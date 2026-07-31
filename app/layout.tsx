import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { loadPersistedProfileLanguage } from "@/lib/persisted-locale.server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Brain — AI operating system for hospitality",
  description:
    "Brain is the AI operating system for restaurants, bars, clubs, and hotels.",
  icons: {
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#020617",
  colorScheme: "dark",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const language = await loadPersistedProfileLanguage();
  return (
    <html
      lang={language}
      dir={language === "ar" ? "rtl" : "ltr"}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full overflow-x-hidden bg-[var(--brain-canvas)] text-[var(--brain-ink)]">{children}</body>
    </html>
  );
}
