import type { MetadataRoute } from "next";

/** 홈 화면에 추가용 매니페스트(/manifest.webmanifest). 아이콘은 app/icon.tsx 가 192·512 로 만든다 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "병해충 발생 예측",
    short_name: "병해충 예측",
    description: "오늘 우리 지역 병해충 위험도와 7일 전망, 내 농장 위험도 알림",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6f5",
    theme_color: "#0b3b36",
    lang: "ko",
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
