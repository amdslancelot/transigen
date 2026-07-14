import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // Pin the file-tracing root to this package explicitly. Without this,
  // Next.js walks up looking for the nearest lockfile and can pick a
  // parent directory outside the repo if one happens to contain a
  // package-lock.json (this has been observed on at least one dev
  // machine), which nests .next/standalone/server.js under extra
  // directories and breaks the Dockerfile's `COPY .next/standalone ./`.
  outputFileTracingRoot: path.join(__dirname),
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com", pathname: "/vi/**" },
      { protocol: "https", hostname: "img.youtube.com", pathname: "/vi/**" },
    ],
  },
};

export default nextConfig;
