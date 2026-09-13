import { describe, it, expect } from "vitest";
import { clientVersion, downloadPolicy, publicDownloadsEnabled, siteOrigin } from "@/lib/security/env";

describe("能力設定預設拒絕", () => {
  it("公開總開關只能明確開啟", () => {
    for (const value of [undefined, "", "false", "1", "TRUE"]) expect(publicDownloadsEnabled({ DOWNLOADS_ENABLED: value })).toBe(false);
    expect(publicDownloadsEnabled({ DOWNLOADS_ENABLED: "true" })).toBe(true);
  });
  it("不接受未設定或零版本", () => {
    for (const value of [undefined, "", "0.0.0", "anything"]) expect(() => clientVersion({ REALMS_CLIENT_VERSION: value })).toThrow();
  });
  it("不接受空白、萬用字元或包含路徑的來源", () => {
    for (const hosts of ["[]", '["*.example.test"]', '["https://download.example.test/path"]']) {
      expect(() => downloadPolicy({ REALMS_DOWNLOAD_HOSTS: hosts })).toThrow();
    }
  });
  it("主機與授權轉送須明列", () => {
    const policy = downloadPolicy({ REALMS_DOWNLOAD_HOSTS: '["download.example.test"]' });
    expect([...policy.hosts]).toEqual(["download.example.test"]);
    expect(policy.redirects).toEqual([]);
  });
  it("拒絕非精確 origin", () => {
    expect(siteOrigin({ SITE_ORIGIN: "https://realms.example.test" })).toBe("https://realms.example.test");
    for (const origin of ["https://realms.example.test/", "https://realms.example.test/path", "http://realms.example.test"]) {
      expect(() => siteOrigin({ SITE_ORIGIN: origin })).toThrow();
    }
  });
});
