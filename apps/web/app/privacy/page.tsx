import type { Metadata } from "next";

export const metadata: Metadata = { title: "개인정보 처리 안내" };

/** 로그인 없이 볼 수 있다(미들웨어 제외). 구글 로그인 동의 화면에 링크된다. */
export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-6 py-4 text-sm leading-relaxed text-slate-700">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">개인정보 처리 안내</h1>
        <p className="mt-1 text-xs text-slate-400">병해충 발생 예측 서비스 · 시행 2026.11.12.</p>
      </header>

      <section>
        <h2 className="font-semibold text-slate-900">1. 수집하는 정보와 목적</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>
            <b>구글·네이버 로그인 시 이메일 주소</b>: 이용 허용·관리자 여부를 확인하는 데에만 씁니다. 확인 직후 버리며 서버·데이터베이스·로그 어디에도 저장하지 않습니다.
          </li>
          <li>
            <b>카카오 로그인 시 회원번호</b>(이 서비스에서만 쓰이는 카카오 고유 번호, 이메일·이름 등은 받지 않음): 이용·관리자 여부 확인과 관리자 지정 안내에 씁니다. 아래 로그인 쿠키에만 담기며 서버에 저장하지 않습니다.
          </li>
          <li>
            <b>접속 코드</b>: 입력한 코드가 맞는지 확인하는 데에만 쓰고 저장하지 않습니다.
          </li>
          <li>회원가입을 받지 않으며 이름·전화번호 등 다른 개인정보는 받지 않습니다.</li>
        </ul>
      </section>

      <section>
        <h2 className="font-semibold text-slate-900">2. 쿠키</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>
            <code>pf_auth</code>: 로그인 상태(일반 이용자/관리자 구분, 카카오 로그인은 회원번호 포함)를 서명해 담은 쿠키로, 30일 뒤 만료됩니다. 이메일은 들어 있지 않습니다.
          </li>
          <li>
            <code>pf_oauth</code>: 소셜 로그인 위조 방지용 임시값으로, 10분 뒤 만료됩니다.
          </li>
          <li>&lsquo;나가기&rsquo;를 누르면 로그인 쿠키가 삭제됩니다.</li>
        </ul>
      </section>

      <section>
        <h2 className="font-semibold text-slate-900">3. 내 농장 정보</h2>
        <p className="mt-2">&lsquo;내 농장&rsquo;에 등록한 농장 이름·위치·작물은 이용자의 브라우저에만 저장되며 서버로 보내지 않습니다. 브라우저 저장 공간을 지우면 함께 삭제됩니다.</p>
      </section>

      <section>
        <h2 className="font-semibold text-slate-900">4. 제3자 제공·위탁</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>개인정보를 제3자에게 제공하지 않습니다.</li>
          <li>소셜 로그인은 Google LLC(이메일), ㈜카카오(회원번호), 네이버㈜(이메일)의 인증 서비스를 이용하며, 괄호 안 정보만 요청합니다.</li>
          <li>서비스는 Vercel Inc.에서 호스팅되며, 호스팅 업체가 보안·운영을 위해 접속 기록(IP 주소 등)을 일정 기간 보관할 수 있습니다.</li>
        </ul>
      </section>

      <section>
        <h2 className="font-semibold text-slate-900">5. 문의</h2>
        <p className="mt-2">개인정보 관련 문의는 서비스 운영 기관으로 해 주세요. (문의처는 정식 운영 전에 기재합니다.)</p>
      </section>
    </article>
  );
}
