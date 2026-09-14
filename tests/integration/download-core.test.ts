import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { createJob, claimDownloadStep, readyJob, consumeTicket, beginStreaming, visibleJob } from "@/lib/db/downloads";
import { setPublication } from "@/lib/realms/publication-service";
import { invalidateMissingSlots, refreshWorlds } from "@/lib/realms/world-service";
import { errorResponse } from "@/lib/security/errors";
import { connection, claimRefresh, saveRefresh, disconnect } from "@/lib/db/connections";
import { finishTransfer, recentDownloadAttempt } from "@/lib/audit/writer";
import { publishLatestWorld } from "@/lib/realms/latest-publication-service";
import { seal } from "@/lib/security/crypto-box";
import { fetchSequence } from "../fixtures/streams";

const now = Date.UTC(2026, 8, 14);

async function latestFixture() {
  const keyring = { fixture: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" };
  const authorization = { ownerXuid: "fixture-owner", userHash: "fixture", xstsToken: "fixture-token", expiresAt: now + 3600000 };
  const box = await seal({ status: "authorized", authorization }, { purpose: "connection", connectionId: 1, generation: 1 }, keyring, "fixture");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO realm_connections(id,generation,status,owner_xuid,credential_box,updated_at) VALUES(1,1,'connected','fixture-owner',?,?)").bind(box, now),
    env.DB.prepare("INSERT INTO realms(id,source_realm_id,connection_id,connection_generation,verified_owner_xuid,source_name,availability,fetched_at) VALUES(1,'7001',1,1,'fixture-owner','人工 Realm','available',?)").bind(now),
    env.DB.prepare("INSERT INTO world_slots(id,public_id,realm_id,source_slot_id,connection_generation,display_name,fetched_at,updated_at) VALUES(1,'fixture-world',1,'3',1,'人工最新世界',?,?)").bind(now, now),
  ]);
  const runtime = { ...env, AUTH_ACTIVE_KEY_ID: "fixture", AUTH_KEYRING: JSON.stringify(keyring), REALMS_CLIENT_VERSION: "1.26.45", REALMS_DOWNLOAD_HOSTS: '["download.example.test"]' };
  return runtime;
}

it("續期等待回傳專用重試訊號，保留已發布世界，不讀取未就緒來源", async () => {
  const runtime = await latestFixture(); const currentTime = Date.now();
  const box = await seal({ status: "pending", stage: "exchanging_tokens", expiresAt: currentTime + 600000, nextPollAt: currentTime + 30000, intervalSeconds: 5 },
    { purpose: "connection", connectionId: 1, generation: 1 }, JSON.parse(runtime.AUTH_KEYRING), "fixture");
  await env.DB.prepare("UPDATE realm_connections SET credential_box=?").bind(box).run();
  await env.DB.prepare("UPDATE world_slots SET source_identity='latest-slot-v1:7001:3',association_status='verified'").run();
  await setPublication(env.DB, "fixture-world", true, 0, true, currentTime);
  const failure = await refreshWorlds(runtime).then(() => { throw new Error("來源不應就緒"); }, (error) => error);
  const response = errorResponse(failure);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: { code: "authorization_refreshing" } });
  expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  expect(await env.DB.prepare("SELECT published,publication_version FROM world_slots").first()).toEqual({ published: 1, publication_version: 1 });
  expect((await connection(env.DB, currentTime)).generation).toBe(1);
});

it("只發布最新存檔不查歷史，固定欄位來源核對後發布，歷史工作仍拒絕", async () => {
  const runtime = await latestFixture();
  const { fetcher, requests } = fetchSequence([
    Response.json({ id: "7001", ownerUUID: "fixture-owner", state: "OPEN", expired: false, slots: [{ slotId: 3, options: '{"slotName":"人工最新世界"}' }] }),
    Response.json({ downloadUrl: "https://download.example.test/world", size: 1024 }),
  ]);
  expect(await publishLatestWorld(runtime, "fixture-world", 0, true, { now: () => now, fetcher })).toMatchObject({ published: true, publicationScope: "latest" });
  expect(requests.map((r) => new URL(r.url).pathname)).toEqual(["/worlds/7001", "/archive/download/world/7001/3/latest"]);
  const latest = await createJob(env.DB, { worldPublicId: "fixture-world", kind: "latest", sourceBackupId: null, associationEvidence: "latest-slot-v1:7001:3", archiveLabel: "latest" }, now);
  expect(latest.state).toBe("preparing");
  await expect(createJob(env.DB, { worldPublicId: "fixture-world", kind: "backup", sourceBackupId: "private-old-id", associationEvidence: "fixture", archiveLabel: "backup" }, now)).rejects.toMatchObject({ code: "not_found" });
});

it.each([
  { label: "擁有者不符", owner: "another-owner", host: "download.example.test", code: "forbidden", calls: 1 },
  { label: "未驗證下載主機", owner: "fixture-owner", host: "unknown.example.test", code: "source_not_configured", calls: 2 },
  { label: "官方尚在準備", owner: "fixture-owner", host: "download.example.test", code: "world_preparing", calls: 2 },
])("$label 時保持私有，不建立工作或票據", async ({owner, host, code, calls}) => {
  const runtime = await latestFixture();
  const { fetcher, requests } = fetchSequence([
    Response.json({ id: "7001", ownerUUID: owner, state: "OPEN", expired: false, slots: [{ slotId: 3, options: '{}' }] }),
    code === "world_preparing" ? Response.json({}, { status: 202 }) : Response.json({ downloadUrl: `https://${host}/world` }),
  ]);
  await expect(publishLatestWorld(runtime, "fixture-world", 0, true, { now: () => now, fetcher })).rejects.toMatchObject({ code });
  expect(requests).toHaveLength(calls);
  expect(await env.DB.prepare("SELECT published,source_identity,publication_scope FROM world_slots").first()).toEqual({ published: 0, source_identity: null, publication_scope: "latest" });
  expect((await env.DB.prepare("SELECT count(*) n FROM download_jobs").first<{n:number}>())?.n).toBe(0);
  expect((await env.DB.prepare("SELECT count(*) n FROM download_tickets").first<{n:number}>())?.n).toBe(0);
});
async function fixture() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO realm_connections(id,generation,status,owner_xuid,updated_at) VALUES(1,1,'connected','fixture-owner',?)").bind(now),
    env.DB.prepare("INSERT INTO realms(id,source_realm_id,connection_id,connection_generation,verified_owner_xuid,source_name,availability,fetched_at) VALUES(1,'fixture-realm',1,1,'fixture-owner','人工 Realm','available',?)").bind(now),
    env.DB.prepare("INSERT INTO world_slots(id,public_id,realm_id,source_slot_id,connection_generation,source_identity,association_status,display_name,fetched_at,updated_at) VALUES(1,'fixture-world',1,'2',1,'fixture-content','verified','人工世界',?,?)").bind(now, now),
  ]);
  await setPublication(env.DB, "fixture-world", true, 0, true, now);
  const job = await createJob(env.DB, { worldPublicId: "fixture-world", kind: "latest", sourceBackupId: null, associationEvidence: "fixture-content", archiveLabel: "latest" }, now);
  const claimed = await claimDownloadStep(env.DB, job.jobId, "fixture-worker", now, "prepare");
  const ready = await readyJob(env.DB, claimed!, "人工加密描述，無上游網址", now);
  return { ...job, ...ready };
}

it("工作與未知觀察同批建立，同一張票二十次並行兌換只有一次成功", async () => {
  const job = await fixture();
  expect(await recentDownloadAttempt(env.DB, job.jobId, now)).toMatchObject({ outcome: "unknown", stream_started_at: null });
  const claimed = await Promise.allSettled(Array.from({ length: 20 }, () => consumeTicket(env.DB, job.ticket, now + 1)));
  expect(claimed.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(await beginStreaming(env.DB, job.jobId, now + 2)).toBe(true);
  expect((await visibleJob(env.DB, job.jobId, job.statusSecret, now + 600001)).state).toBe("streaming");
  await finishTransfer(env.DB, job.jobId, { outcome: "transfer_ended", bytes: "1073741824", code: null }, now + 600002);
  expect(await recentDownloadAttempt(env.DB, job.jobId, now + 600003)).toMatchObject({ outcome: "transfer_ended", observed_bytes: "1073741824" });
  expect(await recentDownloadAttempt(env.DB, job.jobId, now + 2592000000)).toBeNull();
});

it("下架後再發布仍拒絕舊票；過時發布不寫稽核或破壞目前版本", async () => {
  const job = await fixture();
  await expect(setPublication(env.DB, "fixture-world", false, 0, false, now + 1)).rejects.toThrow();
  expect((await env.DB.prepare("SELECT count(*) n FROM audit_events").first<{n:number}>())?.n).toBe(1);
  expect((await visibleJob(env.DB, job.jobId, job.statusSecret, now + 1)).state).toBe("ready");
  await setPublication(env.DB, "fixture-world", false, 1, false, now + 2);
  await setPublication(env.DB, "fixture-world", true, 2, true, now + 3);
  await expect(consumeTicket(env.DB, job.ticket, now + 4)).rejects.toThrow();
  await expect(visibleJob(env.DB, job.jobId, job.statusSecret, now + 4)).rejects.toThrow();
});

it("來源完整列表不再含欄位時下架並清除票據，晚到舊世代列表不影響新連線", async () => {
  const job = await fixture();
  await invalidateMissingSlots(env.DB, 0, "fixture-owner", [], now + 1);
  expect((await visibleJob(env.DB, job.jobId, job.statusSecret, now + 1)).state).toBe("ready");
  await invalidateMissingSlots(env.DB, 1, "fixture-owner", [], now + 2);
  expect(await env.DB.prepare("SELECT published,source_identity,association_status FROM world_slots").first()).toEqual({ published: 0, source_identity: null, association_status: "unavailable" });
  await expect(consumeTicket(env.DB, job.ticket, now + 3)).rejects.toThrow();
  expect(await env.DB.prepare("SELECT state,encrypted_descriptor FROM download_jobs").first()).toEqual({ state: "invalidated", encrypted_descriptor: null });
});

it("已消耗票據但尚未開始附件時，下架使最終串流條件更新失敗", async () => {
  const job = await fixture();
  await consumeTicket(env.DB, job.ticket, now + 1);
  await setPublication(env.DB, "fixture-world", false, 1, false, now + 2);
  expect(await beginStreaming(env.DB, job.jobId, now + 3)).toBe(false);
});

it("刷新租約取得後解除，晚到結果不能復活授權、票據或發布", async () => {
  const job = await fixture();
  const before = await connection(env.DB, now);
  const leased = await claimRefresh(env.DB, before, "fixture-refresh", now + 1);
  await disconnect(env.DB, 1, now + 2);
  expect(await saveRefresh(env.DB, leased!, "人工晚到密文", "connected", now + 3)).toBeNull();
  expect(await connection(env.DB, now + 4)).toMatchObject({ generation: 2, status: "disconnected", credential_box: null });
  await expect(consumeTicket(env.DB, job.ticket, now + 4)).rejects.toThrow();
});
