/* ============================================================
   calendar/cal-shifts.js — 비교대 시프트 코드 정의 (M3b, 방식 B)
   ------------------------------------------------------------
   비교대 부서의 근무 형태 7종. 듀티 SHIFTS(D/E/N…)와 같은 구조
   (code·label·color·bg·desc)를 따르되, 비교대 의미에 맞게 정의.

   ★ "다 만들어 놓고 나중에 취사선택" — 각 코드에 enabled 플래그.
     끄면 입력 팔레트에서 숨김(데이터는 보존). 부서 운영 확정 후 정리.

   ★ 연차성 코드(isLeave) = cal-leave.js 의 소진 집계 대상과 일치해야 함.
     현재 연차 차감: vac(연차)·month(월차)·half(반차). 휴가(sick)·경조(event)는
     법정 특별휴가라 연차 정량과 별개(듀티 B 코드 철학과 동일) → isLeave:false.

   ★ 색: 의미가 겹치는 건 듀티 색을 물려받아 통일감(연차=주황, 경조=남색, OFF=웜그레이).
   ============================================================ */
(function (g) {
  'use strict';

  // 표시 순서 = 팔레트 칩 순서
  var CAL_SHIFTS = [
    { code:'work',  label:'근무', color:'#1A8C62', bg:'#dcf2e8', isLeave:false, enabled:true,
      desc:'정상 근무 (세부는 메모에: 내시경·외래·검사 등)' },
    { code:'vac',   label:'연차', color:'#C0781A', bg:'#fbeed6', isLeave:true,  enabled:true,
      desc:'연차 — 연차 잔여에서 차감 (하루 = 오전+오후)' },
    { code:'month', label:'월차', color:'#BA7517', bg:'#faeeda', isLeave:true,  enabled:true,
      desc:'월차 — 연차성 차감' },
    { code:'half',  label:'반차', color:'#A35200', bg:'#fbe9c8', isLeave:true,  enabled:true,
      desc:'반차 — 0.5일 차감 (오전 또는 오후 한 슬롯)' },
    { code:'sick',  label:'휴가', color:'#7A3FB5', bg:'#efe4fa', isLeave:false, enabled:true,
      desc:'병가·일반휴가 (연차 정량과 별개)' },
    { code:'event', label:'경조', color:'#2D5B8A', bg:'#dde6f0', isLeave:false, enabled:true,
      desc:'경조/공가 등 법정 특별휴가 (연차 정량 제외)' },
    { code:'off',   label:'OFF', color:'#6E6A62', bg:'#eeece7', isLeave:false, enabled:true,
      desc:'휴무' }
  ];

  // 빠른 조회 맵
  var BY_CODE = {};
  CAL_SHIFTS.forEach(function(s){ BY_CODE[s.code] = s; });

  function get(code){ return BY_CODE[code] || null; }
  function label(code){ var s=BY_CODE[code]; return s ? s.label : ''; }
  function enabledList(){ return CAL_SHIFTS.filter(function(s){ return s.enabled; }); }
  function isLeave(code){ var s=BY_CODE[code]; return !!(s && s.isLeave); }

  g.CalShifts = {
    ALL: CAL_SHIFTS,
    byCode: BY_CODE,
    get: get,
    label: label,
    enabled: enabledList,
    isLeave: isLeave
  };
  g.__CALSHIFTS_LOADED__ = true;

})(window);
