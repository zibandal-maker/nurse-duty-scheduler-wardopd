/* ============================================================
   calendar/cal-leave.js — 연차 동기화 + 소진 집계 (M3v, 방식 B)
   ------------------------------------------------------------
   배경: 법정 연차는 "사람당" 부여. 한 사람이 부서를 이동·겸직해도
        연차 총량은 하나여야 휴가 소진이 정확하다. → 총량은 공유 풀(Layer1).

   하는 일 (선택지 B):
     1) 듀티 데이터(dv6_n_duty)를 *읽어서* 연차 총량·입사일을 공유 풀로 동기화.
        ★ 듀티는 한 글자도 안 건드린다 — 읽기 전용. (잠금 정책 준수)
     2) 비교대 스케줄에서 연차성 코드(연차/월차/반차) 사용일을 personId 단위로 집계.
        반차(half)는 0.5일로 계산. → "외래에서 N일 소진".

   통합 합산(듀티+외래)은 선택지 C(차기) — 여기선 외래 소진까지만.

   외부 의존: PersonsStore(연차 필드 확장됨), CalScheduleStore(셀 {am,pm})
   ============================================================ */
(function (g) {
  'use strict';

  // M4e: 인력 진실원 = 종합 풀(persons-store). dv6_n_duty 역동기화(syncLeaveFromDuty)는
  //   폐기 — 듀티 인원 키가 죽은 키가 되어 더는 풀로 끌어올 필요/근거 없음.
  //   연차 총량·입사일은 직원관리(staff)에서 풀에 직접 입력됨.

  // ── 비교대 연차성 소진 집계 ────────────────────────────────────────
  //   연차성 코드 판정은 cal-shifts.js(CalShifts.isLeave)를 단일 진실원으로 위임.
  //   (cal-shifts 미로드 시 폴백: vac/month/half)
  var FALLBACK_LEAVE = { vac:1, month:1, half:1 };

  function _isLeaveCode(code){
    if(g.CalShifts && typeof g.CalShifts.isLeave==='function') return g.CalShifts.isLeave(code);
    return !!(code && FALLBACK_LEAVE[code]);
  }

  // personId별 비교대 소진(일수) — 전체 기간 또는 특정 연/월
  //   opts: {year, month} 주면 그 달만. 없으면 전체.
  function tallyOutpatientLeave(opts){
    var S = g.CalScheduleStore;
    if(!S) return {};
    var all = S.all();
    var byPerson = {};   // personId -> days(소진)
    var filterPre = null;
    if(opts && opts.year!=null && opts.month!=null){
      filterPre = '|'+opts.year+'|'+opts.month+'|';
    }
    Object.keys(all).forEach(function(key){
      if(filterPre && key.indexOf(filterPre) < 0) return;
      var personId = key.split('|')[0];
      var cell = all[key];
      var days = 0;
      if(cell.am && _isLeaveCode(cell.am.code)) days += 0.5;
      if(cell.pm && _isLeaveCode(cell.pm.code)) days += 0.5;
      if(days>0) byPerson[personId] = (byPerson[personId]||0) + days;
    });
    return byPerson;   // { personId: 소진일수 }
  }

  // 한 사람의 연차 현황: {total, usedOutpatient, remaining}
  //   total = 풀의 vacTotal (없으면 null). remaining = total - 외래소진 (total 있을 때만).
  function leaveStatus(personId, opts){
    var total = null;
    if(g.PersonsStore){
      var p = g.PersonsStore.get(personId);
      if(p && typeof p.vacTotal==='number') total = p.vacTotal;
    }
    var used = tallyOutpatientLeave(opts)[personId] || 0;
    return {
      total: total,
      usedOutpatient: used,
      remaining: (total!=null) ? (total - used) : null
    };
  }

  // ── 전역 등록 ─────────────────────────────────────────────────────────
  g.CalLeave = {
    tallyOutpatient: tallyOutpatientLeave,
    status: leaveStatus,
    LEAVE_CODES: FALLBACK_LEAVE,
    isLeaveCode: _isLeaveCode
  };
  g.__CALLEAVE_LOADED__ = true;

})(window);
