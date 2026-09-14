// 人工 ID 與資訊，與真實 Microsoft 帳號或世界無關。
export const ownerXuid = "9000000000000001";
export const ownedRealm = {
  id: "7001", ownerUUID: ownerXuid, name: "人工驗收世界", expired: false,
  activeSlot: 1,
  slots: [
    { slotId: 1, options: JSON.stringify({ slotName: "人工海岸", empty: false }) },
    { slotId: 2, options: JSON.stringify({ slotName: "人工山谷", empty: false }) },
  ],
};
export const invitedRealm = { ...ownedRealm, id: "7002", ownerUUID: "9000000000000002" };
export const unknownRealm = { id: "7003", name: "缺少歸屬證據" };
export const realmBackups = [
  { backupId: "artificial-a", lastModifiedDate: 1700000000000, size: "1073741824", metadata: {} },
  { backupId: "artificial-b", lastModifiedDate: null, size: null, metadata: {} },
  { backupId: "artificial-c", lastModifiedDate: 1699900000000, size: "9007199254740993", metadata: {} },
];
export const syntheticEvidence = { source: "fixture-only", slotId: "2", identity: "artificial-content-b" };
