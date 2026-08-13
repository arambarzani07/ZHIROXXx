import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zhirox Smart POS",
  description: "سیستەمی کاشێر، کۆگا و ژمێریاری بە زمانی کوردی",
  manifest: "/manifest.webmanifest",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#a73b37",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ckb" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
