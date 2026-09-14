"use client";
import { useEffect, useState } from "react";
import { Box, Download, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PublicWorld } from "@/lib/realms/public-catalog";

type Catalog = { items: PublicWorld[]; fetchedAt: string };
type Job = { jobId: string; statusSecret: string; state: string; worldName: string; retryAfterSeconds?: number; ticket?: string; ticketExpiresAt?: string; error?: string | null };
class ApiError extends Error { constructor(message: string, public code: string, public status: number, public seconds = 5) { super(message); } }
async function api<T>(url: string, options: { body?: object; csrf?: string; secret?: string; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(url, { method: options.body === undefined ? "GET" : "POST", cache: "no-store", signal: options.signal,
    headers: { ...(options.body === undefined ? {} : { "Content-Type": "application/json" }), ...(options.csrf ? { "X-CSRF-Token": options.csrf } : {}), ...(options.secret ? { "X-Download-Capability": options.secret } : {}) },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  const value = await response.json() as {data:T;error?:{code:string;message:string;retryAfterSeconds?:number}};
  if (!response.ok) throw new ApiError(value.error?.message || "目前無法取得資料，請稍後再試。", value.error?.code || "unavailable", response.status, value.error?.retryAfterSeconds ?? 5);
  return value.data;
}
const labels: Record<string, string> = { preparing: "正在向 Realms 取得最新世界…", ready: "最新世界已準備好", redeeming: "正在連接世界來源…", streaming: "正在傳輸世界", transfer_ended: "伺服器傳輸結束", transfer_failed: "傳輸未完成", failed: "這次下載無法完成", expired: "這次下載已到期", invalidated: "世界目前無法下載", unknown: "暫時無法確認下載結果" };

export function WorldDownloads() {
  const [catalog, setCatalog] = useState<Catalog | null>(null), [mode, setMode] = useState<"loading"|"public"|"preview"|"closed">("loading");
  const [csrf, setCsrf] = useState(""), [error, setError] = useState(""), [reload, setReload] = useState(0), [creating, setCreating] = useState(false);
  const [job, setJob] = useState<Job | null>(null), [submitted, setSubmitted] = useState(false), [ticketExpired, setTicketExpired] = useState(false);
  const preview = mode === "preview";
  useEffect(() => {
    const abort = new AbortController(); setError("");
    void (async () => {
      try { setCatalog(await api<Catalog>("/api/worlds", { signal: abort.signal })); setMode("public"); }
      catch (failure) {
        if (abort.signal.aborted) return;
        if (!(failure instanceof ApiError) || failure.code !== "downloads_closed") { setError(failure instanceof Error ? failure.message : "無法讀取世界。"); setMode("public"); return; }
        try {
          const session = await api<{csrfToken:string}>("/api/admin/session", { signal: abort.signal });
          const visible = await api<Catalog>("/api/admin/verification/catalog", { signal: abort.signal });
          setCsrf(session.csrfToken); setCatalog(visible); setMode("preview");
        } catch (failure) {
          if (abort.signal.aborted) return;
          setMode("closed");
          if (!(failure instanceof ApiError) || failure.status !== 401) setError(failure instanceof Error ? failure.message : "無法讀取預覽。");
        }
      }
    })();
    return () => abort.abort();
  }, [reload]);
  useEffect(() => {
    setTicketExpired(false);
    if (!job?.ticketExpiresAt) return;
    const timer = setTimeout(() => setTicketExpired(true), Math.max(0, Date.parse(job.ticketExpiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [job?.ticketExpiresAt]);
  useEffect(() => {
    if (!job || (job.state === "ready" && ticketExpired && !submitted) || ["transfer_ended", "transfer_failed", "failed", "expired", "invalidated", "unknown"].includes(job.state)) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const preparing = job.state === "preparing";
        const url = preview ? preparing ? "/api/admin/verification/download-step" : `/api/admin/verification/download-status?jobId=${encodeURIComponent(job.jobId)}`
          : `/api/downloads/${encodeURIComponent(job.jobId)}${preparing ? "/step" : ""}`;
        const value = await api<Partial<Job>>(url, { ...(preparing ? { body: preview ? { jobId: job.jobId } : {} } : {}), csrf, secret: job.statusSecret, signal: abort.signal });
        setJob(current => current?.jobId === job.jobId ? { ...current, ...value } : current);
      } catch (failure) {
        if (abort.signal.aborted) return;
        if (failure instanceof ApiError && [429,503].includes(failure.status) && failure.code !== "preparation_limit_reached") setJob(current => current ? { ...current, retryAfterSeconds: failure.seconds } : current);
        else { setError(failure instanceof Error ? failure.message : "無法繼續確認下載。"); setJob(current => current ? { ...current, state: "unknown" } : current); }
      }
    }, Math.max(2500, (job.retryAfterSeconds ?? 3) * 1000));
    return () => { clearTimeout(timer); abort.abort(); };
  }, [job, preview, csrf, ticketExpired, submitted]);
  async function download(world: PublicWorld) {
    setCreating(true); setError(""); setSubmitted(false); setJob(null);
    try {
      const created = await api<Omit<Job,"worldName">>(preview ? "/api/admin/verification/downloads" : `/api/worlds/${encodeURIComponent(world.id)}/downloads`, {
        body: { ...(preview ? { worldId: world.id } : {}), selection: { kind: "latest" } }, csrf });
      setJob({ ...created, worldName: world.displayName });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "無法建立下載，請稍後再試。"); }
    finally { setCreating(false); }
  }
  return <>
    {preview && <div className="rw-notice"><ShieldCheck aria-hidden="true" /><div><strong>管理員預覽</strong><p>你正在預覽訪客下載頁。已發布世界可在此驗證，匿名下載尚未開放。</p></div></div>}
    {error && <div className="rw-error" role="alert">{error}</div>}
    <section aria-label="可下載世界" className="rw-public-section">
      <div className="rw-section-heading"><h2>已發布的世界</h2><Button className="ml-auto" variant="outline" disabled={creating || job?.state === "preparing"} onClick={() => setReload(value => value + 1)}><RefreshCw /> 重新整理</Button></div>
      {mode === "loading" ? <p className="rw-panel" role="status">正在讀取世界…</p> : mode === "closed" ? <div className="rw-panel rw-empty"><Box /><h3>訪客下載尚未開放</h3><p>管理員正在驗證世界。開放後，這裡會顯示可下載的最新世界。</p></div>
        : catalog?.items.length === 0 ? <div className="rw-panel rw-empty"><Box /><h3>目前沒有已發布的世界</h3><p>管理員發布世界後，這裡就會顯示下載入口。</p></div>
        : <div className="rw-public-grid">{catalog?.items.map(world => <article className="rw-world-card" key={world.id}><div className="rw-card-icon"><Box aria-hidden="true" /></div><p className="rw-kicker">MINECRAFT BEDROCK · 最新存檔</p><h3>{world.displayName}</h3>{world.description && <p className="rw-muted">{world.description}</p>}<p className="rw-small">每次下載重新向 Realms 取得最新可用版本。</p><Button size="lg" disabled={creating || job?.state === "preparing" || world.availability !== "available"} onClick={() => void download(world)}><Download /> {world.availability === "available" ? "下載最新世界" : "世界暫時無法下載"}</Button><p className="rw-source-time">世界資料核對：{new Intl.DateTimeFormat("zh-TW", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Taipei" }).format(new Date(world.fetchedAt))}</p></article>)}</div>}
    </section>
    {creating && <p className="rw-panel" role="status">正在建立最新世界下載…</p>}
    {job && <section className="rw-panel rw-public-transfer" aria-live="polite"><p className="rw-kicker">{job.worldName}</p><h2>{labels[job.state] || "正在確認下載狀態"}</h2><p className="rw-muted">來源為 Realms 官方當時提供的最新存檔；尚未保存的遊戲進度可能不包含在內。</p>
      {job.ticket && <form method="POST" action={preview ? "/api/admin/verification/redeem" : "/api/downloads/redeem"} target="_blank" onSubmit={event => { if (submitted || ticketExpired) event.preventDefault(); else setSubmitted(true); }}>
        <input type="hidden" name="ticket" value={job.ticket} />{preview && <input type="hidden" name="csrfToken" value={csrf} />}<Button size="lg" type="submit" disabled={submitted || ticketExpired}><Download /> {submitted ? "已送出下載" : ticketExpired ? "下載連結已到期" : "儲存最新 .mcworld"}</Button>
      </form>}
      {ticketExpired && !submitted && <p className="rw-small">請重新按「下載最新世界」，取得新的下載連結。</p>}
      <p className="rw-small">傳輸結束後，請在裝置的下載資料夾開啟 .mcworld 並匯入基岩版。伺服器狀態不代表遊戲已匯入成功。</p>
    </section>}
  </>;
}
