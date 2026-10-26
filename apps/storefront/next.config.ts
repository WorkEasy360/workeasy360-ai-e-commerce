import type { NextConfig } from "next";

// The public API: product images and the browser's cart and checkout calls go through the shop's own origin.
const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    // See apps/admin/next.config.ts: the dev MCP server's log writes cause a reload loop in this monorepo.
    mcpServer: false,
    // Recorded by the Next.js security upgrade (16.4.0 → 16.4.2).
    agentUpgrade: "security",
  },
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@workeasy/ui", "@workeasy/commerce"],
  async rewrites() {
    return [{ source: "/public/v1/:path*", destination: `${apiInternalUrl}/public/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
