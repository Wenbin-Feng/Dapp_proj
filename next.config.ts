import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  output: "standalone",
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};
export default config;
