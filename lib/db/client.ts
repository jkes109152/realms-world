import { env } from "cloudflare:workers";
import { AppError } from "@/lib/security/errors";
import type { AppEnv } from "@/lib/security/env";

export function bindings(): AppEnv { return env as AppEnv; }

// env.DB 的直接查詢走主庫；權限不能取自快取或未帶 first-primary 的 session。
export function database(): D1Database {
  const db = bindings().DB;
  if (!db) throw new AppError("database_unavailable", 503);
  return db;
}

export async function batch(db: D1Database, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  try {
    const results = await db.batch(statements);
    if (results.some((result) => !result.success)) throw new AppError("database_unavailable", 503);
    return results;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("database_unavailable", 503);
  }
}

export function changed(result: D1Result): boolean { return result.success && result.meta.changes > 0; }
export function utcNow(): number { return Date.now(); }
