"use client";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Box, KeyRound, ExternalLink, RefreshCw, Download, ShieldCheck, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useVerificationTools } from "@/hooks/use-verification-tools";

type Session = { username: string; csrfToken: string };
type Attempt = { attemptId: string; state: string; stage: string; userCode: string | null; verificationUri: string | null; retryAfterSeconds: number };
type World = { worldId: string; displayName: string; associationStatus: string; published: number; publicationVersion: number; slotId: string; realmName: string };
type Job = { jobId: string; statusSecret: string; state?: string; stage?: string; ticket?: string; error?: string | null; retryAfterSeconds?: number };
type Archive = { archiveId: string; savedAt: string | null };
const labels: Record<string, string> = { disconnected: "尚未連接", authorizing: "授權進行中", connected: "已連接", reauth_required: "需要重新連接", pending: "等待授權", authorized: "授權完成", cancelled: "已取消", denied: "授權未完成", expired: "已到期", failed: "操作未完成", preparing: "準備世界中", ready: "世界已準備好", redeeming: "正在連接來源", streaming: "伺服器正在傳輸", transfer_ended: "伺服器傳輸結束", transfer_failed: "已確認傳輸失敗", invalidated: "下載已失效", unknown: "結果不明" };
const endpoint = (operation: string) => `/api/admin/verification/${operation}`;
class RetryableRequest extends Error { constructor(message: string, public seconds: number) { super(message); } }
async function api<T>(path: string, options: { body?: unknown; csrf?: string; secret?: string; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(path, { method: options.body === undefined ? "GET" : "POST", cache: "no-store", signal: options.signal,
    headers: { ...(options.body === undefined ? {} : { "Content-Type": "application/json" }), ...(options.csrf ? { "X-CSRF-Token": options.csrf } : {}), ...(options.secret ? { "X-Download-Capability": options.secret } : {}) },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  if (response.status === 204) return undefined as T;
  const value = await response.json() as { data: T; error?: { message?: string; code?: string; retryAfterSeconds?: number | null } };
  if ((response.status === 429 || response.status === 503) && value.error?.code !== "preparation_limit_reached") throw new RetryableRequest(value.error?.message || "請稍候再試。", value.error?.retryAfterSeconds ?? 5);
  if (!response.ok) throw new Error(response.status === 401 ? "請登入管理員帳號。" : value.error?.message || "操作暫時無法完成，請稍後再試。");
  return value.data;
}

export default function VerificationPage() {
  const [session, setSession] = useState<Session | null>(null), [checking, setChecking] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [connection, setConnection] = useState("disconnected");
  const [attempt, setAttempt] = useState<Attempt | null>(null), [worlds, setWorlds] = useState<World[]>([]);
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({}), [archives, setArchives] = useState<Record<string, Archive[]>>({});
  const [job, setJob] = useState<Job | null>(null), [submitted, setSubmitted] = useState(false);
  useVerificationTools({ signedIn: !!session, connection, loadedWorlds: worlds.length, publishedWorlds: worlds.filter((world) => world.published).length, downloadState: job?.state ?? null });
  const refreshConnection = useCallback(async () => { setConnection((await api<{state:string}>(endpoint("connection"))).state); }, []);
  useEffect(() => {
    const abort = new AbortController();
    api<Session>("/api/admin/session", { signal: abort.signal }).then((value) => { setSession(value); return refreshConnection(); }).catch(() => undefined).finally(() => setChecking(false));
    return () => abort.abort();
  }, [refreshConnection]);
  useEffect(() => {
    if (!session || !attempt || attempt.state !== "pending") return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      api<Attempt>(endpoint("connection-step"), { body: { attemptId: attempt.attemptId }, csrf: session.csrfToken, signal: abort.signal })
        .then((value) => { setAttempt(value); if (value.state !== "pending") void refreshConnection(); })
        .catch((failure) => { if (!abort.signal.aborted) { if (failure instanceof RetryableRequest) setAttempt((current) => current ? { ...current, retryAfterSeconds: failure.seconds } : null); else { setError(failure.message); setAttempt(null); } } });
    }, Math.max(1000, attempt.retryAfterSeconds * 1000));
    return () => { clearTimeout(timer); abort.abort(); };
  }, [attempt, session, refreshConnection]);
  useEffect(() => {
    if (!session || !job || ["transfer_ended", "transfer_failed", "failed", "expired", "invalidated", "unknown"].includes(job.state || "")) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const preparing = !job.state || job.state === "preparing";
        const value = await api<Partial<Job>>(preparing ? endpoint("download-step") : `${endpoint("download-status")}?jobId=${encodeURIComponent(job.jobId)}`,
          { ...(preparing ? { body: { jobId: job.jobId } } : {}), csrf: session.csrfToken, secret: job.statusSecret, signal: abort.signal });
        setJob((current) => current?.jobId === job.jobId ? { ...current, ...value } : current);
      } catch (failure) { if (!abort.signal.aborted) { if (failure instanceof RetryableRequest) setJob((current) => current ? { ...current, retryAfterSeconds: failure.seconds } : current); else { setError(`${failure instanceof Error ? failure.message : "無法繼續查詢"} 查詢結果不代表附件已完成或中斷。`); setJob((current) => current ? { ...current, state: "unknown" } : current); } } }
    }, Math.max(2500, (job.retryAfterSeconds ?? 0) * 1000));
    return () => { clearTimeout(timer); abort.abort(); };
  }, [job, session]);
  async function action(run: () => Promise<void>) { setBusy(true); setError(""); try { await run(); } catch (failure) { setError(failure instanceof Error ? failure.message : "操作暫時無法完成。"); } finally { setBusy(false); } }
  function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void action(async () => { setSession(await api<Session>("/api/admin/login", { body: { username: form.get("username"), password: form.get("password") } })); await refreshConnection(); });
  }
  function publish(world: World) { void action(async () => {
    const value = await api<{publicationVersion:number;published:boolean}>(endpoint("publication"), { body: { worldId: world.worldId, published: !world.published, expectedVersion: world.publicationVersion, acknowledgeAllArchives: !!acknowledged[world.worldId] }, csrf: session!.csrfToken });
    setWorlds((items) => items.map((item) => item.worldId === world.worldId ? { ...item, published: Number(value.published), publicationVersion: value.publicationVersion } : item));
  }); }
  function download(worldId: string, archiveId?: string) { void action(async () => {
    const created = await api<Job>(endpoint("downloads"), { body: { worldId, selection: archiveId ? { kind: "backup", archiveId } : { kind: "latest" } }, csrf: session!.csrfToken });
    setSubmitted(false); setJob({ ...created, state: "preparing" });
  }); }
  return <div className="rw-shell">
    <header className="rw-header"><Link href="/" className="rw-brand"><Box aria-hidden="true" /> REALMS WORLD</Link><span className="rw-status">● 管理員驗證</span></header>
    <main className="rw-workspace"><div className="rw-page-heading"><div><p className="rw-kicker">管理員工作區</p><h1>連接你的世界</h1><p className="rw-muted">完成授權與下載驗證，確認世界可以完整抵達。</p></div><div className="rw-private"><ShieldCheck size={18} /> 公開下載關閉</div></div>
      {error && <div className="rw-error" role="alert">{error}</div>}
      {checking ? <p role="status" className="rw-panel">正在確認登入狀態…</p> : !session ?
        <section className="rw-login rw-panel"><KeyRound className="rw-icon" /><h2>管理員登入</h2><p className="rw-muted">使用你的網站帳號。Microsoft 授權會在登入後另外進行。</p><form onSubmit={login} className="rw-form"><div><Label htmlFor="username">網站帳號</Label><Input id="username" name="username" autoComplete="username" required maxLength={64} /></div><div><Label htmlFor="password">網站密碼</Label><Input id="password" name="password" type="password" autoComplete="current-password" required /></div><Button type="submit" size="lg" disabled={busy}>{busy ? "登入中…" : "登入驗證入口"}</Button></form><p className="rw-small">此入口僅供已初始化的管理員使用。</p></section> : <>
        <div className="rw-grid"><section className="rw-panel"><div className="rw-section-heading"><span className="rw-number">01</span><h2>Microsoft 連線</h2></div><p className="rw-muted">{session.username}，請連接擁有 Realms 的 Microsoft 帳號。</p><div className="rw-connection-state">{labels[connection] || "狀態未知"}</div>
          {attempt?.state === "pending" ? <div className="rw-challenge">{attempt.userCode && attempt.verificationUri ? <><p>在 Microsoft 官方頁面輸入這組代碼：</p><strong className="rw-code">{attempt.userCode}</strong><Button asChild size="lg"><a href={attempt.verificationUri} target="_blank" rel="noopener noreferrer">前往 Microsoft 授權 <ExternalLink /></a></Button><p className="rw-small">等待授權完成，頁面會自動更新。</p></> : <p role="status">{attempt.stage === "exchanging_tokens" ? "正在完成安全連接…" : "正在取得授權代碼…"}</p>}<Button variant="ghost" disabled={busy} onClick={() => void action(async () => { await api(endpoint("connection-cancel"), { body: { attemptId: attempt.attemptId }, csrf: session.csrfToken }); setAttempt(null); await refreshConnection(); })}>取消此次授權</Button></div>
          : <div className="rw-actions">{connection === "disconnected" ? <Button size="lg" disabled={busy} onClick={() => void action(async () => { setAttempt(await api<Attempt>(endpoint("connection-start"), { body: {}, csrf: session.csrfToken })); setConnection("authorizing"); })}><KeyRound /> 連接 Microsoft</Button> : <Button variant="outline" disabled={busy} onClick={() => void action(async () => { await api(endpoint("disconnect"), { body: {}, csrf: session.csrfToken }); setWorlds([]); setJob(null); setAttempt(null); await refreshConnection(); })}><Unplug /> 解除連線並下架所有世界</Button>}</div>}</section>
          <aside className="rw-panel rw-guide"><p className="rw-kicker">驗證順序</p><ol><li><strong>連接擁有者帳號</strong><span>僅使用 Microsoft 官方授權頁。</span></li><li><strong>核對欄位與歷史</strong><span>歸屬尚未確認的世界無法發布。</span></li><li><strong>下載並匯入遊戲</strong><span>核對最新、歷史與最大世界的內容。</span></li></ol><p className="rw-small">驗證結束或中止前，請下架此次驗證的世界。</p></aside></div>
        <section className="rw-panel"><div className="rw-section-heading"><span className="rw-number">02</span><h2>世界與驗證範圍</h2><Button className="ml-auto" variant="outline" disabled={busy || connection !== "connected"} onClick={() => void action(async () => { setWorlds((await api<{items:World[]}>(endpoint("worlds"))).items); })}><RefreshCw /> 讀取世界</Button></div>
          {!worlds.length ? <div className="rw-empty"><Box size={32} /><h3>還沒有讀取世界</h3><p>連接完成後，讀取擁有者帳號中的 Realms 欄位。</p></div> : worlds.map((world) => <article key={world.worldId} className="rw-world"><p className="rw-kicker">{world.realmName} · 欄位 {world.slotId}</p><h3>{world.displayName}</h3><p className="rw-muted">{world.published ? "已發布至受保護的驗證範圍" : world.associationStatus === "verified" ? "已確認歸屬，尚未發布" : "尚無可靠的存檔歸屬證據，無法發布"}</p>
            {world.associationStatus === "verified" && !world.published ? <Label className="rw-check"><Checkbox checked={!!acknowledged[world.worldId]} onCheckedChange={(checked) => setAcknowledged((current) => ({ ...current, [world.worldId]: checked === true }))} />確認發布此欄位的最新、全部現存與未來可用歷史</Label> : null}
            <div className="rw-actions"><Button disabled={busy || (!world.published && (world.associationStatus !== "verified" || !acknowledged[world.worldId]))} variant={world.published ? "outline" : "default"} onClick={() => publish(world)}>{world.published ? "下架驗證世界" : "發布供驗證"}</Button>{!!world.published && <><Button variant="outline" disabled={busy} onClick={() => download(world.worldId)}><Download /> 準備最新存檔</Button><Button variant="ghost" disabled={busy} onClick={() => void action(async () => { const value = await api<{items:Archive[]}>(`${endpoint("archives")}?worldId=${encodeURIComponent(world.worldId)}`); setArchives((current) => ({ ...current, [world.worldId]: value.items })); })}>讀取歷史存檔</Button></>}</div>
            {archives[world.worldId]?.map((archive) => <div key={archive.archiveId} className="rw-archive"><span>{archive.savedAt ? new Date(archive.savedAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }) : "存檔時間未知"}</span><Button size="sm" variant="outline" disabled={busy || !world.published} onClick={() => download(world.worldId, archive.archiveId)}>準備這份歷史</Button></div>)}</article>)}
        </section>
        {job && <section className="rw-panel" aria-live="polite"><div className="rw-section-heading"><span className="rw-number">03</span><h2>下載觀察</h2></div><p className="rw-transfer-state">{labels[job.state || "preparing"] || "結果不明"}</p><p className="rw-muted">伺服器傳輸結束不代表檔案已儲存或匯入成功；請另外在基岩版中核對。</p>{job.ticket && !submitted && <form className="mt-6" method="POST" action={endpoint("redeem")} target="_blank" onSubmit={() => setSubmitted(true)}><input type="hidden" name="ticket" value={job.ticket} /><input type="hidden" name="csrfToken" value={session.csrfToken} /><Button type="submit" size="lg"><Download /> 開始原生下載</Button><p className="rw-small">票據僅能使用一次，請在 60 秒內開始下載。</p></form>}{job.error && <p className="rw-error">此次下載未能繼續，請重新確認連線與發布狀態。</p>}</section>}
      </>}
    </main><footer className="rw-footer"><span>REALMS WORLD</span><span>驗證階段 · 未開放公開下載</span></footer>
  </div>;
}
