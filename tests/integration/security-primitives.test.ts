import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { maintainAdmin } from "@/lib/auth/maintenance";
import { createSession, requireSession, changePassword } from "@/lib/auth/session";
import { hashPassword, verifyPassword, validatePassword } from "@/lib/auth/password";
import { seal, unseal, digest, randomSecret } from "@/lib/security/crypto-box";
import { assertCsrf, readJson, assertOrigin } from "@/lib/security/request-policy";
import { consumeLimits } from "@/lib/security/rate-limit";
import { claimDownloadStep } from "@/lib/db/downloads";
import { clock } from "../fixtures/clock";

const initial = Date.UTC(2026, 8, 14);
// 人工測試封裝；帳號競爭測試不以此值執行密碼驗證。
const hash = "scrypt$v1$16384$8$5$33554432$32$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const bootstrap = (secret = "a".repeat(64)) => maintainAdmin(env.DB, secret, { action: "bootstrap", username: "admin", passwordHash: hash, expectedCredentialVersion: null }, initial);

describe("D1 帳號、版本與原子維護", () => {
  it("同時初始化最多一個帳號且只消耗成功秘密", async () => {
    const results = await Promise.allSettled([bootstrap(), bootstrap("b".repeat(64))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await env.DB.prepare("SELECT count(*) n FROM admin_accounts").first<{n:number}>())?.n).toBe(1);
    expect((await env.DB.prepare("SELECT count(*) n FROM maintenance_operations").first<{n:number}>())?.n).toBe(1);
    await expect(env.DB.prepare("INSERT INTO admin_accounts VALUES(2,'other',?,1,?,?)").bind(hash, initial, initial).run()).rejects.toThrow();
  });
  it("過時 reset 整批回滾、不刪 session、不消耗秘密；更正後成功且不可重放", async () => {
    await bootstrap();
    const session = await createSession(env.DB, 1, initial);
    const operation = "b".repeat(64);
    const reset = { action: "reset" as const, username: "admin", passwordHash: hash, expectedCredentialVersion: 2 };
    await expect(maintainAdmin(env.DB, operation, reset, initial + 1)).rejects.toMatchObject({ code: "conflict" });
    expect(await requireSession(env.DB, session.token, initial + 2)).toMatchObject({ credentialVersion: 1 });
    expect(await env.DB.prepare("SELECT * FROM maintenance_operations WHERE operation_digest=?").bind(operation).first()).toBeNull();
    expect(await maintainAdmin(env.DB, operation, { ...reset, expectedCredentialVersion: 1 }, initial + 3)).toEqual({ action: "reset", credentialVersion: 2 });
    await expect(requireSession(env.DB, session.token, initial + 4)).rejects.toThrow();
    await expect(maintainAdmin(env.DB, operation, { ...reset, expectedCredentialVersion: 2 }, initial + 5)).rejects.toThrow();
    expect((await env.DB.prepare("SELECT credential_version v FROM admin_accounts").first<{v:number}>())?.v).toBe(2);
  });
  it("不存在帳號的 reset 不新增防重放摘要", async () => {
    await expect(maintainAdmin(env.DB, "c".repeat(64), { action: "reset", username: "admin", passwordHash: hash, expectedCredentialVersion: 1 }, initial)).rejects.toMatchObject({ code: "conflict" });
    expect((await env.DB.prepare("SELECT count(*) n FROM maintenance_operations").first<{n:number}>())?.n).toBe(0);
  });
  it("已提交但回應遺失時只讀回操作證據，不重播維護寫入", async () => {
    let writes = 0;
    const uncertain = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch") return async (statements: D1PreparedStatement[]) => { writes++; await target.batch(statements); throw new Error("artificial_lost_response"); };
        const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await maintainAdmin(uncertain, "c".repeat(64), { action: "bootstrap", username: "admin", passwordHash: hash, expectedCredentialVersion: null }, initial)).toEqual({ action: "bootstrap", credentialVersion: 1 });
    expect(writes).toBe(1);
    expect((await env.DB.prepare("SELECT count(*) n FROM maintenance_operations").first<{n:number}>())?.n).toBe(1);
  });
  it("重設後舊版本登入無法插入；過時改密碼不刪較新 session", async () => {
    await bootstrap();
    await changePassword(env.DB, 1, hash, initial + 1);
    const current = await createSession(env.DB, 2, initial + 2);
    await expect(createSession(env.DB, 1, initial + 3)).rejects.toThrow();
    await expect(changePassword(env.DB, 1, hash, initial + 4)).rejects.toMatchObject({ code: "conflict" });
    expect(await requireSession(env.DB, current.token, initial + 5)).toMatchObject({ credentialVersion: 2 });
  });
  it("session 到期及 CSRF、Origin 與 body 上限都由後端驗證", async () => {
    await bootstrap();
    const session = await createSession(env.DB, 1, initial);
    const context = await requireSession(env.DB, session.token, initial + 1);
    await expect(assertCsrf(session.csrfToken, context.csrfDigest)).resolves.toBeUndefined();
    await expect(assertCsrf(randomSecret(), context.csrfDigest)).rejects.toThrow();
    await expect(requireSession(env.DB, session.token, initial + 1800001)).rejects.toThrow();
    expect(() => assertOrigin(new Request("https://realms.example.test", { headers: { Origin: "https://evil.example.test" } }), "https://realms.example.test")).toThrow();
    await expect(readJson(new Request("https://realms.example.test", { method: "POST", headers: { "content-type": "application/json" }, body: '"' + "a".repeat(16384) + '"' }))).rejects.toThrow();
    const second = await createSession(env.DB, 1, initial);
    await env.DB.prepare("UPDATE admin_sessions SET last_seen_at=? WHERE token_digest=?").bind(initial + 43199999, await digest(second.token)).run();
    await expect(requireSession(env.DB, second.token, initial + 43200000)).rejects.toThrow();
  });
  it("閒置 session 失效後清除關聯的待授權秘密", async () => {
    await bootstrap();
    const session = await createSession(env.DB, 1, initial);
    await env.DB.prepare("INSERT INTO auth_attempts(id,admin_session_digest,credential_version,connection_generation,encrypted_state,expires_at,next_poll_at,created_at) VALUES('expired-attempt',?,1,1,'artificial-encrypted-state',?,?,?)").bind(await digest(session.token), initial + 600000, initial, initial).run();
    await expect(requireSession(env.DB, session.token, initial + 1800000)).rejects.toThrow();
    expect(await env.DB.prepare("SELECT * FROM auth_attempts WHERE id='expired-attempt'").first()).toBeNull();
  });
});

describe("密碼與密文", () => {
  it("保持密碼原文、固定成本、每次不同 salt", async () => {
    const password = "  測試密碼不可以被截斷或去空白  ";
    expect(() => validatePassword("a".repeat(14))).toThrow();
    expect(() => validatePassword("😀".repeat(129))).toThrow();
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    expect(first).not.toBe(second);
    expect(first.startsWith("scrypt$v1$16384$8$5$33554432$32$")).toBe(true);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword(password.trim(), first)).toBe(false);
    expect(await verifyPassword(password, first.replace("16384", "1024"))).toBe(false);
  });
  it("nonce 不重用，標籤及用途／世代變更皆不能解密", async () => {
    const keyring = { artificial: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" };
    const context = { purpose: "auth", connectionId: 1, generation: 3 };
    const first = await seal({ artificialToken: "fixture" }, context, keyring, "artificial");
    const second = await seal({ artificialToken: "fixture" }, context, keyring, "artificial");
    expect(first).not.toBe(second);
    expect(await unseal(first, context, keyring)).toEqual({ artificialToken: "fixture" });
    for (const changed of [{ ...context, generation: 4 }, { ...context, purpose: "download" }]) await expect(unseal(first, changed, keyring)).rejects.toThrow();
    const altered = JSON.parse(first); altered.ciphertext = altered.ciphertext.slice(0, -4) + "AAAA";
    await expect(unseal(JSON.stringify(altered), context, keyring)).rejects.toThrow();
  });
});

it("登入每來源 5 次上限由 D1 原子計數，獨立請求不重設", async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => consumeLimits(env.DB, "d".repeat(64), "login", initial)));
  expect(results.filter((r) => r.allowed)).toHaveLength(5);
  expect((await consumeLimits(env.DB, "e".repeat(64), "login", initial)).allowed).toBe(false);
});

it("世界準備只在取得租約時扣次數，並行／接手最多 20 次，授權分段不計數", async () => {
  const time = clock(initial);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO realm_connections(id,generation,status,owner_xuid,updated_at) VALUES(1,1,'connected','fixture-owner',?)").bind(initial),
    env.DB.prepare("INSERT INTO realms(id,source_realm_id,connection_id,connection_generation,verified_owner_xuid,source_name,availability,fetched_at) VALUES(1,'fixture-realm',1,1,'fixture-owner','人工 Realm','available',?)").bind(initial),
    env.DB.prepare("INSERT INTO world_slots(id,public_id,realm_id,source_slot_id,connection_generation,source_identity,association_status,display_name,published,publication_version,fetched_at,updated_at) VALUES(1,'fixture-world',1,'2',1,'fixture-content','verified','人工世界',1,1,?,?)").bind(initial, initial),
    env.DB.prepare("INSERT INTO download_jobs(id,status_secret_digest,world_slot_id,connection_generation,publication_version,selector_kind,association_evidence,next_poll_at,expires_at,status_expires_at,created_at) VALUES('fixture-job',?,1,1,1,'latest','fixture-content',?,?,?,?)").bind("f".repeat(64), initial, initial + 600000, initial + 2592000000, initial),
  ]);
  await claimDownloadStep(env.DB, "fixture-job", "authorization", time.now(), "authorization");
  expect((await env.DB.prepare("SELECT prepare_attempts n FROM download_jobs").first<{n:number}>())?.n).toBe(0);
  await env.DB.prepare("UPDATE download_jobs SET step_owner=NULL,step_until=NULL").run();
  for (let attempt = 1; attempt <= 20; attempt++) {
    const result = await Promise.all(Array.from({ length: 5 }, (_, i) => claimDownloadStep(env.DB, "fixture-job", `request-${attempt}-${i}`, time.now(), "prepare")));
    expect(result.filter(Boolean)).toHaveLength(1);
    if (attempt < 20) {
      // 模擬一次請求結束並可接手；保留 D1 已消耗次數。
      await env.DB.prepare("UPDATE download_jobs SET step_owner=NULL,step_until=NULL,next_poll_at=?").bind(time.advance(1000)).run();
    }
  }
  time.advance(30001);
  expect(await claimDownloadStep(env.DB, "fixture-job", "request-21", time.now(), "prepare")).toBeNull();
  expect(await env.DB.prepare("SELECT state,prepare_attempts,safe_error_code FROM download_jobs").first()).toMatchObject({ state: "failed", prepare_attempts: 20, safe_error_code: "preparation_limit_reached" });
});
