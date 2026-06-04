/* ============================================================
   doctor/doc-render.js — 의사 셀 표기 규칙 (M6, 방식 B)
   ------------------------------------------------------------
   하는 일: 6속성 셀 → 화면 시각요소(배경색·좌측띠·글자·배지)로 변환.
            "속성이 어떻게 보이는가"의 규칙을 여기 한 곳에 캡슐화한다.
            색 의미가 바뀌거나 우선순위가 바뀌면 이 파일만 고친다(변하는 것 격리).

   ── 색 우선순위 (핸드오프 2-3 확정 — 배경은 하나만 칠함) ──────
     1) 휴진(status='휴진')  → 주황 흐림  (다른 색 무시)
     2) 협진당직(consult)    → 노랑
     3) 내시경(endo)         → 파랑
     4) 그 외                → 흰색 + D/N 글자
   ── 중첩 표시 ──────────────────────────────────────────────
     · (X) block  → 색과 무관하게 좌측 빨강 띠
     · erCall D/N → 글자(주간콜 D / 야간콜 N)
     · memo       → 작은 회색 텍스트

   ⚠ 색 의미 주의 (사용자 정정):
     노랑=협진당직(내시경 아님), 파랑=내시경, 주황=휴진, (X)=콜·협진 금지(입원 아님).

   출력 계약: render(cell) → {
       bg      : 배경색(CSS),
       leftBar : 좌측 띠 색 | null,
       text    : 셀 본문 표시 문자열(D / N / 빈값),
       textColor: 본문 글자색,
       badges  : [{label, kind}]   // '협진'·'내시경' 등 작은 배지
       dim     : true|false        // 휴진 흐림 처리 여부
   }
   ★ 색값은 theme.css 의미색과 정렬: 주황=--orange, 파랑=--primary, 노랑은 의사 고유.
   ============================================================ */
(function (g) {
  'use strict';

  // 의사 화면 전용 색 (theme 토큰과 충돌 없게 명시값. 노랑만 신규)
  var COLOR = {
    restBg   : '#F7E5CC',   // 휴진 주황 흐림 (--warm-bg보다 진하게, 흐림은 dim으로)
    restText : '#9A6618',
    consultBg: '#FCF3C4',   // 협진당직 노랑
    consultText:'#8A6D00',
    endoBg   : '#DCEBFB',   // 내시경 파랑 (--primary 계열 연하게)
    endoText : '#0C447C',
    blockBar : '#C0392B',   // (X) 좌측 빨강 띠 (--warn)
    dCall    : '#1A8C62',   // 주간콜 D — 초록(듀티 D와 통일감)
    nCall    : '#5B3FA0',   // 야간콜 N — 보라(듀티 N과 통일감)
    plain    : '#ffffff'
  };

  // 한 셀의 시각 표현 계산
  function render(cell){
    cell = cell || {};
    var out = {
      bg: COLOR.plain, leftBar: null, text: '', textColor: '#1a1a18',
      badges: [], dim: false
    };

    // 1) 배경색 — 우선순위 적용 (하나만)
    if(cell.status === '휴진'){
      out.bg = COLOR.restBg; out.dim = true; out.textColor = COLOR.restText;
    } else if(cell.consult){
      out.bg = COLOR.consultBg; out.textColor = COLOR.consultText;
    } else if(cell.endo){
      out.bg = COLOR.endoBg; out.textColor = COLOR.endoText;
    } else if(cell.work && !cell.erCall){
      out.bg = '#EAF5EE'; out.textColor = '#1A7A47';   // 명시적 근무 — 옅은 초록
    }

    // 2) 좌측 빨강 띠 — (X) block (색 무관 중첩)
    if(cell.block) out.leftBar = COLOR.blockBar;

    // 3) 본문 글자 — 응급실 콜 D/N
    if(cell.erCall === 'D'){ out.text = 'D'; if(!cell.consult && !cell.endo && cell.status!=='휴진') out.textColor = COLOR.dCall; }
    else if(cell.erCall === 'N'){ out.text = 'N'; if(!cell.consult && !cell.endo && cell.status!=='휴진') out.textColor = COLOR.nCall; }

    // 4) 배지 — 속성 라벨 (휴진이면 다른 배지 생략: 흐림으로 충분)
    //    label=풀네임(범례·넓은 셀), short=약자(좁은 셀 기본)
    if(cell.status !== '휴진'){
      if(cell.consult) out.badges.push({label:'협진', short:'협', kind:'consult'});
      if(cell.endo)    out.badges.push({label:'내시경', short:'내', kind:'endo'});
    }
    if(cell.block) out.badges.push({label:'금지', short:'X', kind:'block'});

    return out;
  }

  // 배지 색 (CSS class 대신 인라인용)
  function badgeStyle(kind){
    switch(kind){
      case 'consult': return {bg:COLOR.consultBg, fg:COLOR.consultText, bd:'#E6D27A'};
      case 'endo':    return {bg:COLOR.endoBg, fg:COLOR.endoText, bd:'#A9CBF0'};
      case 'block':   return {bg:'#FCEBEB', fg:COLOR.blockBar, bd:'#E5A8A0'};
      default:        return {bg:'#eee', fg:'#555', bd:'#ddd'};
    }
  }

  // 엑셀 스타일 한 줄 텍스트 — 이름 제외(이름은 좌측 칸에 별도).
  //   접두 (X)/D/N + 접미 괄호(내시경·협진·휴진·메모). 엑셀 원본 표기와 일치.
  //   예: '(X)내시경', 'N휴진', 'D', '협진'. 빈 슬롯은 ''.
  function lineText(cell){
    cell = cell || {};
    var pre = '';
    if(cell.block) pre += '(X)';
    if(cell.erCall === 'D') pre += 'D';
    else if(cell.erCall === 'N') pre += 'N';
    var tags = [];
    if(cell.status === '휴진') tags.push('휴진');
    if(cell.endo)    tags.push('내시경');
    if(cell.consult) tags.push('협진');
    if(cell.memo)    tags.push(String(cell.memo));
    var suf = tags.length ? '('+tags.join('·')+')' : '';
    var out = pre + suf;
    // 다른 표기가 전혀 없고 명시적 근무(work)만 있으면 '근무'로 표시(빈칸과 구별)
    if(!out && cell.work && cell.status!=='휴진') return '근무';
    return out;
  }

  g.DocRender = { render: render, badgeStyle: badgeStyle, lineText: lineText, COLOR: COLOR };
  g.__DOCRENDER_LOADED__ = true;

})(window);
