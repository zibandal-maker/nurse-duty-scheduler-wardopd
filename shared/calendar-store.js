/* ============================================================
   shared/calendar-store.js — 공휴일 계산기 (모듈 분리 3단계, 방식 B)
   ------------------------------------------------------------
   하는 일: "이 날이 공휴일인가? 이름은? 대체공휴일은 며칠?"을 계산.
   세 가지 공휴일 소스를 한 곳에 격리한다:
     1) 기본 고정 공휴일 (코드에 내장된 폴백값)
     2) 음력 연휴 (설날·추석 — 매년 변동)
     3) 외부 갱신 (인터넷 date.nager.at API로 최신 공휴일 가져오기)
   부서(듀티/비교대)와 무관하므로 두 앱이 공유한다.

   방식 B: 일반 <script src>로 읽히고, CalendarStore를 전역(window)에 올린다.
           본체는 예전처럼 CalendarStore.isHoliday(...) 등을 그대로 호출.
   원본: duty/index.html v3.17.1 1603~1794 에서 그대로 복사 — 동작 불변.
   ============================================================ */
// ── CalendarStore — 국가 공휴일 도메인 캡슐화 (모듈화 1단계) ──────────────
// 목적: 공휴일 데이터 소스(하드코딩 → 외부 API → 서버 테이블)를 한 모듈로 격리.
//   호출부(isH/hn/isWH 등 수십 곳)는 인터페이스만 의존하고, 내부 소스는 자유 교체.
//   서버 이식 시 이 모듈의 build()/load()/refresh()만 ApiRepository로 갈아끼우면 됨.
// 공개 API (month는 1-based — 서버 holiday(year,date,name) 매핑과 일치):
//   CalendarStore.isHoliday(y, m, d)  -> bool
//   CalendarStore.name(y, m, d)       -> '공휴일명' | ''
//   CalendarStore.holidays(year)      -> [{month, day, name}]
//   CalendarStore.build()             -> 룩업 테이블 재생성 (구 buildHolLookup)
//   CalendarStore.load()              -> 저장된 외부 데이터 로드 후 build (구 loadSavedHolidays)
//   CalendarStore.refresh(years?)     -> nager.at 갱신(Promise<count>). UI 무관, 데이터만.
//   CalendarStore.lastUpdated()       -> ISO 문자열 | null
// 주의: 병동별 커스텀 이벤트(customEvents)는 별도 도메인(스펙 2.6) → 여기 포함 안 함.
//   국가 공휴일만 다루며, isH/hn 어댑터가 customEvents를 합산한다.
var CalendarStore = (function(){
  // ── private state ──────────────────────────────────────────────────────
  // 기본 고정 공휴일 (음력 연휴·대체공휴일 제외) — 외부 갱신 전 폴백값
  var BASE_HOL_LIST = {
    2025: [{m:1,d:1,n:'신정'},{m:3,d:1,n:'삼일절'},{m:5,d:1,n:'근로자'},{m:5,d:5,n:'어린이날'},
           {m:6,d:6,n:'현충일'},{m:8,d:15,n:'광복절'},{m:10,d:3,n:'개천절'},{m:10,d:9,n:'한글날'},{m:12,d:25,n:'성탄절'}],
    2026: [{m:1,d:1,n:'신정'},{m:3,d:1,n:'삼일절'},{m:5,d:1,n:'근로자'},{m:5,d:5,n:'어린이날'},
           {m:5,d:25,n:'부처님오신날'},{m:6,d:6,n:'현충일'},{m:8,d:15,n:'광복절'},{m:10,d:3,n:'개천절'},{m:10,d:9,n:'한글날'},{m:12,d:25,n:'성탄절'}],
    2027: [{m:1,d:1,n:'신정'},{m:3,d:1,n:'삼일절'},{m:5,d:1,n:'근로자'},{m:5,d:5,n:'어린이날'},
           {m:6,d:6,n:'현충일'},{m:8,d:15,n:'광복절'},{m:10,d:3,n:'개천절'},{m:10,d:9,n:'한글날'},{m:12,d:25,n:'성탄절'}],
  };
  // 음력 연휴 (설날/추석 — 매년 변동, 외부 갱신으로 덮어씀)
  var LUNAR_HOL_LIST = {
    2025: [{m:2,d:2,n:'설날'},{m:2,d:3,n:'설날'},{m:2,d:4,n:'설날'},
           {m:10,d:5,n:'추석'},{m:10,d:6,n:'추석'},{m:10,d:7,n:'추석'}],
    2026: [{m:2,d:17,n:'설날'},{m:2,d:18,n:'설날'},{m:2,d:19,n:'설날'},
           {m:9,d:28,n:'추석'},{m:9,d:29,n:'추석'},{m:9,d:30,n:'추석'}],
    2027: [{m:2,d:6,n:'설날'},{m:2,d:7,n:'설날'},{m:2,d:8,n:'설날'},
           {m:9,d:15,n:'추석'},{m:9,d:16,n:'추석'},{m:9,d:17,n:'추석'}],
  };
  // 대체공휴일 적용 대상 (관공서의 공휴일에 관한 규정)
  var SUBST_ELIGIBLE = {
    '삼일절':true,'광복절':true,'개천절':true,'한글날':true,
    '어린이날':true,'부처님오신날':true,'성탄절':true
  };
  // 설날/추석 연휴는 일요일과 겹칠 때만
  var LUNAR_SUBST = {'설날':true,'추석':true};

  // 외부 갱신 데이터 (nager.at) — refresh()가 여기에 저장. key: 'YYYY', value: [{m,d,n}]
  var EXT_HOL = {}; // 갱신되면 BASE+LUNAR를 대체
  // 최종 룩업 테이블
  var HOL  = {}; // {'YYYY': {'M': ['D',...]}}  (M, D는 문자열, M은 1-based)
  var HOLN = {}; // {'YYYY-M-D': '이름'}        (M은 1-based)

  var STORE_KEY = 'dv6_extHol';
  var UPD_KEY   = 'dv6_hol_updated';

  // ── 대체공휴일 계산 (법령 로직) ────────────────────────────────────────
  function calcSubstitutes(year, holEntries) {
    // holEntries: [{m,d,n}] — 해당 연도 모든 공휴일 (기본+음력)
    var taken = {};
    holEntries.forEach(function(h){ taken[year+'-'+h.m+'-'+h.d]=true; });
    var subs = [];
    function nextWeekday(yy, mm, dd) {
      var dt = new Date(yy, mm-1, dd+1);
      var safety = 0;
      while(safety < 14) {
        var dw = dt.getDay(); // 0=일,6=토
        var key = dt.getFullYear()+'-'+(dt.getMonth()+1)+'-'+dt.getDate();
        if(dw !== 0 && dw !== 6 && !taken[key]) {
          return {m: dt.getMonth()+1, d: dt.getDate(), dw: dw};
        }
        dt.setDate(dt.getDate()+1);
        safety++;
      }
      return null;
    }
    holEntries.forEach(function(h) {
      var dt = new Date(year, h.m-1, h.d);
      var dw = dt.getDay(); // 0=일,6=토
      var isSat = dw === 6;
      var isSun = dw === 0;
      if(SUBST_ELIGIBLE[h.n] && (isSat || isSun)) {
        var sub = nextWeekday(year, h.m, h.d);
        if(sub) {
          var key = year+'-'+sub.m+'-'+sub.d;
          if(!taken[key]) { taken[key] = true; subs.push({m:sub.m, d:sub.d, n:h.n+'대체'}); }
        }
      } else if(LUNAR_SUBST[h.n] && isSun) {
        var sub2 = nextWeekday(year, h.m, h.d);
        if(sub2) {
          var key2 = year+'-'+sub2.m+'-'+sub2.d;
          if(!taken[key2]) { taken[key2] = true; subs.push({m:sub2.m, d:sub2.d, n:h.n+'대체'}); }
        }
      }
    });
    return subs;
  }

  // ── 룩업 테이블 빌드 ───────────────────────────────────────────────────
  function build() {
    HOL = {}; HOLN = {};
    var years = [2025, 2026, 2027];
    var cy2 = new Date().getFullYear();
    for(var y = cy2-1; y <= cy2+3; y++) { if(years.indexOf(y) < 0) years.push(y); }
    years.forEach(function(y) {
      var entries = [];
      if(Object.keys(EXT_HOL).length > 0 && EXT_HOL[String(y)]) {
        entries = EXT_HOL[String(y)]; // 외부 갱신 데이터 (대체공휴일 포함 전체)
      } else {
        var base = (BASE_HOL_LIST[y]||[]).concat(LUNAR_HOL_LIST[y]||[]);
        var subs = calcSubstitutes(y, base);
        entries = base.concat(subs);
      }
      entries.forEach(function(h) {
        var ys = String(y), ms = String(h.m), ds = String(h.d);
        if(!HOL[ys]) HOL[ys] = {};
        if(!HOL[ys][ms]) HOL[ys][ms] = [];
        if(HOL[ys][ms].indexOf(ds) < 0) HOL[ys][ms].push(ds);
        HOLN[ys+'-'+ms+'-'+ds] = h.n;
      });
    });
  }

  // ── 저장된 외부 데이터 로드 ────────────────────────────────────────────
  function load() {
    try { var ext = localStorage.getItem(STORE_KEY); if(ext) EXT_HOL = JSON.parse(ext); } catch(e){}
    build();
  }

  // ── nager.at 갱신 (데이터만, UI 무관) → Promise<로드 개수> ─────────────
  function refresh(years) {
    var baseYear = new Date().getFullYear();
    years = years || [baseYear-1, baseYear, baseYear+1, baseYear+2];
    var newEXT = {};
    var totalCnt = 0;
    var KR_MAP = {
      "New Year's Day":'신정',"Independence Movement Day":'삼일절',
      "Labour Day":'근로자',"Labor Day":'근로자',"Children's Day":'어린이날',
      "Buddha's Birthday":'부처님오신날',"Buddhas Birthday":'부처님오신날',
      "Memorial Day":'현충일',"Liberation Day":'광복절',"National Foundation Day":'개천절',
      "Hangul Day":'한글날',"Christmas Day":'성탄절',
      "Lunar New Year's Eve":'설날전날',"Lunar New Year":'설날',
      "Chuseok Eve":'추석전날',"Chuseok":'추석',"The day after Chuseok":'추석다음날',
      "Substitute holiday":'대체공휴일',"Alternative holiday":'대체공휴일',
    };
    function mapName(item) {
      var en = item.name || '', lo = item.localName || '';
      if(/[가-힣]/.test(lo)) return lo.length > 5 ? lo.slice(0,5) : lo;
      if(KR_MAP[en]) return KR_MAP[en];
      if(/substitute|alternative/i.test(en)) return '대체공휴일';
      return lo || en || '공휴일';
    }
    var promises = years.map(function(y) {
      return fetch('https://date.nager.at/api/v3/PublicHolidays/'+y+'/KR')
        .then(function(r) { if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
        .then(function(list) {
          if(!Array.isArray(list)) return;
          newEXT[String(y)] = [];
          list.forEach(function(item) {
            var parts = item.date.split('-');
            newEXT[String(y)].push({m:parseInt(parts[1]), d:parseInt(parts[2]), n:mapName(item)});
            totalCnt++;
          });
        });
    });
    return Promise.all(promises).then(function() {
      if(totalCnt === 0) throw new Error('데이터 없음');
      EXT_HOL = newEXT;
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(EXT_HOL));
        localStorage.setItem(UPD_KEY, new Date().toISOString());
      } catch(e) {}
      build();
      return totalCnt;
    });
  }

  // ── 조회 API (month 1-based) ───────────────────────────────────────────
  function isHoliday(y, m, d) {
    var arr = (HOL[String(y)]||{})[String(m)]||[];
    return arr.indexOf(String(d)) >= 0;
  }
  function name(y, m, d) { return HOLN[y+'-'+m+'-'+d] || ''; }
  function holidays(year) {
    var ys = String(year), out = [], mm = HOL[ys]||{};
    Object.keys(mm).forEach(function(ms){
      (mm[ms]||[]).forEach(function(ds){
        out.push({month:parseInt(ms), day:parseInt(ds), name:HOLN[ys+'-'+ms+'-'+ds]||''});
      });
    });
    return out;
  }
  function lastUpdated() { try { return localStorage.getItem(UPD_KEY); } catch(e){ return null; } }

  return { isHoliday:isHoliday, name:name, holidays:holidays,
           build:build, load:load, refresh:refresh, lastUpdated:lastUpdated };
})();

// ── 전역 등록 (방식 B 핵심) ──────────────────────────────────────────
window.CalendarStore = CalendarStore;
window.__CALENDARSTORE_LOADED__ = true;
