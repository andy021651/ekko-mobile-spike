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

// Drive 的跨網域規則不讓網頁讀到 Content-Range，播放器少了它會判定格式錯誤。
// 所以先查檔案大小，每次只取一段（最多 2MB），Content-Range 自己算。
const CHUNK = 2 * 1024 * 1024;
const sizes = new Map();

async function fileSize(fileId, auth) {
  if (!sizes.has(fileId)) {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=size&supportsAllDrives=true`, { headers: auth });
    if (!r.ok) throw new Error(`查不到檔案大小（${r.status}）`);
    sizes.set(fileId, Number((await r.json()).size));
  }
  return sizes.get(fileId);
}

async function proxyDrive(fileId, request) {
  if (!accessToken) return new Response('還沒登入', { status: 401 });
  const auth = { Authorization: `Bearer ${accessToken}` };
  try {
    const size = await fileSize(fileId, auth);
    const asked = (request.headers.get('Range') || 'bytes=0-').match(/bytes=(\d*)-(\d*)/) || [];
    const start = Number(asked[1] || 0);
    const end = Math.min(asked[2] ? Number(asked[2]) : start + CHUNK - 1, start + CHUNK - 1, size - 1);
    if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    const upstream = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      { headers: { ...auth, Range: `bytes=${start}-${end}` } });
    if (!upstream.ok) return new Response(`Drive 回應 ${upstream.status}`, { status: upstream.status });
    const body = await upstream.arrayBuffer();
    return new Response(body, { status: 206, headers: {
      'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
      'Content-Length': String(body.byteLength), 'Content-Range': `bytes ${start}-${start + body.byteLength - 1}/${size}`,
    } });
  } catch (e) {
    return new Response(e.message, { status: 502 });
  }
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
