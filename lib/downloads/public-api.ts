import type { AppEnv } from "@/lib/security/env";
import { publicDownloadsEnabled, siteOrigin } from "@/lib/security/env";
import { AppError, errorResponse, jsonResponse, safeHeaders } from "@/lib/security/errors";
import { assertOrigin, objectInput, readJson, readForm } from "@/lib/security/request-policy";
import { sourceDigest, consumeLimits } from "@/lib/security/rate-limit";
import { publicCatalog } from "@/lib/realms/public-catalog";
import { createVerificationDownload as createDownload, stepVerificationDownload as stepDownload, verificationStatus as downloadStatus, redeemVerificationDownload as redeemDownload } from "./verification-service";

function id(value: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new AppError("not_found", 404);
  return value;
}
function capability(request: Request) {
  const value = request.headers.get("X-Download-Capability");
  if (!value) throw new AppError("not_found", 404);
  return value;
}
function access(request: Request, env: AppEnv) {
  if (!publicDownloadsEnabled(env)) throw new AppError("downloads_closed", 503);
  if (new URL(request.url).search) throw new AppError("invalid_request");
  if (request.method !== "GET" && request.method !== "POST") throw new AppError("invalid_request", 405);
  if (request.method === "POST") assertOrigin(request, siteOrigin(env));
}
async function rate(request: Request, env: AppEnv, kind: "public" | "create" | "status", jobId?: string) {
  const result = await consumeLimits(env.DB, await sourceDigest(request, env.RATE_LIMIT_HMAC_KEY), kind, Date.now(), jobId);
  if (!result.allowed) throw new AppError("rate_limited", 429, result.retryAfterSeconds);
}
function publicError(error: unknown) {
  return errorResponse(error instanceof AppError && ["reauth_required", "slot_unverifiable", "source_not_configured"].includes(error.code) ? new AppError("unavailable", 503) : error);
}
export async function worldsRequest(request: Request, path: string[], env: AppEnv) {
  try {
    access(request, env);
    if (request.method === "GET" && path.length <= 1) {
      await rate(request, env, "public");
      const catalog = await publicCatalog(env, path[0] === undefined ? undefined : id(path[0]));
      return jsonResponse(path.length ? { world: catalog.items[0], latest: { id: "latest", kind: "latest", savedAt: null, sizeBytes: null, gameVersion: null }, fetchedAt: catalog.fetchedAt } : catalog);
    }
    if (request.method === "POST" && path.length === 2 && path[1] === "downloads") {
      const input = objectInput(await readJson(request), ["selection"]);
      const selection = objectInput(input.selection, ["kind"]);
      if (selection.kind !== "latest") throw new AppError("invalid_request");
      await rate(request, env, "create");
      return jsonResponse(await createDownload(env, id(path[0]), { kind: "latest" }), 202);
    }
    throw new AppError("not_found", 404);
  } catch (error) { return publicError(error); }
}

export async function downloadsRequest(request: Request, path: string[], env: AppEnv) {
  const redeem = path.length === 1 && path[0] === "redeem" && request.method === "POST";
  try {
    access(request, env);
    if (redeem) {
      const form = await readForm(request);
      if ([...form.keys()].some(key => key !== "ticket") || form.getAll("ticket").length !== 1) throw new AppError("invalid_request");
      await rate(request, env, "public");
      return await redeemDownload(env, form.get("ticket") || "", request.signal);
    }
    if (path.length === 1 && request.method === "GET") {
      const jobId = id(path[0]), secret = capability(request);
      await rate(request, env, "public");
      const value = await downloadStatus(env, jobId, secret);
      await rate(request, env, "status", jobId);
      return jsonResponse(value);
    }
    if (path.length === 2 && path[1] === "step" && request.method === "POST") {
      objectInput(await readJson(request), []);
      const jobId = id(path[0]), secret = capability(request);
      await rate(request, env, "public");
      // 先驗 capability，避免陌生請求耗盡合法工作的狀態額度。
      await downloadStatus(env, jobId, secret);
      await rate(request, env, "status", jobId);
      const value = await stepDownload(env, jobId, secret);
      return jsonResponse(value, value.state === "preparing" ? 202 : 200);
    }
    throw new AppError("not_found", 404);
  } catch (error) {
    const response = publicError(error);
    if (!redeem) return response;
    const value = await response.json() as {error:{message:string}};
    const message = value.error.message.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
    return new Response(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>無法開始下載</title><body><main><h1>無法開始下載</h1><p>${message}</p><p><a href="/">回到世界列表重新下載</a></p></main></body></html>`, { status: response.status, headers: { ...safeHeaders, "Content-Type": "text/html; charset=utf-8" } });
  }
}
