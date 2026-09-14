export class RetryableRequest extends Error {
  constructor(message: string, public seconds: number, public code?: string) { super(message); }
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, milliseconds);
    signal.addEventListener("abort", aborted, { once: true });
  });
}

/** 只接續伺服器明示的授權續期，不自動重送一般錯誤或已執行的發布。 */
export async function continueAuthorizationRefresh<T>(request: () => Promise<T>, options: { signal: AbortSignal; onWaiting?: () => void }) {
  const deadline = Date.now() + 120000;
  for (let attempt = 0; attempt < 12; attempt++) {
    options.signal.throwIfAborted();
    if (Date.now() >= deadline) throw new Error("連線授權尚未更新完成，請稍後再試。");
    try { return await request(); }
    catch (error) {
      if (!(error instanceof RetryableRequest) || error.code !== "authorization_refreshing") throw error;
      const delay = Math.max(1000, Number.isFinite(error.seconds) ? error.seconds * 1000 : 5000);
      if (attempt === 11 || Date.now() + delay >= deadline) throw new Error("連線授權尚未更新完成，請稍後再試。");
      options.onWaiting?.();
      await wait(delay, options.signal);
    }
  }
  throw new Error("連線授權尚未更新完成，請稍後再試。");
}
