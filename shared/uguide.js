/* 공용 코너 도움말 — 우하단 아이콘 버튼 + 팝업.
   사용법: 페이지에서 window.UGUIDE_ITEMS 배열을 정의한 뒤 이 스크립트를 로드.
     window.UGUIDE_ITEMS = [
       { icon:'📖', title:'사용 가이드', html:'<p>...</p>' },
       { icon:'ⓘ', title:'정보·면책', html:'<p>...</p>' }   // 선택
     ];
   스타일은 shared/uguide.css 가 담당. 화면 어디서든 같은 모양·동작. */
(function(g){
  'use strict';
  function build(){
    var items = g.UGUIDE_ITEMS || [];
    if(!items.length) return;
    // 코너 버튼 묶음
    var bar = document.createElement('div');
    bar.className = 'ug-corner';
    // 팝업 컨테이너
    var pops = [];
    items.forEach(function(it, i){
      var id = 'ugpop_'+i;
      var btn = document.createElement('button');
      btn.type='button'; btn.className='ug-cbtn'; btn.textContent=it.icon||'📖';
      btn.title = it.title||'도움말';
      btn.addEventListener('click', function(e){ e.stopPropagation(); toggle(id); });
      bar.appendChild(btn);

      var pop = document.createElement('div');
      pop.className='ug-pop'; pop.id=id;
      pop.innerHTML = '<div class="ug-head">'+(it.icon||'')+' '+esc(it.title||'도움말')
        + '<button type="button" class="ug-x" aria-label="닫기">✕</button></div>'
        + '<div class="ug-body">'+(it.html||'')+'</div>';
      pop.querySelector('.ug-x').addEventListener('click', function(e){ e.stopPropagation(); pop.classList.remove('open'); });
      document.body.appendChild(pop);
      pops.push(pop);
    });
    document.body.appendChild(bar);

    function toggle(id){
      var t=document.getElementById(id); if(!t) return;
      var willOpen=!t.classList.contains('open');
      pops.forEach(function(p){ p.classList.remove('open'); });
      if(willOpen) t.classList.add('open');
    }
    // 바깥 클릭 닫기
    document.addEventListener('click', function(e){
      if(e.target.closest('.ug-pop')||e.target.closest('.ug-corner')) return;
      pops.forEach(function(p){ p.classList.remove('open'); });
    });
  }
  function esc(s){ return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})(window);
