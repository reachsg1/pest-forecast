import { ImageResponse } from "next/og";

/** iOS 홈 화면 아이콘(180×180). iOS 가 모서리를 깎으므로 바탕을 꽉 채운다 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: 180, height: 180, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #2b8a5c 0%, #195c3e 100%)" }}>
        <svg viewBox="0 0 24 24" width={110} height={110} fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19l7-7" />
        </svg>
      </div>
    ),
    size,
  );
}
