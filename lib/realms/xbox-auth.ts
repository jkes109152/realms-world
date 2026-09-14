import { AppError } from "@/lib/security/errors";
import { upstreamJson, record, nonempty } from "./http";
import type { RealmsAuthorization } from "./types";

export const REALMS_RELYING_PARTY = "https://pocket.realms.minecraft.net/";
export const XBOX_IDENTITY_RELYING_PARTY = "http://xboxlive.com";
const encoder = new TextEncoder();

function timestamp(now: number) {
  if (!Number.isSafeInteger(now) || now < 0) throw new AppError("invalid_request");
  return (BigInt(Math.floor(now / 1000)) + 11644473600n) * 10000000n;
}

export function xboxSignatureInput(url: string, authorization: string, payload: string, now: number): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(14);
  const view = new DataView(header.buffer);
  view.setInt32(0, 1); view.setBigUint64(5, timestamp(now));
  const tail = encoder.encode(`POST\0${new URL(url).pathname}\0${authorization}\0${payload}\0`);
  const result = new Uint8Array(header.length + tail.length);
  result.set(header); result.set(tail, header.length);
  return result;
}

export async function signXboxRequest(jwk: JsonWebKey, url: string, authorization: string, payload: string, now: number): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, xboxSignatureInput(url, authorization, payload, now)));
  if (signature.length !== 64) throw new AppError("unavailable", 503);
  const header = new Uint8Array(76); const view = new DataView(header.buffer);
  view.setInt32(0, 1); view.setBigUint64(4, timestamp(now)); header.set(signature, 12);
  return Buffer.from(header).toString("base64");
}

export async function newProofKey(): Promise<JsonWebKey> {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return crypto.subtle.exportKey("jwk", keys.privateKey);
}

export type XboxStage = "user" | "device" | "title" | "identity" | "xsts";
export type XboxIdentity = { ownerXuid: string; userHash: string; expiresAt: number };
export type XboxState = { proofJwk: JsonWebKey; accessToken: string; userToken?: string; deviceToken?: string; titleToken?: string; xboxIdentity?: XboxIdentity };

export async function exchangeXboxOnce(state: XboxState, stage: XboxStage, now: number, fetcher: typeof fetch = fetch): Promise<string | RealmsAuthorization> {
  const proof = { kty: state.proofJwk.kty, crv: state.proofJwk.crv, x: state.proofJwk.x, y: state.proofJwk.y, alg: "ES256", use: "sig" };
  const properties = stage === "user" ? { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: `t=${state.accessToken}` }
    : stage === "device" ? { AuthMethod: "ProofOfPossession", Id: `{${crypto.randomUUID()}}`, DeviceType: "Nintendo", SerialNumber: `{${crypto.randomUUID()}}`, Version: "0.0.0", ProofKey: proof }
    : stage === "title" ? { AuthMethod: "RPS", DeviceToken: nonempty(state.deviceToken), RpsTicket: `t=${state.accessToken}`, SiteName: "user.auth.xboxlive.com", ProofKey: proof }
    : { UserTokens: [nonempty(state.userToken)], DeviceToken: nonempty(state.deviceToken), TitleToken: nonempty(state.titleToken), ProofKey: proof, SandboxId: "RETAIL" };
  const paths = { user: "https://user.auth.xboxlive.com/user/authenticate", device: "https://device.auth.xboxlive.com/device/authenticate", title: "https://title.auth.xboxlive.com/title/authenticate", identity: "https://xsts.auth.xboxlive.com/xsts/authorize", xsts: "https://xsts.auth.xboxlive.com/xsts/authorize" };
  const url = paths[stage];
  const body = JSON.stringify({ RelyingParty: stage === "identity" ? XBOX_IDENTITY_RELYING_PARTY : stage === "xsts" ? REALMS_RELYING_PARTY : "http://auth.xboxlive.com", TokenType: "JWT", Properties: properties });
  const { response, data } = await upstreamJson(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "x-xbl-contract-version": stage === "user" ? "2" : "1", Signature: await signXboxRequest(state.proofJwk, url, "", body, now) }, body }, fetcher);
  // 只記錄固定階段及狀態碼，協助辨識相容性失敗；不記上游內容、權杖或識別資料。
  if (!response.ok) console.warn("realms_auth_exchange", { stage, status: response.status });
  if (response.status === 401 || response.status === 403) throw new AppError("reauth_required", 409);
  if (response.status === 429 || response.status >= 500) throw new AppError("unavailable", 503);
  if (!response.ok) throw new AppError("protocol_incompatible", 502);
  const token = record(data);
  if (stage !== "xsts" && stage !== "identity") return nonempty(token.Token);
  const claims = record(token.DisplayClaims).xui;
  if (!Array.isArray(claims) || !claims.length) throw new AppError("reauth_required", 409);
  const claim = record(claims[0]);
  const userHash = nonempty(claim.uhs, 128);
  const identity = state.xboxIdentity;
  const matchingIdentity = stage === "xsts" && identity && identity.expiresAt > now && identity.userHash === userHash;
  const ownerXuid = typeof claim.xid === "string" && claim.xid ? claim.xid : matchingIdentity ? identity.ownerXuid : null;
  if (!ownerXuid || (stage === "xsts" && identity && (!matchingIdentity || ownerXuid !== identity.ownerXuid))) {
    console.warn("realms_auth_exchange", { stage, status: response.status, reason: "missing_owner_claim" });
    throw new AppError("reauth_required", 409);
  }
  const expiresAt = Date.parse(nonempty(token.NotAfter));
  if (!/^\d{1,64}$/.test(ownerXuid) || !Number.isFinite(expiresAt) || expiresAt <= now) throw new AppError("reauth_required", 409);
  return { ownerXuid, userHash, xstsToken: nonempty(token.Token), expiresAt };
}
