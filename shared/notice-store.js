/* notice-store.js — 공지사항 저장소 (대시보드 하단)
 *
 * ▶ 서버 이전 대비 설계
 *   - 호출부는 NoticeStore.list()/add()/remove()/update() 만 사용한다.
 *   - 지금은 localStorage 구현(_backend.local). 서버로 옮길 때는 _backend 를
 *     fetch 기반 구현(_backend.remote)으로 바꾸기만 하면 호출부는 그대로다.
 *   - list() 는 동기(현재) / 비동기(서버) 양쪽을 견디도록 Promise 로 통일하지 않고,
 *     지금은 동기 배열을 반환하되, 서버 전환 시 await 가능하도록 _async 플래그를 둔다.
 *     (현 단계는 단순 동기. 전환 시 호출부에서 Promise.resolve 로 감싸 처리.)
 *
 *   레코드: { id, title, body, pinned, author, createdAt, updatedAt }
 *     id        : 'n_' + 타임스탬프36 (로컬). 서버 전환 시 서버 PK 로 대체.
 *     pinned    : 상단 고정 여부
 *     createdAt : epoch ms
 */
(function(g){
  'use strict';
  var LS_KEY = 'dv6_notices';

  // ── 로컬 백엔드 (localStorage) ──────────────────────────────
  var _backend = {
    load: function(){
      try{ var v = localStorage.getItem(LS_KEY); return v ? JSON.parse(v) : []; }
      catch(_){ return []; }
    },
    save: function(arr){
      try{ localStorage.setItem(LS_KEY, JSON.stringify(arr)); return true; }
      catch(_){ return false; }
    }
  };
  /* ▶ 서버 이전 시 예시 (참고용 — 지금은 미사용):
   * var _backendRemote = {
   *   load: function(){ return fetch('/api/notices').then(r=>r.json()); },
   *   save: function(arr){ return fetch('/api/notices',{method:'PUT',body:JSON.stringify(arr)}); }
   * };
   * 이 경우 list/add/remove 를 async 로 바꾸고 호출부에서 await.
   */

  function _newId(){ return 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5); }

  function _norm(r){
    r = r || {};
    return {
      id: r.id || _newId(),
      title: (r.title!=null ? String(r.title) : ''),
      body: (r.body!=null ? String(r.body) : ''),
      pinned: !!r.pinned,
      author: (r.author!=null ? String(r.author) : ''),
      createdAt: r.createdAt || Date.now(),
      updatedAt: r.updatedAt || r.createdAt || Date.now()
    };
  }

  // 정렬: 고정 먼저, 그 다음 최신순
  function _sorted(arr){
    return arr.slice().sort(function(a,b){
      if(!!b.pinned !== !!a.pinned) return (b.pinned?1:0) - (a.pinned?1:0);
      return (b.createdAt||0) - (a.createdAt||0);
    });
  }

  function list(){ return _sorted(_backend.load().map(_norm)); }

  function add(fields){
    var arr = _backend.load().map(_norm);
    var rec = _norm({ title:fields&&fields.title, body:fields&&fields.body,
                      pinned:fields&&fields.pinned, author:fields&&fields.author,
                      createdAt:Date.now(), updatedAt:Date.now() });
    arr.push(rec);
    _backend.save(arr);
    return rec;
  }

  function update(id, fields){
    var arr = _backend.load().map(_norm);
    var hit = null;
    arr.forEach(function(r){
      if(r.id===id){
        if(fields.title!==undefined)  r.title  = String(fields.title);
        if(fields.body!==undefined)   r.body   = String(fields.body);
        if(fields.pinned!==undefined) r.pinned = !!fields.pinned;
        r.updatedAt = Date.now();
        hit = r;
      }
    });
    if(hit) _backend.save(arr);
    return hit;
  }

  function remove(id){
    var arr = _backend.load().map(_norm);
    var next = arr.filter(function(r){ return r.id!==id; });
    if(next.length !== arr.length){ _backend.save(next); return true; }
    return false;
  }

  g.NoticeStore = { list:list, add:add, update:update, remove:remove };
})(window);
