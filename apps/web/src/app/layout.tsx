import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { RegisterSW } from "./register-sw";
import "./globals.css";

export const metadata: Metadata = {
  title: "Movie Desk — 흩어진 순간을 한 편의 영화로",
  description: "영상을 넣으면 정리하고 방향을 제안하고 초안까지 만드는 로컬 우선 AI 영상 편집기.",
  applicationName: "Movie Desk",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black", title: "Movie Desk" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#15191e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="h-screen overflow-hidden">
        {children}
        <Toaster theme="dark" position="bottom-right" />
        <RegisterSW />
      </body>
    </html>
  );
}
