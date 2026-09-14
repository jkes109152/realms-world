import { adminRequest } from "@/lib/auth/http";
import { bindings } from "@/lib/db/client";
import { connection, disconnect } from "@/lib/db/connections";
import { startConnection, stepConnection, readConnectionState } from "@/lib/realms/connection-service";
import { refreshWorlds } from "@/lib/realms/world-service";
import { publicCatalog } from "@/lib/realms/public-catalog";
import { setPublication } from "@/lib/realms/publication-service";
import { inspectStoredWorldAssociation } from "@/lib/realms/association-inspection";
import { publishLatestWorld } from "@/lib/realms/latest-publication-service";
import { verificationArchives, createVerificationDownload, stepVerificationDownload, verificationStatus, redeemVerificationDownload } from "@/lib/downloads/verification-service";
import { AppError, errorResponse, jsonResponse, safeHeaders } from "@/lib/security/errors";
import { readJson, readForm, objectInput } from "@/lib/security/request-policy";
import { consumeLimits, sourceDigest } from "@/lib/security/rate-limit";
import type { Selection } from "@/lib/realms/types";

type RouteContext = { params: Promise<{ operation: string }> };
const readOperations = new Set(["connection", "worlds", "catalog", "archives", "association", "download-status"]);
const writeOperations = new Set(["connection-start", "connection-step", "connection-cancel", "disconnect", "publication", "downloads", "download-step", "redeem"]);
function operationAllowed(operation: string, method: "GET" | "POST") {
  if (!readOperations.has(operation) && !writeOperations.has(operation)) throw new AppError("not_found", 404);
  if (!(method === "GET" ? readOperations : writeOperations).has(operation)) throw new AppError("invalid_request", 405);
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new AppError("invalid_request");
  return value;
}
function capability(request: Request) {
  const secret = request.headers.get("X-Download-Capability");
  if (!secret) throw new AppError("not_found", 404);
  return secret;
}
function selection(value: unknown): Selection {
  const input = objectInput(value, ["kind", "archiveId"]);
  if (input.kind === "latest" && !Object.hasOwn(input, "archiveId")) return { kind: "latest" };
  if (input.kind === "backup") return { kind: "backup", archiveId: id(input.archiveId) };
  throw new AppError("invalid_request");
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { db, context: admin } = await adminRequest(request);
    const { operation } = await context.params; operationAllowed(operation, "GET");
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => !(["archives", "association"].includes(operation) ? ["worldId"] : operation === "download-status" ? ["jobId"] : []).includes(key))) throw new AppError("invalid_request");
    if (operation === "connection") return jsonResponse(await readConnectionState(bindings(), admin));
    if (operation === "worlds") return jsonResponse({ items: (await refreshWorlds(bindings())).results });
    if (operation === "catalog") return jsonResponse(await publicCatalog(bindings()));
    if (operation === "association") return jsonResponse(await inspectStoredWorldAssociation(bindings(), id(params.get("worldId"))));
    if (operation === "archives") {
      const archives = await verificationArchives(bindings(), id(params.get("worldId")));
      return jsonResponse({ items: archives.map((item) => ({ archiveId: item.archiveId, kind: item.kind, savedAt: item.savedAt === null ? null : new Date(item.savedAt).toISOString(), sizeBytes: item.sizeBytes, gameVersion: item.gameVersion })) });
    }
    const jobId = id(params.get("jobId"));
    const result = await verificationStatus(bindings(), jobId, capability(request));
    const rate = await consumeLimits(db, "verification", "status", Date.now(), jobId);
    if (!rate.allowed) throw new AppError("rate_limited", 429, rate.retryAfterSeconds);
    return jsonResponse(result);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { operation } = await context.params;
    // 先驗 session，原生表單的 CSRF 則由有限大小 body 取得。
    const initial = await adminRequest(request);
    operationAllowed(operation, "POST");
    if (operation === "redeem") {
      const form = await readForm(request);
      if ([...form.keys()].some((key) => !["ticket", "csrfToken"].includes(key)) || form.getAll("ticket").length !== 1 || form.getAll("csrfToken").length !== 1) throw new AppError("invalid_request");
      await adminRequest(request, { write: true, csrfToken: form.get("csrfToken") || "" });
      return await redeemVerificationDownload(bindings(), form.get("ticket") || "", request.signal);
    }
    await adminRequest(request, { write: true });
    const allowedKeys = operation === "connection-start" || operation === "disconnect" ? []
      : ["connection-step", "connection-cancel"].includes(operation) ? ["attemptId"]
      : operation === "publication" ? ["worldId", "published", "expectedVersion", "acknowledgeLatest"]
      : operation === "downloads" ? ["worldId", "selection"] : ["jobId"];
    const input = objectInput(await readJson(request), allowedKeys);
    const env = bindings(); const { db, context: admin } = initial;
    if (operation === "connection-start") return jsonResponse(await startConnection(env, admin), 201);
    if (operation === "connection-step") return jsonResponse(await stepConnection(env, admin, id(input.attemptId)));
    if (operation === "connection-cancel") {
      const attempt = await db.prepare("SELECT connection_generation FROM auth_attempts WHERE id=? AND admin_session_digest=? AND status='pending'").bind(id(input.attemptId), admin.tokenDigest).first<{connection_generation:number}>();
      if (!attempt) throw new AppError("not_found", 404);
      await disconnect(db, attempt.connection_generation, Date.now()); return new Response(null, { status: 204, headers: safeHeaders });
    }
    if (operation === "disconnect") { const current = await connection(db, Date.now()); await disconnect(db, current.generation, Date.now()); return new Response(null, { status: 204, headers: safeHeaders }); }
    if (operation === "publication") {
      if (typeof input.published !== "boolean" || typeof input.expectedVersion !== "number" || (input.acknowledgeLatest !== undefined && typeof input.acknowledgeLatest !== "boolean")) throw new AppError("invalid_request");
      if (input.published) {
        const rate = await consumeLimits(db, await sourceDigest(request, env.RATE_LIMIT_HMAC_KEY), "create", Date.now());
        if (!rate.allowed) throw new AppError("rate_limited", 429, rate.retryAfterSeconds);
        return jsonResponse(await publishLatestWorld(env, id(input.worldId), input.expectedVersion, input.acknowledgeLatest === true));
      }
      return jsonResponse(await setPublication(db, id(input.worldId), false, input.expectedVersion, false, Date.now()));
    }
    if (operation === "downloads") {
      const selected = selection(input.selection);
      const rate = await consumeLimits(db, await sourceDigest(request, env.RATE_LIMIT_HMAC_KEY), "create", Date.now());
      if (!rate.allowed) throw new AppError("rate_limited", 429, rate.retryAfterSeconds);
      return jsonResponse(await createVerificationDownload(env, id(input.worldId), selected), 202);
    }
    const result = await stepVerificationDownload(env, id(input.jobId), capability(request));
    return jsonResponse(result, result.state === "preparing" ? 202 : 200);
  } catch (error) {
    const response = errorResponse(error);
    if ((await context.params).operation !== "redeem") return response;
    const body = await response.json() as { error: { message: string } };
    const message = body.error.message.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
    return new Response(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>無法開始下載</title><body><main><h1>無法開始下載</h1><p>${message}</p><p>請回到原頁面重新確認世界與版本。</p></main></body></html>`, { status: response.status, headers: { ...safeHeaders, "Content-Type": "text/html; charset=utf-8" } });
  }
}
