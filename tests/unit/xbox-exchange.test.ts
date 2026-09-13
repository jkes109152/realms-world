import { expect, it, vi } from "vitest";
import { exchangeXboxOnce, newProofKey } from "@/lib/realms/xbox-auth";
import { advanceDeviceLoginOnce, type DeviceState } from "@/lib/realms/microsoft-auth";

const now = Date.UTC(2026, 8, 14);
async function state(): Promise<DeviceState> {
  return { status: "pending", stage: "exchanging_tokens", exchangeStage: "xsts", expiresAt: now + 600000, nextPollAt: now,
    intervalSeconds: 5, proofJwk: await newProofKey(), microsoft: { accessToken: "artificial-access", refreshToken: "artificial-refresh", expiresAt: now + 600000 },
    userToken: "artificial-user", deviceToken: "artificial-device", titleToken: "artificial-title" };
}

it("Realms XSTS 使用固定參考的預設 claims，不傳入未經證實的 optional claim", async () => {
  const pending = await state();
  const fetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    expect(body.RelyingParty).toBe("https://pocket.realms.minecraft.net/");
    expect(body.Properties.OptionalDisplayClaims).toBeUndefined();
    return Response.json({ Token: "artificial-xsts", NotAfter: new Date(now + 600000).toISOString(), DisplayClaims: { xui: [{ xid: "123456789", uhs: "artificial-hash" }] } });
  };
  expect(await advanceDeviceLoginOnce(pending, now, fetcher)).toMatchObject({ status: "authorized", authorization: { ownerXuid: "123456789" } });
});

it("永久協定 400 不無限重試，也不將上游回應或秘密寫入日誌", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const pending = await state();
    const next = await advanceDeviceLoginOnce(pending, now, async () => Response.json({ privateDetails: "must-not-be-logged" }, { status: 400 }));
    expect(next.status).toBe("failed");
    expect(next.microsoft).toBeUndefined();
    expect(warning.mock.calls).toEqual([["realms_auth_exchange", { stage: "xsts", status: 400 }]]);
  } finally { warning.mockRestore(); }
});

it("XSTS 缺少穩定擁有者欄位時明確拒絕，不假裝暫時服務異常", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const pending = await state();
    await expect(exchangeXboxOnce({ ...pending, proofJwk: pending.proofJwk!, accessToken: pending.microsoft!.accessToken }, "xsts", now,
      async () => Response.json({ Token: "artificial-xsts", NotAfter: new Date(now + 600000).toISOString(), DisplayClaims: { xui: [{ uhs: "artificial-hash" }] } }))).rejects.toMatchObject({ code: "reauth_required" });
  } finally { warning.mockRestore(); }
});

it("先以 Xbox relying party 核對身分，再接受相同 user hash 的 Realms 權杖", async () => {
  const pending = { ...await state(), exchangeStage: "identity" as const };
  const requests: string[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    const party = JSON.parse(String(init?.body)).RelyingParty; requests.push(party);
    return Response.json({ Token: party === "http://xboxlive.com" ? "artificial-identity-token" : "artificial-realms-token",
      NotAfter: new Date(now + 600000).toISOString(), DisplayClaims: { xui: [{ uhs: "same-user-hash", ...(party === "http://xboxlive.com" ? { xid: "123456789" } : {}) }] } });
  };
  const identified = await advanceDeviceLoginOnce(pending, now, fetcher);
  expect(identified.status).toBe("pending");
  expect(identified.exchangeStage).toBe("xsts");
  expect(identified.authorization).toBeUndefined();
  expect(JSON.stringify(identified)).not.toContain("artificial-identity-token");
  const ready = await advanceDeviceLoginOnce(identified, now + 1, fetcher);
  expect(ready).toMatchObject({ status: "authorized", authorization: { ownerXuid: "123456789", xstsToken: "artificial-realms-token" } });
  expect(requests).toEqual(["http://xboxlive.com", "https://pocket.realms.minecraft.net/"]);
});

it("兩種 relying party 的 user hash 不一致時拒絕借用身分", async () => {
  const pending = { ...await state(), exchangeStage: "identity" as const };
  const identified = await advanceDeviceLoginOnce(pending, now, async () => Response.json({ Token: "fixture", NotAfter: new Date(now + 600000).toISOString(), DisplayClaims: { xui: [{ uhs: "first-user", xid: "123456789" }] } }));
  const denied = await advanceDeviceLoginOnce(identified, now + 1, async () => Response.json({ Token: "fixture", NotAfter: new Date(now + 600000).toISOString(), DisplayClaims: { xui: [{ uhs: "other-user" }] } }));
  expect(denied.status).toBe("denied");
  expect(denied.microsoft).toBeUndefined();
});
