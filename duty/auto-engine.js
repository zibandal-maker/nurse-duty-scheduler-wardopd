/* ============================================================
   duty/auto-engine.js — 자동배치 엔진 (모듈 분리 7단계, 방식 B)
   ------------------------------------------------------------
   하는 일: 듀티 자동배치의 두 알고리즘을 담는다.
     - 그리디(MultiStart): 여러 번 빠르게 시도해 가장 나은 답 (시드 무작위)
     - 백트래킹: 한 수씩 신중히 채우는 결정적 엔진 (항상 같은 답)
   autoFill() 하나에 두 엔진이 중첩 함수로 자기완결적으로 들어있다(886줄).

   왜 떼는가 (경계 긋기):
     엔진은 듀티 전용이라 공유(shared/)는 아니다. 하지만 본체 8천 줄 속에 파묻혀
     있으면 "어디가 두뇌인지" 안 보여 유지보수가 어렵다. 한 파일로 경계를 명확히 해
     나중에 교체·테스트·이해가 쉽도록 분리. (행정팀 등 확장 시 혼선 방지)

   ★ 절대 불변: 알고리즘·가중치·평가식. (핸드오프 §3·§5)
     검증 기준: 가상병동 20명 백트래킹 = 경고 17·미배치 0 (단 1도 어긋나면 회귀).

   방식 B: 일반 <script src>로 읽히고 autoFill 을 전역(window)에 올린다.
     본체 startAutoFill()이 autoFill()을 그대로 호출.
   외부(window) 의존: nurses, schedule, lockedCells, cy, cm, RULES (상태) +
     conflicts, fatigueScore, headSeniorBonus, isSenior, lexScore, lexCompare,
     _layerOf, offQ, getPrefs, getHeadNurse, getNurse, sorted, applyRepeatPattern,
     isLocked, isH, isWH, key, dow, ndays, render, showToast, saveLocal, staffingFor
     — 전부 본체/공유모듈이 window에 노출(함수 선언은 자동, 상태는 var/2~7단계).
   원본: duty/index.html v3.17.1 의 autoFill 을 그대로 이동 — 동작 불변.
   ============================================================ */
(function (g) {
  'use strict';

function autoFill(){
  if(editLocked){showToast('🔒 편집이 잠겨 있습니다 — 자동배치를 하려면 잠금을 해제하세요');return;}
  // v3.9.4: 즉시 진행 토스트 (대규모 인원에서 무반응으로 느껴지지 않게)
  if(nurses.length > 20) showToast('자동배치 처리 중... 잠시만요', 1500);
  var nd=ndays(cy,cm);
  var R=RULES;

  // ── v3.9.4: 자동배치 다양화 시스템 ───────────────────────────────────────
  // 매 실행마다 다른 "전략"을 무작위 선택하여 결과 다양성 확보.
  // Mulberry32 PRNG로 시드 기반 의사난수 생성 → 같은 시드로 재현 가능.
  var seedNum = (Date.now() ^ (Math.random()*0xFFFFFFFF)) >>> 0;
  function makeRng(seed){
    var s = seed >>> 0;
    return function(){
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 전략 카탈로그 — 30가지. 각 전략은 회전/정렬/가중치 조정자 조합
  var STRATEGIES = [
    // 회전 오프셋 다양화 (10개)
    {rotSr: 0,  rotPl: 0,  shiftBias:{D:1,E:1,N:1}, label:'기본'},
    {rotSr: 1,  rotPl: 2,  shiftBias:{D:1,E:1,N:1}, label:'회전 +1/+2'},
    {rotSr: 2,  rotPl: 4,  shiftBias:{D:1,E:1,N:1}, label:'회전 +2/+4'},
    {rotSr: 3,  rotPl: 1,  shiftBias:{D:1,E:1,N:1}, label:'회전 +3/+1'},
    {rotSr: 5,  rotPl: 3,  shiftBias:{D:1,E:1,N:1}, label:'회전 +5/+3'},
    {rotSr: 7,  rotPl: 5,  shiftBias:{D:1,E:1,N:1}, label:'회전 +7/+5'},
    {rotSr: 11, rotPl: 7,  shiftBias:{D:1,E:1,N:1}, label:'회전 +11/+7'},
    {rotSr: 13, rotPl: 17, shiftBias:{D:1,E:1,N:1}, label:'회전 소수쌍'},
    {rotSr:-1,  rotPl:-2,  shiftBias:{D:1,E:1,N:1}, label:'역회전'},
    {rotSr:-3,  rotPl: 5,  shiftBias:{D:1,E:1,N:1}, label:'혼합 회전'},
    // 시프트 분배 편향 (10개)
    {rotSr: 0,  rotPl: 0,  shiftBias:{D:1.2,E:1.0,N:0.85}, label:'Day 선호'},
    {rotSr: 0,  rotPl: 0,  shiftBias:{D:0.85,E:1.2,N:1.0}, label:'Eve 선호'},
    {rotSr: 0,  rotPl: 0,  shiftBias:{D:1.0,E:0.85,N:1.2}, label:'Night 선호'},
    {rotSr: 2,  rotPl: 0,  shiftBias:{D:1.15,E:0.9,N:1.0}, label:'주간 우선+회전'},
    {rotSr: 0,  rotPl: 3,  shiftBias:{D:0.9,E:1.15,N:1.0}, label:'야간 회피형'},
    {rotSr: 1,  rotPl: 4,  shiftBias:{D:1.1,E:1.1,N:0.8},  label:'Night 최소'},
    {rotSr: 5,  rotPl: 2,  shiftBias:{D:0.95,E:1.05,N:1.0},label:'균형 미세조정 A'},
    {rotSr: 3,  rotPl: 7,  shiftBias:{D:1.05,E:0.95,N:1.0},label:'균형 미세조정 B'},
    {rotSr: 11, rotPl: 13, shiftBias:{D:1.0,E:1.1,N:0.95}, label:'Eve 약간 우선'},
    {rotSr: 9,  rotPl: 11, shiftBias:{D:1.05,E:1.0,N:0.95},label:'Day 약간 우선'},
    // 형평성 가중치 조정 (10개) — equityBoost: 적게 일한 사람에게 더 큰 보정
    {rotSr: 0,  rotPl: 0,  shiftBias:{D:1,E:1,N:1}, equityBoost:0.8, label:'느슨한 형평'},
    {rotSr: 0,  rotPl: 0,  shiftBias:{D:1,E:1,N:1}, equityBoost:1.3, label:'엄격한 형평'},
    {rotSr: 2,  rotPl: 5,  shiftBias:{D:1,E:1,N:1}, equityBoost:1.5, label:'매우 엄격 형평'},
    {rotSr: 4,  rotPl: 1,  shiftBias:{D:1.1,E:1,N:0.9}, equityBoost:1.2, label:'주간+형평'},
    {rotSr: 6,  rotPl: 3,  shiftBias:{D:1,E:1.1,N:0.95}, equityBoost:1.1, label:'야간최소+형평'},
    {rotSr: 8,  rotPl: 0,  shiftBias:{D:0.95,E:1.05,N:1.0}, equityBoost:0.9, label:'느슨 균형'},
    {rotSr: 12, rotPl: 8,  shiftBias:{D:1,E:1,N:1.05}, equityBoost:1.0, label:'야간 분산'},
    {rotSr: 14, rotPl: 9,  shiftBias:{D:1.05,E:1.05,N:0.9}, equityBoost:1.2, label:'주말 우선 분배'},
    {rotSr: 10, rotPl: 6,  shiftBias:{D:1,E:1,N:1}, equityBoost:1.4, label:'평등 강조'},
    {rotSr: 15, rotPl: 14, shiftBias:{D:0.95,E:1.0,N:1.05}, equityBoost:1.1, label:'야간 권장'},
  ];

  // v3.15: 반복 근무 패턴 선적용 — 패턴 간호사는 패턴대로 깔고 임시 락 처리(알고리듬이 보존).
  //   자동배치 종료 시 임시 락은 해제(원티드 락만 유지).
  var patternTempLocks = [];
  nurses.forEach(function(n){
    if(n.attributes && n.attributes.repeatPattern && n.attributes.repeatPattern.enabled){
      var keys = applyRepeatPattern(n.id);
      keys.forEach(function(k){
        if(!lockedCells[k]){ lockedCells[k]=true; patternTempLocks.push(k); }
      });
    }
  });

  // 락 셀 백업 (각 시도 전 복원용) — 락은 모든 시도에서 동일하게 보존
  // v3.16.4: '기존 배치 유지' 옵션 — 켜지면 값이 있는 모든 셀(락 아니어도)을 보존
  var lockedBackup = {};
  var lockedCount = 0;
  var preserveExisting = !!(typeof keepFilledCells!=='undefined' && keepFilledCells);
  var preservedCount = 0;
  nurses.forEach(function(n){
    for(var d=1;d<=nd;d++){
      var k = key(n.id,d);
      if(isLocked(n.id, d)){
        lockedCount++;
        var lc = schedule[k];
        if(lc!==undefined) lockedBackup[k] = lc;
      } else if(preserveExisting){
        // 락은 아니지만 이미 값이 있는 셀 → 보존 대상에 추가 (빈 셀만 자동 채움)
        var v = schedule[k];
        if(v!==undefined && v!=='' ){ lockedBackup[k] = v; preservedCount++; }
      }
    }
  });

  // ── v3.16.23: 엔진 분기 — 백트래킹(하이브리드) 선택 시 ────────────────────
  if(R.engine === 'backtrack'){
    var btOk = _runBacktrack(nd, R, lockedBackup);
    patternTempLocks.forEach(function(k){ delete lockedCells[k]; });
    if(btOk){
      var unresBt = _markUnresolvedCells(nd);
      render();
      var cfBt = conflicts();
      var lockMsgBt = lockedCount > 0 ? ' (원티드 '+lockedCount+'건 보존)' : '';
      showToast((cfBt.length?'자동배치(백트래킹) 완료'+lockMsgBt+' — '+cfBt.length+'건 경고':'자동배치(백트래킹) 완료'+lockMsgBt)
        +' · 패턴 하드 제약', 3500);
      saveLocal();
      return;
    }
    // 백트래킹 실패(타임아웃/해없음) → 그리디로 폴백 (아래 길 A 계속)
    showToast('백트래킹 시간초과 — 그리디로 전환합니다', 2500);
  }

  // ── 길 A: MultiStart best-of-N ───────────────────────────────────────────
  // 본체(_runGreedyOnce)를 여러 전략으로 N회 실행 → 사전식 점수 최저 채택.
  // 인원수에 따라 시도 횟수 조절 (대규모는 적게 — 속도 보호).
  var N_TRIES = nurses.length > 35 ? 5 : (nurses.length > 20 ? 8 : 12);
  // 시도할 전략 인덱스를 무작위로 N개 선택 (중복 없이)
  var rngPick = makeRng(seedNum);
  var stratPool = STRATEGIES.map(function(_,i){return i;});
  for(var i=stratPool.length-1;i>0;i--){ // Fisher-Yates 셔플
    var j=Math.floor(rngPick()*(i+1));
    var tmp=stratPool[i]; stratPool[i]=stratPool[j]; stratPool[j]=tmp;
  }
  var tryStrategies = stratPool.slice(0, Math.min(N_TRIES, STRATEGIES.length));

  var best = null; // {score, snapshot, stratIdx}
  tryStrategies.forEach(function(stratIdx, tryNo){
    // 각 시도: 락 외 셀 전부 비우고 그 전략으로 1회 그리디
    var snap = _runGreedyOnce(STRATEGIES[stratIdx], makeRng(seedNum + tryNo*7919), nd, R, lockedBackup);
    // 이 결과의 사전식 점수 계산 (schedule이 snap 상태일 때 conflicts 평가)
    _applySnapshot(snap, nd);
    var sc = lexScore(conflicts());
    if(best===null || lexCompare(sc, best.score) < 0){
      best = { score: sc, snapshot: snap, stratIdx: stratIdx };
    }
  });

  // 최저 점수 결과를 확정 적용
  _applySnapshot(best.snapshot, nd);
  var STRAT = STRATEGIES[best.stratIdx];

  console.log('[autoFill] seed='+seedNum+', tries='+tryStrategies.length
    +', best strategy='+best.stratIdx+' ('+STRAT.label+')'
    +', score=L'+best.score.join('/L'));

  // ── 길 A: L1 위반만 남은 셀 unresolved 표시 ──────────────────────────────
  var unresolvedCount = _markUnresolvedCells(nd);

  // v3.15: 패턴 임시 락 해제 (원티드 락은 유지). 패턴 결과 셀 자체는 남음.
  patternTempLocks.forEach(function(k){ delete lockedCells[k]; });

  render();
  var cf=conflicts();
  var lockMsg = lockedCount > 0 ? ' (원티드 '+lockedCount+'건 보존)' : '';
  var unresMsg = unresolvedCount > 0 ? ' · ⚠️미배정 '+unresolvedCount+'칸(직접 결정)' : '';
  var stratMsg = ' · 전략: ' + STRAT.label + ' (' + tryStrategies.length + '회 중 최선)';
  showToast((cf.length?'자동배치 완료'+lockMsg+' — '+cf.length+'건 경고':'자동배치 완료'+lockMsg) + unresMsg + stratMsg, 3500);
  saveLocal();
  return;

  // ════════════════════════════════════════════════════════════════════════
  // 이하: _runGreedyOnce 본체 (기존 단일 그리디 로직을 함수로 분리)
  // ════════════════════════════════════════════════════════════════════════
  // ── v3.16.24: 백트래킹/CSP 엔진 (🧪 실험) ────────────────────────────────
  //   설계: 하드 제약 = 금지패턴(켜진 것)·야간 연속/월 한도·속성(임산부·면제 N금지, 야간전담 N만,
  //         고정근무)·연속근무 한도·락 → 이것만 절대 위반 안 함(특히 패턴 0 지향).
  //   소프트 = 선임 정원·신규 보호·staffing min·off균등·프리셉터 → 최대한 맞추되 인력 부족 시 진행(경고).
  //   하루 단위 순차 채움(선임 우선 → 신규보호 → min → off균등 후처리) + 하드 제약 가지치기.
  //   폭발/멈춤 없음(실측 ~6ms). 한계: 패턴은 0이나 소프트 제약 동시최적화는 그리디만 못해
  //   총 경고는 그리디보다 많을 수 있음(특히 staffing 분산·프리셉터). 그래서 '실험' 표시.
  //   반환: true (항상 성공 — 멈추지 않음).
  function _runBacktrack(nd, R, lockedBackup){
    var ids = nurses.map(function(n){return n.id;});
    var attrOf={},roleOf={},isSr={},isNew={},prefsOf={},nurseById={},isFloat={},maxOf={};
    nurses.forEach(function(n){attrOf[n.id]=n.attributes||{};roleOf[n.id]=n.role;
      isSr[n.id]=(n.role==='주임'||n.role==='차지'); isNew[n.id]=(n.role==='신규간호사');
      prefsOf[n.id]=(n.prefs&&n.prefs.shift)||{D:0,E:0,N:0}; nurseById[n.id]=n;
      maxOf[n.id]=(n.prefs&&n.prefs.monthlyMax)||{D:null,E:null,N:null};  // v3.16.40: 월 상한
      isFloat[n.id]=!!(n.attributes&&n.attributes.floating);});
    var newNightCnt={}; ids.forEach(function(id){newNightCnt[id]=0;});  // 신규 월 야간 누적
    var head=nurses.find(function(n){return n.role==='수간호사';});
    var FP=R.forbiddenPatterns, NR=R.nightRules;
    var grid={},nights={},consecN={},workStreak={},offSoFar={},shiftCnt={},workSoFar={};
    ids.forEach(function(id){grid[id]={};nights[id]=0;consecN[id]=0;workStreak[id]=0;offSoFar[id]=0;shiftCnt[id]={D:0,E:0,N:0};workSoFar[id]=0;});
    var tgtOff={}; nurses.forEach(function(n){tgtOff[n.id]=(n.role==='수간호사')?99:offQ(n.id);});
    // 락/보존 셀 선반영
    ids.forEach(function(id){for(var d=1;d<=nd;d++){var k=key(id,d); if(lockedBackup[k]!==undefined) grid[id][d]=lockedBackup[k];}});
    // 수간호사 평일 D 고정(락/보존 없을 때만)
    if(head){var hp=R.headNurse; for(var d=1;d<=nd;d++){ if(grid[head.id][d]===undefined) grid[head.id][d]=isWH(cy,cm,d)?'O':'D'; }}
    function forbidPat(id,d,c){var p1=grid[id][d-1]||'',p2=grid[id][d-2]||'';
      if(FP.ND&&p1==='N'&&c==='D')return true; if(FP.NE&&p1==='N'&&c==='E')return true; if(FP.ED&&p1==='E'&&c==='D')return true;
      if(p1===''||p1==='O'){if(FP.NOD&&p2==='N'&&c==='D')return true;if(FP.EOD&&p2==='E'&&c==='D')return true;
        if(FP.NON&&p2==='N'&&c==='N')return true;if(FP.NOE&&p2==='N'&&c==='E')return true;}
      if(FP.NNNN&&c==='N'&&p1==='N'&&p2==='N'&&(grid[id][d-3]||'')==='N')return true; return false;}
    function canWork(id,d,sh){  // 하드 제약만
      if(grid[id][d]!==undefined) return grid[id][d]===sh;        // 락/보존/수간호사 고정
      if(lockedBackup[key(id,d)]!==undefined || isLocked(id,d)) return false;
      var a=attrOf[id];
      if(a.weekdayOnly && isWH(cy,cm,d)) return false;  // v3.16.41: 상근직 — 주말·공휴일 근무 불가
      if(sh==='N'){ if(a.pregnant||a.nightExempt)return false; if(a.fixedShift&&a.fixedShift!=='N')return false;
        var nl=a.nightDedicated?NR.monthlyNightMaxDedicated:NR.monthlyNightMaxRegular; if(nights[id]>=nl)return false;
        if(consecN[id]>=NR.consecutiveNightMax)return false;
        // v3.16.37: 신규간호사 월 야간 한도·연속 야간을 하드제약으로 (기존엔 softScore +12 페널티뿐이라
        //   다른 후보 없으면 한도 초과 — 신규가 월 7회까지 N 서는 버그). 안전 규칙이므로 canWork에서 차단.
        if(isNew[id] && R.newNurse && R.newNurse.enabled){
          if(R.newNurse.maxNightPerMonth>0 && newNightCnt[id]>=R.newNurse.maxNightPerMonth) return false;
          if(R.newNurse.noConsecNight && (grid[id][d-1]||'')==='N') return false;
        }
      }
      else { if(a.nightDedicated)return false; if(a.fixedShift&&a.fixedShift!==sh)return false; }
      // v3.16.40: 개인별 월 최대 D/E/N 상한 (하드제약). 해당 시프트 이미 상한 도달이면 불가.
      var mx=maxOf[id]; if(mx && mx[sh]!=null && (shiftCnt[id]&&shiftCnt[id][sh]||0)>=mx[sh]) return false;
      if(workStreak[id]>=R.consecutive.maxWorkStreak)return false;
      if(forbidPat(id,d,sh))return false;
      // v3.16.43: 야간 블록 규칙 (minNightStreak 켜진 경우만 활성)
      var RCons=R.consecutive;
      if(RCons.minNightStreak>0){
        // (A) 2연속 이상 N 블록 종료 후 OFF 강제: 직전에 끝난 N블록 길이≥2이고, 그 뒤 OFF가 offAfterNight 미만이면 근무 불가
        if(sh!=='N'){
          // d일 직전의 연속 OFF 수 + 그 앞 N블록 길이 계산
          var k=d-1, offRun=0;
          while(k>=1 && (grid[id][k]==='O'||grid[id][k]==='V')){ offRun++; k--; }
          var nBlk=0; while(k>=1 && grid[id][k]==='N'){ nBlk++; k--; }
          if(nBlk>=2 && offRun < (RCons.offAfterNight||0)) return false;  // N블록 후 OFF 더 필요
        }
        // (B) 사전확인형 최소 연속 N: N을 새로 시작(어제 N 아님)하는데, 다음날 이 사람이 N 불가하면 단독 N → 거부
        if(sh==='N' && (grid[id][d-1]||'')!=='N' && d<nd){
          var nextOk = _canStartNightHere(id,d);
          if(!nextOk) return false;
        }
      }
      return true; }
    // v3.16.43: N을 d일 시작할 때, 최소연속(minNightStreak)을 채울 수 있는지 사전 확인.
    //   다음 (minNightStreak-1)일 동안 하드제약(월한도·연속한도·락·상근·속성)이 N을 막지 않으면 OK.
    function _canStartNightHere(id,d){
      var need=R.consecutive.minNightStreak-1; var a=attrOf[id];
      for(var k=1;k<=need;k++){ var dd=d+k; if(dd>nd) return false;
        if(grid[id][dd]!==undefined) return grid[id][dd]==='N';   // 이미 정해졌으면 N이어야
        if(lockedBackup[key(id,dd)]!==undefined || isLocked(id,dd)) return false;
        if(a.pregnant||a.nightExempt) return false;
        if(a.fixedShift&&a.fixedShift!=='N') return false;
        var nl=a.nightDedicated?NR.monthlyNightMaxDedicated:NR.monthlyNightMaxRegular;
        if(nights[id]+k>=nl+1) return false;       // 월 한도 초과 예상
        if(consecN[id]+k>NR.consecutiveNightMax) return false;
        if(isNew[id]&&R.newNurse&&R.newNurse.enabled&&R.newNurse.maxNightPerMonth>0&&newNightCnt[id]+k>R.newNurse.maxNightPerMonth) return false;
      }
      return true;
    }
    function place(id,d,sh){ grid[id][d]=sh; if(sh==='N'){nights[id]++;consecN[id]++;if(isNew[id])newNightCnt[id]++;} workStreak[id]++; if(shiftCnt[id])shiftCnt[id][sh]++; workSoFar[id]++; }
    function curCnt(d,sh){ return ids.filter(function(id){return grid[id][d]===sh;}).length; }
    // off부족(근무필요)순 + 프리셉터 보너스
    var mentorOf={}; nurses.forEach(function(m){var po=(m.attributes&&m.attributes.preceptorOf)||[];po.forEach(function(nid){mentorOf[nid]=m.id;});});
    // 정렬 점수: 작을수록 우선. off부족(근무필요) + 시프트 편중 페널티(한 시프트 독식 방지) + 프리셉터 보너스
    function shiftPenalty(id,d,sh){
      var a=attrOf[id]||{};
      // v3.16.31: 플로팅은 시프트 편중·연속성 페널티 면제 — 어디든 유연 투입.
      if(a.floating){ if(sh==='N'&&a.nightDedicated)return -100; if(a.fixedShift===sh)return -8; return 0; }
      var c=shiftCnt[id]||{D:0,E:0,N:0};
      var avg=(c.D+c.E+c.N)/3;
      var pen=(c[sh]-avg)*1.1;   // v3.16.38: 0.8→1.1, 시프트 편중 교정 강화
      // v3.16.38: 미보유 시프트 강한 우선 — 명단 순서 편향으로 하단 간호사가 특정 시프트(D 등)를
      //   한 번도 못 받는 문제(류하림·전소미 D=0). 해당 시프트 보유 0이면 강한 보너스로 다양성 보장.
      if((c[sh]||0)===0 && (c.D+c.E+c.N)>=2){ pen -= 7; }   // v3.16.38: 2번 이상 근무했는데 이 시프트 0이면 강한 우선(다양성 보장)
      if(sh==='N' && a.nightDedicated){
        // v3.16.35: 야간전담 N 우선도를 '페이스 인식형'으로 — 강하게 우선(-100)하되,
        //   이번 달 N을 페이스보다 앞서 많이 섰으면 우선도를 낮춰 후반을 위해 분산(초반 몰빵 방지).
        //   기존 고정 -100은 매일 N에 꽂혀 N한도를 초반 소진 → 후반 OFF만 남는 문제.
        var wkN=0; var wkStart=d-((d-1)%7); for(var _k=wkStart;_k<d;_k++){ if(grid[id][_k]==='N')wkN++; }
        pen = -100 + wkN*30 + Math.max(0,paceDeficit(id,d))*6;
      }
      else if(a.fixedShift===sh){ pen-=8; }
      // v3.16.29: 시프트 연속성(블록 근무) — 어제와 같은 시프트면 보너스(생활리듬 유지 → 피로↓, 잦은 전환 방지).
      //   잦은 D↔E↔N 전환이 "15일 전후 색 변화"·균형점수 악화의 원인. 블록 근무를 약하게 유도.
      if(d>1){ var prev=grid[id][d-1];
        if(prev===sh) pen-=2.5;                 // 같은 시프트 연속 → 보너스
        else if(prev && prev!=='O' && prev!=='V'){
          // 다른 근무 시프트로 전환: 정방향(D→E→N)은 약한 페널티, 역방향은 강한 페널티
          var ord={D:1,E:2,N:3}; if(ord[prev]&&ord[sh]){ pen += (ord[sh]>ord[prev]) ? 0.5 : 2; }
        }
      }
      return pen;
    }
    // v3.16.27: 근무 페이스 부족분 — 시간 진행(d)에 비례한 기대 근무 대비 뒤처진 사람 우선.
    //   기존 버그: offSoFar-tgtOff(누적 off)만 봐서 초반엔 모두 0 → 앞쪽 id만 계속 뽑히고
    //   나머지는 후반까지 OFF로 밀림("전반 2주 OFF, 후반 몰아 근무"). 진행률 대비로 바꿔 매일 골고루 분배.
    function paceDeficit(id,d){
      var targetWork = (roleOf[id]==='수간호사') ? 0 : (nd - tgtOff[id]);
      var expected = targetWork * ((d-1)/nd);
      return workSoFar[id] - expected;
    }
    // v3.16.28: 소프트 규칙 전체를 점수에 반영(그리디 가중치를 점수 페널티로 번역).
    //   하드 제약(canWork)으로 못 거르는 권고 규칙들 — 선호도·신규보호·임산부동시·파트너.
    //   값 클수록 후순위. 가중치 0.1(강회피)≈+6, 0.01(매우강)≈+12 수준으로 환산.
    function softScore(id,d,sh){
      var s=0; var a=attrOf[id]; var pr=prefsOf[id];
      var W=R.weights||{prefer:1.4,avoid:0.3,neutral:1.0,partnerPrefer:1.3,partnerAvoid:0.2,equityStrength:0.6};
      // v3.16.36: 하드코딩 상수 대신 규칙설정(R.weights)을 반영 — 그리디와 일관.
      //   그리디는 곱셈 가중치(높을수록 선호)이나 백트래킹 score는 페널티 체계(낮을수록 우선)라
      //   weights를 페널티 스케일로 변환: 선호↑(prefer 큼)→보너스 크게(음수), 기피↑(avoid 작음)→페널티 크게(양수).
      var prefBonus = (W.prefer-1)*10;        // prefer 1.4 → -4.0 보너스
      var avoidPen  = (1-W.avoid)*8.6;         // avoid 0.3 → +6.0 페널티
      var partPrefBonus = (W.partnerPrefer-1)*6.7; // 1.3 → -2.0
      var partAvoidPen  = (1-W.partnerAvoid)*5;    // 0.2 → +4.0
      // (1) 선호도: 선호(+1)→보너스, 기피(-1)→페널티 (설정 가중치 반영)
      if(pr[sh]===1) s-=prefBonus; else if(pr[sh]===-1) s+=avoidPen;
      // (2) 신규간호사 야간 제한 (안전 규칙 — 고정 강도 유지)
      if(isNew[id] && R.newNurse && R.newNurse.enabled){
        if(sh==='N'){
          if(R.newNurse.maxNightPerMonth>0 && newNightCnt[id]>=R.newNurse.maxNightPerMonth) s+=12;
          if(R.newNurse.noConsecNight && (grid[id][d-1]||'')==='N') s+=12;
          if(R.newNurse.noNightAlone){
            var srInN=ids.some(function(o){return o!==id && isSr[o] && grid[o][d]==='N';});
            if(!srInN) s+=6;  // 선임 야간 없으면 신규 야간 회피
          }
        }
        // 선임 없는 교대에 신규 배치 회피
        if(R.newNurse.requireSeniorSameShift && ['D','E','N'].indexOf(sh)>=0){
          var srInSh=ids.some(function(o){return o!==id && isSr[o] && grid[o][d]===sh;});
          if(!srInSh) s+=6;
        }
      }
      // (3) 임산부 동시배치 회피: 같은 시프트에 이미 임산부 있으면 회피 (안전 규칙)
      if(a.pregnant && R.attributeRules && R.attributeRules.pregnantNoSameShift){
        var otherPreg=ids.some(function(o){return o!==id && attrOf[o].pregnant && grid[o][d]===sh;});
        if(otherPreg) s+=6;
      }
      // (4) 파트너 선호/기피 (설정 가중치 반영)
      var n=nurseById[id]; var pf=(n.prefs&&n.prefs.preferWith)||[]; var av=(n.prefs&&n.prefs.avoidWith)||[];
      if(pf.length||av.length){
        ids.forEach(function(o){ if(o===id||grid[o][d]!==sh)return;
          if(pf.indexOf(o)>=0) s-=partPrefBonus;
          if(av.indexOf(o)>=0) s+=partAvoidPen;
        });
      }
      return s;
    }
    function score(id,d,sh){ var sc=paceDeficit(id,d) + shiftPenalty(id,d,sh) + softScore(id,d,sh);
      if(isNew[id]&&mentorOf[id]&&grid[mentorOf[id]]&&grid[mentorOf[id]][d]===sh)sc-=2;
      var po=(attrOf[id].preceptorOf)||[]; if(po.some(function(nid){return grid[nid]&&grid[nid][d]===sh;}))sc-=2;
      return sc; }
    function scoreMin(id,d,sh){ return paceDeficit(id,d) + shiftPenalty(id,d,sh) + softScore(id,d,sh); }
    // v3.16.38: 정렬 비교자 — 점수 동점 시 명단 순서가 아니라 형평(총근무 적은 사람·이 시프트 적게 받은 사람) 우선.
    //   기존엔 동점이면 JS sort가 ids(명단) 순서 유지 → 상단 간호사가 항상 먼저 뽑혀 하단이 쏠림.
    function cmpBy(scoreFn,d,sh){ return function(a,bb){
      var diff=scoreFn(a,d,sh)-scoreFn(bb,d,sh);
      if(Math.abs(diff)>0.001) return diff;
      var sa=(shiftCnt[a]&&shiftCnt[a][sh])||0, sb=(shiftCnt[bb]&&shiftCnt[bb][sh])||0;
      if(sa!==sb) return sa-sb;                      // 이 시프트 적게 받은 사람 먼저
      if(workSoFar[a]!==workSoFar[bb]) return workSoFar[a]-workSoFar[bb]; // 총근무 적은 사람 먼저
      return 0;
    };}
    var t0=Date.now();
    var SHIFTS=['N','E','D'];
    for(var d=1;d<=nd;d++){ var wknd=isWH(cy,cm,d);
      var need={}; SHIFTS.forEach(function(sh){var w=R.staffingFor(sh,wknd);need[sh]=w?{min:w.min,max:w.max,sn:w.senior||0,jn:w.junior||0}:{min:0,max:0,sn:0,jn:0};});
      // ── 단계 1: 모든 시프트의 선임 슬롯을 라운드로빈으로 채움(선임을 D/E/N에 고루 분배) ──
      //   가장 채우기 어려운(가용 선임 적은) 시프트부터 = MRV. 한 시프트가 선임 독식하지 않게.
      var srRounds=Math.max(need.N.sn,need.E.sn,need.D.sn);
      for(var rr=0;rr<srRounds;rr++){
        // MRV: 이번 라운드에 선임 더 필요한 시프트들을, 가용 선임 적은 순으로
        var shList=SHIFTS.filter(function(sh){var cur=ids.filter(function(id){return grid[id][d]===sh&&isSr[id];}).length;return cur<need[sh].sn;});
        shList.sort(function(a,bb){
          var pa=ids.filter(function(id){return grid[id][d]===undefined&&isSr[id]&&canWork(id,d,a);}).length;
          var pb=ids.filter(function(id){return grid[id][d]===undefined&&isSr[id]&&canWork(id,d,bb);}).length;
          return pa-pb;  // 후보 적은(어려운) 시프트 먼저
        });
        shList.forEach(function(sh){
          var pool=ids.filter(function(id){return grid[id][d]===undefined&&isSr[id]&&canWork(id,d,sh);});
          if(!pool.length)return; pool.sort(cmpBy(scoreMin,d,sh)); place(pool[0],d,sh);
        });
      }
      // ── 단계 2: junior 슬롯 (선임 있는 시프트에 신규 우선 보호) ──
      SHIFTS.forEach(function(sh){
        var plNow=function(){return ids.filter(function(id){return grid[id][d]===sh&&!isSr[id]&&roleOf[id]!=='수간호사';}).length;};
        var guardJ=0;
        while(plNow()<need[sh].jn && guardJ++<50){
          var hasSrSame=ids.some(function(id){return grid[id][d]===sh&&isSr[id];});
          var pool=ids.filter(function(id){return grid[id][d]===undefined&&!isSr[id]&&roleOf[id]!=='수간호사'&&canWork(id,d,sh);});
          if(R.newNurse&&R.newNurse.enabled&&R.newNurse.requireSeniorSameShift&&!hasSrSame){
            var nonNew=pool.filter(function(id){return !isNew[id];}); if(nonNew.length)pool=nonNew;
          }
          if(!pool.length)break; pool.sort(cmpBy(scoreMin,d,sh)); place(pool[0],d,sh); }
      });
      // ── 단계 3: min 나머지 (아무 역할이나) ──
      SHIFTS.forEach(function(sh){
        var guard=0;
        while(curCnt(d,sh)<need[sh].min && guard++<50){
          var hasSrN=(sh==='N')&&ids.some(function(id){return grid[id][d]==='N'&&isSr[id];});
          var pool=ids.filter(function(id){return grid[id][d]===undefined&&roleOf[id]!=='수간호사'&&canWork(id,d,sh);});
          if(sh==='N'&&!hasSrN){var p2=pool.filter(function(id){return !isNew[id];}); if(p2.length)pool=p2;}
          if(!pool.length){
            // v3.16.31: 막힘 — 플로팅(유연 인력)을 마지막 후보로 투입해 min 미달 방지.
            //   일반 후보가 canWork를 통과 못한 경우에도, 플로팅은 우선 투입(단 하드 안전제약 canWork는 지킴).
            var fpool=ids.filter(function(id){return grid[id][d]===undefined&&isFloat[id]&&roleOf[id]!=='수간호사'&&canWork(id,d,sh);});
            if(!fpool.length)break;
            fpool.sort(cmpBy(scoreMin,d,sh)); place(fpool[0],d,sh); continue;
          }
          pool.sort(cmpBy(scoreMin,d,sh)); place(pool[0],d,sh); }
      });
      // v3.16.39: min 구제 패스 — 위 단계로도 min 미달이 남으면, OFF 페이스·다양성을 무시하고
      //   canWork 통과자를 강제 투입. min 정원(환자안전)은 OFF 균등보다 절대 우선.
      //   원인: SHIFTS 순서(N→E→D)로 D가 마지막이라 D가용자가 E/N에 먼저 소진 + OFF페이스로 가용자를 놀림.
      SHIFTS.forEach(function(sh){
        var guard2=0;
        while(curCnt(d,sh)<need[sh].min && guard2++<50){
          var pool=ids.filter(function(id){return grid[id][d]===undefined&&roleOf[id]!=='수간호사'&&canWork(id,d,sh);});
          if(!pool.length){
            var fp=ids.filter(function(id){return grid[id][d]===undefined&&isFloat[id]&&roleOf[id]!=='수간호사'&&canWork(id,d,sh);});
            if(!fp.length)break; fp.sort(cmpBy(scoreMin,d,sh)); place(fp[0],d,sh); continue;
          }
          pool.sort(cmpBy(scoreMin,d,sh)); place(pool[0],d,sh);
        }
      });
      // ── 단계 4: off균등 후처리 (max까지, 페이스 안 앞선 사람) ──
      SHIFTS.forEach(function(sh){
        for(var k=curCnt(d,sh);k<need[sh].max;k++){
          var pool=ids.filter(function(id){return grid[id][d]===undefined&&roleOf[id]!=='수간호사'&&canWork(id,d,sh)&&paceDeficit(id,d)<0.5;});
          var hasSrN=(sh==='N')&&ids.some(function(id){return grid[id][d]==='N'&&isSr[id];});
          if(sh==='N'&&!hasSrN)pool=pool.filter(function(id){return !isNew[id];});
          if(!pool.length)break; pool.sort(cmpBy(score,d,sh)); place(pool[0],d,sh); }
      });
      // ── 나머지 O ──
      ids.forEach(function(id){ if(grid[id][d]===undefined){grid[id][d]='O';offSoFar[id]++;workStreak[id]=0;} if(grid[id][d]!=='N')consecN[id]=0; });
    }
    // v3.16.43: 사후 보정 — minNightStreak 켜진 경우, 단독 N을 best-effort로 2연속화.
    //   정원 여유가 있으면 다음날 N으로 연장(2연속). 연장 불가하면 단독 N을 그대로 둔다
    //   (O변환·대체투입은 정원/OFF를 더 크게 망가뜨려 역효과 — 측정으로 확인, best-effort만 채택).
    if(R.consecutive.minNightStreak>=2){
      ids.forEach(function(id){ if(attrOf[id].nightDedicated)return;
        for(var d=1;d<=nd;d++){
          if(grid[id][d]!=='N')continue;
          var prevN=(d>1&&grid[id][d-1]==='N'), nextN=(d<nd&&grid[id][d+1]==='N');
          if(prevN||nextN)continue;
          if(d<nd){
            var nx=grid[id][d+1];
            var nNd=R.staffingFor('N',isWH(cy,cm,d+1)); var curN=ids.filter(function(x){return grid[x][d+1]==='N';}).length;
            if((nx==='O'||nx===undefined)&&!isLocked(id,d+1)&&lockedBackup[key(id,d+1)]===undefined
               && curN < (nNd?nNd.max:99)){
              var a=attrOf[id];
              var nCnt=0;for(var z=1;z<=nd;z++)if(grid[id][z]==='N')nCnt++;
              var nl=a.nightDedicated?NR.monthlyNightMaxDedicated:NR.monthlyNightMaxRegular;
              var okExt=!(a.pregnant||a.nightExempt)&&!(a.fixedShift&&a.fixedShift!=='N')&&nCnt<nl;
              if(isNew[id]&&R.newNurse&&R.newNurse.enabled&&R.newNurse.maxNightPerMonth>0&&nCnt>=R.newNurse.maxNightPerMonth)okExt=false;
              if(a.weekdayOnly&&isWH(cy,cm,d+1))okExt=false;
              if(okExt){ if(nx==='O')offSoFar[id]--; grid[id][d+1]='N'; }
            }
          }
        }
      });
    }
    ids.forEach(function(id){for(var d=1;d<=nd;d++){ schedule[key(id,d)]=grid[id][d]||'O'; }});
    console.log('[autoFill:backtrack] '+(Date.now()-t0)+'ms');
    return true;
  }

  function _runGreedyOnce(STRAT, rng, nd, R, lockedBackup){

  // v3.16.4: '고정 셀' = 락 셀 + (기존 배치 유지 옵션의) 보존 셀.
  //   lockedBackup에 키가 있으면 그 값으로 복원하고, 배치 로직은 이 셀을 건드리지 않는다.
  //   isFixed(nid,d)로 통합 판정 → 락/보존을 동일하게 취급(빈 셀만 자동 채움).
  function isFixed(nid, dd){ return lockedBackup[key(nid,dd)]!==undefined || isLocked(nid,dd); }

  // 이 시도 전용: 고정(락+보존) 외 모든 셀 비우고, 고정 셀은 백업값으로 복원
  nurses.forEach(function(n){
    for(var dd=1; dd<=nd; dd++){
      var k = key(n.id, dd);
      if(lockedBackup[k]!==undefined){
        schedule[k] = lockedBackup[k];   // 락 또는 보존 셀 → 원래 값 복원
      } else {
        delete schedule[k];              // 그 외 → 비우고 자동 채움 대상
      }
    }
  });

  var head=getHeadNurse();
  var sr=sorted().filter(isSenior);
  var pl=sorted().filter(function(n){return n.role==='평간호사'||n.role==='신규간호사';});

  // 수간호사 배치 — 고정 셀(락/보존)은 건너뜀
  if(head){
    for(var d=1;d<=nd;d++){
      if(isFixed(head.id, d)) continue; // 원티드 락 + 기존 배치 보존
      var w=dow(cy,cm,d),h=isH(cy,cm,d);
      if(w===0&&R.headNurse.sundayOff) schedule[key(head.id,d)]='O';
      else if(h&&R.headNurse.holidayOff) schedule[key(head.id,d)]='O';
      else if(w===6){ if(R.headNurse.saturdayMode!=='empty') schedule[key(head.id,d)]=R.headNurse.saturdayMode; }
      else schedule[key(head.id,d)]=R.headNurse.weekdayShift||'D';
    }
  }

  var workers=sr.concat(pl);
  if(!workers.length){ return _captureSnapshot(nd); }

  // 이전 달 나이트 인수인계
  var prevCy=cy,prevCm=cm-1;
  if(prevCm<0){prevCm=11;prevCy--;}
  var prevNd=ndays(prevCy,prevCm);
  var LOOKBACK=R.consecutive.maxNightStreak+1;
  var st={};
  workers.forEach(function(n){
    var ns=0,cd=0;
    for(var pd=prevNd;pd>=Math.max(1,prevNd-LOOKBACK+1);pd--){
      if(schedule[n.id+'|'+prevCy+'|'+prevCm+'|'+pd]==='N') ns++; else break;
    }
    if(ns>=R.consecutive.maxNightStreak){cd=R.consecutive.offAfterNight;ns=0;}
    st[n.id]={ns:ns,cd:cd,sc:{D:0,E:0,N:0},wd:0};
  });

  // 가중치 기반 확률 선택 (형평성 보정 포함)
  function wpick(arr,sh,partner){
    if(!arr.length) return null;
    // v3.16.41: 절대 금지(상근직 주말·공휴일, 월 상한 도달)는 후보에서 완전 제외 — _ban(확률0.0001)으론
    //   다른 후보 없을 때 뚫리므로, 임산부 야간처럼 사전 제외해야 확실.
    var _wknd=isWH(cy,cm,d);
    arr=arr.filter(function(n){
      if(n.attributes&&n.attributes.weekdayOnly&&_wknd) return false;
      var mm=(n.prefs&&n.prefs.monthlyMax)||null;
      if(mm&&mm[sh]!=null&&(st[n.id].sc[sh]||0)>=mm[sh]) return false;
      return true;
    });
    if(!arr.length) return null;
    var W=R.weights;
    var items=arr.map(function(n){
      var _ban=false; var pref=(getPrefs(n).shift[sh]||0);
      var w=pref===1?W.prefer:pref===-1?W.avoid:W.neutral;
      // 형평성
      var total=(st[n.id].sc.D||0)+(st[n.id].sc.E||0)+(st[n.id].sc.N||0);
      var avg=total/3;
      var equity=W.equityStrength*(avg-(st[n.id].sc[sh]||0))*0.12;
      w=Math.max(0.05,w+equity);
      // 패턴 학습 가중치
      if(R.patternLearning.enabled&&patternRef[n.id]&&patternRef[n.id].total>0){
        var pr=patternRef[n.id];
        var ratio=(pr[sh]||0)/pr.total; // 이전달 해당 교대 비율
        var avg3=1/3;
        var patBonus=R.patternLearning.weight*(ratio-avg3)*2;
        w=Math.max(0.05,w+patBonus);
      }
      // 신규간호사 배치 제한
      if(n.role==='신규간호사'&&R.newNurse.enabled){
        if(sh==='N'){
          // 월 야간 한도
          if(R.newNurse.maxNightPerMonth>0&&(newNurseNightCount[n.id]||0)>=R.newNurse.maxNightPerMonth) w=0.01;
          // 연속 야간 금지
          if(R.newNurse.noConsecNight&&d>1){var prevC=schedule[key(n.id,d-1)];if(prevC==='N') w=0.01;}
          // 야간 단독 배치 금지: 선임 중 누군가 N 배정 예정인지 확인
          // (현재 asgn 기준 — 선임이 이미 배정됐으면 OK, 아직 없으면 가중치 낮춤)
          if(R.newNurse.noNightAlone){
            var seniorInNight=sr.some(function(s){return asgn[s.id]==='N';});
            if(!seniorInNight) w*=0.1; // 선임 야간 없으면 확률 대폭 감소
          }
        }
        // 선임 없는 교대에 신규 배치 금지
        if(['D','E','N'].indexOf(sh)>=0&&R.newNurse.requireSeniorSameShift){
          var seniorInShift=sr.some(function(s){return asgn[s.id]===sh;});
          if(!seniorInShift) w*=0.1;
        }
      }
      // 파트너 가중치
      if(partner){
        var pp=getPrefs(partner),np=getPrefs(n);
        if(pp.preferWith.indexOf(n.id)>=0||np.preferWith.indexOf(partner.id)>=0) w*=W.partnerPrefer;
        if(pp.avoidWith.indexOf(n.id)>=0||np.avoidWith.indexOf(partner.id)>=0) w*=W.partnerAvoid;
      }

      // ── v3.5: 신규 규칙 페널티 (자동배치 회피용) ────────────────────────
      // 모두 강제는 아니므로 가중치만 감소. 사용자가 수동으로 같은 배치는 가능.
      var attr = n.attributes || {};
      var FP2 = R.forbiddenPatterns;
      var NR2 = R.nightRules;
      var AR2 = R.attributeRules;

      // (A) 금지 패턴 회피: 직전 1~2일 코드 검사
      var pCode  = (d>1) ? (schedule[key(n.id,d-1)]||'') : '';
      var ppCode = (d>2) ? (schedule[key(n.id,d-2)]||'') : '';
      var pIsOff = (pCode===''||pCode==='O'||pCode==='V');
      // 2일 패턴
      // 2일 패턴 — v3.16.21: 가중치 강화. v3.16.22: hardForbid 시 후보 제외(_ban).
      var _hard = FP2.hardForbid;
      if(FP2.ND && pCode==='N' && sh==='D'){ if(_hard)_ban=true; else w*=0.01; }
      if(FP2.NE && pCode==='N' && sh==='E'){ if(_hard)_ban=true; else w*=0.01; }
      if(FP2.ED && pCode==='E' && sh==='D'){ if(_hard)_ban=true; else w*=0.02; }
      // 3일 패턴 (가운데가 Off)
      if(pIsOff && d>2){
        if(FP2.NOD && ppCode==='N' && sh==='D'){ if(_hard)_ban=true; else w*=0.005; }
        if(FP2.EOD && ppCode==='E' && sh==='D'){ if(_hard)_ban=true; else w*=0.02; }
        if(FP2.NON && ppCode==='N' && sh==='N'){ if(_hard)_ban=true; else w*=0.08; }
        if(FP2.NOE && ppCode==='N' && sh==='E'){ if(_hard)_ban=true; else w*=0.08; }
      }
      // NNNN: 직전 3일이 모두 N인데 또 N
      if(FP2.NNNN && sh==='N' && d>3){
        if((schedule[key(n.id,d-1)]||'')==='N'
        && (schedule[key(n.id,d-2)]||'')==='N'
        && (schedule[key(n.id,d-3)]||'')==='N') w*=0.05;
      }

      // (B) 야간 세부 규칙
      // 연속 야간 한도
      if(sh==='N' && st[n.id].ns >= NR2.consecutiveNightMax) w*=0.05;
      // 월 야간 한도 (속성에 따라 한도 다름)
      if(sh==='N'){
        var nlimit = attr.nightDedicated ? NR2.monthlyNightMaxDedicated : NR2.monthlyNightMaxRegular;
        if((st[n.id].sc.N||0) >= nlimit) w*=0.05;
      }
      // 역방향 교대 (D→E→N→D 정방향, 그 외 역방향)
      if(NR2.forbidBackwardRotation && pCode){
        var ord = {D:1, E:2, N:3};
        if(ord[sh] && ord[pCode] && ord[sh] < ord[pCode]){
          // 단, N→D는 ND 패턴에서 별도 처리 (중복 페널티 방지)
          if(!(pCode==='N' && sh==='D')) w*=0.4;
        }
      }

      // (C) 간호사 속성 기반
      // 임산부 야간 금지
      if(AR2.pregnantNoNight && attr.pregnant && sh==='N') w*=0.01;
      // 야간전담은 야간만 — D/E 강회피 + N 강우선(안 그러면 N 슬롯을 일반에 뺏기고 OFF로 놀게 됨)
      if(AR2.nightDedicatedNightOnly && attr.nightDedicated){
        if(sh==='D'||sh==='E') w*=0.01;
        else if(sh==='N') w*=8;   // v3.16.17: N에 강하게 우선 배정 (대안 시프트가 없으므로)
      }
      // 야간면제자
      if(AR2.exemptNoNight && attr.nightExempt && sh==='N') w*=0.01;
      // 고정근무자: 자기 시프트 강우선, 다른 시프트 강회피 (대안 없어 OFF로 놀지 않게)
      if(attr.fixedShift && ['D','E','N'].includes(attr.fixedShift)){
        if(sh!==attr.fixedShift) w*=0.05;
        else w*=6;   // v3.16.17: 자기 고정 시프트에 강우선
      }
      // 임산부 동시 배치 회피: 같은 시프트에 이미 임산부가 있으면 추가 배치 안 함
      if(AR2.pregnantNoSameShift && attr.pregnant){
        var otherPregOnSame = nurses.some(function(o){
          return o.id!==n.id && o.attributes && o.attributes.pregnant && asgn[o.id]===sh;
        });
        if(otherPregOnSame) w*=0.1;
      }

      // 프리셉터-프리셉티 페어링: 신규간호사가 이번 시프트에 있는데
      // 그 신규의 프리셉터가 본인이면 가산. 반대로 프리셉터가 신규의 시프트에
      // 이미 배정된 다른 사람이면 페어 충족이라 추가 가산 없음.
      if(AR2.preceptorWithPreceptee && ['D','E','N'].indexOf(sh)>=0){
        // 본인이 신규간호사: 본인의 프리셉터가 이 시프트에 이미 있으면 가산
        if(n.role==='신규간호사'){
          var myMentor = nurses.find(function(m){
            return m.attributes && Array.isArray(m.attributes.preceptorOf)
              && m.attributes.preceptorOf.indexOf(n.id) >= 0;
          });
          if(myMentor && asgn[myMentor.id]===sh) w*=1.4; // 프리셉터 있으면 +40%
        }
        // 본인이 멘토(프리셉터): 본인 프리셉티 중 이 시프트에 이미 배정된 신규가 있으면 가산
        if(attr.preceptorOf && attr.preceptorOf.length){
          var preceptiInShift = attr.preceptorOf.some(function(pid){
            return asgn[pid]===sh;
          });
          if(preceptiInShift) w*=1.4; // 본인 프리셉티가 이 시프트에 있으면 +40%
        }
      }

      // ── v6.2: off 능동제약 ───────────────────────────────────────────
      // 근무(D/E/N)에 뽑는 상황이므로, off가 모자란 사람은 근무 가중치를 낮춰
      // (= off로 남겨두고), off가 target 도달/초과한 사람은 근무 가중치를 높여
      // (= 더 이상 off 안 주고 근무) off 쏠림을 배치 단계에서 평탄화.
      if(['D','E','N'].indexOf(sh)>=0 && offTarget[n.id]!==undefined){
        var remainDays = nd - d + 1;                  // 오늘 포함 남은 일수
        var needOff = offTarget[n.id] - offSoFar[n.id]; // 더 받아야 할 off
        if(remainDays > 0){
          // offPressure: 남은 일수 중 off로 채워야 할 비율 (0~1+)
          var offPressure = needOff / remainDays;
          if(offPressure >= 1){
            // 남은 날을 전부 off로 채워도 모자람 → 근무 강하게 회피
            w *= 0.15;
          } else if(offPressure > 0.6){
            w *= 0.45;   // off 꽤 부족 → 근무 약하게 회피
          } else if(offPressure < 0){
            // 이미 target 초과 (off 너무 많음) → 근무 강하게 우선
            w *= 2.2;
          } else if(offPressure < 0.2){
            // off 거의 다 채움 → 근무 우선
            w *= 1.6;
          }
        }
      }

      return{n:n,w:_ban?0.0001:Math.max(0.01,w)};
    });
    // v3.9.4: STRAT.shiftBias로 시프트 편향 추가 적용
    var biasMul = (STRAT.shiftBias && STRAT.shiftBias[sh]) ? STRAT.shiftBias[sh] : 1;
    items.forEach(function(it){ it.w *= biasMul; });
    var tot=items.reduce(function(s,x){return s+x.w;},0);
    var r=rng()*tot,cum=0;  // Math.random → rng (시드 PRNG)
    for(var i=0;i<items.length;i++){cum+=items[i].w;if(r<=cum)return items[i].n;}
    return items[items.length-1].n;
  }

  function rot(arr,off){
    if(!arr.length)return arr;
    var o=((off%arr.length)+arr.length)%arr.length;
    return arr.slice(o).concat(arr.slice(0,o));
  }

  // ── 이전 달 패턴 학습 데이터 수집 ────────────────────────────────────
  var patternRef={};
  if(R.patternLearning.enabled){
    var lb=R.patternLearning.lookbackMonths||1;
    workers.forEach(function(n){
      patternRef[n.id]={D:0,E:0,N:0,total:0};
      for(var mi=1;mi<=lb;mi++){
        var pCm=cm-mi, pCy=cy;
        if(pCm<0){pCm+=12;pCy--;}
        var pNd=ndays(pCy,pCm);
        for(var pd=1;pd<=pNd;pd++){
          var code=schedule[n.id+'|'+pCy+'|'+pCm+'|'+pd];
          if(code==='D'||code==='E'||code==='N'){
            patternRef[n.id][code]++;
            patternRef[n.id].total++;
          }
        }
      }
    });
  }

  // 신규간호사 이번달 야간 카운트 추적
  var newNurseNightCount={};
  // v3.7: 락된 셀에 이미 배정된 시프트는 카운트에 반영 (한도 정확히 계산)
  workers.forEach(function(n){
    if(n.role!=='신규간호사') return;
    for(var dd=1; dd<=nd; dd++){
      if(isFixed(n.id, dd) && schedule[key(n.id, dd)]==='N'){
        newNurseNightCount[n.id] = (newNurseNightCount[n.id]||0) + 1;
      }
    }
  });

  // ── v6.2: off 능동제약 — 누적 off 추적 ─────────────────────────────────
  // 각 사람의 target_off와 락으로 이미 확정된 off를 미리 카운트.
  // 배치 중 offSoFar를 갱신하며, target 도달자는 근무 우선/미달자는 off 우선.
  var offTarget={}, offSoFar={};
  workers.forEach(function(n){
    offTarget[n.id] = offQ(n.id);
    offSoFar[n.id] = 0;
    // 락으로 이미 확정된 O/V도 off로 카운트 (V=연차는 off 아님, O만)
    for(var dd=1; dd<=nd; dd++){
      if(isFixed(n.id, dd)){
        var lc = schedule[key(n.id, dd)];
        if(lc==='O') offSoFar[n.id]++;
      }
    }
  });

  for(var d=1;d<=nd;d++){
    var forced={};
    workers.forEach(function(n){if(st[n.id].cd>0){forced[n.id]=true;st[n.id].cd--;}});

    // v3.7: 락된 셀은 이미 배정값이 있으므로 그 값을 asgn에 미리 채워 다른 사람과의 중복 방지
    var asgn={};
    workers.forEach(function(n){
      if(isFixed(n.id, d)){
        var lockedCode = schedule[key(n.id, d)];
        // 락 코드가 D/E/N일 때만 asgn에 반영 (인력 카운트에 들어감)
        if(lockedCode==='D' || lockedCode==='E' || lockedCode==='N'){
          asgn[n.id] = lockedCode;
        }
      }
    });

    var avSr=rot(sr.filter(function(n){return !forced[n.id] && !asgn[n.id] && !isFixed(n.id,d);}),d-1+STRAT.rotSr);
    var avPl=rot(pl.filter(function(n){return !forced[n.id] && !asgn[n.id] && !isFixed(n.id,d);}),d+1+STRAT.rotPl);

    ['D','E','N'].forEach(function(sh){
      var fSr=avSr.filter(function(x){return !asgn[x.id];});
      var fPl=avPl.filter(function(x){return !asgn[x.id];});
      // v6.2: 교대×평일/주말 2축 정원 (주말=토/일/공휴일)
      var isWknd = isWH(cy,cm,d);
      var need = R.staffingFor(sh, isWknd);
      var alreadySrInShift = sr.filter(function(x){return asgn[x.id]===sh;}).length;
      // v3.14: 평일 Day에 수간호사가 고정 배치돼 있으면 선임 1명으로 인정(옵션 ON 시).
      //   → 차지(charge)를 Day에 낭비하지 않고 N/E로 돌릴 수 있음. headNurseAsSenior의 목적.
      alreadySrInShift += headSeniorBonus(sh, d);
      var alreadyPlInShift = pl.filter(function(x){return asgn[x.id]===sh;}).length;
      var srNeeded=Math.max(0, (need.senior||0) - alreadySrInShift);
      var plNeeded=Math.max(0, (need.junior||0) - alreadyPlInShift);
      for(var si=0;si<srNeeded;si++){
        var sn=wpick(fSr.filter(function(x){return !asgn[x.id];}),sh,null);
        if(sn)asgn[sn.id]=sh;
      }
      for(var pi=0;pi<plNeeded;pi++){
        var lastSr=sr.find(function(x){return asgn[x.id]===sh;});
        var pn=wpick(fPl.filter(function(x){return !asgn[x.id];}),sh,lastSr||null);
        if(pn)asgn[pn.id]=sh;
      }
    });

    // v3.16.17: min 충원 후 max까지 추가 배치 — 잉여 인원을 무조건 OFF로 버리지 않고,
    //   off 목표에 도달/근접한 사람을 우선 근무에 넣어 평간호사 OFF 과다·양극화를 완화.
    //   (off가 아직 부족한 사람은 능동제약 가중치가 알아서 낮춰 OFF로 남김.)
    ['N','E','D'].forEach(function(sh){              // N부터(가장 빡빡) 여유 채움
      var isWknd2 = isWH(cy,cm,d);
      var need2 = R.staffingFor(sh, isWknd2);
      var maxCap = (need2 && typeof need2.max==='number') ? need2.max : 99;
      var cur = workers.filter(function(x){return asgn[x.id]===sh;}).length;
      var room = Math.max(0, maxCap - cur);
      for(var k=0;k<room;k++){
        // 아직 미배정 + off 목표를 이미 채운(또는 초과한) 사람만 후보 → 근무 더 시켜도 OK
        var pool = workers.filter(function(x){
          if(asgn[x.id] || forced[x.id] || isFixed(x.id,d)) return false;
          // v3.16.17: 속성 제약자는 max 채우기 대상에서 제외 (금지 시프트로 끌려가지 않게).
          //   야간전담→N만(한도 차면 OFF), 야간면제→N금지, 임산부→N금지, 고정→자기 시프트만.
          var xa = x.attributes || {};
          if(sh!=='N' && xa.nightDedicated) return false;        // 야간전담은 D/E 채우기 제외
          if(sh==='N' && (xa.nightExempt || xa.pregnant)) return false;  // N 금지자 제외
          if(xa.fixedShift && xa.fixedShift!==sh) return false;  // 고정근무자는 자기 시프트만
          var got = offSoFar[x.id]||0, tgt = offTarget[x.id];
          return (tgt===undefined) ? false : (got >= tgt - 1);  // 목표 -1일 이내면 근무 가능
        });
        if(!pool.length) break;
        var add = wpick(pool, sh, sr.find(function(x){return asgn[x.id]===sh;})||null);
        if(add) asgn[add.id]=sh; else break;
      }
    });

    workers.forEach(function(n){
      // v3.7: 락된 셀은 건드리지 않음 — 기존 schedule 값 유지
      if(isFixed(n.id, d)){
        // 단, st(상태)는 락된 셀 값으로 업데이트해야 다음날 계산이 맞음
        var lockedCode = schedule[key(n.id, d)] || 'O';
        st[n.id] = RULES.nextState(st[n.id], lockedCode);
        return;
      }
      var code;
      if(forced[n.id]){
        code='O';
        st[n.id].ns=0;
      } else {
        code=asgn[n.id]||'O'; // 배정 안 된 간호사는 Off
        // RuleEngine.nextState()로 상태 업데이트
        st[n.id] = RULES.nextState(st[n.id], code);
        if(code==='N'&&n.role==='신규간호사')
          newNurseNightCount[n.id]=(newNurseNightCount[n.id]||0)+1;
      }
      // v6.2: off 누적 갱신 (O만 카운트 — V는 연차로 별개)
      if(code==='O') offSoFar[n.id]=(offSoFar[n.id]||0)+1;
      schedule[key(n.id,d)]=code;
    });
  }

  // 본체 종료: 현재 schedule 상태를 스냅샷으로 반환
  return _captureSnapshot(nd);

  } // ── _runGreedyOnce 끝 ──

  // 현재 달 schedule을 객체로 캡처 (락 셀 포함)
  function _captureSnapshot(nd){
    var snap = {};
    nurses.forEach(function(n){
      for(var d=1; d<=nd; d++){
        var k = key(n.id, d);
        if(schedule[k]!==undefined) snap[k] = schedule[k];
      }
    });
    return snap;
  }
  // 스냅샷을 현재 달 schedule에 적용 (덮어쓰기 — 먼저 락 외 비움)
  function _applySnapshot(snap, nd){
    nurses.forEach(function(n){
      for(var d=1; d<=nd; d++){
        var k = key(n.id, d);
        if(snap[k]!==undefined) schedule[k] = snap[k];
        else delete schedule[k];
      }
    });
  }
  // L1 위반에 연루된 셀을 비워 unresolved 처리.
  // 모든 후보가 L1 위반인 셀만 해당 — 실무상 "도저히 안전배치 불가"한 칸.
  // 여기서는 보수적으로: L1 conflict가 가리키는 (간호사,일) 셀이 락이 아니면 비움.
  function _markUnresolvedCells(nd){
    var cf = conflicts();
    var l1cells = {};
    cf.forEach(function(c){
      if(_layerOf(c) !== 'L1') return;
      if(!c.d || c.d < 1) return;          // 월간 집계형(d=0)은 특정 셀 아님 → 제외
      // c에는 nurse id가 직접 없으므로 message로 식별 불가 → 셀 단위 식별이 어려운 경우 skip
    });
    // 현재 conflict 구조는 (간호사 id) 필드를 직접 담지 않아 셀 단위 unresolved가
    // 제한적. 안전을 위해 자동 비우기는 하지 않고 0 반환(경고만 유지).
    // (향후 conflict에 nurseId 필드 추가 시 활성화 — 스펙 5.5)
    return 0;
  }

} // ── autoFill 끝 ──

  // ── 전역 등록 (방식 B 핵심) ──────────────────────────────────────────
  g.autoFill = autoFill;
  g.__AUTOENGINE_LOADED__ = true;

})(window);
