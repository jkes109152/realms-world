import { createInterface } from "node:readline/promises";
import { randomBytes, scryptSync } from "node:crypto";
import { stdin, stdout } from "node:process";

// 秘密只從互動終端讀取，不接受命令列、環境或檔案形式的密碼。
if (!stdin.isTTY || !stdout.isTTY) throw new Error("請在互動終端執行帳號維護。");
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--action" || !["bootstrap", "reset"].includes(args[1])) throw new Error("使用 --action bootstrap 或 --action reset。");
const action = args[1];
async function prompt(label) {
  const rl = createInterface({ input: stdin, output: stdout });
  try { return await rl.question(label); } finally { rl.close(); }
}
async function secretPrompt(label) {
  stdout.write(label);
  stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
  let value = "";
  return new Promise((resolve, reject) => {
    const cleanup = () => { stdin.off("data", listener); stdin.setRawMode(false); stdin.pause(); stdout.write("\n"); };
    const listener = (chunk) => {
      for (const char of chunk) {
        if (char === "\u0003") { cleanup(); reject(new Error("已取消。")); return; }
        if (char === "\r" || char === "\n") { cleanup(); resolve(value); return; }
        if (char === "\u007f" || char === "\b") value = [...value].slice(0, -1).join("");
        else if (char >= " ") value += char;
      }
    };
    stdin.on("data", listener);
  });
}

try {
  const origin = process.env.REALMS_MAINTENANCE_ORIGIN || await prompt("網站 HTTPS origin：");
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin) throw new Error("必須使用精確 HTTPS origin。");
  const token = process.env.REALMS_MAINTENANCE_TOKEN || await secretPrompt("已部署的一次性維護秘密（不回顯）：");
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("維護秘密格式不符。");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const sitesToken = process.env.REALMS_SITES_ACCESS_TOKEN;
  if (sitesToken) headers["OAI-Sites-Authorization"] = `Bearer ${sitesToken}`;
  delete process.env.REALMS_MAINTENANCE_TOKEN;
  delete process.env.REALMS_SITES_ACCESS_TOKEN;
  const versionResponse = await fetch(`${origin}/api/maintenance/admin/version`, { headers, redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!versionResponse.ok) throw new Error(`無法查詢維護版本（HTTP ${versionResponse.status}）。`);
  const { data: version } = await versionResponse.json();
  if (action === "bootstrap" ? version.initialized : !version.initialized) throw new Error("目前帳號狀態不符合所選操作。");
  const username = await prompt("網站帳號：");
  if (!/^[a-z0-9_.-]{2,64}$/.test(username)) throw new Error("帳號格式不符。");
  const password = await secretPrompt("新密碼（15～128 碼點，不回顯）：");
  if ([...password].length < 15 || [...password].length > 128 || Buffer.byteLength(password) > 1024) throw new Error("密碼長度不符。");
  if (password !== await secretPrompt("再次輸入新密碼：")) throw new Error("兩次密碼不同。");
  if (await prompt(`確認 ${action}，目前版本 ${version.credentialVersion ?? "尚未建立"}；輸入 CONFIRM：`) !== "CONFIRM") throw new Error("已取消。");
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 5, maxmem: 33554432 });
  const passwordHash = `scrypt$v1$16384$8$5$33554432$32$${salt.toString("base64")}$${key.toString("base64")}`;
  const response = await fetch(`${origin}/api/maintenance/admin`, { method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(30000), body: JSON.stringify({ action, username, passwordHash, expectedCredentialVersion: version.credentialVersion }) });
  if (!response.ok) throw new Error(`維護未確認成功（HTTP ${response.status}）。重新查詢版本並確認後再操作，不自動重送。`);
  const { data: result } = await response.json();
  stdout.write(`維護已完成，帳號版本 ${result.credentialVersion}。請立即從 Sites 移除 MAINTENANCE_TOKEN，重新部署，再驗證登入。\n`);
} catch (error) {
  // 僅列印本站建立的錯誤，外部 fetch 原始錯誤可能包含敏感 URL。
  const safe = error instanceof Error && /^(必須|維護秘密|無法查詢維護版本|目前帳號|帳號格式|密碼長度|兩次密碼|已取消|維護未確認)/.test(error.message);
  stdout.write(safe ? `${error.message}\n` : "維護結果不明，請查詢版本後處理；不自動重送。\n");
  process.exitCode = 1;
}
