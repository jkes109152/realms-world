import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("在 Worker runtime 使用真正的本機 D1 綁定", async () => {
  await env.DB.prepare("CREATE TABLE runtime_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)").run();
  const result = await env.DB.prepare("INSERT INTO runtime_probe (value) VALUES (?) RETURNING value").bind("人工資料").first<{ value: string }>();
  expect(result?.value).toBe("人工資料");
});
