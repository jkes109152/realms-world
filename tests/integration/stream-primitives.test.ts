import { describe, expect, it } from "vitest";
import { openValidatedDownload } from "@/lib/downloads/stream";
import { validateDownloadUrl } from "@/lib/security/download-source";
import { byteStream, fetchSequence } from "../fixtures/streams";

const policy = { hosts: new Set(["download.example.test", "second.example.test"]), redirects: [] };
const descriptor = { url: "https://download.example.test/artificial", bearerToken: "fixture-bearer", sizeBytes: null, expiresAt: null, sourceIdentity: "fixture", sourceBackupId: null };

describe("有界驗證與串流", () => {
  it("未知長度仍能完整交付前綴、保持背壓且 EOF 才完成", async () => {
    const source = byteStream({ size: 30000, chunkSize: 1031 });
    const { fetcher, requests } = fetchSequence([new Response(source.stream, { headers: { "content-type": "application/octet-stream" } })]);
    const opened = await openValidatedDownload(descriptor, policy, new AbortController().signal, fetcher);
    expect(source.stats.emitted).toBeLessThanOrEqual(5155);
    expect(requests[0].headers.get("Cookie")).toBeNull();
    expect(requests[0].headers.get("Authorization")).toBe("Bearer fixture-bearer");
    const reader = opened.body.getReader();
    let count = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const byte of value) {
        expect(byte).toBe(count < 4 ? [0x50, 0x4b, 3, 4][count] : count % 251);
        count++;
      }
    }
    expect(count).toBe(30000);
    expect(await opened.completion).toEqual({ outcome: "transfer_ended", bytes: "30000", code: null });
  });
  it("取消傳到來源，紀錄確定失敗", async () => {
    const source = byteStream({ size: 1000000 });
    const { fetcher } = fetchSequence([new Response(source.stream)]);
    const opened = await openValidatedDownload(descriptor, policy, new AbortController().signal, fetcher);
    await opened.body.cancel();
    expect(source.stats.cancelled).toBe(true);
    expect(await opened.completion).toMatchObject({ outcome: "transfer_failed", code: "transfer_cancelled" });
  });
  it("已知長度不符不能當作成功", async () => {
    const { fetcher } = fetchSequence([new Response(byteStream({ size: 4096 }).stream, { headers: { "content-length": "5000" } })]);
    const opened = await openValidatedDownload(descriptor, policy, new AbortController().signal, fetcher);
    await expect(new Response(opened.body).arrayBuffer()).rejects.toThrow();
    expect(await opened.completion).toMatchObject({ outcome: "transfer_failed", code: "length_mismatch" });
  });
  it("輸出尚未被讀取時，請求取消仍立即清除上游", async () => {
    const source = byteStream({ size: 1000000 });
    const { fetcher } = fetchSequence([new Response(source.stream)]);
    const controller = new AbortController();
    const opened = await openValidatedDownload(descriptor, policy, controller.signal, fetcher);
    controller.abort();
    expect(await opened.completion).toMatchObject({ outcome: "transfer_failed", code: "transfer_cancelled" });
    expect(source.stats.cancelled).toBe(true);
  });
  it.each([
    [200, "text/html", "<html>錯誤</html>"], [200, "application/json", '{"error":"fixture"}'],
    [206, "application/octet-stream", "PK\x03\x04"], [200, "application/octet-stream", "not-a-world"],
  ])("拒絕 %s／%s 無效附件", async (status, contentType, body) => {
    const { fetcher } = fetchSequence([new Response(body, { status, headers: { "content-type": contentType } })]);
    await expect(openValidatedDownload(descriptor, policy, new AbortController().signal, fetcher)).rejects.toThrow();
  });
});

describe("精確來源與 redirect 隔離", () => {
  it("拒絕 IP、userinfo、其他埠、HTTP、通配相似主機", () => {
    for (const url of ["http://download.example.test/a", "https://127.0.0.1/a", "https://user@download.example.test/a", "https://download.example.test:444/a", "https://download.example.test.evil.test/a"]) {
      expect(() => validateDownloadUrl(url, policy)).toThrow();
    }
  });
  it("逐跳驗證；沒有主機對政策不跨主機", async () => {
    const { fetcher, requests } = fetchSequence([new Response(null, { status: 302, headers: { location: "https://second.example.test/file" } })]);
    await expect(openValidatedDownload(descriptor, policy, new AbortController().signal, fetcher)).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });
  it("允許的跨主機仍預設不轉送 Bearer", async () => {
    const { fetcher, requests } = fetchSequence([
      new Response(null, { status: 302, headers: { location: "https://second.example.test/file" } }),
      new Response(byteStream().stream),
    ]);
    const opened = await openValidatedDownload(descriptor, { ...policy, redirects: [{ from: "download.example.test", to: "second.example.test", forwardAuthorization: false }] }, new AbortController().signal, fetcher);
    expect(requests[1].headers.get("Authorization")).toBeNull();
    expect(requests[0].redirect).toBe("manual");
    await opened.body.cancel();
  });
});
