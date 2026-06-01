/* ============================================================
   shared/duty-adapter.js — 듀티 어댑터 (M4c-0: 풀 ↔ nurse 번역기)
   ------------------------------------------------------------
   하는 일: 종합 풀(persons-store)의 듀티 소속 인원을, 듀티 엔진이
            기대하는 옛 nurse 객체 배열로 번역한다(읽기). 그리고
            듀티가 부서특성을 편집했을 때 그 변경만 풀로 되쓴다(쓰기).

   ── 레이어 경계 (물리적 분리) ─────────────────────────────────
   이 어댑터의 펜은 deptAttrs.duty 영역에만 닿는다.
     · 읽기:  Layer1(사람 기본) + deptAttrs.duty(부서특성) → nurse 합본
     · 쓰기:  nurse → deptAttrs.duty 만 추출해 풀에 되쓰기.
              Layer1(name·birthday·joinDate·vacTotal·photo·memo·ext·
              membership·isManager·managerGroups)은 추출 단계에서 배제
              → 듀티가 아무리 써도 닿지 않음(권한 경계).

   ★ 화이트리스트는 "필드 나열"이 아니라 "deptAttrs.duty 네임스페이스
     통째"다. 듀티가 부서특성을 새로 추가해도 어댑터 수정 불필요.

   ── ID 두 체계 ────────────────────────────────────────────────
   · personId — 부서 무관, 풀의 키. 영구 불변.
   · nurse.id — 부서 내부 정수. 스케줄·락·파트너관계(avoidWith 등)의 키.
     마이그레이션이 nurse.id를 deptAttrs.duty.id에 보존 → 어댑터가 복원.
     ★ 이 복원이 깨지면 기존 스케줄·락이 통째로 어긋난다(최대 위험).

   의존: window.PersonsStore (필수). migrateNurse(있으면 누락필드 보강).
   저장: 직접 안 함 — PersonsStore 경유.
   ============================================================ */
(function (g) {
  'use strict';

  var DEPT = 'duty';

  // Layer1(사람 기본) 키 — 풀에서 nurse 상단으로 끌어올 것 + 되쓰기 금지 대상.
  var L1_KEYS = ['name','birthday','joinDate','photo','memo','vacTotal'];
  // deptAttrs.duty 안에서 nurse 상단으로 펼칠 부서특성 키.
  //   id 는 별도 취급(엔진 핵심 키). active 는 내부 플래그라 nurse로 안 펼침.
  var DUTY_ATTR_KEYS = ['id','role','color','prefs','attributes','carryOver','manualOrder'];

  // ── 읽기: 풀 → nurse 배열 ───────────────────────────────────────────
  // 한 사람 레코드 → nurse 한 명 (Layer1 + deptAttrs.duty 합본)
  function _personToNurse(p){
    var da = (p.deptAttrs && p.deptAttrs.duty) ? p.deptAttrs.duty : {};
    var n = {};
    // Layer1 기본 (사람 정보)
    L1_KEYS.forEach(function(k){ if(p[k]!==undefined) n[k]=p[k]; });
    // 부서특성 (듀티 전용)
    DUTY_ATTR_KEYS.forEach(function(k){ if(da[k]!==undefined) n[k]=da[k]; });
    // personId — 풀 추적용 라벨 (불변)
    n.personId = p.personId;
    return n;
  }

  // 풀의 듀티 소속(active) 전원 → nurse 배열.
  //   ★ M4d: deptAttrs.duty 가 빈(신규 배치) 사람도 안전하게 완성한다.
  //     - id 없으면 발급(듀티 내부 정수, 기존 max+1) → 풀에 되써서 고정(스케줄 키 안정).
  //     - role 없으면 '평간호사'(수간호사 강제 금지 — staff에서 직급 지정한 경우 그 값 존중).
  //     - color/prefs/attributes/carryOver 없으면 듀티 기본값.
  //   migrateNurse가 있으면 누락 필드 추가 보강.
  function poolToNurses(){
    if(!g.PersonsStore) return [];
    var list = g.PersonsStore.listByDept(DEPT);   // active===true 인 듀티 소속만
    // 기존 id 최대값 (신규 id 발급 기준)
    var maxId = 0;
    list.forEach(function(p){
      var da = (p.deptAttrs && p.deptAttrs.duty) || {};
      if(typeof da.id==='number') maxId = Math.max(maxId, da.id);
    });
    var ROLES = g.ROLES || ['수간호사','주임','차지','평간호사','신규간호사'];
    var NCOLS = g.NCOLS || ['#2980B9'];
    var assigned = [];   // 이번에 부서특성을 보강한 사람 → 풀에 되쓰기

    var nurses = list.map(function(p, idx){
      var da = (p.deptAttrs && p.deptAttrs.duty) ? Object.assign({}, p.deptAttrs.duty) : {};
      var changed = false;
      // id 발급·고정
      if(typeof da.id !== 'number'){ da.id = (++maxId); changed = true; }
      // role: 비었으면 평간호사(수간호사 강제 금지). staff 지정값 존중.
      if(!da.role){ da.role = '평간호사'; changed = true; }
      else if(ROLES.indexOf(da.role)<0){ da.role = '평간호사'; changed = true; }
      // color: 비었으면 팔레트 순환
      if(!da.color){ da.color = NCOLS[ (da.id) % NCOLS.length ]; changed = true; }
      // prefs / attributes / carryOver 기본값
      if(!da.prefs){ da.prefs = (g.defaultPrefs?g.defaultPrefs():{shift:{D:0,E:0,N:0},monthlyMax:{D:null,E:null,N:null},avoidWith:[],preferWith:[]}); changed = true; }
      if(!da.attributes){ da.attributes = (g.defaultAttributes?g.defaultAttributes():{}); changed = true; }
      if(!da.carryOver){ da.carryOver = { offBalance:0 }; changed = true; }
      if(typeof da.manualOrder !== 'number'){ da.manualOrder = idx; changed = true; }
      da.active = true;

      if(changed) assigned.push({ personId:p.personId, da:da });

      // nurse 합본 (Layer1 + 완성된 부서특성)
      var n = {};
      L1_KEYS.forEach(function(k){ if(p[k]!==undefined) n[k]=p[k]; });
      DUTY_ATTR_KEYS.forEach(function(k){ if(da[k]!==undefined) n[k]=da[k]; });
      n.personId = p.personId;
      return n;
    });

    // 보강한 부서특성을 풀에 고정 (특히 발급한 id — 다음 로드에도 동일 → 스케줄 안정)
    if(assigned.length && g.PersonsStore.setDeptAttrs){
      assigned.forEach(function(a){ g.PersonsStore.setDeptAttrs(a.personId, DEPT, a.da); });
    }

    if(typeof g.migrateNurse === 'function'){
      nurses.forEach(function(n){ g.migrateNurse(n); });
    }
    return nurses;
  }

  // ── 쓰기: nurse → 풀의 deptAttrs.duty 만 되쓰기 ─────────────────────
  // nurse 객체에서 부서특성만 추출 (Layer1 키는 닿지 않음 = 물리적 차단).
  function _extractDutyAttrs(n){
    var da = {};
    DUTY_ATTR_KEYS.forEach(function(k){ if(n[k]!==undefined) da[k]=n[k]; });
    return da;
  }

  // 권한 경계 검사 — nurse가 Layer1 필드를 풀과 다르게 들고 있으면 누수 신호.
  //   (어댑터는 어차피 Layer1을 안 쓰므로 데이터는 안전하지만, 호출부 버그를 조기 발견.)
  function _leakCheck(personId, n){
    if(!g.PersonsStore) return [];
    var p = g.PersonsStore.get(personId);
    if(!p) return [];
    var leaks = [];
    L1_KEYS.forEach(function(k){
      if(n[k]!==undefined && JSON.stringify(n[k])!==JSON.stringify(p[k]))
        leaks.push(k);
    });
    return leaks;
  }

  // 한 명의 부서특성을 풀에 되쓰기. Layer1은 절대 안 건드림.
  //   returns {ok, leaks:[...]}  — leaks 비어있어야 정상(경계 지켜짐).
  function writeDutyAttrs(n){
    if(!g.PersonsStore || !n || !n.personId) return { ok:false, leaks:[] };
    var leaks = _leakCheck(n.personId, n);
    if(leaks.length){
      // 경계 누수: 듀티가 Layer1을 바꾸려 함 → 막고 경고(데이터엔 반영 안 됨).
      try{ console.warn('[duty-adapter] Layer1 되쓰기 차단:', n.personId, leaks); }catch(_){}
    }
    var da = _extractDutyAttrs(n);
    da.active = true;  // 듀티 소속이므로 active 유지
    var ok = g.PersonsStore.setDeptAttrs(n.personId, DEPT, da);
    return { ok: ok, leaks: leaks };
  }

  // 듀티 nurse 배열 전체를 풀로 되쓰기 (saveLocal 경로에서 호출 예정 — M4c-3).
  //   returns {written, leaks:[{personId,keys}]}
  function writeAllDutyAttrs(nurses){
    var written=0, allLeaks=[];
    (nurses||[]).forEach(function(n){
      if(!n || !n.personId) return;
      var r = writeDutyAttrs(n);
      if(r.ok) written++;
      if(r.leaks.length) allLeaks.push({ personId:n.personId, keys:r.leaks });
    });
    return { written:written, leaks:allLeaks };
  }

  // ── 배치/해제 (M4c-4): 사람 생성은 직원관리 전속. 듀티는 풀에서 배치만. ──
  // 듀티에 아직 없는(배치 가능한) 풀 인원 목록 — "간호사 추가" UI의 후보.
  //   membership !== 'duty' 인 모두(미소속 + 타 부서 소속). 표시는 호출부가 결정.
  function listPlaceable(){
    if(!g.PersonsStore) return [];
    return g.PersonsStore.list().filter(function(p){ return p.membership !== DEPT; });
  }
  // 풀 인원을 듀티로 배치 (새 사람 생성 아님 — 소속 부여 + 부서특성 초기화).
  //   ★ 배치 시 deptAttrs.duty 를 완전체로 만든다: 고유 id·role·color·attributes·prefs.
  //     안 그러면 어댑터가 빈 부서특성을 읽어 직급 undefined·id 충돌·속성 토글 깨짐.
  function placeInDuty(personId, role){
    if(!g.PersonsStore || !personId) return false;
    // 1) 소속 부여 (deptAttrs.duty = {active:true} 생성)
    var ok = g.PersonsStore.setMembership(personId, DEPT);
    if(!ok) return false;
    // 2) 부서특성이 비어있으면(신규 배치) 완전체로 초기화
    var cur = g.PersonsStore.getDeptAttrs(personId, DEPT) || {};
    var patch = {};
    if(cur.id===undefined){
      // 듀티 내부 고유 id 발급: 기존 듀티 인원 id 최대값 + 1 (스케줄·락 키)
      var maxId = 0;
      g.PersonsStore.listByDept(DEPT).forEach(function(p){
        var did = p.deptAttrs && p.deptAttrs.duty && p.deptAttrs.duty.id;
        if(typeof did==='number' && did>maxId) maxId=did;
      });
      patch.id = maxId + 1;
    }
    // 직급: 호출부가 지정한 값(staff에서 사용자 선택) 우선, 없으면 기본 평간호사.
    if(role) patch.role = role;
    else if(cur.role===undefined) patch.role = '평간호사';   // ★ 기본 평간호사 (수간호사 아님)
    if(cur.color===undefined){
      var palette = g.NCOLS || ['#2980B9'];
      var cnt = g.PersonsStore.listByDept(DEPT).length;
      patch.color = palette[(cnt-1+palette.length)%palette.length];
    }
    if(cur.attributes===undefined) patch.attributes = (typeof g.defaultAttributes==='function') ? g.defaultAttributes() : {};
    if(cur.prefs===undefined)      patch.prefs      = (typeof g.defaultPrefs==='function') ? g.defaultPrefs() : {};
    if(cur.carryOver===undefined)  patch.carryOver  = { offBalance:0 };
    if(cur.manualOrder===undefined){
      var maxOrd = -1;
      g.PersonsStore.listByDept(DEPT).forEach(function(p){
        var mo = p.deptAttrs && p.deptAttrs.duty && p.deptAttrs.duty.manualOrder;
        if(typeof mo==='number' && mo>maxOrd) maxOrd=mo;
      });
      patch.manualOrder = maxOrd + 1;
    }
    if(Object.keys(patch).length) g.PersonsStore.setDeptAttrs(personId, DEPT, patch);
    return true;
  }
  // 듀티에서 빼기 (사람 삭제 아님 — 소속 해제. 풀엔 남음).
  function removeFromDuty(personId){
    if(!g.PersonsStore || !personId) return false;
    return g.PersonsStore.setMembership(personId, null);
  }

  g.DutyAdapter = {
    poolToNurses: poolToNurses,
    writeDutyAttrs: writeDutyAttrs,
    writeAllDutyAttrs: writeAllDutyAttrs,
    listPlaceable: listPlaceable,
    placeInDuty: placeInDuty,
    removeFromDuty: removeFromDuty,
    // 검사·테스트용 노출
    _personToNurse: _personToNurse,
    _extractDutyAttrs: _extractDutyAttrs,
    _leakCheck: _leakCheck,
    L1_KEYS: L1_KEYS,
    DUTY_ATTR_KEYS: DUTY_ATTR_KEYS,
    DEPT: DEPT
  };
  g.__DUTYADAPTER_LOADED__ = true;

})(window);
