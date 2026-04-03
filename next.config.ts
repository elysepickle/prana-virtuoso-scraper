import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/scrape": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/scrape-page": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/enrich": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
