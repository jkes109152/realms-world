import { Box, ArrowUpRight, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  return <div className="rw-shell">
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 已重現 vinext 用戶端導頁例外，入口使用瀏覽器原生導航。 */}
    <header className="rw-header"><a href="/" className="rw-brand"><Box aria-hidden="true" /> REALMS WORLD</a><span className="rw-kicker">MINECRAFT · BEDROCK</span></header>
    <main className="rw-intro"><div className="rw-status">● 驗證階段</div><h1>世界下載尚未開放</h1>
      <p className="rw-lead">世界下載服務正在驗證中。開放後，你可以在這裡取得管理員公開的最新與歷史存檔。</p>
      <div className="rw-notice"><LockKeyhole aria-hidden="true" /><div><strong>目前沒有公開世界</strong><p>下載開放後，這裡會顯示可取得的世界與版本。</p></div></div>
      <Button asChild variant="outline" size="lg"><a href="/admin/verification">管理員登入 <ArrowUpRight /></a></Button>
    </main><footer className="rw-footer"><span>REALMS WORLD</span><span>非 Minecraft 官方網站</span></footer>
  </div>;
}
