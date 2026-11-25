import { NextResponse } from "next/server";
import webpush from "web-push";
import { getPests, getSpotFile, getSummary } from "@/lib/data";
import { safeEqual } from "@/lib/auth";
import { getLast, listSubs, pushEnabled, removeSub, saveLast, vapid, type PushSub } from "@/lib/push";
import { plan, type PestLite, type Point } from "@/lib/pushRules";

/**
 * 농장 알림 발송. 배치 커밋 → Vercel 재배포 뒤 GitHub Actions(daily.yml)가 부르고, vercel.json 의 예비 크론도 하루 한 번 부른다.
 *   GET|POST /api/cron/notify   Authorization: Bearer $CRON_SECRET  (Vercel Cron 은 이 헤더를 자동으로 붙인다)
 * 배포된 summary.json 의 issued_date 가 오늘(KST)보다 오래되면 stale 로 응답하고 보내지 않는다(Actions 가 잠시 뒤 다시 부름).
 * 판정은 lib/pushRules.plan — 같은 날 여러 번 불려도 중복 발송이 없다. 구독 endpoint·키는 로그에 남기지 않는다.
 */
export const maxDuration = 60;
const CONCURRENCY = 20;
const SEND_TIMEOUT_MS = 10_000;
const MAX_FAILS = 5; // 연속 실패(키 불량·응답 없음 등)가 이만큼 쌓이면 구독을 지운다
type Series = Record<string, Record<string, Point[]> | undefined>;

const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  return secret !== "" && safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`);
}

async function deliver(sub: PushSub, series: Series, pests: PestLite[], today: string): Promise<{ sent: number; gone: boolean }> {
  const prev = await getLast(sub.id);
  const { alerts, last } = plan(sub.farms, pests, series, prev.last, today);
  let sent = 0;
  let fails = prev.fails;
  let gone = false;
  for (const a of alerts) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify({ title: a.title, body: a.body, tag: a.key, url: "/farm", pest_id: a.pest.pest_id, grade: a.grade }),
        { TTL: 12 * 3600, urgency: "normal", timeout: SEND_TIMEOUT_MS },
      );
      sent++;
      fails = 0;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      // 404·410 = 브라우저가 구독을 해지함. 그 밖의 실패(키 불량·응답 없음)는 다음 실행에 다시 시도하되 연속 MAX_FAILS 번이면 지운다
      fails += 1;
      if (code === 404 || code === 410 || fails >= MAX_FAILS) {
        gone = true;
        break;
      }
      delete last[a.key];
    }
  }
  if (gone) await removeSub(sub.id);
  else if (fails !== prev.fails || JSON.stringify(last) !== JSON.stringify(prev.last)) await saveLast(sub.id, { last, fails });
  return { sent, gone };
}

async function run(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!pushEnabled()) return NextResponse.json({ ok: false, reason: "push disabled" }, { status: 503 });
  const v = vapid()!;
  webpush.setVapidDetails(v.subject, v.publicKey, v.privateKey);

  const today = kstToday();
  const issued = (await getSummary())?.issued_date ?? "";
  if (issued < today) return NextResponse.json({ ok: true, stale: true, issued_date: issued, today, sent: 0 });

  const subs = await listSubs();
  const codes = Array.from(new Set(subs.flatMap((s) => s.farms.map((f) => f.spot_code))));
  const files = await Promise.all(codes.map((c) => getSpotFile(c)));
  const series: Series = Object.fromEntries(codes.map((c, i) => [c, files[i]?.series]));
  const pests: PestLite[] = (await getPests()).map((p) => ({ pest_id: p.pest_id, name_ko: p.name_ko, crop: p.crop, crop_ko: p.crop_ko }));

  let sent = 0;
  let removed = 0;
  let failed = 0;
  for (let i = 0; i < subs.length; i += CONCURRENCY) {
    const batch = await Promise.allSettled(subs.slice(i, i + CONCURRENCY).map((s) => deliver(s, series, pests, today)));
    for (const r of batch) {
      if (r.status === "rejected") failed++;
      else {
        sent += r.value.sent;
        if (r.value.gone) removed++;
      }
    }
  }
  return NextResponse.json({ ok: true, stale: false, issued_date: issued, subscriptions: subs.length, sent, removed, failed });
}

export const GET = run;
export const POST = run;
