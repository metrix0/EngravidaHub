// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    allowedDevOrigins: ["*.trycloudflare.com"],
    devIndicators: false
};

export default nextConfig;