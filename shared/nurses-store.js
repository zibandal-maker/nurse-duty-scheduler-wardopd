/* ============================================================
   shared/nurses-store.js — 사람(간호사) 정보 (모듈 분리 6단계, 방식 B)
   ------------------------------------------------------------
   왜 shared/ 에 두는가:
     사람 정보(이름·직급·색·속성)는 부서가 달라도 "같은 사람"이다.
     같은 김간호사가 듀티 부서에도, 비교대 부서에도 있을 수 있다.
     → 두 앱이 공유할 핵심 자산. (스케줄과 반대 — 스케줄은 부서마다 모양이 달라 duty/에 둠)

   담긴 것:
     - 조회 헬퍼: getNurse, getNurseIndex, getHeadNurse, isSenior(본체 잔류)
     - 기본값: defaultAttributes, defaultPrefs
     - migrateNurse: 옛 데이터를 최신 형식으로 + personId(부서 무관 식별자) 발급
     - NurseStore: 추가/삭제/목록
     - normalizeAttributes: 속성 충돌 정리(임산부·야간전담 등)

   ★ M1b 메모: persons 풀 분리의 본체가 여기다.
     "한 사람(personId)을 여러 부서가 공유" 구조를 이 모듈 위에 얹는다.
     스케줄 키(nurse.id)는 안 건드림 — 이미 확정.

   방식 B: 일반 <script src>로 읽히고, 객체/함수를 전역(window)에 올린다.
           nurses/nextId/nextPersonId/WARD_ID 와 ScheduleStore/LockStore 는 window에서 살아있음.
   원본: duty/index.html v3.17.1 에서 그대로 이동 — 동작 불변.
   ============================================================ */
(function (g) {
  'use strict';
  // 외부(window) 의존: nurses, nextId, nextPersonId, WARD_ID,
  //                    ScheduleStore, LockStore (모두 window 전역)

// ── 조회 헬퍼 + 기본값 + migrateNurse + NurseStore ───────────────────
function getNurse(id, ctx){
  // 4단계: 선택적 ctx — 있으면 ctx.nurses, 없으면 전역(기존 호출부 무변경)
  var arr = (ctx && ctx.nurses) ? ctx.nurses : nurses;
  if(id===null || id===undefined) return null;
  for(var i=0;i<arr.length;i++){ if(arr[i].id===id) return arr[i]; }
  return null;
}
function getNurseIndex(id){
  for(var i=0;i<nurses.length;i++){ if(nurses[i].id===id) return i; }
  return -1;
}
function getHeadNurse(ctx){
  var arr = (ctx && ctx.nurses) ? ctx.nurses : nurses;
  for(var i=0;i<arr.length;i++){ if(arr[i].role==='수간호사') return arr[i]; }
  return null;
}

// ── 2단계: 속성 기본값 · 마이그레이션 일원화 ──────────────────────────
//   기존엔 addNurse와 loadLocal 두 곳에 기본값이 따로 있어, 새 속성 추가 시
//   양쪽을 다 고쳐야 했다(skillLevel 추가 때 실제로 그랬음). 이제 한 곳만 수정.
function defaultAttributes(){
  return {
    pregnant:false,        // 임산부 — 야간 금지, 동시 배치 회피
    nightDedicated:false,  // 야간전담 — 야간만 배치
    nightExempt:false,     // 야간 면제 (건강상 사유 등)
    weekdayOnly:false,     // v3.16.41: 상근직 — 토·일·공휴일 근무 제외 (주중만)
    fixedShift:null,       // 고정 근무 'D'|'E'|'N'|null (사이클 근무자)
    floating:false,        // v3.16.31: 플로팅(유연 인력) — 어느 시프트든 가능, 막힌 슬롯 우선 투입, 일부 소프트제약 면제
    repeatPattern:null,    // v3.15: 반복 근무 패턴 {seq:['N','N','N','O','O'], anchor:1} | null
    preceptorOf:[],        // 이 간호사가 멘토하는 프리셉티 ID 배열
    targetOffOverride:null,// off 정량 수동조정 (null=자동, 숫자=덮어쓰기)
    skillLevel:2           // 숙련도(업무강도) 1=저·2=중·3=고 (데이터만, UX 미구현)
  };
}
function defaultPrefs(){
  return { shift:{D:0,E:0,N:0}, monthlyMax:{D:null,E:null,N:null}, avoidWith:[], preferWith:[] };
}
// 간호사 1명의 누락 필드를 기본값으로 보강 (로드 시 호출)
function migrateNurse(n){
  // v3.17.1: personId 자동 보강 — 기존 데이터는 personId가 없으니, 로드 시 발급.
  //   nextPersonId가 발급될 ID와 충돌하지 않게 max+1로 후속 카운터도 맞춤.
  if(!n.personId){
    n.personId = 'p_'+String(nextPersonId++).padStart(4,'0');
  } else {
    // 기존 personId가 있으면 nextPersonId가 그보다 큰지 확인 (import·복원 대비)
    var m = /^p_(\d+)$/.exec(n.personId);
    if(m){ var num=parseInt(m[1],10); if(num>=nextPersonId) nextPersonId=num+1; }
  }
  if(n.joinDate===undefined) n.joinDate='';
  if(!n.birthday) n.birthday='';
  if(!n.memo) n.memo='';
  if(!n.photo) n.photo='';
  // 선호도
  if(!n.prefs) n.prefs=defaultPrefs();
  if(!n.prefs.shift) n.prefs.shift={D:0,E:0,N:0};
  // v3.16.40: 개인별 월 최대 D/E/N 상한 (null=무제한). 선호도(±1)를 대체하는 주력 제약.
  // v3.16.42: 로드/import 시 값 정규화 — 잘못된 값(음수·문자·31초과)이 조용히 무제한 처리되지 않게 방어.
  if(!n.prefs.monthlyMax || typeof n.prefs.monthlyMax!=='object') n.prefs.monthlyMax={D:null,E:null,N:null};
  ['D','E','N'].forEach(function(sh){
    var v=n.prefs.monthlyMax[sh];
    if(v===null||v===undefined||v===''){ n.prefs.monthlyMax[sh]=null; return; }
    var num=parseInt(v,10);
    n.prefs.monthlyMax[sh] = isNaN(num) ? null : Math.max(0, Math.min(31, num));
  });
  if(!n.prefs.avoidWith) n.prefs.avoidWith=[];
  if(!n.prefs.preferWith) n.prefs.preferWith=[];
  // 속성: 누락 키를 기본값으로 보강
  if(!n.attributes) n.attributes=defaultAttributes();
  var d=defaultAttributes();
  for(var k in d){ if(n.attributes[k]===undefined) n.attributes[k]=d[k]; }
  if(!Array.isArray(n.attributes.preceptorOf)) n.attributes.preceptorOf=[];
  // 이월 잔고
  if(!n.carryOver) n.carryOver={offBalance:0};
  if(typeof n.carryOver.offBalance!=='number') n.carryOver.offBalance=0;
  // v3.16.19: 저장·import 데이터에 이미 모순 속성이 있으면 로드 시 자동 정리
  if(typeof normalizeAttributes==='function') normalizeAttributes(n);
  return n;
}

// ── 3단계: CRUD 네임스페이스 (NurseStore) ─────────────────────────────
//   추가/수정/삭제/조회를 한 객체로 묶음. 서버 이식 시 각 메서드 내부만
//   fetch 호출로 교체하면 호출부는 그대로 유지됨(인터페이스 안정).
//   현재는 로컬 nurses 배열 + saveLocal()을 그대로 사용.
var NurseStore = {
  all: function(){ return nurses; },
  get: function(id){ return getNurse(id); },
  index: function(id){ return getNurseIndex(id); },
  head: function(){ return getHeadNurse(); },
  // 신규 추가. fields={name,role,joinDate,vacTotal,color}
  add: function(fields){
    // 방어(6단계): nextId/nextPersonId 가 기존 데이터보다 작으면(불일치 데이터·비정상 경로)
    //   기존 최대값 +1 로 끌어올린다 → 어떤 상황에서도 ID 중복 원천 차단.
    var maxId = nurses.reduce(function(m,x){ return Math.max(m, x.id||0); }, 0);
    if(nextId <= maxId) nextId = maxId + 1;
    var maxPid = nurses.reduce(function(m,x){
      var v = x.personId ? parseInt(String(x.personId).replace('p_',''),10) : 0;
      return Math.max(m, isNaN(v)?0:v);
    }, 0);
    if(nextPersonId <= maxPid) nextPersonId = maxPid + 1;

    var maxOrd=nurses.reduce(function(m,n){return Math.max(m,typeof n.manualOrder==='number'?n.manualOrder:-1);},-1);
    var n={
      id: nextId++,
      personId: 'p_'+String(nextPersonId++).padStart(4,'0'),  // v3.17.1: 부서 무관 사람 식별자
      name: fields.name,
      role: fields.role,
      joinDate: fields.joinDate||'',
      birthday:'', memo:'', photo:'',
      vacTotal: (typeof fields.vacTotal==='number'?fields.vacTotal:15),
      color: fields.color,
      prefs: defaultPrefs(),
      attributes: defaultAttributes(),
      carryOver: {offBalance:0},
      manualOrder: maxOrd+1
    };
    nurses.push(n);
    return n;
  },
  // 삭제: 간호사 + 관련 듀티·락 정리
  remove: function(id){
    nurses = nurses.filter(function(n){return n.id!==id;});
    ScheduleStore.removeNurse(WARD_ID, id);
    LockStore.removeNurse(WARD_ID, id);
  }
};

// ── 속성 정규화 ───────────────────────────────────────────────────
function normalizeAttributes(n, changed){
  if(!n || !n.attributes) return;
  var a = n.attributes;
  if(!n.prefs) n.prefs = {shift:{D:0,E:0,N:0},avoidWith:[],preferWith:[]};
  if(!n.prefs.shift) n.prefs.shift = {D:0,E:0,N:0};
  var pr = n.prefs.shift;

  function clearNight(){            // 야간 금지자 처리 (임산부·면제)
    a.nightDedicated = false;
    if(a.fixedShift==='N') a.fixedShift = null;
    if(pr.N===1) pr.N = 0;         // 나이트 선호 → 중립
  }
  function makeNightOnly(){         // 야간전담 처리
    a.pregnant = false;
    a.nightExempt = false;
    a.fixedShift = 'N';            // 야간만이니 고정도 N
    if(pr.D===1) pr.D = 0;         // D/E 선호 → 중립
    if(pr.E===1) pr.E = 0;
  }

  // 방금 바꾼 항목을 우선 존중
  if(changed==='nightDedicated' && a.nightDedicated){ makeNightOnly(); return; }
  if(changed==='pregnant' && a.pregnant){ clearNight(); return; }
  if(changed==='nightExempt' && a.nightExempt){ clearNight(); return; }

  // changed가 fixedShift/pref이거나 끄는 동작일 때 — 현재 상태 기준으로 충돌만 정리
  if(a.nightDedicated){            // 야간전담이 살아있으면 그게 기준
    a.pregnant = false; a.nightExempt = false;
    if(a.fixedShift && a.fixedShift!=='N') a.fixedShift = 'N';
    if(pr.D===1) pr.D=0; if(pr.E===1) pr.E=0;
  } else if(a.pregnant || a.nightExempt){   // 야간 금지자
    if(a.fixedShift==='N') a.fixedShift = null;
    if(pr.N===1) pr.N = 0;
  }
}

  // ── 전역 등록 (방식 B 핵심) ──────────────────────────────────────────
  g.getNurse = getNurse;
  g.getNurseIndex = getNurseIndex;
  g.getHeadNurse = getHeadNurse;
  g.defaultAttributes = defaultAttributes;
  g.defaultPrefs = defaultPrefs;
  g.migrateNurse = migrateNurse;
  g.NurseStore = NurseStore;
  g.normalizeAttributes = normalizeAttributes;
  g.__NURSESSTORE_LOADED__ = true;

})(window);
