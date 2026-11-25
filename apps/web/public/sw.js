/* 내 농장 위험도 알림 서비스 워커 — 푸시를 받아 알림을 띄우고, 누르면 내 농장 화면을 연다.
   오프라인 캐시는 하지 않는다(데이터는 매일 바뀌므로 항상 서버에서 받는다). 발송은 /api/cron/notify. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { body: e.data ? e.data.text() : "" };
  }
  const title = data.title || "병해충 위험도 알림";
  e.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon/192",
      badge: "/icon/192",
      tag: data.tag || "pest-forecast", // 같은 농장·병해충은 하나로 겹쳐 보인다
      renotify: true,
      lang: "ko",
      data: { url: data.url || "/farm" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/farm", self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.location.origin) && "focus" in c);
      if (open) return (open.navigate ? open.navigate(url).then((c) => c && c.focus()) : Promise.resolve(open.focus())).catch(() => self.clients.openWindow(url));
      return self.clients.openWindow(url);
    }),
  );
});
