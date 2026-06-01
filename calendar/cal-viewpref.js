/* ============================================================
   calendar/cal-viewpref.js — 뷰/레이아웃 환경설정 (M3d-3a, 방식 B)
   ------------------------------------------------------------
   "장부(근무 데이터)는 그대로, 보는 방식만 전환" — 그 '보는 방식'을 저장.
   근무 데이터(cal_sched)와 분리된 키(cal_viewpref_*)에 둔다.

   옵션:
     view     : 'doctor' | 'slot'        현재 보기 (의사표형 / 자리-슬롯형)
     slotMode : 'byCode' | 'byHalf'      슬롯형일 때 슬롯 나누는 방식
                  byCode = 근무형별 슬롯(오전-근무·오전-연차·오후-근무…)
                  byHalf = 오전/오후 2슬롯만
     defaultView : 'doctor' | 'slot'     앱 열 때 기본 뷰
   ★ 슬롯 방식을 코드에 고정하지 않고 옵션으로 둔 이유:
     현장 운영이 부서마다·시기마다 달라 코드 수정 없이 바꿔야 실사용에서 안 막힌다.
   ============================================================ */
(function (g) {
  'use strict';

  function vpKey(){ return 'cal_viewpref_' + (g.WARD_ID || 'outpatient'); }

  var DEFAULTS = { view:'doctor', slotMode:'byHalf', defaultView:'doctor' };
  var pref = null;

  function _merge(){
    var o={}, i, src, k;
    for(i=0;i<arguments.length;i++){ src=arguments[i]; if(!src) continue;
      for(k in src){ if(Object.prototype.hasOwnProperty.call(src,k)) o[k]=src[k]; } }
    return o;
  }
  function load(){
    try{
      var raw = localStorage.getItem(vpKey());
      pref = raw ? _merge(DEFAULTS, JSON.parse(raw)) : _merge(DEFAULTS);
    }catch(e){ pref = _merge(DEFAULTS); }
    // 앱 열 때 현재 뷰 = 기본 뷰로 시작
    pref.view = pref.defaultView || 'doctor';
    return pref;
  }
  function _ensure(){ if(!pref) load(); return pref; }
  function save(){
    try{ localStorage.setItem(vpKey(), JSON.stringify(_ensure())); return null; }
    catch(e){ return e; }
  }

  var CalViewPref = {
    all: function(){ return _merge(_ensure()); },
    get: function(k){ return _ensure()[k]; },
    set: function(k, v){ _ensure()[k] = v; return save(); },
    // 의사표 ↔ 슬롯 토글 (현재 뷰만 바꿈, 저장 안 함=세션성. 원하면 save 호출)
    setView: function(v){ _ensure().view = v; },
    load: load,
    key: vpKey
  };

  g.CalViewPref = CalViewPref;
  g.__CALVIEWPREF_LOADED__ = true;

})(window);
