/* ============================================================
   shared/personnel-migrate.js — 듀티 인력 → 종합 풀 마이그레이션 (M4b)
   ------------------------------------------------------------
   하는 일: 듀티 nurse 배열(dv6_n_duty)을 읽어 종합 풀로 분해·복사.
     - 사람 공통(Layer1) → 풀 기본 필드
     - 듀티 특성        → deptAttrs.duty (active:true)
     - membership='duty' 설정

   ★★ 듀티 원본(dv6_n_duty)은 절대 변경하지 않는다 — 읽기 전용. ★★
      (M4b는 "종이 장부 보고 전산에 옮겨 적기". 종이는 그대로.
       듀티가 풀에서 읽도록 바꾸는 개조는 M4c.)

   ★ 무손실 원칙: nurse의 모든 필드가 어딘가로 간다. 누락 0.
     - 사람 공통: personId,name,joinDate,birthday,memo,photo,vacTotal
     - 듀티 특성: id,role,color,prefs,attributes,carryOver,manualOrder
       (id·avoidWith·preferWith·preceptorOf 는 듀티 내부 id 참조 → 듀티 특성에 보존)

   멱등: 여러 번 돌려도 안전(같은 결과). 풀에 이미 있으면 갱신.
   ============================================================ */
(function (g) {
  'use strict';

  var DUTY_NURSES_KEY = 'dv6_n_duty';

  // 사람 공통(Layer1)으로 갈 키
  var L1_KEYS = ['name','joinDate','birthday','memo','photo','vacTotal'];
  // 듀티 특성(deptAttrs.duty)으로 갈 키
  var DUTY_ATTR_KEYS = ['id','role','color','prefs','attributes','carryOver','manualOrder'];

  function _readDutyNurses(){
    try{
      var raw = localStorage.getItem(DUTY_NURSES_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    }catch(e){ return []; }
  }

  // 한 nurse → {l1, dutyAttrs} 분해
  function _split(n){
    var l1 = {}, da = { active:true };
    L1_KEYS.forEach(function(k){ if(n[k]!==undefined) l1[k]=n[k]; });
    DUTY_ATTR_KEYS.forEach(function(k){ if(n[k]!==undefined) da[k]=n[k]; });
    return { personId:n.personId, l1:l1, dutyAttrs:da };
  }

  // 마이그레이션 실행 (듀티 원본 불변, 풀에 복사)
  //   returns { migrated, skipped, people:[personId...] }
  function migrateDutyToPool(){
    if(!g.PersonsStore) return { migrated:0, skipped:0, people:[], error:'PersonsStore 없음' };
    var nurses = _readDutyNurses();
    var migrated=0, skipped=0, people=[];
    nurses.forEach(function(n){
      if(!n || !n.personId){ skipped++; return; }   // personId 없으면 건너뜀(migrateNurse가 먼저 발급해야)
      var parts = _split(n);
      // Layer1 기본 + 듀티 특성 + 소속 한 번에
      var fields = {};
      L1_KEYS.forEach(function(k){ if(parts.l1[k]!==undefined) fields[k]=parts.l1[k]; });
      fields.membership = 'duty';
      var deptAttrs = {}; deptAttrs.duty = parts.dutyAttrs;
      fields.deptAttrs = deptAttrs;
      g.PersonsStore.upsert(n.personId, fields);
      migrated++; people.push(n.personId);
    });
    return { migrated:migrated, skipped:skipped, people:people };
  }

  // 무손실 검증: 풀에 옮긴 내용이 듀티 원본과 일치하는지 (필드별 대조)
  //   returns { ok, mismatches:[...] }
  function verifyMigration(){
    var nurses = _readDutyNurses();
    var mism = [];
    nurses.forEach(function(n){
      if(!n || !n.personId) return;
      var p = g.PersonsStore.get(n.personId);
      if(!p){ mism.push(n.personId+': 풀에 없음'); return; }
      // Layer1 대조
      L1_KEYS.forEach(function(k){
        var src = (n[k]!==undefined)?n[k]:( k==='vacTotal'?null:'' );
        var dst = p[k];
        if(JSON.stringify(src)!==JSON.stringify(dst)) mism.push(n.personId+'.'+k+': '+JSON.stringify(src)+'≠'+JSON.stringify(dst));
      });
      // 소속
      if(p.membership!=='duty') mism.push(n.personId+'.membership≠duty');
      // 듀티 특성 대조
      var da = p.deptAttrs && p.deptAttrs.duty;
      if(!da){ mism.push(n.personId+': deptAttrs.duty 없음'); return; }
      DUTY_ATTR_KEYS.forEach(function(k){
        if(n[k]===undefined) return;
        if(JSON.stringify(n[k])!==JSON.stringify(da[k])) mism.push(n.personId+'.duty.'+k+' 불일치');
      });
    });
    return { ok: mism.length===0, mismatches: mism };
  }

  g.PersonnelMigrate = {
    run: migrateDutyToPool,
    verify: verifyMigration,
    readDutyNurses: _readDutyNurses,
    DUTY_NURSES_KEY: DUTY_NURSES_KEY
  };
  g.__PERSONNELMIGRATE_LOADED__ = true;

})(window);
