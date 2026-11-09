/* Only the public offline explanation is cached. User pages and bytes stay on the network. */
const OFFLINE_CACHE = "chief-offline-v1";
const offlineURL = new URL("offline.html", self.registration.scope).href;
self.addEventListener("install", event => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then(async cache => {
    const response = await fetch(offlineURL, { cache: "no-store" });
    if (!response.ok) throw new Error("Offline page unavailable");
    await cache.put(offlineURL, response);
    await self.skipWaiting();
  }));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("chief-offline-") && key !== OFFLINE_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  const path = url.pathname.slice(scope.pathname.length);
  // No API, attachment, file, media or arbitrary download interception, even on navigation.
  if (request.method !== "GET" || request.mode !== "navigate" || url.origin !== scope.origin ||
      !url.pathname.startsWith(scope.pathname) ||
      /(?:^|\/)(?:api|attachments|files|voice)(?:\/|$)/.test(path) ||
      !/^(?:$|(?:chat|settings|login|pair|onboarding|apps|tasks)(?:\/|$))/.test(path)) return;
  event.respondWith(fetch(request).catch(async () =>
    (await caches.match(offlineURL)) || new Response("You are offline. Connect Tailscale and try again.", { status: 503, headers: { "Content-Type": "text/plain" } })));
});
