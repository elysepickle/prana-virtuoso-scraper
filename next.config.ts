import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Increase serverless function timeout for scraping
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
};

export default nextConfig;
