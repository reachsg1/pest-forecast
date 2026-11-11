import Link from "next/link";
import { fmtDate, fmtDateTime } from "@/lib/format";

export default function Footer({ generatedAt, issuedDate }: { generatedAt?: string; issuedDate?: string }) {
  return (
    <footer className="mt-16 border-t border-slate-200/80 bg-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="font-bold tracking-tight text-slate-900">병해충 발생 예측</div>
          <p className="mt-2 max-w-md text-xs leading-relaxed text-slate-500">
            예측 결과는 기상 자료 기반 모델의 추정값이며 실제 발생과 다를 수 있습니다. 방제 결정 전 현장 예찰과 지역 농업기술센터의 안내를 함께 확인하세요.
          </p>
          {(issuedDate || generatedAt) && (
            <p className="num mt-3 text-xs text-slate-400">
              {issuedDate && `기준일 ${fmtDate(issuedDate)}`}
              {generatedAt && ` · 갱신 ${fmtDateTime(generatedAt)}`}
            </p>
          )}
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-400">데이터 출처</div>
          <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
            <li>농촌진흥청 농업날씨365 (농업기상 관측)</li>
            <li>국가농작물병해충관리시스템 (NCPMS)</li>
            <li>기상청 단기예보 · 농업경영체 등록정보</li>
            <li>
              지도 ©{" "}
              <a className="underline decoration-slate-300 underline-offset-2 hover:text-slate-900" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                OpenStreetMap
              </a>
            </li>
          </ul>
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-400">이용</div>
          <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
            <li>
              <Link href="/data" className="hover:text-slate-900">
                Open API · 데이터 다운로드
              </Link>
            </li>
            <li>
              <Link href="/about" className="hover:text-slate-900">
                모델 검증 · 서비스 소개
              </Link>
            </li>
            <li>재개방 데이터는 공공누리 제1유형(출처표시)</li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
