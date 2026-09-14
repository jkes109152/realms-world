/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { beforeEach, afterEach, vi } from "vitest";

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("測試禁止呼叫外部服務，請明確注入人工來源。"))));
});

afterEach(() => { vi.unstubAllGlobals(); });
