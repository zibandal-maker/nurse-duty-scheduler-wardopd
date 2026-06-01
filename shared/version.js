/* version.js — 앱 버전 단일 진실원 + 화면 하단 버전 배지 자동 삽입.
   배포 추적용: 어떤 화면을 열어도 하단에서 현재 버전을 확인할 수 있다.
   ★ 버전 올릴 때 여기 APP_VERSION 한 줄만 고치면 전 화면에 반영된다. */
(function (g) {
  'use strict';

  var APP_VERSION = 'v6.4.39';
  var BUILD_DATE  = '2026-05-31';

  g.APP_VERSION = APP_VERSION;
  g.APP_BUILD_DATE = BUILD_DATE;

  function stamp(){
    if (document.getElementById('app-version-badge')) return;
    var el = document.createElement('div');
    el.id = 'app-version-badge';
    el.textContent = APP_VERSION + ' · ' + BUILD_DATE;
    el.style.cssText = [
      'position:fixed', 'right:10px', 'bottom:8px', 'z-index:9999',
      'font-family:ui-monospace,Menlo,Consolas,monospace', 'font-size:11px',
      'color:#7a8aa0', 'background:rgba(255,255,255,.82)',
      'border:1px solid #d6e0ee', 'border-radius:7px', 'padding:3px 9px',
      'pointer-events:none', 'user-select:none', 'letter-spacing:.02em',
      'box-shadow:0 1px 4px rgba(20,50,90,.07)'
    ].join(';');
    document.body.appendChild(el);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', stamp);
  } else {
    stamp();
  }
})(typeof window !== 'undefined' ? window : this);
