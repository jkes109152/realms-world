import { AppError } from "@/lib/security/errors";
import { upstreamJson, record, nonempty, retryAt } from "./http";
import { exchangeXboxOnce, newProofKey, type XboxStage } from "./xbox-auth";
import type { RealmsAuthorization } from "./types";

export const CLIENT_ID = "00000000441cc96b";
const SCOPE = "service::user.auth.xboxlive.com::MBI_SSL";
const CONNECT = "https://login.live.com/oauth20_connect.srf";
const TOKEN = "https://login.live.com/oauth20_token.srf";
export type DeviceState = {
  status: "pending" | "authorized" | "denied" | "expired" | "failed";
  stage: "requesting_code" | "waiting_for_user" | "exchanging_tokens";
  expiresAt: number; nextPollAt: number; intervalSeconds: number;
  deviceCode?: string; userCode?: string; verificationUri?: string; cookie?: string;
  microsoft?: { accessToken: string; refreshToken: string; expiresAt: number };
  proofJwk?: JsonWebKey; exchangeStage?: XboxStage | "refresh_microsoft";
  userToken?: string; deviceToken?: string; titleToken?: string; authorization?: RealmsAuthorization;
};

export function expiresAtFromSeconds(now: number, seconds: unknown): number {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0 || !Number.isSafeInteger(now + seconds * 1000)) throw new AppError("unavailable", 503);
  return now + seconds * 1000;
}

function form(body: Record<string, string>, cookie?: string): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie } : {}) }, body: new URLSearchParams(body).toString() };
}

function terminal(state: DeviceState, status: "denied" | "expired" | "failed"): DeviceState {
  return { status, stage: state.stage, expiresAt: state.expiresAt, nextPollAt: state.nextPollAt, intervalSeconds: state.intervalSeconds };
}

export function initialDeviceState(now: number): DeviceState {
  return { status: "pending", stage: "requesting_code", expiresAt: now + 600000, nextPollAt: now, intervalSeconds: 5 };
}

export async function beginDeviceLogin(now: number, fetcher: typeof fetch = fetch): Promise<DeviceState> {
  return advanceDeviceLoginOnce(initialDeviceState(now), now, fetcher);
}

export async function advanceDeviceLoginOnce(state: DeviceState, now: number, fetcher: typeof fetch = fetch): Promise<DeviceState> {
  if (state.status !== "pending") return state;
  if (now >= state.expiresAt) return terminal(state, "expired");
  if (now < state.nextPollAt) return state;
  if (state.stage === "requesting_code") {
    const { response, data } = await upstreamJson(CONNECT, form({ scope: SCOPE, client_id: CLIENT_ID, response_type: "device_code" }), fetcher);
    if (response.status === 429 || response.status >= 500) return { ...state, nextPollAt: retryAt(response, now) };
    if (!response.ok) return terminal(state, "failed");
    const challenge = record(data);
    const uri = new URL(nonempty(challenge.verification_uri, 2048));
    if (uri.protocol !== "https:" || uri.username || uri.password || uri.port || !["www.microsoft.com", "microsoft.com", "login.live.com", "account.microsoft.com"].includes(uri.hostname)) throw new AppError("unavailable", 503);
    const interval = challenge.interval === undefined ? 5 : challenge.interval;
    if (typeof interval !== "number" || !Number.isSafeInteger(interval) || interval < 1 || interval > 900) throw new AppError("unavailable", 503);
    const cookies = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).filter((value) => /^[^\r\n;=]+=([^\r\n;]*)$/.test(value)).join("; ");
    return { ...state, stage: "waiting_for_user", deviceCode: nonempty(challenge.device_code), userCode: nonempty(challenge.user_code, 64), verificationUri: uri.href, cookie: cookies || undefined,
      expiresAt: expiresAtFromSeconds(now, challenge.expires_in), intervalSeconds: interval, nextPollAt: now + interval * 1000 };
  }
  if (state.stage === "waiting_for_user" || state.exchangeStage === "refresh_microsoft") {
    const refreshing = state.exchangeStage === "refresh_microsoft";
    const body: Record<string, string> = refreshing ? { scope: SCOPE, client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: nonempty(state.microsoft?.refreshToken) }
      : { client_id: CLIENT_ID, device_code: nonempty(state.deviceCode), grant_type: "urn:ietf:params:oauth:grant-type:device_code" };
    const { response, data } = await upstreamJson(`${TOKEN}?client_id=${CLIENT_ID}`, form(body, state.cookie), fetcher);
    if (response.status === 429 || response.status >= 500) return { ...state, nextPollAt: retryAt(response, now, state.intervalSeconds) };
    const token = record(data);
    if (token.error === "authorization_pending" || token.error === "slow_down") {
      const intervalSeconds = state.intervalSeconds + (token.error === "slow_down" ? 5 : 0);
      return { ...state, intervalSeconds, nextPollAt: now + intervalSeconds * 1000 };
    }
    if (token.error === "expired_token") return terminal(state, "expired");
    if (token.error || !response.ok) return terminal(state, "denied");
    return { ...state, stage: "exchanging_tokens", exchangeStage: "user", deviceCode: undefined, userCode: undefined, verificationUri: undefined, cookie: undefined,
      microsoft: { accessToken: nonempty(token.access_token), refreshToken: nonempty(token.refresh_token ?? state.microsoft?.refreshToken), expiresAt: expiresAtFromSeconds(now, token.expires_in) },
      proofJwk: state.proofJwk ?? await newProofKey(), userToken: undefined, deviceToken: undefined, titleToken: undefined, authorization: undefined, nextPollAt: now };
  }
  const stage = state.exchangeStage;
  if (!stage || !state.proofJwk || !state.microsoft) return terminal(state, "failed");
  try {
    const result = await exchangeXboxOnce({ ...state, proofJwk: state.proofJwk, accessToken: state.microsoft.accessToken }, stage, now, fetcher);
    if (typeof result !== "string") return { ...state, status: "authorized", authorization: result, nextPollAt: now };
    const next: Record<XboxStage, XboxStage> = { user: "device", device: "title", title: "xsts", xsts: "xsts" };
    return { ...state, [`${stage}Token`]: result, exchangeStage: next[stage], nextPollAt: now };
  } catch (error) {
    if (error instanceof AppError && error.code === "reauth_required") return terminal(state, "denied");
    if (error instanceof AppError && error.code === "protocol_incompatible") return terminal(state, "failed");
    if (error instanceof AppError && error.status === 503) return { ...state, nextPollAt: now + 5000 };
    throw error;
  }
}
