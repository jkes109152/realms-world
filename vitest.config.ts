import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => ({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  plugins: [cloudflareTest({
    miniflare: {
      compatibilityDate: "2026-05-15",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      bindings: {
        SITE_ORIGIN: "https://realms.example.test",
        DOWNLOADS_ENABLED: "false",
        RATE_LIMIT_HMAC_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        TEST_MIGRATIONS: await readD1Migrations("./drizzle"),
      },
    },
  })],
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
    fileParallelism: false,
    restoreMocks: true,
  },
}));
