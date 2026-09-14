import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { worldsRequest, downloadsRequest } from "@/lib/downloads/public-api";
import { seal } from "@/lib/security/crypto-box";
import { setPublication } from "@/lib/realms/publication-service";
import { fetchSequence } from "../fixtures/streams";

const origin = "https://realms.example.test";
function request(path: string, body?: unknown, secret?: string) {
  return new Request(origin + path, { method: body === undefined ? "GET" : "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(secret ? { "X-Download-Capability": secret } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function fixture() {
  const now = Date.now(), keyring = { fixture: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" };
  const box = await seal({ status: "authorized", authorization: { ownerXuid: "fixture-owner", userHash: "fixture", xstsToken: "secret-token", expiresAt: now + 3600000 } }, { purpose: "connection", connectionId: 1, generation: 1 }, keyring, "fixture");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO realm_connections(id,generation,status,owner_xuid,credential_box,updated_at) VALUES(1,1,'connected','fixture-owner',?,?)").bind(box, now),
    env.DB.prepare("INSERT INTO realms(id,source_realm_id,connection_id,connection_generation,verified_owner_xuid,source_name,availability,fetched_at) VALUES(1,'7001',1,1,'fixture-owner','私人 Realm 名稱','available',?)").bind(now),
    env.DB.prepare("INSERT INTO world_slots(id,public_id,realm_id,source_slot_id,connection_generation,source_identity,association_status,display_name,description,fetched_at,updated_at) VALUES(1,'public-world',1,'3',1,'latest-slot-v1:7001:3','verified','公開世界','測試用說明',?,?)").bind(now, now),
    env.DB.prepare("INSERT INTO world_slots(id,public_id,realm_id,source_slot_id,connection_generation,source_identity,association_status,display_name,fetched_at,updated_at) VALUES(2,'private-world',1,'2',1,'latest-slot-v1:7001:2','verified','私人世界',?,?)").bind(now, now),
  ]);
  await setPublication(env.DB, "public-world", true, 0, true, now);
  return { ...env, DOWNLOADS_ENABLED: "true", REALMS_CLIENT_VERSION: "1.26.45", AUTH_ACTIVE_KEY_ID: "fixture", AUTH_KEYRING: JSON.stringify(keyring), REALMS_DOWNLOAD_HOSTS: '["download.example.test"]' };
}

it("匿名只看到已發布的安全投影，關閉總開關不洩漏列表", async () => {
  const runtime = await fixture();
  const response = await worldsRequest(request("/api/worlds"), [], runtime);
  expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store");
  const data = await response.json() as {data:{items:unknown[]}}; expect(data.data.items).toHaveLength(1);
  expect(JSON.stringify(data)).not.toMatch(/私人|source_identity|7001|fixture-owner|xstsToken|secret-token/);
  expect((await worldsRequest(request("/api/worlds"), [], { ...runtime, DOWNLOADS_ENABLED: "false" })).status).toBe(503);
  expect((await worldsRequest(request("/api/worlds/private-world"), ["private-world"], runtime)).status).toBe(404);
});

it("每次訪客下載建立新工作並重新請求官方 latest，不重用前次描述", async () => {
  const runtime = await fixture();
  const detail = () => Response.json({ id: "7001", ownerUUID: "fixture-owner", state: "OPEN", expired: false, slots: [{ slotId: 3, options: '{}' }] });
  const { fetcher, requests } = fetchSequence([detail(), Response.json({ downloadUrl: "https://download.example.test/new-one" }), detail(), Response.json({ downloadUrl: "https://download.example.test/new-two" })]);
  vi.spyOn(globalThis, "fetch").mockImplementation(fetcher);
  const jobs = [];
  for (let index = 0; index < 2; index++) {
    const created = await worldsRequest(request("/api/worlds/public-world/downloads", { selection: { kind: "latest" } }), ["public-world", "downloads"], runtime);
    expect(created.status).toBe(202); const job = (await created.json() as {data:{jobId:string;statusSecret:string}}).data; jobs.push(job);
    const stepped = await downloadsRequest(request(`/api/downloads/${job.jobId}/step`, {}, job.statusSecret), [job.jobId, "step"], runtime);
    expect(stepped.status).toBe(200); const ready = (await stepped.json() as {data:{state:string;ticket:string}}).data; expect(ready.state).toBe("ready"); expect(ready.ticket).toBeTruthy();
    expect(JSON.stringify(ready)).not.toMatch(/download\.example|secret-token|7001/);
    const closed = { ...runtime, DOWNLOADS_ENABLED: "false" };
    expect((await downloadsRequest(request(`/api/downloads/${job.jobId}`, undefined, job.statusSecret), [job.jobId], closed)).status).toBe(503);
    expect((await downloadsRequest(request(`/api/downloads/${job.jobId}/step`, {}, job.statusSecret), [job.jobId, "step"], closed)).status).toBe(503);
    const redeem = new Request(origin + "/api/downloads/redeem", { method: "POST", headers: { Origin: origin }, body: new URLSearchParams({ ticket: ready.ticket }) });
    const rejected = await downloadsRequest(redeem, ["redeem"], closed);
    expect(rejected.status).toBe(503); expect(rejected.headers.get("Content-Disposition")).toBeNull();
    expect(await rejected.text()).toContain("尚未對訪客開放");
    expect((await env.DB.prepare("SELECT state FROM download_jobs WHERE id=?").bind(job.jobId).first())?.state).toBe("ready");
    const status = await downloadsRequest(request(`/api/downloads/${job.jobId}`, undefined, job.statusSecret), [job.jobId], runtime);
    expect((await status.json() as {data:{ticket?:string}}).data.ticket).toBeUndefined();
    expect((await downloadsRequest(request(`/api/downloads/${job.jobId}`, undefined, "x".repeat(43)), [job.jobId], runtime)).status).toBe(404);
  }
  expect(jobs[0].jobId).not.toBe(jobs[1].jobId);
  expect(requests.map(r => new URL(r.url).pathname)).toEqual(["/worlds/7001", "/archive/download/world/7001/3/latest", "/worlds/7001", "/archive/download/world/7001/3/latest"]);
  await setPublication(env.DB, "public-world", false, 1, false, Date.now());
  expect((await downloadsRequest(request(`/api/downloads/${jobs[0].jobId}`, undefined, jobs[0].statusSecret), [jobs[0].jobId], runtime)).status).toBe(404);
});

it("拒絕歷史、任意 URL、跨來源與關閉後的新下載", async () => {
  const runtime = await fixture();
  for (const body of [{ selection: { kind: "backup", archiveId: "private" } }, { selection: { kind: "latest" }, url: "https://internal.invalid" }]) {
    expect((await worldsRequest(request("/api/worlds/public-world/downloads", body), ["public-world", "downloads"], runtime)).status).toBe(400);
  }
  const cross = request("/api/worlds/public-world/downloads", { selection: { kind: "latest" } }); cross.headers.set("Origin", "https://evil.example.test");
  expect((await worldsRequest(cross, ["public-world", "downloads"], runtime)).status).toBe(403);
  expect((await worldsRequest(request("/api/worlds/public-world/downloads", { selection: { kind: "latest" } }), ["public-world", "downloads"], { ...runtime, DOWNLOADS_ENABLED: "false" })).status).toBe(503);
});
