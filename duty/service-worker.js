// Nurse Duty Scheduler — Service Worker
// 버전 변경 시 캐시가 새로 빌드됨. 배포 시 CACHE_VERSION 증가시킬 것.
const CACHE_VERSION = 'duty-scheduler-v3.44.0';

// 캐싱 대상 (오프라인 동작에 필요한 핵심 파일)
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './kakaopay-qr.png',
  // M1: 분리된 모듈들 (오프라인 동작 위해 캐시)
  './schedule-store.js',
  './auto-engine.js',
  '../shared/utils.js',
  '../shared/calendar-store.js',
  '../shared/ward-context.js',
  '../shared/nurses-store.js',
  '../shared/persons-store.js',
  '../shared/version.js',
];

// CDN 의존성 (xlsx 라이브러리)
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
];

// ── install: 핵심 자산 미리 캐싱 ─────────────────────────────────────────
self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache){
      console.log('[SW] 캐시 생성:', CACHE_VERSION);
      // 핵심 자산은 반드시 캐싱, CDN은 실패해도 OK
      return cache.addAll(CORE_ASSETS).then(function(){
        return Promise.all(CDN_ASSETS.map(function(url){
          return fetch(url).then(function(res){
            if(res.ok) cache.put(url, res);
          }).catch(function(){ /* CDN 실패는 무시 */ });
        }));
      });
    })
  );
  self.skipWaiting(); // 새 SW 즉시 활성화
});

// ── activate: 구버전 캐시 정리 ───────────────────────────────────────────
self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){return k !== CACHE_VERSION;})
            .map(function(k){
              console.log('[SW] 구버전 캐시 삭제:', k);
              return caches.delete(k);
            })
      );
    }).then(function(){
      return self.clients.claim(); // 즉시 제어권 인수
    })
  );
});

// ── fetch: 네트워크 우선, 실패 시 캐시 (Network-First) ────────────────────
// 이유: HTML 업데이트가 즉시 반영되어야 함. 오프라인일 때만 캐시.
self.addEventListener('fetch', function(event){
  var req = event.request;

  // POST 등 비-GET 요청은 캐싱 안 함 (Formspree 등)
  if(req.method !== 'GET') return;

  // chrome-extension 등 비-http(s) 요청 무시
  if(!req.url.startsWith('http')) return;

  event.respondWith(
    fetch(req)
      .then(function(res){
        // 응답 성공 시 캐시 갱신 (성공 응답만)
        if(res.ok && res.type === 'basic'){
          var clone = res.clone();
          caches.open(CACHE_VERSION).then(function(cache){
            cache.put(req, clone);
          });
        }
        return res;
      })
      .catch(function(){
        // 네트워크 실패 시 캐시 폴백
        return caches.match(req).then(function(cached){
          if(cached) return cached;
          // 캐시도 없으면 root로 폴백 (SPA 라우팅 안전망)
          if(req.mode === 'navigate') return caches.match('./');
          return new Response('Offline and not cached', {status:503});
        });
      })
  );
});

// ── message: 클라이언트가 'SKIP_WAITING' 보내면 즉시 갱신 ─────────────────
self.addEventListener('message', function(event){
  if(event.data && event.data.type === 'SKIP_WAITING'){
    self.skipWaiting();
  }
});
