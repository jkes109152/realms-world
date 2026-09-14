import { Box, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorldDownloads } from "@/components/WorldDownloads";

export default function Home() {
  return <div className="rw-shell">
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 已重現 vinext 用戶端導頁例外，入口使用瀏覽器原生導航。 */}
    <header className="rw-header"><a href="/" className="rw-brand"><Box aria-hidden="true" /> REALMS WORLD</a><span className="rw-kicker">MINECRAFT · BEDROCK</span></header>
    <main className="rw-public-main"><section className="rw-public-hero"><h1>下載最新世界</h1>
      <p className="rw-lead">每次下載都從 Realms 取得最新可用存檔。開啟下載的 .mcworld，即可匯入基岩版。</p></section>
      <WorldDownloads />
      <div className="rw-public-admin"><Button asChild variant="outline"><a href="/admin/verification">管理員登入 <ArrowUpRight /></a></Button></div>
    </main><footer className="rw-footer"><span>REALMS WORLD</span><span>非 Minecraft 官方網站</span></footer>
  </div>;
}
