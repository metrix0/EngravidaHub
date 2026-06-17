// apps/insights/tailwind.config.ts
import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./src/**/*.{ts,tsx}",
        "../../packages/components/**/*.{ts,tsx}",
    ],
};

export default config;