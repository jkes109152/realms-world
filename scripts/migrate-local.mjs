import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

// Wrangler migrations apply 記錄已套用檔案，不重播既有遷移。
const config = "dist/server/wrangler.json";
if (!existsSync(config)) throw new Error("請先執行 npm run build，產生本機 D1 設定。");
const built = JSON.parse(readFileSync(config, "utf8"));
const database = built.d1_databases?.find((binding) => binding.binding === "DB");
if (!database) throw new Error("建置設定缺少 DB binding。");
mkdirSync(".wrangler", { recursive: true });
const localConfig = ".wrangler/migrations.config.json";
writeFileSync(localConfig, JSON.stringify({
  name: built.name, compatibility_date: built.compatibility_date,
  d1_databases: [{ ...database, migrations_dir: "../drizzle" }],
}));
const result = spawnSync(process.execPath, [
  "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js",
  "d1", "migrations", "apply", "DB", "--local", "--config", localConfig,
  "--persist-to", ".wrangler/state",
], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
