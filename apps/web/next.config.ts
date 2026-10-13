import type { NextConfig } from "next";

const config: NextConfig = {
  output: process.env.PEERSCREEN_DEV_PROXY === "true" ? undefined : "export",
  trailingSlash: process.env.PEERSCREEN_DEV_PROXY !== "true",
  images: { unoptimized: true },
  transpilePackages: ["@peerscreen/player"],
  poweredByHeader: false,
};
if (process.env.PEERSCREEN_DEV_PROXY === "true") {
  config.rewrites = async () => [
    {
      source: "/api/v1/:path*",
      destination: `${process.env.API_TARGET || "http://127.0.0.1:18080"}/api/v1/:path*`,
    },
    {
      source: "/health/:path*",
      destination: `${process.env.API_TARGET || "http://127.0.0.1:18080"}/health/:path*`,
    },
  ];
}

export default config;
