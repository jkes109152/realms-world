import { siteOrigin, type AppEnv } from "./env";

/** 頁面導覽先進入正式網域；API 與帶有表單內容的請求不轉送。 */
export function canonicalPageRedirect(request: Request, env: Pick<AppEnv, "SITE_ORIGIN">): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const current = new URL(request.url);
  if (current.pathname !== "/" && current.pathname !== "/admin" && !current.pathname.startsWith("/admin/")) return null;
  const origin = siteOrigin(env);
  if (current.origin === origin) return null;
  const target = new URL(origin);
  target.pathname = current.pathname;
  return new Response(null, { status: 307, headers: {
    Location: target.href,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  } });
}
