import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 서버 라우트(/api/*)가 public/data/*.json 을 fs로 읽을 수 있도록 번들에 포함
  outputFileTracingIncludes: {
    "/api/**/*": ["./public/data/**/*"],
    "/**/*": ["./public/data/**/*"],
  },
  async headers() {
    return [
      {
        source: "/api/v1/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, s-maxage=3600, stale-while-revalidate=86400" },
        ],
      },
      {
        source: "/data/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=600, s-maxage=3600" }],
      },
    ];
  },
};

export default nextConfig;
