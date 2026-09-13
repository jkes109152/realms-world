import Link from "next/link";
import { Box, ArrowUpRight, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  return <div className="rw-shell">
    <header className="rw-header"><Link href="/" className="rw-brand"><Box aria-hidden="true" /> REALMS WORLD</Link><span className="rw-kicker">MINECRAFT · BEDROCK</span></header>
    <main className="rw-intro"><div className="rw-status">● 驗證階段</div><h1>世界下載尚未開放</h1>
      <p className="rw-lead">世界下載服務正在驗證中。開放後，你可以在這裡取得管理員公開的最新與歷史存檔。</p>
      <div className="rw-notice"><LockKeyhole aria-hidden="true" /><div><strong>目前沒有公開世界</strong><p>下載開放後，這裡會顯示可取得的世界與版本。</p></div></div>
      <Button asChild variant="outline" size="lg"><Link href="/admin/verification">管理員驗證入口 <ArrowUpRight /></Link></Button>
    </main><footer className="rw-footer"><span>REALMS WORLD</span><span>非 Minecraft 官方網站</span></footer>
  </div>;
}
