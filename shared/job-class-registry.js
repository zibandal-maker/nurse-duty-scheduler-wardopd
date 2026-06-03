/* ============================================================
   shared/job-class-registry.js — 직군(인력 대분류) 레지스트리
   ------------------------------------------------------------
   하는 일: 병원 인력의 "직군 대분류" 명부. 사람마다 직군 1개를 가짐(person.jobClass).
            부서(dept-registry)와 독립된 축 — 부서는 "어디서 일하는가",
            직군은 "어떤 종류의 일을 하는가".
            예) 박형도: 직군 '의사' + 부서 'doctor_1(내과계)'
                김간호: 직군 '간호' + 부서 'duty(5East)'
                이원무: 직군 '행정' + 부서 'admin_1(원무과)'

   ── 직군 레코드 ──────────────────────────────────────────────
   { id:'nursing', name:'간호', color:'#1E6DBF', builtin:true, order:0 }
     id      : 안정 식별자(person.jobClass에 저장). builtin은 고정 id.
     name    : 표시명(편집 가능).
     color   : 배지 색.
     builtin : 기본 제공 직군(삭제 불가, 이름·색만 편집). 사용자 추가분은 false.
     order   : 표시 순서.

   ★ 기본 8개 시드: 간호·의사·행정·시설·환경미화·의료기사·약무·보안.
     원무·총무·미화'부' 등은 직군이 아니라 '부서'다(행정/시설 직군 하위) → dept로.
   ★ 사용자가 직군 추가/이름변경/색변경/삭제 가능(builtin은 삭제만 불가).
   ★ 직군 삭제 시 그 직군을 가진 사람의 jobClass는 호출부가 별도 처리(빈값化).

   저장: 'dv6_job_class_registry' (localStorage).
   ============================================================ */
(function (g) {
  'use strict';

  var STORAGE_KEY = 'dv6_job_class_registry';

  // 기본 직군 8종 (병원 표준). builtin=true → 삭제 불가.
  var SEED = [
    { id:'nursing',  name:'간호',     color:'#1E6DBF', builtin:true, order:0 },
    { id:'doctor',   name:'의사',     color:'#1A8C62', builtin:true, order:1 },
    { id:'admin',    name:'행정',     color:'#5B3FA0', builtin:true, order:2 },
    { id:'facility', name:'시설',     color:'#0C7B93', builtin:true, order:3 },
    { id:'cleaning', name:'환경미화', color:'#A35200', builtin:true, order:4 },
    { id:'medtech',  name:'의료기사', color:'#B5306E', builtin:true, order:5 },
    { id:'pharmacy', name:'약무',     color:'#2D7D46', builtin:true, order:6 },
    { id:'security', name:'보안',     color:'#5A6472', builtin:true, order:7 }
  ];

  function _load(){
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if(!raw){ _save(SEED); return SEED.slice(); }   // 최초 진입: 시드 심기
      var arr = JSON.parse(raw);
      if(!Array.isArray(arr) || !arr.length){ _save(SEED); return SEED.slice(); }
      return arr;
    } catch(_){ return SEED.slice(); }
  }
  function _save(arr){
    try {
      var s = JSON.stringify(arr);
      localStorage.setItem(STORAGE_KEY, s);
      return localStorage.getItem(STORAGE_KEY) === s;
    } catch(e){ console.warn('[job-class-registry] save 실패:', e); return false; }
  }
  function _norm(r){
    return {
      id: r.id,
      name: r.name || r.id,
      color: r.color || '#5A6472',
      builtin: !!r.builtin,
      order: (typeof r.order==='number') ? r.order : 999
    };
  }

  function list(){
    return _load().map(_norm).sort(function(a,b){ return a.order - b.order; });
  }
  function get(id){
    if(!id) return null;
    var f = _load().filter(function(r){ return r.id===id; })[0];
    return f ? _norm(f) : null;
  }
  function name(id){ var r=get(id); return r ? r.name : ''; }
  function color(id){ var r=get(id); return r ? r.color : '#5A6472'; }
  function exists(id){ return !!get(id); }

  // 사용자 추가 직군 id: 'jc_' + 순번 (builtin과 충돌 안 나게 접두)
  function _nextId(){
    var max=0;
    _load().forEach(function(r){
      var m=String(r.id||'').match(/^jc_(\d+)$/);
      if(m){ var n=parseInt(m[1],10); if(n>max) max=n; }
    });
    return 'jc_'+(max+1);
  }
  function _nextOrder(){
    var max=-1; _load().forEach(function(r){ if(typeof r.order==='number' && r.order>max) max=r.order; });
    return max+1;
  }

  // 직군 추가 (사용자 정의 — builtin=false)
  function create(name, color){
    name=(name||'').trim();
    if(!name) return null;
    var arr=_load();
    var rec={ id:_nextId(), name:name, color:color||'#5A6472', builtin:false, order:_nextOrder() };
    arr.push(rec);
    return _save(arr) ? _norm(rec) : null;
  }
  function rename(id, name){
    name=(name||'').trim(); if(!id||!name) return false;
    var arr=_load(), hit=false;
    arr.forEach(function(r){ if(r.id===id){ r.name=name; hit=true; } });
    return hit ? _save(arr) : false;
  }
  function setColor(id, color){
    if(!id||!color) return false;
    var arr=_load(), hit=false;
    arr.forEach(function(r){ if(r.id===id){ r.color=color; hit=true; } });
    return hit ? _save(arr) : false;
  }
  // 삭제 (builtin은 불가). 사람의 jobClass 정리는 호출부 책임.
  function remove(id){
    if(!id) return false;
    var arr=_load();
    var tgt=arr.filter(function(r){ return r.id===id; })[0];
    if(!tgt || tgt.builtin) return false;   // 없거나 기본직군 → 거부
    var next=arr.filter(function(r){ return r.id!==id; });
    return _save(next);
  }

  g.JobClassRegistry = {
    list:list, get:get, name:name, color:color, exists:exists,
    create:create, rename:rename, setColor:setColor, remove:remove,
    SEED:SEED, STORAGE_KEY:STORAGE_KEY
  };
  g.__JOBCLASSREGISTRY_LOADED__ = true;

})(window);
