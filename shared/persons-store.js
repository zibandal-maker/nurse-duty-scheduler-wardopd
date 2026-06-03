/* ============================================================
   shared/persons-store.js — 종합 인력 풀 (M4a 확장: 3계층 모델)
   ------------------------------------------------------------
   하는 일: 회사 전체 직원 명부(Layer 1) + 소속(Layer 2) + 관리그룹(2.5)
            + 부서별 특성(deptAttrs)을 한 곳에 모은다.

   ── 한 사람 레코드 (M4a) ──────────────────────────────────────
   {
     // Layer 1 — 사람 기본(부서 무관). 확장 가능.
     name, birthday, joinDate, photo, memo, vacTotal,
     ext: {},                 // 미래 확장 항목(자격증·연락처 등) 자유 키
     // Layer 2 — 소속(배타적 1개). null=미배정.
     membership: 'duty'|'outpatient'|null,
     // Layer 2.5 — 관리 그룹(소속과 직교, 겹침 가능)
     isManager: false,
     managerGroups: [],       // 예: ['head_nurses']
     // 부서별 특성(소속 외에도 보존 = 서랍). 부서 떠나면 active:false.
     deptAttrs: { duty:{active, role, color, prefs, attributes, ...}, outpatient:{...} }
   }

   ★ 하위 호환: 기존 함수(get/upsert/syncFromNurses/list)는 그대로 동작.
     옛 레코드(membership 등 없음)도 읽으면 기본값으로 채워 반환.
   ★ 연차(vacTotal)·기본정보는 Layer1 → 부서 이동해도 연차 이어짐.

   ── 부서특성 확장 규약 (M4g) ──────────────────────────────────
   새 부서/새 부서특성을 추가할 때 따른다:
   1) deptAttrs[부서키] 는 그 부서만의 네임스페이스. 다른 부서·Layer1과 안 겹침.
      반드시 active 플래그 보유(현재 소속=true, 떠나면 false=보존).
   2) 소속 이동은 setMembership 하나로. 이전 부서 active:false(보존), 새 부서 active:true.
      복귀 시 보존된 특성 그대로 살아남(삭제·초기화 안 함).
   3) 부서특성 초기값은 그 부서 도메인이 소유(예: 듀티=DutyAdapter.placeInDuty).
      "비어있을 때만 채움" 가드 필수 → 복귀자 특성을 덮지 않음.
   4) 부서는 자기 deptAttrs[부서키]만 읽고 쓴다. Layer1(이름·연차 등)은 직원관리 전속.
   5) 새 부서특성 키 추가는 어댑터 화이트리스트가 "네임스페이스 통째"라 자동 포함
      (필드 나열 아님) → 어댑터 수정 없이 확장.

   저장: 'dv6_persons' (전역 공유, 부서 무관).
   ============================================================ */
(function (g) {
  'use strict';

  var STORAGE_KEY = 'dv6_persons';   // 전역 공유 (부서 무관)

  // 풀 전체 로드 → { personId: record }
  function loadPool(){
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch(e){ return {}; }
  }

  // 풀 전체 저장 (write-then-verify)
  function savePool(pool){
    try {
      var s = JSON.stringify(pool || {});
      localStorage.setItem(STORAGE_KEY, s);
      return localStorage.getItem(STORAGE_KEY) === s;
    } catch(e){ return false; }
  }

  // 레코드 정규화 — 옛 레코드(필드 없음)도 완전한 형태로 채워 반환 (하위 호환의 핵심)
  function _normRecord(r){
    r = r || {};
    return {
      name:     r.name || '',
      birthday: r.birthday || '',
      joinDate: r.joinDate || '',
      photo:    r.photo || '',
      memo:     r.memo || '',
      vacTotal: (r.vacTotal!==undefined ? r.vacTotal : null),
      jobClass: (r.jobClass!==undefined ? r.jobClass : ''),   // 직군 대분류 (간호·의사·행정 등). 부서와 독립.
      ext:      (r.ext && typeof r.ext==='object') ? r.ext : {},
      membership:    (r.membership!==undefined ? r.membership : null),
      isManager:     !!r.isManager,
      managerGroups: Array.isArray(r.managerGroups) ? r.managerGroups : [],
      deptAttrs:     (r.deptAttrs && typeof r.deptAttrs==='object') ? r.deptAttrs : {}
    };
  }

  // 한 사람 조회 (정규화해서 반환 — 항상 완전한 레코드)
  function getPerson(personId){
    if(!personId) return null;
    var pool = loadPool();
    return pool[personId] ? _normRecord(pool[personId]) : null;
  }

  // 한 사람 갱신/추가 (부분 필드 병합 — 주어진 필드만 덮고 나머지 보존)
  function upsertPerson(personId, fields){
    if(!personId) return false;
    var pool = loadPool();
    var cur = _normRecord(pool[personId]);
    fields = fields || {};
    // Layer1 기본
    if(fields.name     !== undefined) cur.name     = fields.name;
    if(fields.birthday !== undefined) cur.birthday = fields.birthday;
    if(fields.joinDate !== undefined) cur.joinDate = fields.joinDate;
    if(fields.photo    !== undefined) cur.photo    = fields.photo;
    if(fields.memo     !== undefined) cur.memo     = fields.memo;
    if(typeof fields.vacTotal==='number') cur.vacTotal = fields.vacTotal;
    if(fields.jobClass !== undefined) cur.jobClass = fields.jobClass;
    if(fields.ext && typeof fields.ext==='object'){
      for(var k in fields.ext){ if(Object.prototype.hasOwnProperty.call(fields.ext,k)) cur.ext[k]=fields.ext[k]; }
    }
    // Layer2/2.5
    if(fields.membership   !== undefined) cur.membership   = fields.membership;
    if(fields.isManager    !== undefined) cur.isManager    = !!fields.isManager;
    if(fields.managerGroups!== undefined && Array.isArray(fields.managerGroups)) cur.managerGroups = fields.managerGroups;
    if(fields.deptAttrs && typeof fields.deptAttrs==='object'){
      for(var d in fields.deptAttrs){ if(Object.prototype.hasOwnProperty.call(fields.deptAttrs,d)) cur.deptAttrs[d]=fields.deptAttrs[d]; }
    }
    pool[personId] = cur;
    return savePool(pool);
  }

  // ── Layer 2: 소속 관리 ────────────────────────────────────────────────
  // 소속 변경(배타적). 떠나는 부서 특성은 active:false(보존), 새 부서는 active:true.
  function setMembership(personId, dept){
    if(!personId) return false;
    var pool = loadPool();
    var cur = _normRecord(pool[personId]);
    var prev = cur.membership;
    // 이전 소속 특성 비활성 (서랍에 보관)
    if(prev && cur.deptAttrs[prev]) cur.deptAttrs[prev].active = false;
    cur.membership = dept || null;
    // 새 소속 특성 활성(없으면 생성)
    if(dept){
      if(!cur.deptAttrs[dept]) cur.deptAttrs[dept] = { active:true };
      else cur.deptAttrs[dept].active = true;
    }
    pool[personId] = cur;
    return savePool(pool);
  }
  // 특정 부서 소속 인원만 (active 기준) [{personId, ...record}]
  function listByDept(dept){
    var pool = loadPool();
    return Object.keys(pool).map(function(pid){
      var r=_normRecord(pool[pid]); r.personId=pid; return r;
    }).filter(function(r){ return r.membership===dept; });
  }
  // M4f: 관리그룹 소속 인원 (소속과 직교 — 겹침 가능). group 미지정 시 isManager 전원.
  //   각 레코드는 자기 membership(듀티/외래)을 그대로 보유 → 근무 조회 시 소속 장부 결정에 사용.
  function listByGroup(group){
    var pool = loadPool();
    return Object.keys(pool).map(function(pid){
      var r=_normRecord(pool[pid]); r.personId=pid; return r;
    }).filter(function(r){
      if(group) return r.managerGroups.indexOf(group) >= 0;
      return r.isManager;   // group 생략 = 관리자 전원
    });
  }
  // 부서 특성 읽기/쓰기 (deptAttrs[dept])
  function getDeptAttrs(personId, dept){
    var r = getPerson(personId); if(!r) return null;
    return r.deptAttrs[dept] || null;
  }
  function setDeptAttrs(personId, dept, attrs){
    if(!personId || !dept) return false;
    var pool = loadPool();
    var cur = _normRecord(pool[personId]);
    var merged = cur.deptAttrs[dept] || {};
    for(var k in attrs){ if(Object.prototype.hasOwnProperty.call(attrs,k)) merged[k]=attrs[k]; }
    cur.deptAttrs[dept] = merged;
    pool[personId] = cur;
    return savePool(pool);
  }

  // 부서의 간호사 목록 → 풀로 동기화 (Layer1 기본 정보만; 소속/특성은 안 건드림)
  //   ★ 하위 호환: M3까지의 동기화 동작 유지. 소속(membership)은 M4b 마이그레이션이 별도 설정.
  function syncFromNurses(nurseList){
    if(!Array.isArray(nurseList)) return 0;
    var pool = loadPool();
    var n = 0;
    nurseList.forEach(function(x){
      if(!x || !x.personId) return;
      var cur = _normRecord(pool[x.personId]);
      if(x.name !== undefined && x.name !== '')         cur.name     = x.name;
      if(x.birthday !== undefined && x.birthday !== '') cur.birthday = x.birthday;
      if(typeof x.vacTotal==='number')                  cur.vacTotal = x.vacTotal;
      if(x.joinDate !== undefined && x.joinDate !== '') cur.joinDate = x.joinDate;
      pool[x.personId] = cur;
      n++;
    });
    savePool(pool);
    return n;
  }

  // ── personId 발급 (풀이 사람의 주인 → 발급도 풀이) ──────────────────
  //   카운터 변수에 의존하지 않고 "현재 풀의 최대 번호 + 1"로 계산.
  //   → 어디서 호출하든(직원관리·import·복원) 풀 상태 기준이라 충돌 없음.
  function issuePersonId(){
    var pool = loadPool();
    var max = 0;
    Object.keys(pool).forEach(function(pid){
      var m = /^p_(\d+)$/.exec(pid);
      if(m){ var num=parseInt(m[1],10); if(!isNaN(num) && num>max) max=num; }
    });
    return 'p_' + String(max+1).padStart(4,'0');
  }

  // 신규 직원 생성 → 발급된 personId 반환 (실패 시 null)
  function createPerson(fields){
    var pid = issuePersonId();
    var ok = upsertPerson(pid, fields || {});
    return ok ? pid : null;
  }

  // 직원 삭제 (풀에서 제거). 부서 스케줄 정리는 각 부서 책임(personId 결번 유지).
  function removePerson(personId){
    if(!personId) return false;
    var pool = loadPool();
    if(!pool[personId]) return false;
    delete pool[personId];
    return savePool(pool);
  }

  // 풀의 모든 사람 목록 (정규화된 완전 레코드 + personId)
  function listPersons(){
    var pool = loadPool();
    return Object.keys(pool).map(function(pid){
      var r = _normRecord(pool[pid]); r.personId = pid; return r;
    });
  }

  g.PersonsStore = {
    load: loadPool,
    save: savePool,
    get: getPerson,
    upsert: upsertPerson,
    syncFromNurses: syncFromNurses,
    list: listPersons,
    // M4a 추가
    setMembership: setMembership,
    listByDept: listByDept,
    listByGroup: listByGroup,
    getDeptAttrs: getDeptAttrs,
    setDeptAttrs: setDeptAttrs,
    // M4d-2 추가 (생성·삭제·발급)
    issueId: issuePersonId,
    create: createPerson,
    remove: removePerson,
    STORAGE_KEY: STORAGE_KEY
  };
  g.__PERSONSSTORE_LOADED__ = true;

})(window);
