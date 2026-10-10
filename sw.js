// 第 0 步測試頁的 service worker：
// 1. 影片請求 ./drive-media/<檔案 id> 轉送到 Google Drive，補上登入標頭，分段讀取原樣轉過去（Safari 播影片一定要分段）。
// 2. 收推播就顯示通知，點通知打開測試頁。
let accessToken = null;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'token') accessToken = event.data.token;
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const match = url.pathname.match(/\/drive-media\/([\w-]+)$/);
  if (!match) return;
  event.respondWith(proxyDrive(match[1], event.request));
});

async function proxyDrive(fileId, request) {
  if (!accessToken) return new Response('還沒登入', { status: 401 });
  const headers = { Authorization: `Bearer ${accessToken}` };
  const range = request.headers.get('Range');
  if (range) headers.Range = range;
  const upstream = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers });
  const out = new Headers();
  for (const name of ['Content-Range', 'Content-Length']) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  out.set('Content-Type', 'video/mp4');
  out.set('Accept-Ranges', 'bytes');
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

self.addEventListener('push', (event) => {
  let data = { title: 'Ekko', body: '有一支影片剪好了', url: './' };
  try { data = { ...data, ...event.data.json() }; } catch (_) {}
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, data: { url: data.url } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url || './'));
});
