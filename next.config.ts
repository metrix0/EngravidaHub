// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    allowedDevOrigins: [
        "*.trycloudflare.com",
    ],
    transpilePackages: ["@engravida/components", "@engravida/types"]
};

export default nextConfig;