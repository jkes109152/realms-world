import { timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";

export type BoxContext = { purpose: string; connectionId: number; generation: number };
export type Keyring = Record<string, string>;
const encoder = new TextEncoder();

export function randomSecret(): string { return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"); }
export async function digest(value: string): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", encoder.encode(value))).toString("hex");
}
export function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function validSecret(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value); }

function decode(value: unknown, size?: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || value.length > 262144) throw new Error("invalid_box");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || (size !== undefined && bytes.length !== size)) throw new Error("invalid_box");
  return new Uint8Array(bytes);
}

function aad(context: BoxContext): Uint8Array<ArrayBuffer> {
  if (!context.purpose || context.connectionId !== 1 || !Number.isSafeInteger(context.generation) || context.generation < 0) throw new Error("invalid_context");
  return encoder.encode(JSON.stringify([1, context.purpose, context.connectionId, context.generation]));
}

export function readKeyring(value?: string): Keyring {
  try {
    const parsed = JSON.parse(value || "null");
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
    for (const [id, key] of Object.entries(parsed)) { if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error(); decode(key, 32); }
    return parsed;
  } catch { throw new AppError("unavailable", 503); }
}

export async function seal(value: unknown, context: BoxContext, keyring: Keyring, keyId: string): Promise<string> {
  try {
    const key = await crypto.subtle.importKey("raw", decode(keyring[keyId], 32), "AES-GCM", false, ["encrypt"]);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = encoder.encode(JSON.stringify(value));
    if (plaintext.length > 131072) throw new Error();
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(context), tagLength: 128 }, key, plaintext);
    return JSON.stringify({ format_version: 1, key_id: keyId, nonce: Buffer.from(nonce).toString("base64"), ciphertext: Buffer.from(ciphertext).toString("base64") });
  } catch { throw new AppError("unavailable", 503); }
}

export async function unseal<T = unknown>(box: string, context: BoxContext, keyring: Keyring): Promise<T> {
  try {
    if (box.length > 262144) throw new Error();
    const data = JSON.parse(box);
    if (data.format_version !== 1 || typeof data.key_id !== "string") throw new Error();
    const key = await crypto.subtle.importKey("raw", decode(keyring[data.key_id], 32), "AES-GCM", false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(data.nonce, 12), additionalData: aad(context), tagLength: 128 }, key, decode(data.ciphertext));
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
  } catch { throw new AppError("reauth_required", 409); }
}
