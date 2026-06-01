/* ============================================================
   duty/schedule-store.js — 스케줄 셀 + 락(원티드) + 저장소 (모듈 분리 5단계, 방식 B)
   ------------------------------------------------------------
   왜 duty/ 안에 두는가 (shared/ 아님):
     스케줄 데이터 모양이 부서마다 다르다. 듀티=D/E/N 3교대, 비교대={am,pm} 반차.
     그래서 공유 불가 — 각 앱이 자기 버전을 갖는 게 맞다. (핸드오프 §3)

   담긴 것:
     1) ScheduleStore — "누가 언제 무슨 근무" 셀을 읽고/쓰고/지움
     2) LockStore     — 원티드 고정(자동배치가 못 건드리는 칸) 관리
     3) LocalRepository + ACTIVE_REPO — 저장의 단일 창구

   ★ 서버 전환 지점 (당신이 걱정한 "나중에 안 뜯어고치기"):
     - 서버로 갈 때 = ApiRepository(fetch 버전)를 새로 만들고
       맨 아래 ACTIVE_REPO = ApiRepository 한 줄만 바꾸면 됨. 본체 호출부 불변.
     - 키 규칙은 ward-context.wardKey 가 단일 진실원 — 여기선 위임만.
     - loadWard/saveWard/listWards 가 이미 서버 DB(행 단위)와 1:1 매핑.

   방식 B: 일반 <script src>로 읽히고, 객체들을 전역(window)에 올린다.
           schedule/lockedCells/WARD_ID/wardKey/cellKey 는 모두 window에서 살아있음.
   원본: duty/index.html v3.17.1 에서 그대로 이동 — 동작 불변, 락 구조 불변.
   ============================================================ */
(function (g) {
  'use strict';
  // 외부(window) 의존: cellKey, WARD_ID, schedule, lockedCells, wardKey, localStorage
  var cellKey = g.cellKey;

// ── 1) ScheduleStore + 2) LockStore ──────────────────────────────────
const ScheduleStore = {
  _others: {},                                        // { wardId: { 'nid|y|m|d': code } } (현재 병동 제외)
  cellKey: cellKey,
  ward: function(wardId){                             // 현재 병동은 라이브 전역, 그 외는 버킷
    return (wardId==null || wardId===WARD_ID) ? schedule
         : (this._others[wardId] || (this._others[wardId]={}));
  },
  setWard: function(wardId, map){                     // 버킷 교체(로드/임포트/복원/대시보드 적재)
    if(wardId==null || wardId===WARD_ID) schedule = map || {};
    else this._others[wardId] = map || {};
  },
  get: function(wardId,y,m,nid,d){ return this.ward(wardId)[cellKey(y,m,nid,d)] || ''; },
  set: function(wardId,y,m,nid,d,code){
    var w=this.ward(wardId), k=cellKey(y,m,nid,d);
    if(code==null || code==='') delete w[k]; else w[k]=code;
  },
  del: function(wardId,y,m,nid,d){ delete this.ward(wardId)[cellKey(y,m,nid,d)]; },
  monthCells: function(wardId,y,m){                   // 해당 병동·달 셀만 {fullKey:code}
    var w=this.ward(wardId), pre='|'+y+'|'+m+'|', out={};
    Object.keys(w).forEach(function(k){ if(k.indexOf(pre)>0) out[k]=w[k]; });
    return out;
  },
  removeNurse: function(wardId,nid){                  // 간호사 전 셀 삭제(전 달)
    var w=this.ward(wardId);
    Object.keys(w).forEach(function(k){ if(k.indexOf(nid+'|')===0) delete w[k]; });
  }
};

const LockStore = {                                   // 락은 셀과 운명공동체 — 동일 키체계(스펙 2.5)
  _others: {},
  cellKey: cellKey,
  ward: function(wardId){
    return (wardId==null || wardId===WARD_ID) ? lockedCells
         : (this._others[wardId] || (this._others[wardId]={}));
  },
  setWard: function(wardId, map){
    if(wardId==null || wardId===WARD_ID) lockedCells = map || {};
    else this._others[wardId] = map || {};
  },
  get: function(wardId,y,m,nid,d){ return this.ward(wardId)[cellKey(y,m,nid,d)]; },
  set: function(wardId,y,m,nid,d,meta){ this.ward(wardId)[cellKey(y,m,nid,d)] = meta; },
  del: function(wardId,y,m,nid,d){ delete this.ward(wardId)[cellKey(y,m,nid,d)]; },
  removeNurse: function(wardId,nid){
    var w=this.ward(wardId);
    Object.keys(w).forEach(function(k){ if(k.indexOf(nid+'|')===0) delete w[k]; });
  }
};

// ── 3) LocalRepository + ACTIVE_REPO + _safeSet ──────────────────────
var LocalRepository = (function(){
  // 키 규칙은 ward-context.wardKey 가 단일 진실원 — 여기선 위임만 (중복 제거, 모듈 분리 5단계).
  function K(base, wardId){ return wardKey(base, wardId); }
  var BUNDLE = ['dv6_n','dv6_i','dv6_s','dv6_evts','dv6_evtId','dv6_rules','dv6_locks'];
  function _set(key,val){                              // write-then-read 검증 (구 _safeSet)
    try{ localStorage.setItem(key,val); return localStorage.getItem(key)===val ? null : new Error('verify mismatch on '+key); }
    catch(e){ return e; }
  }
  return {
    // 병동 데이터 묶음 로드 (없는 키는 undefined)
    loadWard: function(wardId){
      function g(b){ return localStorage.getItem(K(b,wardId)); }
      return {
        nurses:    g('dv6_n'),     nextId:   g('dv6_i'),
        schedule:  g('dv6_s'),     events:   g('dv6_evts'),
        nextEvtId: g('dv6_evtId'), rules:    g('dv6_rules'),
        locks:     g('dv6_locks')
      }; // 값은 raw 문자열(JSON) — 호출부가 파싱(인메모리 형태 결정권 유지)
    },
    // 병동 데이터 묶음 저장. data는 이미 직렬화된 문자열 맵. 첫 에러 반환(null=성공).
    saveWard: function(wardId, data){
      var firstErr=null;
      var map={ dv6_n:data.nurses, dv6_i:data.nextId, dv6_s:data.schedule,
                dv6_evts:data.events, dv6_evtId:data.nextEvtId,
                dv6_rules:data.rules, dv6_locks:data.locks };
      Object.keys(map).forEach(function(b){
        if(map[b]===undefined) return;
        var e=_set(K(b,wardId), map[b]); if(e && !firstErr) firstErr=e;
      });
      return firstErr;
    },
    // 저장된 병동 목록 (localStorage 키 스캔). 서버에선 SELECT id FROM ward.
    listWards: function(){
      var ids={'default':true};
      for(var i=0;i<localStorage.length;i++){
        var k=localStorage.key(i), m=k && k.match(/^dv6_n_(.+)$/);
        if(m) ids[m[1]]=true;
      }
      return Object.keys(ids).map(function(id){ return {id:id}; });
    }
  };
})();
var ACTIVE_REPO = LocalRepository;                      // 서버 이식 시 ApiRepository로 교체

function _safeSet(key, value){                          // 하위호환 별칭 (외부 잔존 호출 대비)
  try{ localStorage.setItem(key, value);
    if(localStorage.getItem(key)!==value) throw new Error('verify mismatch on '+key);
    return null;
  }catch(e){ return e; }
}

  // ── 전역 등록 (방식 B 핵심) ──────────────────────────────────────────
  g.ScheduleStore = ScheduleStore;
  g.LockStore = LockStore;
  g.LocalRepository = LocalRepository;
  g.ACTIVE_REPO = ACTIVE_REPO;
  g._safeSet = _safeSet;
  g.__SCHEDULESTORE_LOADED__ = true;

})(window);
