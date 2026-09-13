import { expect, it } from "vitest";
import { inspectRealmAssociation } from "@/lib/realms/association-inspection";
import { fetchSequence } from "../fixtures/streams";
import { ownedRealm, ownerXuid } from "../fixtures/realms";

const auth = { ownerXuid, userHash: "private-user-hash", xstsToken: "private-token", expiresAt: 999999 };
it("歸屬診斷僅查固定擁有者端點，投影結構與數量，不輸出私人值", async () => {
  const { fetcher, requests } = fetchSequence([
    Response.json({ ...ownedRealm, name: "private-world-name", state: "OPEN" }),
    Response.json({ backups: [{ backupId: "private-backup-id", metadata: { slotId: "2", name: "private-backup-name", gameServerVersion: "1.26.45" } }] }),
  ]);
  const result = await inspectRealmAssociation(auth, "7001", "1.26.45", fetcher);
  expect(requests.map((r) => new URL(r.url).pathname)).toEqual(["/worlds/7001", "/worlds/7001/backups"]);
  expect(result).toMatchObject({ ownerMatches: true, backupCount: 1, paginationAdvertised: false });
  expect(result.backupFields).toContain("metadata.slotId:string");
  expect(result.slotLinks).toContainEqual({ field: "metadata.slotId", slotId: "2", count: 1 });
  expect(JSON.stringify(result)).not.toMatch(/private-|9000000000000001|7001/);
});
it("歸屬診斷遇到受邀 Realm 不讀取其備份", async () => {
  const { fetcher, requests } = fetchSequence([Response.json({ ...ownedRealm, ownerUUID: "different-owner" })]);
  await expect(inspectRealmAssociation(auth, "7001", "1.26.45", fetcher)).rejects.toMatchObject({ code: "forbidden" });
  expect(requests).toHaveLength(1);
});
