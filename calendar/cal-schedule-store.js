/* ============================================================
   calendar/cal-schedule-store.js — 비교대 스케줄 셀 + 저장소 (M3a, 방식 B)
   ------------------------------------------------------------
   왜 calendar/ 안에 두는가 (shared/ 아님):
     스케줄 데이터 모양이 부서마다 다르다. 듀티=D/E/N 3교대(셀=코드 1글자),
     비교대=오전/오후 각각 근무(셀={am,pm}). 그래서 공유 불가 — 각 앱이 자기 버전.
     (듀티 schedule-store 주석이 이미 이 분기를 예고함)

   ── 데이터 구조 (확정) ──────────────────────────────────────
     키:  personId|연|월|일      (utils.cellKey 재사용. nid 자리에 personId)
          ★ M2 결정: 스케줄 키 = personId 직접. 부서 이동은 멤버십(Layer2) 변경.
          ★ 월(month)은 0-based (utils 규약). 듀티와 동일.
     값:  { am: {code, memo}, pm: {code, memo} }
          code = 시프트 코드(cal-shifts.js의 7종 중 하나) | ''(없음)
          memo = 자유 텍스트("내시경","투석" 등) | ''
          오전·오후 독립 — 어떤 코드든 양쪽에 자유 배치 가능.
     빈 셀: 키 자체를 두지 않음(공간 절약). am/pm 둘 다 비면 키 삭제.

   저장: localStorage 'cal_sched_outpatient' (WARD_ID 접두). 듀티 dv6_* 와 완전 격리.

   ★ 서버 전환 지점: ACTIVE_REPO 한 줄 교체로 ApiRepository 전환(듀티와 동일 패턴).
   ============================================================ */
(function (g) {
  'use strict';

  // 외부 의존: cellKey(utils), WARD_ID(페이지에서 'outpatient' 선언)
  var cellKey = g.cellKey;                          // nid|y|m|d
  function calKey(base){ return base + '_' + (g.WARD_ID || 'outpatient'); }

  // ── 인메모리 셀 맵 ────────────────────────────────────────────────────
  //   { 'personId|y|m|d': {am:{code,memo}, pm:{code,memo}} }
  var calSchedule = {};

  // 한 칸이 비었는지 (am/pm 둘 다 code·memo 없음. group은 분류일 뿐이라 내용으로 안 침)
  function _slotEmpty(s){ return !s || ((!s.code) && (!s.memo)); }
  function _cellEmpty(c){ return !c || (_slotEmpty(c.am) && _slotEmpty(c.pm)); }
  function _normSlot(s){
    var o = { code: (s && s.code) ? String(s.code) : '',
              memo: (s && s.memo) ? String(s.memo) : '' };
    if(s && s.fixed) o.fixed = true;   // 요일고정 자동입력 표시 (수동입력과 구분)
    if(s && s.auto)  o.auto  = true;   // 자동배치 입력 표시 (재실행 시 갱신 대상)
    return o;
  }
  // 셀에 group(주사실·내과·외과 등 하위 구분) 보존. 빈 문자열이 기본.
  function _normGroup(g2){ return (g2!=null) ? String(g2) : ''; }
  function _emptyCell(){ return {am:{code:'',memo:''}, pm:{code:'',memo:''}, group:''}; }

  var CalScheduleStore = {
    cellKey: cellKey,
    // 전체 맵 교체 (로드·임포트·복원)
    setAll: function(map){ calSchedule = map || {}; },
    all: function(){ return calSchedule; },

    // 한 칸 조회 → {am, pm, group} (없으면 빈 칸 반환)
    get: function(personId, y, m, d){
      return calSchedule[cellKey(y,m,personId,d)] || _emptyCell();
    },
    // 한 슬롯(am 또는 pm)만 설정 (group 보존)
    setSlot: function(personId, y, m, d, slot /* 'am'|'pm' */, val){
      var k = cellKey(y,m,personId,d);
      var cur = calSchedule[k] || _emptyCell();
      cur[slot] = _normSlot(val);
      cur.group = _normGroup(cur.group);
      if(_cellEmpty(cur)) delete calSchedule[k];   // 근무 둘 다 비면 키 제거(group만으론 안 남김)
      else calSchedule[k] = cur;
    },
    // 한 칸 통째 설정 ({am, pm, group})
    set: function(personId, y, m, d, cell){
      var k = cellKey(y,m,personId,d);
      var norm = { am:_normSlot(cell&&cell.am), pm:_normSlot(cell&&cell.pm),
                   group:_normGroup(cell&&cell.group) };
      if(_cellEmpty(norm)) delete calSchedule[k];
      else calSchedule[k] = norm;
    },
    // 그 사람·그 날의 group 만 설정 (근무가 이미 있을 때 분류 지정)
    setGroup: function(personId, y, m, d, group){
      var k = cellKey(y,m,personId,d);
      var cur = calSchedule[k];
      if(!cur) return;                 // 근무 없는 칸엔 group 단독 저장 안 함
      cur.group = _normGroup(group);
      calSchedule[k] = cur;
    },
    del: function(personId, y, m, d){ delete calSchedule[cellKey(y,m,personId,d)]; },

    // 그 달의 모든 칸 {fullKey: cell} — 달력 렌더가 사용
    monthCells: function(y, m){
      var pre = '|'+y+'|'+m+'|', out = {};
      Object.keys(calSchedule).forEach(function(k){ if(k.indexOf(pre)>0) out[k]=calSchedule[k]; });
      return out;
    },
    // 그 날 근무자(코드·메모 있는 사람) personId 목록 — 의사표형 칸 렌더용
    dayPeople: function(y, m, d){
      var suf = '|'+y+'|'+m+'|'+d, out = [];
      Object.keys(calSchedule).forEach(function(k){
        if(k.slice(-suf.length) === suf){
          out.push(k.slice(0, k.length - suf.length));   // personId
        }
      });
      return out;
    },
    // 사람 1명 전 셀 삭제 (인력 제거 시)
    removePerson: function(personId){
      Object.keys(calSchedule).forEach(function(k){
        if(k.indexOf(personId+'|')===0) delete calSchedule[k];
      });
    }
  };

  // ── LocalRepository (단일 저장 창구, 듀티와 동일 패턴) ─────────────────
  var STORE_BASE = 'cal_sched';
  function _set(key, val){
    try{ localStorage.setItem(key, val); return localStorage.getItem(key)===val ? null : new Error('verify '+key); }
    catch(e){ return e; }
  }
  var LocalRepository = {
    // 저장된 스케줄 JSON 문자열 로드 (없으면 null)
    loadSchedule: function(){
      try{ return localStorage.getItem(calKey(STORE_BASE)); }catch(e){ return null; }
    },
    // 스케줄 저장 (write-then-verify). 성공=null, 실패=Error
    saveSchedule: function(){
      return _set(calKey(STORE_BASE), JSON.stringify(calSchedule));
    },
    storageKey: function(){ return calKey(STORE_BASE); }
  };
  var ACTIVE_REPO = LocalRepository;     // 서버 이식 시 ApiRepository로 교체

  // 시작 시 저장분 로드 (있으면)
  function loadFromStore(){
    try{
      var raw = ACTIVE_REPO.loadSchedule();
      if(raw){ calSchedule = JSON.parse(raw) || {}; }
    }catch(e){ calSchedule = {}; }
    return calSchedule;
  }

  // ── 전역 등록 ─────────────────────────────────────────────────────────
  g.CalScheduleStore = CalScheduleStore;
  g.CalLocalRepository = LocalRepository;
  g.CalActiveRepo = ACTIVE_REPO;
  g.calLoadFromStore = loadFromStore;
  g.__CALSCHEDULESTORE_LOADED__ = true;

})(window);
