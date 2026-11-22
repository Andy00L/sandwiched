import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  agentRules: false,
  devIndicators: false,
  turbopack: {
    // Next's built-in browser Buffer polyfill predates BigInt writes, which the MagicBlock SDK's deposit builders call.
    resolveAlias: { "next/dist/compiled/buffer": { browser: "./node_modules/buffer/index.js" } },
  },
};

export default nextConfig;
