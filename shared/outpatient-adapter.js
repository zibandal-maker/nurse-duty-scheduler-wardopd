/* ============================================================
   shared/outpatient-adapter.js — 외래(비교대) 부서 어댑터 (묶음 B)
   ------------------------------------------------------------
   하는 일: 외래 계열 부서(outpatient_N)에 인력을 배치/해제하고,
            배치 시 부서특성(deptAttrs[deptId])을 완전체로 초기화한다.

   듀티 어댑터(duty-adapter)와의 차이:
   · 듀티는 자동배치 엔진이 nurse 객체를 읽어 → poolToNurses 변환층이 두꺼움.
   · 외래는 엔진 없음 → 변환 불필요. "배치 + 부서특성 초기화"만.

   ── 외래 부서특성 스키마 (deptAttrs[deptId]) ──────────────────
   {
     active: true,           // 현재 소속 여부 (M4g 보존/복귀)
     id: 1,                  // 부서 내부 정수 (슬롯·정렬 키). 듀티 nurse.id 대응.
     role: '평간호사',        // 직급 5종 (듀티와 동일 구성) — 기본 평간호사
     color: '#...',          // 표시색 (NCOLS 순환)
     attributes: {
       pregnant: false,      // 임산부 (특수속성)
       fixedWeekday: {}      // 요일 고정 패턴: { tue:'half', thu:'off' } 등
                             //   키=요일(sun..sat), 값=시프트코드(work/half/vac/off…)
     },
     manualOrder: 0          // 좌측 목록·달력 행 정렬
   }

   ★ 직급 5종은 듀티와 통일: 수간호사·주임·차지·평간호사·신규간호사 (ROLES).
   ★ 부서특성 화이트리스트 = deptAttrs[deptId] 네임스페이스 통째 (M4g 규약).
   ★ id 는 같은 부서 내 기존 최대+1 → 부서별로 독립 발급.

   의존: window.PersonsStore, window.ROLES, window.NCOLS.
   ============================================================ */
(function (g) {
  'use strict';

  var KIND = 'outpatient';

  function _defaultAttributes(){
    return {
      pregnant: false,       // 임산부 (특수속성)
      fixedWeekday: {}       // 요일 고정 패턴 { sun..sat : code }
    };
  }

  // 배치 가능 후보 — 이 부서에 아직 없는(membership !== deptId) 풀 인원.
  function listPlaceable(deptId){
    if(!g.PersonsStore) return [];
    return g.PersonsStore.list().filter(function(p){ return p.membership !== deptId; });
  }

  // 풀 인원을 외래 부서로 배치 — 부서특성 완전체 초기화.
  //   role 지정(staff 선택) 우선, 없으면 기본 평간호사.
  function placeIn(deptId, personId, role){
    if(!g.PersonsStore || !deptId || !personId) return false;
    var ok = g.PersonsStore.setMembership(personId, deptId);
    if(!ok) return false;
    var cur = g.PersonsStore.getDeptAttrs(personId, deptId) || {};
    var patch = {};
    if(cur.id===undefined){
      var maxId = 0;
      g.PersonsStore.listByDept(deptId).forEach(function(p){
        var did = p.deptAttrs && p.deptAttrs[deptId] && p.deptAttrs[deptId].id;
        if(typeof did==='number' && did>maxId) maxId=did;
      });
      patch.id = maxId + 1;
    }
    if(role) patch.role = role;
    else if(cur.role===undefined) patch.role = '평간호사';   // ★ 기본 평간호사
    if(cur.color===undefined){
      var palette = g.NCOLS || ['#2980B9'];
      var cnt = g.PersonsStore.listByDept(deptId).length;
      patch.color = palette[(cnt-1+palette.length)%palette.length];
    }
    if(cur.attributes===undefined) patch.attributes = _defaultAttributes();
    if(cur.manualOrder===undefined){
      var maxOrd = -1;
      g.PersonsStore.listByDept(deptId).forEach(function(p){
        var mo = p.deptAttrs && p.deptAttrs[deptId] && p.deptAttrs[deptId].manualOrder;
        if(typeof mo==='number' && mo>maxOrd) maxOrd=mo;
      });
      patch.manualOrder = maxOrd + 1;
    }
    if(Object.keys(patch).length) g.PersonsStore.setDeptAttrs(personId, deptId, patch);
    return true;
  }

  // 부서에서 빼기 (사람 삭제 아님 — 소속 해제, 부서특성 보존).
  function removeFrom(deptId, personId){
    if(!g.PersonsStore || !personId) return false;
    return g.PersonsStore.setMembership(personId, null);
  }

  // 부서 소속 인원 목록 (manualOrder 순). 누락 부서특성 보강해 반환.
  function listMembers(deptId){
    if(!g.PersonsStore) return [];
    var list = g.PersonsStore.listByDept(deptId);
    list.forEach(function(p){
      var da = (p.deptAttrs && p.deptAttrs[deptId]) ? p.deptAttrs[deptId] : {};
      if(!da.attributes) da.attributes = _defaultAttributes();
      if(da.attributes.fixedWeekday===undefined) da.attributes.fixedWeekday = {};
      if(da.attributes.pregnant===undefined) da.attributes.pregnant = false;
      p._dept = da;   // 호출부 편의: 이 부서 특성 바로 접근
    });
    list.sort(function(a,b){
      var ao=(a.deptAttrs[deptId]&&a.deptAttrs[deptId].manualOrder)||0;
      var bo=(b.deptAttrs[deptId]&&b.deptAttrs[deptId].manualOrder)||0;
      return ao-bo;
    });
    return list;
  }

  g.OutpatientAdapter = {
    KIND: KIND,
    listPlaceable: listPlaceable,
    placeIn: placeIn,
    removeFrom: removeFrom,
    listMembers: listMembers,
    defaultAttributes: _defaultAttributes
  };
  g.__OUTPATIENTADAPTER_LOADED__ = true;

})(window);
