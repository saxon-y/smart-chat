import type { Metadata } from "next";
import Script from "next/script";
import { DM_Mono, Manrope } from "next/font/google";
import "./globals.css";
import SwRegister from "@/components/SwRegister";

const manrope = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

const mono = DM_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Smart Chat",
  description: "一个专注、安静的团队文字聊天室。",
};

const themeInit = `(function(){try{var c=localStorage.getItem('smartchat_theme');if(!c)c='#c7613d';document.documentElement.style.setProperty('--theme',c);}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className={`${manrope.variable} ${mono.variable}`}>
      <body>
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeInit }} />
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
