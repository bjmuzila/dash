import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sql.js"],
  outputFileTracingRoot: require("path").join(__dirname, "../../"),
};

export default nextConfig;
