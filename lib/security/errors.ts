const messages: Record<string, string> = {
  downloads_closed: "世界下載尚未對訪客開放。",
  authorization_refreshing: "正在更新 Microsoft 連線授權，完成後會自動繼續…",
  world_preparing: "官方正在準備最新存檔，請稍後再次發布。",
  login_failed: "帳號或密碼不正確。", session_expired: "請重新登入管理介面。", not_available: "世界目前未開放或無法使用。",
  version_conflict: "資料已變更，請重新確認後再操作。", temporarily_unavailable: "目前暫時無法使用，請稍後再試。",
  protocol_incompatible: "來源能力尚未完成驗證。", connection_required: "請管理員重新連接 Microsoft 帳號。", invalid_archive: "無法取得有效世界檔。",
  unauthorized: "請重新登入管理介面。", forbidden: "這項操作未獲授權。", not_found: "找不到可用的項目。",
  invalid_request: "請檢查輸入內容。", conflict: "資料已變更，請重新確認後再操作。",
  rate_limited: "請稍候再試。", unavailable: "服務暫時無法使用。", database_unavailable: "服務暫時無法確認操作結果。",
  source_not_configured: "來源能力尚未完成驗證。", slot_unverifiable: "無法確認世界與存檔的歸屬。",
  invalid_source: "官方來源未提供可驗證的世界檔案。", reauth_required: "請管理員重新連接 Microsoft 帳號。",
  preparation_limit_reached: "世界準備已達本次上限，請稍後重新建立下載。",
};

export class AppError extends Error {
  constructor(public code: string, public status = 400, public retryAfterSeconds?: number) { super(code); }
}

export const safeHeaders = {
  "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
};

export function jsonResponse(data: unknown, status = 200, extra: HeadersInit = {}) {
  const headers = new Headers(extra);
  for (const [key, value] of Object.entries(safeHeaders)) headers.set(key, value);
  return Response.json(status < 400 ? { data } : data, { status, headers });
}

export function errorResponse(error: unknown): Response {
  const known = error instanceof AppError ? error : new AppError("unavailable", 503);
  const aliases: Record<string, string> = { unauthorized: "session_expired", not_found: "not_available", conflict: "version_conflict", unavailable: "temporarily_unavailable", database_unavailable: "temporarily_unavailable", source_not_configured: "protocol_incompatible", reauth_required: "connection_required", invalid_source: "invalid_archive" };
  const code = aliases[known.code] ?? (Object.hasOwn(messages, known.code) ? known.code : "temporarily_unavailable");
  return jsonResponse({ error: { code, message: messages[code], retryAfterSeconds: known.retryAfterSeconds ?? null, requestId: crypto.randomUUID() } }, known.code === "reauth_required" ? 503 : known.status,
    known.retryAfterSeconds ? { "Retry-After": String(known.retryAfterSeconds) } : {});
}
