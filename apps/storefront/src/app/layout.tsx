import type { Metadata } from "next";
import type { ReactNode } from "react";
import { themeInitScript } from "@workeasy/ui";
import { storefrontStyles } from "./storefront-css";

export const metadata: Metadata = {
  title: { default: "Shop", template: "%s" },
  description: "An online store powered by Workeasy360 Commerce.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Store pages set the document language from the store; the theme script may set data-theme before hydration.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <style>{storefrontStyles}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
