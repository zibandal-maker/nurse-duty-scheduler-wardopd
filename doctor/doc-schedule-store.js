/* ============================================================
   doctor/doc-schedule-store.js — 의사과 스케줄 셀 + 저장소 (M6, 방식 B)
   ------------------------------------------------------------
   왜 doctor/ 안에 두는가 (shared/ 아님):
     셀 데이터 모양이 부서 계열마다 다르다.
       듀티   = D/E/N 1글자 코드
       외래   = {am, pm} 2슬롯
       의사   = 독립 속성 6개 (erCall·block·consult·endo·status·memo) + amPm 자리
     공유 불가 — 각 계열이 자기 store를 가진다. (외래 cal-schedule-store와 같은 철학)

   ── 셀 구조 (핸드오프 2-2 확정) ──────────────────────────────
     키:  personId|연|월|일       (utils.cellKey 재사용. month는 0-based, 기존 통일)
     값:  {
            erCall : 'D' | 'N' | '',   // 응급실 콜. D=주간콜, N=야간콜
            block  : true|false,        // (X) = 콜·협진 "금지" 표시
            consult: true|false,        // 협진당직(수술 전 협진) — 노랑
            endo   : true|false,        // 내시경 시술 — 파랑
            status : '근무' | '휴진',    // 휴진 = 주황 흐림
            memo   : ''                 // 자유 텍스트('투석' 등)
            // amPm : {am,pm}           // ⏸ 보류 — 자리만. 규칙 미정(복잡). 지금은 저장 안 함.
          }
     ★ 모든 속성 독립. 엑셀의 "N박형도(내시경)" 한 문자열을 풀어서 분리 저장.
     빈 셀: 의미있는 속성이 하나도 없으면 키 자체를 두지 않음(공간 절약).

   저장: localStorage 'doc_sched_<deptId>'. 외래 cal_sched_* / 듀티 dv6_* 와 완전 격리.
   ★ 서버 전환 지점: ACTIVE_REPO 한 줄 교체(외래·듀티와 동일 패턴).
   ============================================================ */
(function (g) {
  'use strict';

  var cellKey = g.cellKey;   // nid|y|m|d (utils). nid 자리에 personId.
  function docKey(base){ return base + '_' + (g.DOC_DEPT_ID || 'doctor'); }

  // ── 인메모리 셀 맵 ──────────────────────────────────────────────────
  var docSchedule = {};   // { 'personId|y|m|d': cell }

  function _emptyCell(){
    return { erCall:'', block:false, consult:false, endo:false, status:'근무', memo:'' };
  }
  // 의미있는 입력이 하나라도 있는가 (status '근무'·기본값만이면 빈 칸 취급)
  function _cellEmpty(c){
    if(!c) return true;
    if(c.erCall)  return false;
    if(c.block)   return false;
    if(c.consult) return false;
    if(c.endo)    return false;
    if(c.memo)    return false;
    if(c.status && c.status!=='근무') return false;   // '휴진'은 의미 있음
    return true;
  }
  function _norm(c){
    c = c || {};
    var er = (c.erCall==='D'||c.erCall==='N') ? c.erCall : '';
    var st = (c.status==='휴진') ? '휴진' : '근무';
    return {
      erCall : er,
      block  : !!c.block,
      consult: !!c.consult,
      endo   : !!c.endo,
      status : st,
      memo   : (c.memo!=null) ? String(c.memo) : ''
    };
  }

  var DocScheduleStore = {
    cellKey: cellKey,
    setAll: function(map){ docSchedule = map || {}; },
    all: function(){ return docSchedule; },

    // 한 칸 조회 → 정규화된 셀 (없으면 빈 칸)
    get: function(personId, y, m, d){
      var c = docSchedule[cellKey(y,m,personId,d)];
      return c ? _norm(c) : _emptyCell();
    },
    // 한 칸 통째 설정
    set: function(personId, y, m, d, cell){
      var k = cellKey(y,m,personId,d);
      var norm = _norm(cell);
      if(_cellEmpty(norm)) delete docSchedule[k];
      else docSchedule[k] = norm;
    },
    // 한 속성만 토글/설정 (기존 셀 보존)
    setAttr: function(personId, y, m, d, attr, val){
      var k = cellKey(y,m,personId,d);
      var cur = docSchedule[k] ? _norm(docSchedule[k]) : _emptyCell();
      cur[attr] = val;
      var norm = _norm(cur);
      if(_cellEmpty(norm)) delete docSchedule[k];
      else docSchedule[k] = norm;
    },
    del: function(personId, y, m, d){ delete docSchedule[cellKey(y,m,personId,d)]; },

    // 그 달의 모든 칸 {fullKey: cell}
    monthCells: function(y, m){
      var pre = '|'+y+'|'+m+'|', out = {};
      Object.keys(docSchedule).forEach(function(k){ if(k.indexOf(pre)>0) out[k]=docSchedule[k]; });
      return out;
    },
    // 사람 1명 전 셀 삭제 (인력 제거 시)
    removePerson: function(personId){
      Object.keys(docSchedule).forEach(function(k){
        if(k.indexOf(personId+'|')===0) delete docSchedule[k];
      });
    }
  };

  // ── LocalRepository (단일 저장 창구, 외래·듀티와 동일 패턴) ─────────
  var STORE_BASE = 'doc_sched';
  function _set(key, val){
    try{ localStorage.setItem(key, val); return localStorage.getItem(key)===val ? null : new Error('verify '+key); }
    catch(e){ return e; }
  }
  var LocalRepository = {
    loadSchedule: function(){
      try{ return localStorage.getItem(docKey(STORE_BASE)); }catch(e){ return null; }
    },
    saveSchedule: function(){
      return _set(docKey(STORE_BASE), JSON.stringify(docSchedule));
    },
    storageKey: function(){ return docKey(STORE_BASE); }
  };
  var ACTIVE_REPO = LocalRepository;   // 서버 이식 시 ApiRepository로 교체

  function loadFromStore(){
    try{
      var raw = ACTIVE_REPO.loadSchedule();
      if(raw){ docSchedule = JSON.parse(raw) || {}; }
    }catch(e){ docSchedule = {}; }
    return docSchedule;
  }

  g.DocScheduleStore = DocScheduleStore;
  g.DocLocalRepository = LocalRepository;
  g.DocActiveRepo = ACTIVE_REPO;
  g.docLoadFromStore = loadFromStore;
  g.__DOCSCHEDULESTORE_LOADED__ = true;

})(window);
