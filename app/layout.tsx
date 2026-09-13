import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Realms World",
  description: "Minecraft 基岩版 Realms 世界下載與管理。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body className="antialiased">{children}</body>
    </html>
  );
}
