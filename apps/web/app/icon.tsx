import { ImageResponse } from "next/og";

/** 앱 아이콘(/icon/192, /icon/512) — 머리글 로고와 같은 잎 모양, 브랜드 그라데이션. 매니페스트·푸시 알림 그림에 쓴다 */
export const contentType = "image/png";

export function generateImageMetadata() {
  return [192, 512].map((n) => ({ id: String(n), size: { width: n, height: n }, contentType, alt: "병해충 발생 예측" }));
}

export function LeafIcon({ size }: { size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: size * 0.22,
        background: "linear-gradient(135deg, #2b8a5c 0%, #195c3e 100%)",
      }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19l7-7" />
      </svg>
    </div>
  );
}

export default function Icon({ id }: { id: string }) {
  const n = Number(id) || 192;
  return new ImageResponse(<LeafIcon size={n} />, { width: n, height: n });
}
