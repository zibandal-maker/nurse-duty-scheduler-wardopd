/* ============================================================
   shared/utils.js  —  공용 도구함 (모듈 분리 2단계, 방식 B)
   ------------------------------------------------------------
   여기 든 것은 "순수 함수/상수"뿐이다.
   순수 = 다른 정보(어느 병동·어느 환자·현재 달)에 전혀 기대지 않고,
          같은 입력이면 항상 같은 결과를 내는 계산.
   그래서 듀티 앱·비교대 앱 어느 쪽이든 똑같이 꺼내 쓸 수 있다.

   방식 B: 이 파일은 일반 <script src>로 읽힌다.
   각 도구를 전역(window)에 그대로 올려, 본체 코드는 한 글자도 바꾸지 않아도
   예전과 똑같이 이 도구들을 찾는다. (나중에 ES 모듈로 승격 예정)

   원본: duty/index.html v3.17.1 에서 그대로 복사 — 동작 불변.
   ============================================================ */
(function (g) {
  'use strict';

  // ── 시프트/직급/색 상수 (원본 1519~1528) ──────────────────────────────
  var SHIFTS = [
    {code:'D',label:'Day',  color:'#2EA875',bg:'#dcf2e8',desc:'07:00-15:00'},
    {code:'E',label:'Eve',  color:'#E8607E',bg:'#fbe1e8',desc:'15:00-23:00'},
    {code:'N',label:'Night',color:'#7C5FD3',bg:'#e8e2f7',desc:'23:00-07:00'},
    {code:'O',label:'Off',  color:'#B0ABA0',bg:'#eeecE7',desc:'Off (통합)'},
    {code:'V',label:'연차', color:'#E2941C',bg:'#fbeed6',desc:'연차 (잔여에서 차감)'},
    {code:'B',label:'경조', color:'#2D5B8A',bg:'#dde6f0',desc:'경조/공가 등 특별휴가 (off 정량 제외)'},
  ];
  var NCOLS = ['#C0392B','#E67E22','#D35DB3','#8E44AD','#2980B9','#1A8C62','#16A085','#D4AC0D','#1E6DBF','#5B44C8','#2C3E50','#686864'];
  var ROLES = ['수간호사','주임','차지','평간호사','신규간호사'];

  // ── 날짜 계산 (원본 2762~2763) ────────────────────────────────────────
  // ndays(연,월): 그 달이 며칠까지인지. (월은 0부터 — 5월은 4)
  var ndays = function(y,m){ return new Date(y,m+1,0).getDate(); };
  // dow(연,월,일): 그 날의 요일 (0=일 ~ 6=토)
  var dow = function(y,m,d){ return new Date(y,m,d).getDay(); };

  // ── 셀 키 (원본 2771) ─────────────────────────────────────────────────
  // cellKey: "어느 간호사의 어느 날 칸인가"를 가리키는 정규 이름표.
  // 형식 nid|연|월|일 — 저장 데이터 100% 호환 (절대 바꾸지 않음).
  var cellKey = function(y,m,nid,d){ return nid+'|'+y+'|'+m+'|'+d; };

  // ── 문자열 안전 처리 (원본 5251, 5725) ────────────────────────────────
  function escapeHtml(s){
    return String(s||'').replace(/[&<>"']/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
  }
  function _esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ── 코드→라벨 (원본 4052) ─────────────────────────────────────────────
  function _codeLabel(c){ return {D:'Day',E:'Eve',N:'Night',O:'Off',V:'연차',B:'경조','':'Off'}[c]||c; }

  // ── 전역 등록 (방식 B 핵심: 본체가 예전처럼 그대로 찾게) ──────────────
  g.SHIFTS = SHIFTS;
  g.NCOLS = NCOLS;
  g.ROLES = ROLES;
  g.ndays = ndays;
  g.dow = dow;
  g.cellKey = cellKey;
  g.escapeHtml = escapeHtml;
  g._esc = _esc;
  g._codeLabel = _codeLabel;

  // 표식: 도구함이 실제로 로드됐는지 측정에서 확인용
  g.__UTILS_LOADED__ = true;

})(window);
