import type { Metadata } from "next";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { getStatus } from "@/lib/data";

export const metadata: Metadata = {
  title: { default: "병해충 발생 예측", template: "%s · 병해충 발생 예측" },
  description: "농업기상 관측과 예보를 바탕으로 작물별 병해충 발생 위험도를 매일 예측해 공개하는 서비스",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const status = await getStatus();
  return (
    <html lang="ko">
      <body className="flex min-h-screen flex-col">
        <Header demo={status?.mode === "demo"} />
        {status && !status.ok && (
          <div role="status" className="border-b border-red-100 bg-red-50 px-4 py-2 text-center text-sm text-red-700">
            최근 배치가 실패해 이전 결과를 표시하고 있습니다. (기준일 {status.issued_date})
          </div>
        )}
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
          {children}
        </main>
        <Footer generatedAt={status?.generated_at} issuedDate={status?.issued_date} />
      </body>
    </html>
  );
}
