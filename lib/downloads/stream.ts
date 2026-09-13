import { AppError } from "@/lib/security/errors";
import { validateDownloadUrl, type SourcePolicy } from "@/lib/security/download-source";
import type { DownloadDescriptor } from "@/lib/realms/types";

type Observation = { outcome: "transfer_ended" | "transfer_failed"; bytes: string; code: string | null };
export type ValidatedStream = { body: ReadableStream<Uint8Array>; contentLength: string | null; completion: Promise<Observation>; cancel: () => Promise<void> };

export async function openValidatedDownload(descriptor: DownloadDescriptor, policy: SourcePolicy, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<ValidatedStream> {
  if (descriptor.expiresAt !== null && descriptor.expiresAt <= Date.now()) throw new AppError("invalid_source", 502);
  const abort = new AbortController();
  const cancelUpstream = () => abort.abort();
  if (signal.aborted) throw new AppError("invalid_source", 502);
  signal.addEventListener("abort", cancelUpstream, { once: true });
  const openingTimer = setTimeout(cancelUpstream, 10000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    let url = validateDownloadUrl(descriptor.url, policy);
    let authorization = descriptor.bearerToken;
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 3; redirects++) {
      response = await fetcher(url.href, { redirect: "manual", signal: abort.signal, headers: { ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}), "Accept-Encoding": "identity" } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      await response.body?.cancel();
      const location = response.headers.get("Location");
      if (!location || redirects === 3) throw new AppError("invalid_source", 502);
      const next = validateDownloadUrl(new URL(location, url).href, policy);
      if (next.hostname !== url.hostname) {
        const rule = policy.redirects.find((item) => item.from === url.hostname && item.to === next.hostname);
        if (!rule) throw new AppError("invalid_source", 502);
        if (!rule.forwardAuthorization) authorization = undefined;
      }
      url = next;
    }
    const media = response?.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
    if (!response || response.status !== 200 || !response.body ||
        (media && !["application/octet-stream", "application/zip", "application/x-zip-compressed", "application/vnd.minecraft.world"].includes(media)) ||
        (response.headers.get("Content-Encoding") && response.headers.get("Content-Encoding") !== "identity")) {
      await response?.body?.cancel(); throw new AppError("invalid_source", 502);
    }
    const rawLength = response.headers.get("Content-Length");
    if (rawLength !== null && (!/^(0|[1-9]\d*)$/.test(rawLength) || rawLength.length > 30)) { await response.body.cancel(); throw new AppError("invalid_source", 502); }
    const expected = rawLength === null ? null : BigInt(rawLength);
    reader = response.body.getReader();
    const prefixChunks: Uint8Array[] = [];
    const prefix = new Uint8Array(4096);
    let prefixLength = 0;
    // 只複製最多 4 KiB；保留取到的原始 chunk 供後續完整交付。
    while (prefixLength < 4) {
      const item = await reader.read();
      if (item.done) break;
      prefixChunks.push(item.value);
      const amount = Math.min(item.value.length, 4096 - prefixLength);
      prefix.set(item.value.subarray(0, amount), prefixLength); prefixLength += amount;
    }
    if (prefixLength < 4 || prefix[0] !== 0x50 || prefix[1] !== 0x4b || !((prefix[2] === 3 && prefix[3] === 4) || (prefix[2] === 5 && prefix[3] === 6) || (prefix[2] === 7 && prefix[3] === 8))) throw new AppError("invalid_source", 502);
    clearTimeout(openingTimer);
    const source = reader;
    let bytes = 0n; let settled = false;
    let finish!: (result: Observation) => void;
    const completion = new Promise<Observation>((resolve) => { finish = resolve; });
    const settle = (outcome: Observation["outcome"], code: string | null) => {
      if (settled) return;
      settled = true; signal.removeEventListener("abort", cancelUpstream);
      abort.signal.removeEventListener("abort", cancelled);
      finish({ outcome, code, bytes: bytes.toString() });
    };
    const cancel = async () => { settle("transfer_failed", "transfer_cancelled"); abort.abort(); await source.cancel().catch(() => undefined); };
    const cancelled = () => { void cancel(); };
    abort.signal.addEventListener("abort", cancelled, { once: true });
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (abort.signal.aborted) { await cancel(); controller.error(new Error("transfer_cancelled")); return; }
          const queued = prefixChunks.shift();
          const result = queued ? { done: false, value: queued } : await source.read();
          if (result.done) {
            if (expected !== null && expected !== bytes) { settle("transfer_failed", "length_mismatch"); controller.error(new Error("length_mismatch")); return; }
            controller.close(); settle("transfer_ended", null); return;
          }
          if (!result.value) return;
          bytes += BigInt(result.value.byteLength);
          if (expected !== null && bytes > expected) { await source.cancel(); settle("transfer_failed", "length_mismatch"); controller.error(new Error("length_mismatch")); return; }
          controller.enqueue(result.value);
        } catch {
          abort.abort(); await source.cancel().catch(() => undefined);
          settle("transfer_failed", signal.aborted ? "transfer_cancelled" : "transfer_error"); controller.error(new Error("transfer_error"));
        }
      },
      cancel,
    }, { highWaterMark: 0 });
    return { body, contentLength: rawLength, completion, cancel };
  } catch {
    clearTimeout(openingTimer); abort.abort(); signal.removeEventListener("abort", cancelUpstream);
    await reader?.cancel().catch(() => undefined);
    throw new AppError("invalid_source", 502);
  }
}
