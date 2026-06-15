import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sql.js"],
  compress: true,
  productionBrowserSourceMaps: false,
};

export default nextConfig;
