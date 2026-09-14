"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Box, KeyRound, ExternalLink, RefreshCw, Download, ShieldCheck, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useVerificationTools } from "@/hooks/use-verification-tools";
import { continueAuthorizationRefresh, RetryableRequest } from "@/lib/client/auth-refresh-request";

type Session = { username: string; csrfToken: string };
type Attempt = { attemptId: string; state: string; stage: string; userCode: string | null; verificationUri: string | null; retryAfterSeconds: number };
type World = { worldId: string; displayName: string; associationStatus: string; published: number; publicationVersion: number; slotId: string; realmName: string };
type Job = { jobId: string; statusSecret: string; state?: string; stage?: string; ticket?: string; error?: string | null; retryAfterSeconds?: number };

const labels: Record<string, string> = { disconnected: "尚未連接", authorizing: "授權進行中", connected: "已連接", reauth_required: "需要重新連接", pending: "等待授權", authorized: "授權完成", cancelled: "已取消", denied: "授權未完成", expired: "已到期", failed: "操作未完成", preparing: "準備世界中", ready: "世界已準備好", redeeming: "正在連接來源", streaming: "伺服器正在傳輸", transfer_ended: "伺服器傳輸結束", transfer_failed: "已確認傳輸失敗", invalidated: "下載已失效", unknown: "結果不明" };
const endpoint = (operation: string) => `/api/admin/verification/${operation}`;
async function api<T>(path: string, options: { body?: unknown; csrf?: string; secret?: string; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(path, { method: options.body === undefined ? "GET" : "POST", cache: "no-store", signal: options.signal,
    headers: { ...(options.body === undefined ? {} : { "Content-Type": "application/json" }), ...(options.csrf ? { "X-CSRF-Token": options.csrf } : {}), ...(options.secret ? { "X-Download-Capability": options.secret } : {}) },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  if (response.status === 204) return undefined as T;
  const value = await response.json() as { data: T; error?: { message?: string; code?: string; retryAfterSeconds?: number | null } };
  if ((response.status === 429 || response.status === 503) && value.error?.code !== "preparation_limit_reached") throw new RetryableRequest(value.error?.message || "請稍候再試。", value.error?.retryAfterSeconds ?? 5, value.error?.code);
  if (!response.ok) throw new Error(response.status === 401 ? "請登入管理員帳號。" : value.error?.message || "操作暫時無法完成，請稍後再試。");
  return value.data;
}

export default function VerificationPage() {
  const [session, setSession] = useState<Session | null>(null), [checking, setChecking] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [connection, setConnection] = useState("disconnected");
  const [attempt, setAttempt] = useState<Attempt | null>(null), [worlds, setWorlds] = useState<World[]>([]);
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  const [job, setJob] = useState<Job | null>(null), [submitted, setSubmitted] = useState(false);
  const [progress, setProgress] = useState("");
  const activeAction = useRef<AbortController | null>(null);
  useEffect(() => () => activeAction.current?.abort(), []);

  useVerificationTools({ signedIn: !!session, connection, loadedWorlds: worlds.length, publishedWorlds: worlds.filter((world) => world.published).length, downloadState: job?.state ?? null });
  const refreshConnection = useCallback(async () => {
    const value = await api<{state:string;pendingAttempt:Attempt|null}>(endpoint("connection"));
    setConnection(value.state); setAttempt(value.pendingAttempt);
  }, []);
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
        .then((value) => { setAttempt(value); if (value.state !== "pending") { void refreshConnection(); if (value.state !== "authorized") setError(value.state === "expired" ? "此次授權已到期，請重新連接。" : "未能完成 Microsoft／Xbox 授權，請重新確認帳號與服務狀態後再連接。"); } })
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
  async function action(run: () => Promise<void>) { setBusy(true); setError(""); try { await run(); } catch (failure) { setError(failure instanceof Error ? failure.message : "操作暫時無法完成。"); } finally { setBusy(false); setProgress(""); } }
  async function withAuthorizationRefresh<T>(request: (signal: AbortSignal) => Promise<T>) {
    const abort = new AbortController(); activeAction.current?.abort(); activeAction.current = abort;
    try { return await continueAuthorizationRefresh(() => request(abort.signal), { signal: abort.signal, onWaiting: () => setProgress("正在更新 Microsoft 連線授權，完成後會自動繼續…") }); }
    finally { if (activeAction.current === abort) activeAction.current = null; }
  }
  function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void action(async () => { setSession(await api<Session>("/api/admin/login", { body: { username: form.get("username"), password: form.get("password") } })); await refreshConnection(); });
  }
  function publish(world: World) { void action(async () => {
    const value = await api<{publicationVersion:number;published:boolean}>(endpoint("publication"), { body: { worldId: world.worldId, published: !world.published, expectedVersion: world.publicationVersion, acknowledgeLatest: !!acknowledged[world.worldId] }, csrf: session!.csrfToken });
    setWorlds((items) => items.map((item) => item.worldId === world.worldId ? { ...item, published: Number(value.published), publicationVersion: value.publicationVersion } : item));
  }); }
  function download(worldId: string) { void action(async () => {
    const created = await api<Job>(endpoint("downloads"), { body: { worldId, selection: { kind: "latest" } }, csrf: session!.csrfToken });
    setSubmitted(false); setJob({ ...created, state: "preparing" });
  }); }
  return <div className="rw-shell">
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 已重現 vinext 用戶端導頁例外，回首頁使用瀏覽器原生導航。 */}
    <header className="rw-header"><a href="/" className="rw-brand"><Box aria-hidden="true" /> REALMS WORLD</a><span className="rw-status">管理員工作區</span></header>
    <main className="rw-workspace"><div className="rw-page-heading"><div><p className="rw-kicker">管理員工作區</p><h1>連接你的世界</h1><p className="rw-muted">管理 Microsoft 連線、世界發布與下載。</p></div><div className="rw-private"><ShieldCheck size={18} /> 管理員專用</div></div>
      {error && <div className="rw-error" role="alert">{error}</div>}
      {progress && <div className="rw-panel" role="status">{progress}</div>}
      {checking ? <p role="status" className="rw-panel">正在確認登入狀態…</p> : !session ?
        <section className="rw-login rw-panel"><KeyRound className="rw-icon" /><h2>管理員登入</h2><p className="rw-muted">使用你的網站帳號。Microsoft 授權會在登入後另外進行。</p><form onSubmit={login} className="rw-form"><div><Label htmlFor="username">網站帳號</Label><Input id="username" name="username" autoComplete="username" required maxLength={64} /></div><div><Label htmlFor="password">網站密碼</Label><Input id="password" name="password" type="password" autoComplete="current-password" required /></div><Button type="submit" size="lg" disabled={busy}>{busy ? "登入中…" : "登入管理員"}</Button></form><p className="rw-small">此入口僅供已初始化的管理員使用。</p></section> : <>
        <div className="rw-grid"><section className="rw-panel"><div className="rw-section-heading"><span className="rw-number">01</span><h2>Microsoft 連線</h2></div><p className="rw-muted">{session.username}，請連接擁有 Realms 的 Microsoft 帳號。</p><div className="rw-connection-state">{labels[connection] || "狀態未知"}</div>
          {connection === "authorizing" && !attempt && <p className="rw-small" role="status">目前登入無法接續這筆授權。請回到原先啟動授權的瀏覽器頁面；若無法繼續，可解除連線後重新開始。</p>}
          {attempt?.state === "pending" ? <div className="rw-challenge">{attempt.userCode && attempt.verificationUri ? <><p>在 Microsoft 官方頁面輸入這組代碼：</p><strong className="rw-code">{attempt.userCode}</strong><Button asChild size="lg"><a href={attempt.verificationUri} target="_blank" rel="noopener noreferrer">前往 Microsoft 授權 <ExternalLink /></a></Button><p className="rw-small">等待授權完成，頁面會自動更新。</p></> : <p role="status">{attempt.stage === "exchanging_tokens" ? "正在完成安全連接…" : "正在取得授權代碼…"}</p>}<Button variant="ghost" disabled={busy} onClick={() => void action(async () => { await api(endpoint("connection-cancel"), { body: { attemptId: attempt.attemptId }, csrf: session.csrfToken }); setAttempt(null); await refreshConnection(); })}>取消此次授權</Button></div>
          : <div className="rw-actions">{connection === "disconnected" ? <Button size="lg" disabled={busy} onClick={() => void action(async () => { setAttempt(await api<Attempt>(endpoint("connection-start"), { body: {}, csrf: session.csrfToken })); setConnection("authorizing"); })}><KeyRound /> 連接 Microsoft</Button> : <Button variant="outline" disabled={busy} onClick={() => void action(async () => { await api(endpoint("disconnect"), { body: {}, csrf: session.csrfToken }); setWorlds([]); setJob(null); setAttempt(null); await refreshConnection(); })}><Unplug /> 解除連線並下架所有世界</Button>}</div>}</section>
          <aside className="rw-panel rw-guide"><p className="rw-kicker">操作順序</p><ol><li><strong>連接擁有者帳號</strong><span>僅使用 Microsoft 官方授權頁。</span></li><li><strong>選擇最新存檔</strong><span>發布時核對擁有權、欄位與最新來源。</span></li><li><strong>下載並匯入遊戲</strong><span>核對最新世界的內容。</span></li></ol><p className="rw-small">不再提供下載時，請下架對應世界；解除連線會下架所有世界。</p></aside></div>
        <section className="rw-panel"><div className="rw-section-heading"><span className="rw-number">02</span><h2>世界與發布範圍</h2><Button className="ml-auto" variant="outline" disabled={busy || connection !== "connected"} onClick={() => void action(async () => { setProgress("正在讀取世界…"); setWorlds((await withAuthorizationRefresh((signal) => api<{items:World[]}>(endpoint("worlds"), { signal }))).items); })}><RefreshCw /> 讀取世界</Button></div>
          {!worlds.length ? <div className="rw-empty"><Box size={32} /><h3>還沒有讀取世界</h3><p>連接完成後，讀取擁有者帳號中的 Realms 欄位。</p></div> : worlds.map((world) => <article key={world.worldId} className="rw-world"><p className="rw-kicker">{world.realmName} · 欄位 {world.slotId}</p><h3>{world.displayName}</h3><p className="rw-muted">{world.published ? "已發布最新存檔，歷史備份未公開" : world.associationStatus === "unavailable" ? "Realm 目前不可用" : world.associationStatus === "empty" ? "此欄位為空" : "可發布此欄位的最新存檔"}</p>
            {!["empty", "unavailable"].includes(world.associationStatus) && !world.published ? <Label className="rw-check"><Checkbox checked={!!acknowledged[world.worldId]} onCheckedChange={(checked) => setAcknowledged((current) => ({ ...current, [world.worldId]: checked === true }))} />確認只公開此欄位目前與之後的最新存檔；在遊戲中替換此欄位後，也會提供新的內容</Label> : null}
            <div className="rw-actions"><Button disabled={busy || (!world.published && (["empty", "unavailable"].includes(world.associationStatus) || !acknowledged[world.worldId]))} variant={world.published ? "outline" : "default"} onClick={() => publish(world)}>{world.published ? "下架世界" : "發布最新存檔"}</Button>{!!world.published && <Button variant="outline" disabled={busy} onClick={() => download(world.worldId)}><Download /> 準備最新存檔</Button>}</div></article>)}
        </section>
        {job && <section className="rw-panel" aria-live="polite"><div className="rw-section-heading"><span className="rw-number">03</span><h2>下載觀察</h2></div><p className="rw-transfer-state">{labels[job.state || "preparing"] || "結果不明"}</p><p className="rw-muted">伺服器傳輸結束不代表檔案已儲存或匯入成功；請另外在基岩版中核對。</p>{job.ticket && <form className="mt-6" method="POST" action={endpoint("redeem")} target="_blank" onSubmit={(event) => { if (submitted) event.preventDefault(); else setSubmitted(true); }}><input type="hidden" name="ticket" value={job.ticket} /><input type="hidden" name="csrfToken" value={session.csrfToken} /><Button type="submit" size="lg" disabled={submitted}><Download /> {submitted ? "已送出下載" : "開始原生下載"}</Button><p className="rw-small">票據僅能使用一次，請在 60 秒內開始下載。</p></form>}{job.error && <p className="rw-error">此次下載未能繼續，請重新確認連線與發布狀態。</p>}</section>}
      </>}
    </main><footer className="rw-footer"><span>REALMS WORLD</span><span>世界與連線管理</span></footer>
  </div>;
}
