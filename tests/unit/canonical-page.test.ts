import { describe, expect, it } from "vitest";
import { canonicalPageRedirect } from "@/lib/security/canonical-page";
import { assertOrigin } from "@/lib/security/request-policy";

const env = { SITE_ORIGIN: "https://realms.example.test" };
const previous = "https://previous.example.test";

describe("正式網域入口", () => {
  it("舊首頁與管理入口先轉向正式頁面，且不快取", () => {
    for (const path of ["/", "/admin/login", "/admin/verification"]) {
      const response = canonicalPageRedirect(new Request(previous + path), env);
      expect(response?.status).toBe(307);
      expect(response?.headers.get("Location")).toBe(env.SITE_ORIGIN + path);
      expect(response?.headers.get("Cache-Control")).toBe("no-store");
      expect(response?.headers.get("Referrer-Policy")).toBe("no-referrer");
    }
  });
  it("正式網域不循環；不信任偽造的轉送主機或查詢目的地", () => {
    const request = new Request(env.SITE_ORIGIN + "/admin/login", { headers: { "X-Forwarded-Host": "evil.example.test" } });
    expect(canonicalPageRedirect(request, env)).toBeNull();
    const response = canonicalPageRedirect(new Request(previous + "/admin/login?next=https://evil.example.test#secret", { method: "HEAD" }), env);
    expect(response?.headers.get("Location")).toBe(env.SITE_ORIGIN + "/admin/login");
  });
  it("不轉送密碼、API 或其他寫入；舊來源登入仍被拒絕", () => {
    for (const path of ["/", "/admin/login", "/api/admin/login", "/api/downloads/redeem"]) {
      const request = new Request(previous + path, { method: "POST", body: "artificial-form", headers: { Origin: previous } });
      expect(canonicalPageRedirect(request, env)).toBeNull();
      expect(() => assertOrigin(request, env.SITE_ORIGIN)).toThrow();
    }
    expect(canonicalPageRedirect(new Request(previous + "/api/admin/session"), env)).toBeNull();
    expect(() => assertOrigin(new Request(env.SITE_ORIGIN + "/api/admin/login", { method: "POST", headers: { Origin: env.SITE_ORIGIN, "Sec-Fetch-Site": "same-origin" } }), env.SITE_ORIGIN)).not.toThrow();
  });
});
