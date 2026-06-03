/* ============================================================
   shared/er-roster-store.js — 공유 응급실 당직표 (M6 5단계, 방식 B)
   ------------------------------------------------------------
   하는 일: "그날 응급실 당직의가 누구인가"를 한 곳에 보관.
            공휴일 중앙관리(calendar-store의 dv6_extHol)와 똑같은 철학:
            중앙 공유 데이터 1개를, 모든 kind='doctor' 부서가 읽어간다.

   ── 데이터 흐름 (핸드오프 3-1 확정) ──────────────────────────
     응급실 당직표 (원천/source of truth)
        └─ 읽어옴(read-only) ─▶ 각 의사과 스케줄 날짜헤더에 (성) 표시
     ★ 응급실이 원천. 의사과는 성씨만 읽어 표시(편집 불가).

   ── 저장 구조 ────────────────────────────────────────────────
     키:  'dv6_er_roster'  (부서 무관 — 모든 의사과가 공유)
     값:  { 'YYYY-M-D': personId }     (month 1-based — 사람이 읽는 날짜키)
          personId 는 인력풀(dv6_persons)의 ID. 이름 바뀌어도 추적됨.
     ★ 성씨는 저장하지 않는다 — personId → PersonsStore 이름 → 첫 글자로 매번 계산.
       (이름 변경이 당직표에 자동 반영되도록. 변하는 것/안 변하는 것 분리)

   공개 API:
     ErRosterStore.get(y, m1, d)        -> personId | ''     (m1 = 1-based)
     ErRosterStore.set(y, m1, d, pid)   -> true|false        (pid='' 이면 삭제)
     ErRosterStore.initial(y, m1, d)    -> '성' | ''          (이름 첫 글자)
     ErRosterStore.name(y, m1, d)       -> '홍길동' | ''
     ErRosterStore.monthMap(y, m1)      -> { d: personId }    (그 달 전체)
     ErRosterStore.removePerson(pid)    -> 그 의사가 잡힌 모든 당직 해제
   ============================================================ */
(function (g) {
  'use strict';

  var STORE_KEY = 'dv6_er_roster';
  var _map = null;   // { 'YYYY-M-D': personId }

  function _load(){
    if(_map) return _map;
    try{ var raw = localStorage.getItem(STORE_KEY); _map = raw ? JSON.parse(raw) : {}; }
    catch(_){ _map = {}; }
    if(typeof _map !== 'object' || _map===null) _map = {};
    return _map;
  }
  function _save(){
    try{ localStorage.setItem(STORE_KEY, JSON.stringify(_map||{})); return true; }
    catch(e){ console.warn('[er-roster] save 실패:', e); return false; }
  }
  function _key(y, m1, d){ return y+'-'+m1+'-'+d; }   // m1: 1-based

  function get(y, m1, d){
    var m = _load();
    return m[_key(y,m1,d)] || '';
  }
  function set(y, m1, d, pid){
    var m = _load();
    var k = _key(y,m1,d);
    if(!pid){ delete m[k]; }
    else { m[k] = String(pid); }
    return _save();
  }
  // personId → 이름 (PersonsStore 경유). 없으면 ''
  function _nameOf(pid){
    if(!pid || !g.PersonsStore || !g.PersonsStore.get) return '';
    var p = g.PersonsStore.get(pid);
    return p ? (p.name||'') : '';
  }
  function name(y, m1, d){ return _nameOf(get(y,m1,d)); }
  function initial(y, m1, d){
    var nm = name(y,m1,d);
    return nm ? nm.trim().charAt(0) : '';
  }
  function monthMap(y, m1){
    var m = _load(), pre = y+'-'+m1+'-', out = {};
    Object.keys(m).forEach(function(k){
      if(k.indexOf(pre)===0){
        var d = parseInt(k.slice(pre.length),10);
        if(!isNaN(d)) out[d] = m[k];
      }
    });
    return out;
  }
  function removePerson(pid){
    if(!pid) return;
    var m = _load(), changed = false;
    Object.keys(m).forEach(function(k){ if(m[k]===String(pid)){ delete m[k]; changed = true; } });
    if(changed) _save();
  }

  // ── 응급실 부서 지정 ──────────────────────────────────────────
  // ER 당직 후보 = 이 부서(kind='doctor') 소속 의사. 부서 이름은 바뀔 수 있으므로 id로 보관.
  var DEPT_KEY = 'dv6_er_dept';
  function getDeptId(){
    try{ return localStorage.getItem(DEPT_KEY) || ''; }catch(_){ return ''; }
  }
  function setDeptId(deptId){
    try{ localStorage.setItem(DEPT_KEY, deptId||''); return true; }catch(_){ return false; }
  }

  g.ErRosterStore = {
    get: get, set: set, name: name, initial: initial,
    monthMap: monthMap, removePerson: removePerson,
    getDeptId: getDeptId, setDeptId: setDeptId,
    STORE_KEY: STORE_KEY, DEPT_KEY: DEPT_KEY
  };
  g.__ERROSTERSTORE_LOADED__ = true;

})(window);
