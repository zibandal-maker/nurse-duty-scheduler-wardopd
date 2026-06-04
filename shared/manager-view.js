/* ============================================================
   shared/manager-view.js — 관리자 집계 뷰 (M4f-2, 읽기 전용)
   ------------------------------------------------------------
   하는 일: 관리그룹(수간호사단) 멤버 각자의 "그날 근무"를, 그 사람의
            소속 부서 장부에서 읽어 공통 표시 형태로 돌려준다.
            ★ 새 데이터 없음 — 듀티/비교대 장부를 거울처럼 비출 뿐.

   ── 소속별 장부 (키·구조가 다름) ───────────────────────────────
   · 듀티(membership='duty'):
       저장키 dv6_s_duty, 셀키 nid|연|월|일 (nid = deptAttrs.duty.id),
       값 = 시프트 코드 문자열 'D'|'E'|'N'|'O'|'V'...
   · 비교대(membership='outpatient'):
       저장키 cal_sched_outpatient, 셀키 personId|연|월|일,
       값 = { am:{code,memo}, pm:{code,memo}, group }

   반환(공통): { dept, display, raw }
     dept    : 'duty' | 'outpatient' | null
     display : 화면용 문자열 (듀티='D', 비교대='근무/연차'처럼 am·pm 조합)
     raw     : 원본 값 (필요 시 호출부가 직접 해석)

   의존: window.PersonsStore. (저장소는 localStorage 직접 읽기 — 읽기 전용)
   ============================================================ */
(function (g) {
  'use strict';

  var DUTY_SCHED_KEY = 'dv6_s_duty';
  var OUT_SCHED_KEY  = 'cal_sched_outpatient';

  function _read(key){
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : {}; }
    catch(_){ return {}; }
  }
  function _cellKey(id, y, m, d){ return id+'|'+y+'|'+m+'|'+d; }

  // 비교대 슬롯 코드 → 한글 라벨 (cal-shifts 있으면 위임, 없으면 폴백)
  function _outLabel(code){
    if(!code) return '';
    if(g.CalShifts && typeof g.CalShifts.label==='function'){
      var l = g.CalShifts.label(code); if(l) return l;
    }
    var FB = { work:'근무', vac:'연차', month:'월차', half:'반차', sick:'휴가', off:'OFF', event:'경조' };
    return FB[code] || code;
  }

  // 한 사람의 그날 근무 조회 — 소속 장부에서.
  //   person = 풀 레코드(personId·membership·deptAttrs 포함)
  function _isDuty(dept){ return dept==='duty' || /^duty_\d+$/.test(dept); }
  function cellFor(person, y, m, d){
    if(!person) return { dept:null, display:'', raw:null };
    var dept = person.membership || null;
    if(!dept) return { dept:null, display:'', raw:null };

    if(_isDuty(dept)){
      var da = person.deptAttrs && person.deptAttrs[dept];
      var did = da && da.id;
      if(did==null) return { dept:dept, display:'', raw:null };
      // 병동별 스케줄 키: 'duty'→dv6_s_duty, 'duty_2'→dv6_s_duty_2
      var sched = _read('dv6_s_' + dept);
      var code = sched[_cellKey(did, y, m, d)] || '';
      return { dept:dept, display:code, raw:code };   // D/E/N/O
    }

    // 외래(비교대): membership 이 부서 id (outpatient_1 등) → cal_sched_<id> 에서 읽음
    var cs = _read('cal_sched_' + dept);
    var cell = cs[_cellKey(person.personId, y, m, d)] || null;
    if(_isDoctor(dept)){
      // 의사: doc_sched_<id> 에서 6속성 슬롯 읽음. 표시는 콜/내시경/협진/휴진 등.
      var ds = _read('doc_sched_' + dept);
      var dcell = ds[_cellKey(person.personId, y, m, d)] || null;
      if(!dcell) return { dept:dept, display:'', raw:null };
      var dlab = _docLabel(dcell);
      return { dept:dept, display:dlab, raw:dcell };
    }
    if(!cell) return { dept:dept, display:'', raw:null };
    var am = cell.am && cell.am.code ? _outLabel(cell.am.code) : '';
    var pm = cell.pm && cell.pm.code ? _outLabel(cell.pm.code) : '';
    var disp = (am && pm) ? (am===pm ? am : am+'/'+pm) : (am || pm || '');
    return { dept:dept, display:disp, raw:cell };
  }
  // 의사 부서 판정 + 의사 셀(오전/오후 6속성) → 짧은 라벨
  function _isDoctor(dept){ return /^doctor_\d+$/.test(dept); }
  function _slotLabel(s){
    if(!s) return '';
    var parts=[];
    if(s.block) parts.push('(X)');
    if(s.erCall==='D') parts.push('D콜'); else if(s.erCall==='N') parts.push('N콜');
    if(s.status==='휴진') parts.push('휴진');
    if(s.endo) parts.push('내시경');
    if(s.consult) parts.push('협진');
    return parts.join(' ');
  }
  function _docLabel(cell){
    var am=_slotLabel(cell.am), pm=_slotLabel(cell.pm);
    if(am && pm) return am===pm ? am : ('오전 '+am+' / 오후 '+pm);
    return am || pm || '';
  }

  // 특정 하루의 부서별 근무자 명단 — 일일 현황판.
  //   반환: { byDept: { deptId: { label, kind, groups:[{key,label,names:[]}], total } }, order:[deptId...] }
  function dailyRoster(y, m, d){
    var all = g.PersonsStore ? g.PersonsStore.list().filter(function(p){return !!p.membership;}) : [];
    var byDept = {};
    var order = [];
    // 부서 등장 순서 — 듀티 먼저, 그다음 레지스트리 순
    all.forEach(function(p){
      var dept = p.membership;
      if(!byDept[dept]){
        var kind = _isDuty(dept) ? 'duty' : String(dept).split('_')[0];
        byDept[dept] = { dept:dept, label:deptLabel(dept), kind:kind, groups:{}, total:0, working:0 };
        order.push(dept);
      }
    });
    all.forEach(function(p){
      var dept = p.membership;
      var bucket = byDept[dept];
      bucket.total++;
      var c = cellFor(p, y, m, d);
      if(bucket.kind==='duty'){
        // D/E/N/O 그룹
        var code = c.display || '';
        if(!code) return;            // 미입력은 명단에 안 띄움
        if(!bucket.groups[code]) bucket.groups[code] = [];
        bucket.groups[code].push(p.name||'?');
        if(code==='D'||code==='E'||code==='N') bucket.working++;
      } else if(bucket.kind==='doctor'){
        // 의사: 표시 라벨(D콜/N콜/내시경/협진/휴진 …)로 그룹. 라벨 없으면 미입력.
        var dl = c.display || '';
        if(!dl) return;
        if(!bucket.groups[dl]) bucket.groups[dl] = [];
        bucket.groups[dl].push(p.name||'?');
        // 휴진만 아니면 근무로 간주
        if(dl.indexOf('휴진')<0) bucket.working++;
      } else {
        // 외래: 오전/오후 근무 라벨로 그룹 (근무/연차/반차…)
        var raw = c.raw;
        if(!raw) return;
        var am = raw.am && raw.am.code ? _outLabel(raw.am.code) : '';
        var pm = raw.pm && raw.pm.code ? _outLabel(raw.pm.code) : '';
        var disp = (am && pm) ? (am===pm ? am : am+'/'+pm) : (am||pm||'');
        if(!disp) return;
        if(!bucket.groups[disp]) bucket.groups[disp] = [];
        bucket.groups[disp].push(p.name||'?');
        if(am==='근무'||pm==='근무') bucket.working++;
      }
    });
    return { byDept:byDept, order:order };
  }

  // 그날의 전체 요약 (현황판 상단 카드용)
  function dailySummary(y, m, d){
    var r = dailyRoster(y, m, d);
    var totalPeople=0, totalWorking=0, deptCount=0;
    r.order.forEach(function(id){
      var b=r.byDept[id]; totalPeople+=b.total; totalWorking+=b.working; deptCount++;
    });
    return { totalPeople:totalPeople, totalWorking:totalWorking, deptCount:deptCount };
  }

  // 전 직원(소속 있는 사람) 한 달 매트릭스 — ⑥ 통합 스케줄.
  function allMatrix(y, m, ndays){
    var all = g.PersonsStore ? g.PersonsStore.list() : [];
    var people = all.filter(function(p){ return !!p.membership; });
    people.sort(function(a,b){
      if(a.membership!==b.membership) return String(a.membership).localeCompare(String(b.membership));
      return (a.name||'').localeCompare(b.name||'', 'ko');
    });
    var cells = {};
    people.forEach(function(p){
      for(var d=1; d<=ndays; d++){ cells[p.personId+'|'+d] = cellFor(p, y, m, d); }
    });
    return { people:people, cells:cells };
  }

  function deptLabel(deptId){
    // dept-registry 에 등록된 이름이 최우선 (사용자가 지정한 병동명)
    if(g.DeptRegistry && g.DeptRegistry.get){
      var r = g.DeptRegistry.get(deptId); if(r && r.name) return r.name;
    }
    if(deptId==='duty') return '듀티(병동)';
    if(/^duty_\d+$/.test(deptId)){ var dn=deptId.split('_')[1]; return '병동 '+dn; }
    return deptId || '미배정';
  }

  // ⑥ 통합 통계: 부서별 인원 / 부서별 이번달 근무일 합 / 전체 연차 사용
  function deptStats(y, m, ndays){
    var all = g.PersonsStore ? g.PersonsStore.list().filter(function(p){return !!p.membership;}) : [];
    var byDept = {};
    var totalVac = 0;
    all.forEach(function(p){
      var dept = p.membership;
      if(!byDept[dept]) byDept[dept] = { dept:dept, label:deptLabel(dept), count:0, workDays:0 };
      byDept[dept].count++;
      for(var d=1; d<=ndays; d++){
        var c = cellFor(p, y, m, d);
        if(_isDuty(dept)){
          if(c.display==='D'||c.display==='E'||c.display==='N') byDept[dept].workDays++;
        } else {
          var raw = c.raw;
          if(raw){
            if(raw.am && raw.am.code==='work') byDept[dept].workDays+=0.5;
            if(raw.pm && raw.pm.code==='work') byDept[dept].workDays+=0.5;
          }
        }
      }
    });
    var vacByPerson = {};
    all.forEach(function(p){
      if(_isDuty(p.membership)) return;
      var cs = _read('cal_sched_'+p.membership);
      Object.keys(cs).forEach(function(k){
        if(k.indexOf(p.personId+'|'+y+'|'+m+'|')!==0) return;
        var cell = cs[k];
        ['am','pm'].forEach(function(slot){
          var cd = cell[slot] && cell[slot].code;
          if(cd==='vac'||cd==='month'||cd==='half'){ vacByPerson[p.personId]=(vacByPerson[p.personId]||0)+0.5; }
        });
      });
    });
    Object.keys(vacByPerson).forEach(function(pid){ totalVac += vacByPerson[pid]; });
    return {
      depts: Object.keys(byDept).map(function(k){ return byDept[k]; }),
      totalPeople: all.length,
      totalVacDays: totalVac
    };
  }

  // 관리그룹 전원의 한 달 근무 매트릭스.
  //   returns { people:[{personId,name,membership}...], cells:{ 'personId|d': {dept,display,raw} } }
  function monthMatrix(group, y, m, ndays){
    var people = g.PersonsStore ? g.PersonsStore.listByGroup(group) : [];
    var cells = {};
    people.forEach(function(p){
      for(var d=1; d<=ndays; d++){
        cells[p.personId+'|'+d] = cellFor(p, y, m, d);
      }
    });
    return { people:people, cells:cells };
  }

  g.ManagerView = {
    cellFor: cellFor,
    monthMatrix: monthMatrix,
    allMatrix: allMatrix,
    dailyRoster: dailyRoster,
    dailySummary: dailySummary,
    deptStats: deptStats,
    deptLabel: deptLabel,
    DUTY_SCHED_KEY: DUTY_SCHED_KEY,
    OUT_SCHED_KEY: OUT_SCHED_KEY
  };
  g.__MANAGERVIEW_LOADED__ = true;

})(window);
