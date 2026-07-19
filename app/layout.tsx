import type { Metadata } from "next";
import { Inter } from "next/font/google";
import ThemeScript from "@/components/theme-script";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Campaign Scanner",
  description: "Multi-store WhatsApp campaign scanner portal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the theme script sets data-theme on <html>
    // before React hydrates, so the attribute legitimately differs from the
    // server-rendered markup.
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
