"use client";
import { useEffect, useRef } from "react";

type Overview = { signedIn: boolean; connection: string; loadedWorlds: number; publishedWorlds: number; downloadState: string | null };
type ModelContext = { registerTool(tool: {
  name: string; title: string; description: string; inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute(input: unknown): Overview;
}, options: { signal: AbortSignal }): void | Promise<void> };

/** 只提供畫面上的安全摘要；不提供帳號、授權代碼或下載秘密。 */
export function useVerificationTools(overview: Overview) {
  const current = useRef(overview);
  useEffect(() => { current.current = overview; }, [overview]);
  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(context.registerTool({
        name: "read_verification_status",
        title: "讀取驗證進度",
        description: "讀取目前畫面上的登入、Microsoft 連線、已載入世界數與下載進度。只反映此頁已知狀態，不查詢新的來源或修改發布。",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute(input) {
          if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) throw new Error("此工具只接受空物件。");
          return { ...current.current };
        },
      }, { signal: lifecycle.signal })).catch(() => undefined);
    } catch { /* 不支援工具註冊時，原有介面仍可操作。 */ }
    return () => lifecycle.abort();
  }, []);
}
