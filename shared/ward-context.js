/* ============================================================
   shared/ward-context.js — 병동 식별 + 저장 키 규칙 (모듈 분리 4단계, 방식 B)
   ------------------------------------------------------------
   하는 일: "지금 어느 병동인가(WARD_ID)" 와
            "그 병동의 저장 서랍에 이름표를 어떻게 붙이나(dataKey)" 를 한 곳에서 관리.

   왜 이 둘만 여기 두는가:
     - 이 둘은 곧(M1b) 'default' → 'duty' 로 바뀔 대상이다.
       한 모듈이 소유하면 그때 이 파일 한 곳만 고치면 된다.
     - 나머지 화이트보드(보는 달 cy/cm, 간호사 목록 등)는 본체에 그대로 둔다.
       (let 선언이라 외부 접근이 막혀 있고, 개명과도 무관 — 무리해서 옮길 이유 없음)

   방식 B: 일반 <script src>로 읽히고, WARD_ID·dataKey 를 전역(window)에 올린다.
           본체는 예전처럼 WARD_ID, dataKey('dv6_n') 등을 그대로 사용.
   원본: duty/index.html v3.17.1 의 WARD_ID·dataKey 정의를 그대로 이동 — 동작 불변.

   ★ M1b 메모: 개명 시 이 파일에서 DEFAULT_WARD 를 'duty' 로 바꾸고,
              마이그레이션(옛 'default' 키 → 새 'duty' 키 복사)을 여기에 추가한다.
   ============================================================ */
(function (g) {
  'use strict';

  // ── 병동 식별자 (M1b: 'default' → 'duty' 정식 개명) ──────────────────────
  // 듀티 부서의 식별자. localStorage 키 접두사(dv6_*_duty)로 사용.
  // 다병동 지원: URL ?ward=duty_1 로 특정 병동 지정 가능(기본 'duty' — 하위호환).
  //   id 형식은 'duty' 또는 'duty_<n>'. 다른 값은 무시하고 'duty'로 폴백.
  g.WARD_ID = (function(){
    try{
      var p = new URLSearchParams(location.search).get('ward');
      if(p && /^duty(_\d+)?$/.test(p)) return p;
    }catch(_){}
    return 'duty';
  })();

  // ── 저장 키 규칙 (단일 진실원) ───────────────────────────────────────────
  // wardKey(base, wardId): 임의 병동의 저장 키. (다병동 대시보드/서버 대비)
  //   wardId 'default'(또는 생략)만 접두사 없는 레거시 키. 그 외(='duty' 포함)는 base_wardId.
  //   ★ 서버 전환 시 이 한 함수만 고치면 모든 키 규칙이 따라온다.
  function wardKey(base, wardId){
    return (wardId==null || wardId==='default') ? base : base+'_'+wardId;
  }

  // dataKey(base): "현재 병동"의 키. 이제 WARD_ID='duty' 이므로 dv6_n → dv6_n_duty.
  function dataKey(base){ return wardKey(base, g.WARD_ID); }

  // ── 1회성 마이그레이션 (M1b) ─────────────────────────────────────────────
  // 'default' 시절의 접두사 없는 키(dv6_n …) → 'duty' 키(dv6_n_duty …)로 복사.
  //   조건: 옛 키가 있고 새 키가 아직 없을 때만 (이미 옮겼으면 건너뜀 — 멱등).
  //   ward-scoped 키만 대상. 전역 설정키(welcome/demo/exp/hol 등)는 제외.
  //   ※ 옛 키는 안전하게 남겨둠(삭제하지 않음) — 문제 시 수동 복구 가능. 다음 단계에서 정리 검토.
  var WARD_SCOPED_BASES = [
    'dv6_n','dv6_i','dv6_s','dv6_evts','dv6_evtId','dv6_rules','dv6_locks',
    'dv6_kbd','dv6_offclosed','dv6_hist','dv6_slot'
  ];
  function migrateDefaultToDuty(){
    var moved = [];
    try {
      WARD_SCOPED_BASES.forEach(function(base){
        var oldKey = base;                 // 'default' 시절: 접두사 없음
        var newKey = base + '_duty';       // 'duty': 접두사
        var oldVal = localStorage.getItem(oldKey);
        var newExists = localStorage.getItem(newKey) !== null;
        if (oldVal !== null && !newExists) {
          localStorage.setItem(newKey, oldVal);   // 복사 (옛 키는 보존)
          moved.push(base);
        }
      });
    } catch(e){ /* localStorage 접근 불가 시 무시 — 신규 사용자엔 옮길 것도 없음 */ }
    return moved;   // 옮긴 키 목록 (검증·로그용)
  }

  // 모듈 로드 즉시 1회 실행 (본체 데이터 로드보다 먼저 — 스크립트 순서상 보장됨)
  var _migrated = migrateDefaultToDuty();

  // ── 전역 등록 (방식 B 핵심) ──────────────────────────────────────────
  g.wardKey = wardKey;
  g.dataKey = dataKey;
  g.migrateDefaultToDuty = migrateDefaultToDuty;   // 재실행·테스트용
  g.__WARD_MIGRATED__ = _migrated;                 // 이번 로드에서 옮긴 키 목록

  g.__WARDCONTEXT_LOADED__ = true;

})(window);
