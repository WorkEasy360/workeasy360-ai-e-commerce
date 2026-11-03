import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { adminStyles, themeInitScript, tokens } from "@workeasy/ui";

// Self-hosted at build time; the tokens' font stack reads --we-font-inter.
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--we-font-inter" });

export const metadata: Metadata = {
  title: { default: "Workeasy AI Commerce", template: "%s · Workeasy AI Commerce" },
  description: "Sell products with a complete storefront, checkout and order management.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: tokens.color.surface },
    { media: "(prefers-color-scheme: dark)", color: tokens.colorDark.surface },
  ],
};

const css = adminStyles();

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The theme script may set data-theme before React hydrates.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <style>{css}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
