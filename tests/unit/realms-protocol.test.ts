import { describe, expect, it } from "vitest";
import { beginDeviceLogin, advanceDeviceLoginOnce, expiresAtFromSeconds } from "@/lib/realms/microsoft-auth";
import { xboxSignatureInput, signXboxRequest } from "@/lib/realms/xbox-auth";
import { selectOwnedRealms, projectSlots } from "@/lib/realms/ownership";
import { collectVerifiedBackups } from "@/lib/realms/archives";
import { prepareWorldDownload } from "@/lib/realms/client";
import { fetchSequence } from "../fixtures/streams";
import { ownedRealm, invitedRealm, unknownRealm, ownerXuid, realmBackups } from "../fixtures/realms";
import vector from "../fixtures/xbox-signature.json";

describe("Microsoft 與 Xbox 協定", () => {
  it("expires_in 明確由秒換算毫秒，拒絕未知或溢位", () => {
    expect(expiresAtFromSeconds(100000, 3600)).toBe(3700000);
    for (const value of [0, -1, Infinity, "3600", Number.MAX_SAFE_INTEGER]) expect(() => expiresAtFromSeconds(100000, value)).toThrow();
  });
  it("開始只請求 challenge，step 每次一個外部階段並遵守降速", async () => {
    const sequence = fetchSequence([
      Response.json({ device_code: "artificial-code", user_code: "ABCD-EFGH", verification_uri: "https://www.microsoft.com/link", expires_in: 900, interval: 5 }),
      Response.json({ error: "slow_down" }, { status: 400 }),
    ]);
    const started = await beginDeviceLogin(100000, sequence.fetcher);
    expect(sequence.requests).toHaveLength(1);
    expect(started.stage).toBe("waiting_for_user");
    expect(started.expiresAt).toBe(1000000);
    expect(started.nextPollAt).toBe(105000);
    const waiting = await advanceDeviceLoginOnce(started, 102000, sequence.fetcher);
    expect(waiting).toEqual(started);
    expect(sequence.requests).toHaveLength(1);
    const slowed = await advanceDeviceLoginOnce(started, 105000, sequence.fetcher);
    expect(slowed.nextPollAt).toBe(115000);
    expect(slowed.expiresAt).toBe(started.expiresAt);
    expect(sequence.requests).toHaveLength(2);
    await advanceDeviceLoginOnce(slowed, 1000001, sequence.fetcher);
    expect(sequence.requests).toHaveLength(2);
  });
  it("拒絕偽造的 Microsoft 授權連結", async () => {
    const { fetcher } = fetchSequence([Response.json({ device_code: "fixture", user_code: "TEST", verification_uri: "https://microsoft.com.evil.test/link", expires_in: 900, interval: 5 })]);
    await expect(beginDeviceLogin(100000, fetcher)).rejects.toThrow();
  });
  it("Windows epoch 封裝符合固定向量，簽章使用 64 bytes P1363", async () => {
    const bytes = xboxSignatureInput(vector.url, "", vector.payload, vector.now);
    expect(Buffer.from(bytes).toString("hex")).toBe(vector.preimageHex);
    const publicKey = await crypto.subtle.importKey("jwk", vector.publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const known = Buffer.from(vector.headerBase64, "base64");
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, known.subarray(12), bytes)).toBe(true);
    const signed = Buffer.from(await signXboxRequest(vector.privateJwk, vector.url, "", vector.payload, vector.now), "base64");
    expect(signed.length).toBe(76);
    expect(signed.subarray(0, 12)).toEqual(known.subarray(0, 12));
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signed.subarray(12), bytes)).toBe(true);
  });
});

describe("擁有權與欄位歷史", () => {
  it("僅穩定擁有者 ID 相符才接受；欄位存在不代表歷史歸屬已證明", () => {
    expect(selectOwnedRealms([ownedRealm, invitedRealm, unknownRealm], ownerXuid, 1000).map((r) => r.sourceRealmId)).toEqual(["7001"]);
    const slots = projectSlots(ownedRealm, ownerXuid, 1000);
    expect(slots).toHaveLength(2);
    expect(slots.every((s) => s.associationStatus === "unverifiable" && s.sourceIdentity === null)).toBe(true);
    expect(slots.find((s) => s.sourceSlotId === "2")).toBeDefined();
  });
  it("Realm 級備份缺少可靠欄位映射時必須拒絕", async () => {
    await expect(collectVerifiedBackups(async () => ({ items: realmBackups, nextCursor: null }), () => null, "2", "world-fixture", 1000)).rejects.toMatchObject({ code: "slot_unverifiable" });
  });
  it("驗證人工映射時完整遍歷、去重並保留未知值與大數字字串", async () => {
    const pages = [
      { items: realmBackups.slice(0, 2), nextCursor: "next" },
      { items: [realmBackups[0], realmBackups[2]], nextCursor: null },
    ];
    const items = await collectVerifiedBackups(async () => pages.shift()!, () => "fixture-proof-slot-2", "2", "world-fixture", 1000);
    expect(items).toHaveLength(3);
    expect(pages).toHaveLength(0);
    expect(items[2].savedAt).toBeNull();
    expect(items.find((item) => item.sourceBackupId === "artificial-c")?.sizeBytes).toBe("9007199254740993");
  });
  it("分頁游標循環不能靜默當完整清單", async () => {
    await expect(collectVerifiedBackups(async () => ({ items: realmBackups, nextCursor: "same" }), () => "fixture-proof", "2", "world-fixture", 1000)).rejects.toThrow();
  });
});

it("一次準備只送一個 HTTP；401 回傳續期需求而不隱藏重送", async () => {
  const { fetcher, requests } = fetchSequence([new Response(null, { status: 401 })]);
  const result = await prepareWorldDownload({ userHash: "fixture", xstsToken: "fixture", ownerXuid, expiresAt: 999999 },
    { sourceRealmId: "7001", sourceSlotId: "2", sourceIdentity: "fixture", associationStatus: "verified", associationEvidence: "fixture-proof", name: "人工世界", fetchedAt: 1000 },
    { kind: "latest" }, "1.99.99", 1000, fetcher);
  expect(result).toEqual({ kind: "reauth_required" });
  expect(requests).toHaveLength(1);
  expect(new URL(requests[0].url).pathname).toBe("/archive/download/world/7001/2/latest");
});
