import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { createJob, claimDownloadStep, readyJob, consumeTicket, beginStreaming, visibleJob } from "@/lib/db/downloads";
import { setPublication } from "@/lib/realms/publication-service";
import { invalidateMissingSlots } from "@/lib/realms/world-service";
import { connection, claimRefresh, saveRefresh, disconnect } from "@/lib/db/connections";
import { finishTransfer, recentDownloadAttempt } from "@/lib/audit/writer";

const now = Date.UTC(2026, 8, 14);
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
