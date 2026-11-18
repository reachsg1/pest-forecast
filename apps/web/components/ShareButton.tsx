"use client";

import { useState } from "react";

/** 공유: 휴대폰은 기본 공유 창(카카오톡 등), PC는 링크 복사. 미리보기 그림은 opengraph-image가 만든다. */
export default function ShareButton({ text, className = "btn-glass" }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  const share = async () => {
    const url = window.location.origin;
    try {
      if (navigator.share) {
        await navigator.share({ title: "병해충 발생 예측", text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      /* 사용자가 공유 창을 닫음 */
    }
  };
  return (
    <button type="button" onClick={share} className={className}>
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" />
      </svg>
      {done ? "링크를 복사했어요" : "공유하기"}
    </button>
  );
}
