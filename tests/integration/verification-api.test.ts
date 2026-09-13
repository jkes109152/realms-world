import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { GET, POST } from "@/app/api/admin/verification/[operation]/route";
import { createSession } from "@/lib/auth/session";
import { requireSession } from "@/lib/auth/session";
import { startConnection, readConnectionState, stepConnection } from "@/lib/realms/connection-service";
import { disconnect } from "@/lib/db/connections";

const now = () => Date.now();
const origin = "https://realms.example.test";
const context = (operation: string) => ({ params: Promise.resolve({ operation }) });
async function admin() {
  const time = now();
  await env.DB.prepare("INSERT INTO admin_accounts VALUES(1,'admin','fixture-hash',1,?,?)").bind(time, time).run();
  return createSession(env.DB, 1, time);
}
function request(operation: string, token?: string, body?: unknown, csrf?: string) {
  return new Request(`${origin}/api/admin/verification/${operation}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { Cookie: `__Host-realms_session=${token}` } : {}), Origin: origin, "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": csrf } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
it("驗證入口要求有效管理員 session", async () => {
  expect((await GET(request("association"), context("association"))).status).toBe(401);
  expect((await GET(request("connection"), context("connection"))).status).toBe(401);
  const session = await admin();
  await env.DB.prepare("DELETE FROM admin_sessions").run();
  expect((await GET(request("connection", session.token), context("connection"))).status).toBe(401);
});
it("未知操作、方法錯誤、缺 CSRF 與跨來源操作均拒絕", async () => {
  const session = await admin();
  expect((await GET(request("sql", session.token), context("sql"))).status).toBe(404);
  expect((await GET(request("connection-start", session.token), context("connection-start"))).status).toBe(405);
  expect((await POST(request("disconnect", session.token, {}), context("disconnect"))).status).toBe(403);
  const cross = request("disconnect", session.token, {}, session.csrfToken); cross.headers.set("Origin", "https://evil.example.test");
  expect((await POST(cross, context("disconnect"))).status).toBe(403);
});
it("不接收任意 URL 或 SQL，未發布世界與舊票都拒絕", async () => {
  const session = await admin();
  expect((await GET(new Request(request("association", session.token).url + "?worldId=unknown&url=https://internal.invalid", request("association", session.token)), context("association"))).status).toBe(400);
  expect((await GET(new Request(request("association", session.token).url + "?worldId=unknown", request("association", session.token)), context("association"))).status).toBe(404);
  expect((await POST(request("downloads", session.token, { worldId: "unknown", selection: { kind: "latest" }, url: "https://internal.invalid" }, session.csrfToken), context("downloads"))).status).toBe(400);
  expect((await POST(request("downloads", session.token, { worldId: "unknown", selection: { kind: "latest" } }, session.csrfToken), context("downloads"))).status).toBe(404);
  const form = new Request(`${origin}/api/admin/verification/redeem`, { method: "POST", headers: { Cookie: `__Host-realms_session=${session.token}`, Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ticket: "a".repeat(43), csrfToken: session.csrfToken }) });
  expect((await POST(form, context("redeem"))).status).toBe(404);
});
it("DOWNLOADS_ENABLED=false 仍只允許管理員讀取安全連線狀態", async () => {
  const session = await admin();
  const response = await GET(request("connection", session.token), context("connection"));
  expect(response.status).toBe(200);
  expect(JSON.stringify(await response.json())).not.toMatch(/credential_box|refresh_token|xstsToken/);
});
it("已登入的管理員可建立尚未對外請求的授權工作", async () => {
  const session = await admin();
  const adminContext = await requireSession(env.DB, session.token, Date.now());
  const started = await startConnection({ ...env, AUTH_ACTIVE_KEY_ID: "fixture", AUTH_KEYRING: JSON.stringify({ fixture: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }) }, adminContext);
  expect(started.stage).toBe("requesting_code");
  expect(started.userCode).toBeNull();
  expect((await env.DB.prepare("SELECT status FROM realm_connections WHERE id=1").first())?.status).toBe("authorizing");
});

it("重開頁面可找回本 session 的授權工作，其他 session 不能取得其 challenge", async () => {
  const session = await admin();
  const adminContext = await requireSession(env.DB, session.token, Date.now());
  const runtime = { ...env, AUTH_ACTIVE_KEY_ID: "fixture", AUTH_KEYRING: JSON.stringify({ fixture: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }) };
  const started = await startConnection(runtime, adminContext);
  const resumed = await readConnectionState(runtime, adminContext);
  expect(resumed).toMatchObject({ state: "authorizing", pendingAttempt: { attemptId: started.attemptId, state: "pending", stage: "requesting_code" } });
  const time = Date.now();
  await stepConnection(runtime, adminContext, started.attemptId, { now: () => time, fetcher: (async () => Response.json({
    device_code: "private-device-secret", user_code: "USER-CODE", verification_uri: "https://microsoft.com/link", expires_in: 900, interval: 5,
  })) as typeof fetch });
  const challenge = await readConnectionState(runtime, adminContext, time);
  expect(challenge.pendingAttempt).toMatchObject({ stage: "waiting_for_user", userCode: "USER-CODE", verificationUri: "https://microsoft.com/link", retryAfterSeconds: 5 });
  expect(JSON.stringify(challenge)).not.toMatch(/encrypted_state|deviceCode|private-device-secret|refreshToken|credential_box/);
  const other = await createSession(env.DB, 1, Date.now());
  expect(await readConnectionState(runtime, await requireSession(env.DB, other.token, Date.now()))).toMatchObject({ state: "authorizing", pendingAttempt: null });
  expect((await readConnectionState(runtime, adminContext, time + 900000)).pendingAttempt).toMatchObject({ userCode: null, verificationUri: null, retryAfterSeconds: 0 });
  await disconnect(env.DB, challenge.generation, time);
  expect(await readConnectionState(runtime, adminContext, time)).toMatchObject({ state: "disconnected", pendingAttempt: null });
});
