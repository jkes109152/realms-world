import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { AppError } from "@/lib/security/errors";

const parameters = { N: 16384, r: 8, p: 5, maxmem: 33554432 } as const;
const prefix = "scrypt$v1$16384$8$5$33554432$32$";
const pattern = /^scrypt\$v1\$16384\$8\$5\$33554432\$32\$([A-Za-z0-9+/]+=*)\$([A-Za-z0-9+/]+=*)$/;

export function validatePassword(password: unknown): asserts password is string {
  if (typeof password !== "string" || [...password].length < 15 || [...password].length > 128 ||
      Buffer.byteLength(password, "utf8") > 1024 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(password)) {
    throw new AppError("invalid_request");
  }
}

export function validatePasswordHash(hash: unknown): asserts hash is string {
  if (typeof hash !== "string" || hash.length > 256) throw new AppError("invalid_request");
  const match = hash.match(pattern);
  if (!match) throw new AppError("invalid_request");
  const salt = Buffer.from(match[1], "base64"); const key = Buffer.from(match[2], "base64");
  if (salt.length < 16 || salt.length > 32 || key.length !== 32 || salt.toString("base64") !== match[1] || key.toString("base64") !== match[2]) throw new AppError("invalid_request");
}

function derive(password: string, salt: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 32, parameters, (error, key) => error ? reject(new AppError("unavailable", 503)) : resolve(key)));
}

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `${prefix}${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try { validatePassword(password); validatePasswordHash(hash); } catch { return false; }
  const [, salt, expected] = hash.match(pattern)!;
  const actual = await derive(password, Buffer.from(salt, "base64"));
  return timingSafeEqual(actual, Buffer.from(expected, "base64"));
}
