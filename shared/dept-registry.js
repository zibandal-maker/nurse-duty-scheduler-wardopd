/* ============================================================
   shared/dept-registry.js — 부서 레지스트리 (M5a)
   ------------------------------------------------------------
   하는 일: 사용자가 개설한 "외래(비교대) 부서들"의 명부.
            대시보드·직원관리·근무표가 공유하는 단일 부서 목록.

   왜 필요한가: 비교대를 한 화면에서 쪼개지 않고 부서를 통째로 분리((나) 방식).
     사용자가 "외과계 외래" 개설 → 명부에 한 줄 추가 → 대시보드가 카드 자동 생성,
     근무표는 같은 파일이 ?dept=<id> 로 부서별 데이터를 그림(파일 안 늘어남).

   ── 부서 레코드 ──────────────────────────────────────────────
   {
     id: 'outpatient_1',     // ★ 자동 순번. 이름과 분리(이름 바꿔도 id 안정).
     name: '외과계 외래',     // 표시용. 변경 가능.
     kind: 'outpatient',      // 계열. 'outpatient' = 비교대 계열.
     createdAt: 1234567890
   }

   ★ 고정 부서(듀티)는 레지스트리에 없음 — 코드에 박힌 핵심 부서.
     레지스트리는 "사용자가 추가하는 외래 계열"만 관리.
   ★ id 는 kind + '_' + 순번. kind 로 시작하므로 계열 묶기 가능
     (예: 비교대 전체 = id.startsWith('outpatient_')).
   ★ 소속(persons-store membership)·근무표 저장키(cal_*_<id>)가 이 id 를 씀.

   저장: 'dv6_dept_registry' (localStorage).
   ============================================================ */
(function (g) {
  'use strict';

  var STORAGE_KEY = 'dv6_dept_registry';

  function _load(){
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch(_){ return []; }
  }
  function _save(arr){
    try {
      var s = JSON.stringify(arr);
      localStorage.setItem(STORAGE_KEY, s);
      return localStorage.getItem(STORAGE_KEY) === s;
    } catch(e){ console.warn('[dept-registry] save 실패:', e); return false; }
  }
  function _norm(r){
    return {
      id: r.id,
      name: r.name || r.id,
      kind: r.kind || 'outpatient',
      createdAt: r.createdAt || 0
    };
  }

  // 전체 목록 (생성순)
  function list(){
    return _load().map(_norm);
  }
  // 계열별 목록 (예: kind='outpatient')
  function listByKind(kind){
    return list().filter(function(r){ return r.kind === kind; });
  }
  // 단건 조회
  function get(id){
    if(!id) return null;
    var found = _load().filter(function(r){ return r.id === id; })[0];
    return found ? _norm(found) : null;
  }
  // 존재 여부
  function exists(id){ return !!get(id); }

  // 다음 순번 id 발급 (kind 별). 기존 최대 순번 + 1 → 삭제해도 결번(재사용 안 함).
  function _nextId(kind){
    var max = 0;
    _load().forEach(function(r){
      if(r.kind !== kind) return;
      var m = String(r.id||'').match(new RegExp('^'+kind+'_(\\d+)$'));
      if(m){ var n = parseInt(m[1],10); if(n > max) max = n; }
    });
    return kind + '_' + (max + 1);
  }

  // 부서 개설. name 필수, kind 기본 'outpatient'. → 생성된 레코드 반환(실패 시 null)
  function create(name, kind){
    name = (name||'').trim();
    if(!name) return null;
    kind = kind || 'outpatient';
    var arr = _load();
    var rec = { id:_nextId(kind), name:name, kind:kind, createdAt:Date.now() };
    arr.push(rec);
    return _save(arr) ? _norm(rec) : null;
  }
  // 이름 변경 (id 불변 → 데이터 안 끊김)
  function rename(id, name){
    name = (name||'').trim();
    if(!id || !name) return false;
    var arr = _load();
    var hit = false;
    arr.forEach(function(r){ if(r.id===id){ r.name = name; hit = true; } });
    return hit ? _save(arr) : false;
  }
  // 부서 삭제 (레지스트리에서만 제거. 근무 데이터·소속은 호출부가 별도 처리).
  //   ★ id 는 재사용 안 함(_nextId가 최대값 기반이라 결번 유지).
  function remove(id){
    if(!id) return false;
    var arr = _load();
    var next = arr.filter(function(r){ return r.id !== id; });
    if(next.length === arr.length) return false;  // 없던 id
    return _save(next);
  }

  g.DeptRegistry = {
    list: list,
    listByKind: listByKind,
    get: get,
    exists: exists,
    create: create,
    rename: rename,
    remove: remove,
    STORAGE_KEY: STORAGE_KEY
  };
  g.__DEPTREGISTRY_LOADED__ = true;

})(window);
