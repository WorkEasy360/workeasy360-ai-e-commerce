import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { adminStyles, themeInitScript } from "@workeasy/ui";

export const metadata: Metadata = {
  title: { default: "Workeasy360 Commerce", template: "%s · Workeasy360 Commerce" },
  description: "Sell products with a complete storefront, checkout and order management.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1430" },
  ],
};

const css = adminStyles();

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The theme script may set data-theme before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <style>{css}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
