import type { NextConfig } from "next";

// Express API that serves /auth, /api and public media. Proxying through the admin keeps
// session cookies first-party to the admin origin.
const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    // Next 16's dev MCP server records every log line to .next/dev/logs. In this
    // monorepo the repo-wide watcher sees those writes and reloads the page,
    // which logs again: an endless reload loop. Not needed for development.
    mcpServer: false,
    // Recorded by the Next.js security upgrade (16.4.0 → 16.4.2).
    agentUpgrade: "security",
  },
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@workeasy/ui", "@workeasy/commerce"],
  env: {
    // "View store" links point at the storefront app.
    NEXT_PUBLIC_STOREFRONT_URL: process.env.STOREFRONT_PUBLIC_URL ?? "http://localhost:3001",
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiInternalUrl}/api/:path*` },
      { source: "/auth/:path*", destination: `${apiInternalUrl}/auth/:path*` },
      // Payment gateway webhooks, when the API has no public address of its own.
      { source: "/webhooks/:path*", destination: `${apiInternalUrl}/webhooks/:path*` },
      // Product and collection images (a redirect to a signed storage URL).
      { source: "/public/v1/media/:path*", destination: `${apiInternalUrl}/public/v1/media/:path*` },
    ];
  },
  async headers() {
    // The admin is never framed (clickjacking), and never sends its URLs to
    // other sites. "same-origin" rather than "no-referrer": with no-referrer,
    // browsers send `Origin: null` on form posts (Sign out), which the API's
    // same-origin check must refuse. HSTS is set by the TLS-terminating proxy.
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
