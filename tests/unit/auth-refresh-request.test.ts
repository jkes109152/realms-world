import { afterEach, expect, it, vi } from "vitest";
import { continueAuthorizationRefresh, RetryableRequest } from "@/lib/client/auth-refresh-request";

afterEach(() => vi.useRealTimers());
const pending = (seconds = 2) => new RetryableRequest("正在更新連線授權…", seconds, "authorization_refreshing");

it("一次操作接續分段續期，遵守等待時間後回傳世界", async () => {
  vi.useFakeTimers();
  const request = vi.fn().mockRejectedValueOnce(pending(3)).mockRejectedValueOnce(pending(5)).mockResolvedValue({ items: ["世界"] });
  const progress = vi.fn();
  const result = continueAuthorizationRefresh(request, { signal: new AbortController().signal, onWaiting: progress });
  await vi.advanceTimersByTimeAsync(2999); expect(request).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(request).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(5000);
  expect(await result).toEqual({ items: ["世界"] }); expect(progress).toHaveBeenCalledTimes(2);
});

it.each([new Error("請重新登入"), new RetryableRequest("官方暫時不可用", 5, "temporarily_unavailable")])("登入或一般上游錯誤不自動重送", async (failure) => {
  const request = vi.fn().mockRejectedValue(failure);
  await expect(continueAuthorizationRefresh(request, { signal: new AbortController().signal })).rejects.toBe(failure);
  expect(request).toHaveBeenCalledTimes(1);
});

it("離開頁面可取消等待，不繼續續期或讀取世界", async () => {
  vi.useFakeTimers();
  const abort = new AbortController(); const request = vi.fn().mockRejectedValue(pending());
  const result = continueAuthorizationRefresh(request, { signal: abort.signal });
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(1); abort.abort(); await rejected;
  await vi.advanceTimersByTimeAsync(10000); expect(request).toHaveBeenCalledTimes(1);
});

it("持續未完成時有次數上限，過長 Retry-After 不提前重送", async () => {
  vi.useFakeTimers();
  const request = vi.fn().mockRejectedValue(pending());
  const result = expect(continueAuthorizationRefresh(request, { signal: new AbortController().signal })).rejects.toThrow("稍後再試");
  await vi.advanceTimersByTimeAsync(30000); await result; expect(request).toHaveBeenCalledTimes(12);
  const long = vi.fn().mockRejectedValue(pending(180));
  await expect(continueAuthorizationRefresh(long, { signal: new AbortController().signal })).rejects.toThrow("稍後再試");
  expect(long).toHaveBeenCalledTimes(1);
  const suspended = vi.fn().mockRejectedValue(pending());
  const overdue = expect(continueAuthorizationRefresh(suspended, { signal: new AbortController().signal })).rejects.toThrow("稍後再試");
  await vi.advanceTimersByTimeAsync(1); vi.setSystemTime(Date.now() + 120000);
  await vi.advanceTimersByTimeAsync(2000); await overdue; expect(suspended).toHaveBeenCalledTimes(1);
});
