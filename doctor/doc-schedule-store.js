/* ============================================================
   doctor/doc-schedule-store.js — 의사과 스케줄 셀 + 저장소 (M6)
   ------------------------------------------------------------
   왜 doctor/ 안에 두는가 (shared/ 아님):
     셀 데이터 모양이 부서 계열마다 다르다.
       듀티 = D/E/N 1글자 / 외래 = {am,pm} 근무코드 / 의사 = 오전·오후 각 6속성.
     공유 불가 — 각 계열이 자기 store를 가진다.

   ── 셀 구조 (오전/오후 2슬롯, 각 슬롯 독립 6속성) ─────────────
     키:  personId|연|월|일   (utils.cellKey 재사용. month 0-based)
     값:  { am:<slot>, pm:<slot> }
     slot = {
       erCall : 'D'|'N'|'',   // 응급실 콜 (D=주간콜, N=야간콜)
       block  : bool,          // (X) 콜·협진 금지
       consult: bool,          // 협진당직 — 노랑
       endo   : bool,          // 내시경 — 파랑
       status : '근무'|'휴진',  // 휴진 = 주황 흐림
       memo   : ''             // 자유텍스트(투석 등)
     }
     ★ 원본 엑셀이 "의사 × (오전열·오후열)" 구조 → 오전/오후 분리가 핵심.
       외래 근무표처럼 칸을 오전/오후로 나누고 각각 6속성을 채운다.
     빈 슬롯: 의미있는 입력 없으면 비움. 양 슬롯 다 비면 키 자체 제거.

   ── 구버전 호환 ──────────────────────────────────────────────
     v1(하루 단일 6속성: {erCall,block,...})로 저장된 데이터는 로드 시
     자동 마이그레이션: 그 값을 am 슬롯으로 옮긴다(pm 빈 칸).

   저장: localStorage 'doc_sched_<deptId>'. 외래/듀티와 완전 격리.
   ============================================================ */
(function (g) {
  'use strict';

  var cellKey = g.cellKey;
  function docKey(base){ return base + '_' + (g.DOC_DEPT_ID || 'doctor'); }

  var docSchedule = {};   // { 'personId|y|m|d': {am, pm} }

  function _emptySlot(){
    return { erCall:'', block:false, consult:false, endo:false, status:'근무', memo:'' };
  }
  function _slotEmpty(s){
    if(!s) return true;
    if(s.erCall) return false;
    if(s.block) return false;
    if(s.consult) return false;
    if(s.endo) return false;
    if(s.memo) return false;
    if(s.status && s.status!=='근무') return false;
    return true;
  }
  function _normSlot(s){
    s = s || {};
    var er = (s.erCall==='D'||s.erCall==='N') ? s.erCall : '';
    var st = (s.status==='휴진') ? '휴진' : '근무';
    return {
      erCall:er, block:!!s.block, consult:!!s.consult,
      endo:!!s.endo, status:st, memo:(s.memo!=null)?String(s.memo):'',
      fixed:!!s.fixed   // 요일고정으로 채워진 슬롯 표시 (재배치 시 구분)
    };
  }
  // 셀 정규화. 구버전(하루 단일 6속성)이면 am으로 이주.
  function _normCell(c){
    c = c || {};
    if(c.am!==undefined || c.pm!==undefined){
      return { am:_normSlot(c.am), pm:_normSlot(c.pm) };
    }
    // 구버전: {erCall,block,...} → am 슬롯
    return { am:_normSlot(c), pm:_emptySlot() };
  }
  function _cellEmpty(c){ return _slotEmpty(c.am) && _slotEmpty(c.pm); }
  function _emptyCell(){ return { am:_emptySlot(), pm:_emptySlot() }; }

  var DocScheduleStore = {
    cellKey: cellKey,
    setAll: function(map){ docSchedule = map || {}; },
    all: function(){ return docSchedule; },

    // 셀 전체 조회 → {am, pm} (없으면 빈 셀)
    get: function(personId, y, m, d){
      var c = docSchedule[cellKey(y,m,personId,d)];
      return c ? _normCell(c) : _emptyCell();
    },
    // 한 슬롯(am|pm) 조회
    getSlot: function(personId, y, m, d, slot){
      var c = this.get(personId,y,m,d);
      return (slot==='pm') ? c.pm : c.am;
    },
    // 한 슬롯 통째 설정
    setSlot: function(personId, y, m, d, slot, slotData){
      var k = cellKey(y,m,personId,d);
      var cur = docSchedule[k] ? _normCell(docSchedule[k]) : _emptyCell();
      if(slot==='pm') cur.pm = _normSlot(slotData);
      else cur.am = _normSlot(slotData);
      if(_cellEmpty(cur)) delete docSchedule[k];
      else docSchedule[k] = cur;
    },
    // 셀 전체 설정 ({am,pm} 또는 구버전 단일)
    set: function(personId, y, m, d, cell){
      var k = cellKey(y,m,personId,d);
      var norm = _normCell(cell);
      if(_cellEmpty(norm)) delete docSchedule[k];
      else docSchedule[k] = norm;
    },
    del: function(personId, y, m, d){ delete docSchedule[cellKey(y,m,personId,d)]; },

    monthCells: function(y, m){
      var pre = '|'+y+'|'+m+'|', out = {};
      Object.keys(docSchedule).forEach(function(k){ if(k.indexOf(pre)>0) out[k]=docSchedule[k]; });
      return out;
    },
    removePerson: function(personId){
      Object.keys(docSchedule).forEach(function(k){
        if(k.indexOf(personId+'|')===0) delete docSchedule[k];
      });
    },
    // 슬롯이 비었는지 (렌더용)
    slotEmpty: function(s){ return _slotEmpty(s); }
  };

  var STORE_BASE = 'doc_sched';
  function _set(key, val){
    try{ localStorage.setItem(key, val); return localStorage.getItem(key)===val ? null : new Error('verify '+key); }
    catch(e){ return e; }
  }
  var LocalRepository = {
    loadSchedule: function(){ try{ return localStorage.getItem(docKey(STORE_BASE)); }catch(e){ return null; } },
    saveSchedule: function(){ return _set(docKey(STORE_BASE), JSON.stringify(docSchedule)); },
    storageKey: function(){ return docKey(STORE_BASE); }
  };
  var ACTIVE_REPO = LocalRepository;

  function loadFromStore(){
    try{
      var raw = ACTIVE_REPO.loadSchedule();
      if(raw){
        var parsed = JSON.parse(raw) || {};
        // 로드 시 전체 정규화 (구버전 단일 셀 → {am,pm} 이주)
        var migrated = {};
        Object.keys(parsed).forEach(function(k){ migrated[k] = _normCell(parsed[k]); });
        docSchedule = migrated;
      }
    }catch(e){ docSchedule = {}; }
    return docSchedule;
  }

  g.DocScheduleStore = DocScheduleStore;
  g.DocLocalRepository = LocalRepository;
  g.DocActiveRepo = ACTIVE_REPO;
  g.docLoadFromStore = loadFromStore;
  g.__DOCSCHEDULESTORE_LOADED__ = true;

})(window);
