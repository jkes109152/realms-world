import { digest, equalSecret, validSecret } from "./crypto-box";
import { AppError } from "./errors";

export function assertOrigin(request: Request, origin: string): void {
  if (request.headers.get("Origin") !== origin || request.headers.get("Sec-Fetch-Site") === "cross-site") throw new AppError("forbidden", 403);
}

export async function assertCsrf(raw: unknown, expectedDigest: string): Promise<void> {
  if (!validSecret(raw) || !equalSecret(await digest(raw), expectedDigest)) throw new AppError("forbidden", 403);
}

export async function boundedBody(request: Pick<Request, "headers" | "body">, limit: number): Promise<string> {
  const declared = request.headers.get("Content-Length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new AppError("invalid_request", 413);
  if (!request.body) return "";
  const reader = request.body.getReader();
  const bytes = new Uint8Array(limit);
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw new AppError("invalid_request", 413); }
      bytes.set(value, total - value.byteLength);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, total));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("invalid_request");
  } finally { reader.releaseLock(); }
}

export async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new AppError("invalid_request", 415);
  try { return JSON.parse(await boundedBody(request, 16384)); }
  catch (error) { if (error instanceof AppError) throw error; throw new AppError("invalid_request"); }
}

export async function readForm(request: Request): Promise<URLSearchParams> {
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") throw new AppError("invalid_request", 415);
  return new URLSearchParams(await boundedBody(request, 4096));
}

export function objectInput(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !keys.includes(key))) throw new AppError("invalid_request");
  return input as Record<string, unknown>;
}
