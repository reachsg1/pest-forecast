"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./ui";

/**
 * 내 농장 위험도 알림(Web Push) 켜기·끄기.
 * 서버(/api/push/config)가 꺼져 있으면 아무것도 그리지 않는다. 켜면 알림 권한 → 서비스 워커(/sw.js) 등록 → 푸시 구독 → 농장 목록과 함께 서버 저장.
 * 농장 목록이 바뀌면(추가·삭제) 켜져 있는 동안 자동으로 다시 보낸다. iOS Safari 는 홈 화면에 추가한 뒤에만 구독할 수 있다.
 */
export type AlertFarm = { name: string; crop: string; lat: number; lon: number; spot_code: string };
type Config = { enabled: boolean; publicKey: string | null };
type State = "loading" | "off" | "on" | "unsupported" | "denied" | "busy";
const ON_KEY = "pest-forecast.push.v1";

function toKey(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return true; // 브라우저가 키를 알려주지 않으면 그대로 쓴다
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !("standalone" in navigator && (navigator as { standalone?: boolean }).standalone);

async function currentSub(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  return reg ? reg.pushManager.getSubscription() : null;
}

async function send(sub: PushSubscription, farms: AlertFarm[]): Promise<string | null> {
  const r = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), farms }) });
  if (r.ok) return null;
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  return j.error ?? "서버에 저장하지 못했어요.";
}

export default function FarmAlerts({ farms }: { farms: AlertFarm[] }) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [state, setState] = useState<State>("loading");
  const [msg, setMsg] = useState("");
  const lastSent = useRef("");

  useEffect(() => {
    fetch("/api/push/config")
      .then((r) => (r.ok ? r.json() : { enabled: false, publicKey: null }))
      .then((c: Config) => {
        setCfg(c);
        if (!c.enabled) return;
        if (!supported()) return setState("unsupported");
        if (Notification.permission === "denied") return setState("denied");
        currentSub().then((s) => setState(s && localStorage.getItem(ON_KEY) === "on" ? "on" : "off")).catch(() => setState("off"));
      })
      .catch(() => setCfg({ enabled: false, publicKey: null }));
  }, []);

  // 켜져 있는 동안 농장 목록이 바뀌면 서버의 목록도 맞춘다(같은 내용은 다시 보내지 않음)
  useEffect(() => {
    if (state !== "on") return;
    const sig = JSON.stringify(farms);
    if (sig === lastSent.current) return;
    currentSub()
      .then(async (s) => {
        if (!s) return setState("off");
        const err = await send(s, farms);
        if (!err) lastSent.current = sig;
        setMsg(err ?? "");
      })
      .catch(() => setMsg("농장 목록을 서버에 반영하지 못했어요. 잠시 뒤 다시 시도해 주세요."));
  }, [farms, state]);

  const enable = useCallback(async () => {
    if (!cfg?.publicKey) return;
    setState("busy");
    setMsg("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        if (perm !== "denied") setMsg("알림 권한을 허용해야 받을 수 있어요.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const key = toKey(cfg.publicKey);
      let sub = await reg.pushManager.getSubscription();
      // 서버 VAPID 키가 바뀐 뒤 남은 옛 구독은 해지하고 새로 구독
      if (sub && !sameKey(sub.options.applicationServerKey, key)) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const err = await send(sub, farms);
      if (err) {
        setMsg(err);
        setState("off");
        return;
      }
      lastSent.current = JSON.stringify(farms);
      localStorage.setItem(ON_KEY, "on");
      setState("on");
    } catch {
      setMsg("알림을 켜지 못했어요. 브라우저가 푸시를 지원하는지 확인해 주세요.");
      setState("off");
    }
  }, [cfg, farms]);

  const disable = useCallback(async () => {
    setState("busy");
    setMsg("");
    try {
      const s = await currentSub();
      if (s) {
        await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: s.endpoint }) }).catch(() => null);
        await s.unsubscribe();
      }
    } catch {
      setMsg("브라우저 구독 해지에 실패했지만 서버의 알림 정보는 삭제했어요.");
    } finally {
      localStorage.removeItem(ON_KEY);
      lastSent.current = "";
      setState("off");
    }
  }, []);

  if (!cfg?.enabled || state === "loading") return null;
  const on = state === "on";
  const desc =
    state === "unsupported"
      ? isIOS()
        ? "iPhone·iPad는 Safari 공유 메뉴에서 '홈 화면에 추가'한 뒤 그 아이콘으로 열면 알림을 켤 수 있어요."
        : "이 브라우저는 푸시 알림을 지원하지 않아요."
      : state === "denied"
        ? "브라우저에서 이 사이트의 알림이 차단되어 있어요. 주소창 옆 사이트 설정에서 알림을 허용한 뒤 다시 켜 주세요."
        : on
          ? `등록한 농장 ${farms.length}곳의 병해충이 주의보 이상으로 올라가면 매일 아침 예측이 끝난 뒤 이 기기로 알려 드려요.`
          : "등록한 농장의 병해충 위험도가 주의보 이상으로 올라가면 이 기기로 알림을 보내 드려요.";

  return (
    <section className="card card-pad text-sm" aria-label="위험도 알림">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${on ? "bg-brand-50 text-brand-600" : "bg-slate-100 text-slate-500"}`}>
            <Icon name="bell" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="section-title">위험도 알림</h2>
              {on && <span className="chip bg-brand-50 text-brand-700">켜짐</span>}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{desc}</p>
          </div>
        </div>
        {(state === "off" || state === "on" || state === "busy") && (
          <button type="button" onClick={on ? disable : enable} disabled={state === "busy" || (!on && farms.length === 0)} className={`${on ? "btn-secondary" : "btn-primary"} btn-sm shrink-0`}>
            {state === "busy" ? "처리 중…" : on ? "끄기" : "알림 켜기"}
          </button>
        )}
      </div>
      {state === "off" && farms.length === 0 && <p className="mt-2 text-xs text-slate-400">농장을 먼저 등록하면 켤 수 있어요.</p>}
      {msg && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{msg}</p>}
      {on && <p className="mt-2 text-[11px] leading-relaxed text-slate-400">알림을 위해 농장 이름·위치·작물과 이 기기의 알림 구독 정보가 서버에 저장돼요. 끄면 바로 삭제돼요.</p>}
    </section>
  );
}
