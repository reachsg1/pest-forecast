export default function Footer({ generatedAt, issuedDate }: { generatedAt?: string; issuedDate?: string }) {
  return (
    <footer className="mt-12 border-t border-gray-200 bg-white text-xs text-gray-600">
      <div className="mx-auto max-w-7xl space-y-2 px-4 py-6">
        <p>
          데이터 출처: 농촌진흥청 국립농업과학원 농업날씨365(농업기상 관측) · 국가농작물병해충관리시스템(NCPMS) · 기상청 단기예보 · 지도 ©{" "}
          <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            OpenStreetMap contributors
          </a>
        </p>
        <p>
          예측 결과는 기상 자료 기반 모델의 추정값이며 실제 발생과 다를 수 있습니다. 방제 결정 전 현장 예찰과 지역 농업기술센터의 안내를 함께 확인하세요.
          {issuedDate && ` · 기준일 ${issuedDate}`}
          {generatedAt && ` · 갱신 ${generatedAt.replace("T", " ")}`}
        </p>
        <p>재개방 데이터·API는 공공누리 제1유형(출처표시)으로 제공됩니다.</p>
      </div>
    </footer>
  );
}
