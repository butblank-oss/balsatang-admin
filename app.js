'use strict';
const { store, CATEGORY_KO, SAFE_KO, FUNC_KO, TYPE_KO, AGE_KO, SIZE_KO, SHOP_KO,
        COUNTRY_KO, CONCERN_KO, estimateCarb, totalScore, autoHeadline, uid, clone } = BS;

const $  = s => document.querySelector(s);
const el = id => document.getElementById(id);
const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const at  = s => esc(s).replace(/"/g,'&quot;');
const ico = (n,z=16) => ICONS[n] ? `<svg class="i" width="${z}" height="${z}" viewBox="0 0 24 24">${ICONS[n]}</svg>` : '';
const opts = (o,sel,ph) => (ph?`<option value="">${ph}</option>`:'')
  + Object.entries(o).map(([k,v])=>`<option value="${k}"${k===sel?' selected':''}>${v}</option>`).join('');

let toastT;
function toast(m){ const t=el('toast'); t.textContent=m; t.classList.add('on');
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('on'),1900); }
function save(){
  const ok = store.save();
  markDirty();
  if(ok === false) toast('브라우저 저장 용량이 가득 찼어요 — 내보내기로 파일을 받아주세요');
  return ok;
}
function markDirty(){ el('dirtyDot').innerHTML = store.dirty ? '<span class="dirty-dot"></span>' : ''; }

/* ═══ 한글 입력 ═══
   한글은 한 글자를 만드는 동안 IME 가 그 입력칸을 붙잡고 있다. 목록을 다시
   그리면서 그 칸이 문서에서 잠깐이라도 떨어져 나가면 조합이 취소되어
   'ㅈㅣㅇㅜㅍㅣㄱ' 처럼 자모가 흩어진다. 노드를 붙잡았다가 도로 꽂아도
   소용없다 — 떨어지는 순간 이미 취소된다.

   그래서 검색칸이 든 껍데기(…Shell)와 조건에 따라 바뀌는 목록(…List)을
   나눴다. 검색할 때는 목록만 갈아끼우고 입력칸은 손대지 않는다.
   새 목록 화면을 만들 때도 이 규칙을 지켜야 한다. */

/* ═══ NAV ═══ */
const NAV = [
  {h:'메인'},
  {k:'dash',   label:'대시보드',    ico:'chart'},
  {h:'콘텐츠 관리'},
  /* 사료·가격·심사는 어드민 안에서 진짜 편집기를 띄운다.
     예전에 이 화면이 갖고 있던 사료 편집기는 지금 데이터 형태를 몰라서
     고쳐도 사이트에 닿지 않았다. 그래서 화면만 여기 두고 알맹이를 바꿨다. */
  {k:'foods',  label:'사료 관리',    ico:'package'},
  {k:'ingr',   label:'성분 관리',    ico:'microscope'},
  {k:'tags',   label:'맞춤찾기 태그', ico:'paw'},
  {h:'운영'},
  {k:'recall', label:'리콜 관리',    ico:'siren', badge:()=>store.recalls.filter(r=>r.active).length},
  {k:'price',  label:'가격 관리',    ico:'coins'},
  {k:'review', label:'발행 심사',    ico:'check'},
  {k:'article',label:'콘텐츠',       ico:'book'},
  {k:'reviews', label:'리뷰 관리',   ico:'star'}
];

/* 어드민 안에 띄우는 편집기.
   사료·가격·심사는 GitHub 에 직접 커밋하는 화면이 따로 있고, 그 화면이
   진짜다. 코드를 두 벌로 베끼면 반드시 어긋나므로(예전 사료 편집기가 그래서
   구매 링크를 버렸다) 같은 화면을 여기에 그대로 띄운다.
   토큰은 같은 도메인의 localStorage 라 한 번만 넣으면 세 곳이 함께 쓴다. */
const EMBED = {
  foods:  { src:'foods.html',  title:'사료 관리',
            note:'사료 정보·성분표·원료·판정 카드·맞춤 태그를 고치고 GitHub 에 커밋합니다. 몇 분 뒤 프론트에 그대로 반영됩니다.' },
  price:  { src:'foods.html',  title:'가격 관리',
            note:'가격과 쿠팡 구매 링크는 사료 편집 패널에서 고칩니다. 아래 목록에서 <b>구매링크 없음</b> 필터를 쓰세요.' },
  review: { src:'review.html', title:'발행 심사',
            note:'수집된 사료를 검토하고 발행합니다. 발행하면 data.js 에 병합되어 커밋됩니다.' }
};
function pgEmbed(k){
  const e = EMBED[k];
  el('wrap').innerHTML = `
    <div class="card" style="margin-bottom:12px;background:var(--pri-soft);border-color:#23386b;
         color:#9DBBF5;font-size:12.5px;line-height:1.65">${e.note}</div>
    <iframe src="${e.src}" title="${e.title}"
      style="width:100%;height:calc(100vh - 190px);min-height:520px;border:1px solid var(--line);
             border-radius:12px;background:var(--bg);display:block"></iframe>`;
}
const TITLES = {dash:'대시보드', foods:'사료 관리', ingr:'성분 관리', tags:'맞춤찾기 태그 관리',
  recall:'리콜 관리', price:'가격 관리', article:'콘텐츠 관리', reviews:'리뷰 관리',
  review:'발행 심사', wizard:'사료 등록'};

let page = 'dash';
function renderNav(){
  el('nav').innerHTML = NAV.map(n=>{
    if(n.h) return `<div class="nav-h">${n.h}</div>`;
    const b = n.badge ? n.badge() : 0;
    return `<button class="nav-i${n.k===page?' on':''}" onclick="go('${n.k}')">
      ${ico(n.ico,15)}${n.label}${b?`<span class="dot">${b}</span>`:''}</button>`;
  }).join('');
}
function go(k, arg){
  page = k;
  el('pgTitle').textContent = TITLES[k] || '';
  renderNav();
  if(EMBED[k]){ pgEmbed(k); el('wrap').scrollTop = 0; return; }
  ({dash:pgDash, ingr:pgIngr, tags:pgTags, recall:pgRecall,
    article:pgArticle, reviews:pgReview}[k] || pgDash)(arg);
  el('wrap').scrollTop = 0;
}

/* ═══ 대시보드 ═══ */
function pgDash(){
  const active = store.recalls.filter(r=>r.active).length;
  const pub = store.foods.filter(f=>f.status==='published').length;
  const draft = store.foods.filter(f=>f.status==='draft').length;
  const noPrice = store.foods.filter(f=>!f.prices.length).length;
  const priceN = store.foods.reduce((a,f)=>a+f.prices.length,0);
  const unknown = store.unknownIngredients().length;
  const recent = store.foods.slice(0,4);
  const todos = [
    active   ? {c:'var(--bad)',  t:`활성 리콜 ${active}건 — 즉시 확인 필요`, a:'처리하기', go:'recall'} : null,
    noPrice  ? {c:'var(--warn)', t:`가격 미등록 ${noPrice}종 업데이트`,      a:'업데이트', go:'price'} : null,
    unknown  ? {c:'var(--pri)',  t:`성분 사전에 없는 원료 ${unknown}종`,     a:'등록하기', go:'ingr'}   : null,
    {c:'var(--pri)', t:'이번 주 콘텐츠 1건 발행 예정', a:'작성하기', go:'article'}
  ].filter(Boolean);

  el('wrap').innerHTML = `
  <div class="kpis">
    <div class="kpi${active?' alert':''}">
      <div class="kpi-l">${ico('siren',14)}활성 리콜</div>
      <div class="kpi-v" style="color:${active?'var(--bad)':'var(--ink)'}">${active}</div>
      <div class="kpi-s">${active?'즉시 처리 필요':'현재 이슈 없음'}</div></div>
    <div class="kpi">
      <div class="kpi-l">${ico('package',14)}등록된 사료</div>
      <div class="kpi-v">${pub}</div>
      <div class="kpi-s">임시저장 ${draft}건 포함</div></div>
    <div class="kpi">
      <div class="kpi-l">${ico('coins',14)}가격 레코드</div>
      <div class="kpi-v" style="color:var(--warn)">${priceN}</div>
      <div class="kpi-s">${noPrice}종 가격 미등록</div></div>
    <div class="kpi${unknown?'':' ok'}">
      <div class="kpi-l">${ico('microscope',14)}성분 사전</div>
      <div class="kpi-v" style="color:${unknown?'var(--warn)':'var(--good)'}">${store.ingredients.length}</div>
      <div class="kpi-s">${unknown?`미등록 원료 ${unknown}종`:'모든 원료 등록 완료'}</div></div>
  </div>
  <div class="grid2">
    <div class="card">
      <div class="sec-t">오늘 할 일</div>
      ${todos.map(t=>`<div class="todo"><span class="bul" style="background:${t.c}"></span>
        ${t.t}<a onclick="go('${t.go}')">${t.a}</a></div>`).join('')}
    </div>
    <div class="card">
      <div class="sec-t">최근 등록 사료</div>
      ${recent.map(f=>`<div class="rec-i">
        <div class="rec-ic">${hasThumb(f)?`<img src="${f.thumb}" alt="">`:ico(BS.deriveIco(f),16)}</div>
        <div style="min-width:0">
          <div class="rec-n">${esc(f.name)}</div>
          <div class="rec-m">${esc(f.brand)} · ${TYPE_KO[f.type]||f.type}</div>
        </div>
        <div class="rec-s" style="color:${f.score>=8?'var(--good)':f.score>=6?'var(--warn)':'var(--bad)'}">${f.score}</div>
      </div>`).join('')}
    </div>
  </div>`;
  el('alertbar').classList.toggle('on', active>0);
  if(active) el('alertTxt').textContent = `리콜 발생 — 즉시 처리 필요 (${active}건)`;
}

/* ═══ 사료 관리 ═══ */
let fQ='', fType='', fStatus='', fPage=1;
/* 검색 입력칸이 있는 껍데기와, 조건에 따라 바뀌는 목록을 나눈다.

   한 덩어리로 다시 그리면 입력칸이 문서에서 잠깐 떨어져 나간다. 노드를
   붙잡았다가 도로 꽂아도 소용없다 — 떨어지는 순간 브라우저가 한글 조합을
   취소해서 'ㅈㅣㅇㅜㅍㅣㄱ' 처럼 자모가 흩어진다.
   그래서 입력칸이 든 껍데기는 그대로 두고 목록만 갈아끼운다. */
/* 대시보드 '최근 등록 사료' 가 쓴다. https 로 시작하지 않는 주소는 안 불러와진다. */
function hasThumb(f){ return /^https:\/\//.test(f.thumb||''); }

/* 예전 사료 편집기는 걷어냈다.

   이 화면이 만들어질 때의 데이터 형태를 기준으로 쓰여 있어서, 여기서 고친 값은
   사이트에 닿지 않았고 내보내면 FOODS_ALL 선언과 구매 링크가 빠졌다.
   지금은 사료 관리(foods.html)를 어드민 안에 그대로 띄운다 — 코드가 한 벌이라
   어긋날 자리가 없다. 자세한 내용은 docs/운영-가이드.md.

   pager 는 성분 관리가 아직 쓴다. */
function pager(cur,pages,varName,total,fn){
  const btn=(p,l,d)=>`<button ${d?'disabled':''} class="${p===cur?'on':''}" onclick="${varName}=${p};${fn}()">${l||p}</button>`;
  let out=btn(cur-1,'‹',cur<=1);
  for(let p=1;p<=pages;p++) if(p===1||p===pages||Math.abs(p-cur)<=1) out+=btn(p);
    else if(Math.abs(p-cur)===2) out+='<button disabled>…</button>';
  out+=btn(cur+1,'›',cur>=pages);
  return `<div class="pager">${out}<span class="n">총 ${total}건</span></div>`;
}

/* ═══ 성분 관리 ═══ */
let iQ='', iSafe='', iCat='', iPage=1;
/* 사료 관리와 같은 이유로 껍데기와 목록을 나눈다 — 입력칸을 건드리지 않는다 */
function pgIngr(){
  el('wrap').innerHTML = ingrShell();
  pgIngrList();
}
function ingrShell(){
  const unknown = store.unknownIngredients();
  return `
  ${unknown.length?`<div class="card" style="margin-bottom:14px;border-color:#4A3A12;background:#17130A">
    <div style="display:flex;align-items:center;gap:9px">
      ${ico('alert',16)}<b style="font-size:12.5px">성분 사전에 없는 원료 ${unknown.length}종</b>
      <div style="flex:1"></div>
      <button class="btn sm pri" onclick="addAllUnknown()">일괄 등록</button></div>
    <div style="margin-top:9px;font-size:11.5px;color:var(--ink2);line-height:1.7">
      ${unknown.slice(0,14).map(u=>`${esc(u.name)}<span style="color:var(--muted)"> (${u.n})</span>`).join(' · ')}
      ${unknown.length>14?` 외 ${unknown.length-14}종`:''}</div></div>`:''}
  <div class="filters">
    <input class="inp fw" style="width:220px" placeholder="성분명 검색" value="${at(iQ)}"
           oninput="iQ=this.value;iPage=1;pgIngrList()">
    <select class="inp fw" onchange="iSafe=this.value;iPage=1;pgIngrList()">
      <option value="">전체 등급</option>${opts(SAFE_KO,iSafe)}</select>
    <select class="inp fw" onchange="iCat=this.value;iPage=1;pgIngrList()">
      <option value="">전체 카테고리</option>${opts(CATEGORY_KO,iCat)}</select>
    <div style="flex:1"></div>
    <button class="btn pri" onclick="openIngr()">+ 성분 등록</button>
  </div>
  <div id="ingrList"></div>`;
}
function pgIngrList(){
  let list = store.ingredients;
  if(iQ) list = list.filter(i=>(i.name+i.nameEn).toLowerCase().includes(iQ.toLowerCase()));
  if(iSafe) list = list.filter(i=>i.safe===iSafe);
  if(iCat) list = list.filter(i=>i.cat===iCat);
  const per=12, pages=Math.max(1,Math.ceil(list.length/per));
  iPage=Math.min(iPage,pages);
  const rows=list.slice((iPage-1)*per, iPage*per);

  el('ingrList').innerHTML = `
  <div class="card" style="padding:0">
    ${rows.length?`<table><thead><tr>
      <th>성분명</th><th>카테고리</th><th>안전 등급</th><th>알러젠</th><th>기능</th>
      <th>포함 사료</th><th style="width:104px">관리</th></tr></thead><tbody>
    ${rows.map(i=>`<tr>
      <td><div class="t-main">${esc(i.name)}</div>${i.nameEn?`<div class="t-sub">${esc(i.nameEn)}</div>`:''}</td>
      <td><span class="tag mute">${CATEGORY_KO[i.cat]||i.cat}</span></td>
      <td><span class="tag ${i.safe==='safe'?'good':i.safe==='caution'?'warn':'bad'}">${SAFE_KO[i.safe]}</span>
          ${i.basis?` <span title="${at(i.basis)}" style="color:var(--muted);cursor:help">ⓘ</span>`:''}</td>
      <td>${i.allergen?'<span class="tag warn">알러젠</span>':'<span style="color:var(--muted)">—</span>'}</td>
      <td>${i.func?`<span class="tag info">${FUNC_KO[i.func]}</span>`:'<span style="color:var(--muted)">—</span>'}</td>
      <td><span class="tag mute">${store.ingredientUsage(i.name)}</span></td>
      <td><button class="btn sm" onclick="openIngr('${i.id}')">수정</button>
          <button class="btn sm dan" onclick="delIngr('${i.id}')">삭제</button></td>
    </tr>`).join('')}</tbody></table>`:`<div class="empty">조건에 맞는 성분이 없어요</div>`}
  </div>
  ${pages>1?pager(iPage,pages,'iPage',list.length,'pgIngrList'):''}`;
}
function addAllUnknown(){
  for(const u of store.unknownIngredients())
    store.ingredients.push({...store.newIngredient(), name:u.name, cat:'other', safe:'safe'});
  store.ingredients.sort((a,b)=>a.name.localeCompare(b.name,'ko'));
  save(); pgIngr(); toast('일괄 등록했어요 — 등급·설명을 채워주세요');
}
function delIngr(id){
  const g=store.ingredients.find(x=>x.id===id); if(!g) return;
  const used=store.ingredientUsage(g.name);
  if(used && !confirm(`'${g.name}'은 사료 ${used}종에서 쓰이고 있어요. 삭제할까요?`)) return;
  store.ingredients=store.ingredients.filter(x=>x.id!==id); save(); pgIngr(); toast('삭제했어요');
}

/* ═══ 맞춤찾기 태그 ═══ */
function pgTags(){
  const sec = (key,title,ico2,desc) => {
    const arr=store.tags[key];
    return `<div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        ${ico(ico2,16)}<b style="font-size:13.5px">${title}</b>
        <span style="font-size:10.5px;color:var(--muted)">${desc}</span></div>
      <table><thead><tr><th style="width:44px">순서</th><th>라벨 <span style="color:var(--muted)">(소비자에게 보이는 이름)</span></th>
        <th style="width:132px">아이콘 이름</th><th style="width:66px">노출</th></tr></thead><tbody>
      ${arr.map((t,i)=>`<tr>
        <td><div class="iarrows">
          <button onclick="moveTag('${key}',${i},-1)" ${i===0?'disabled':''}>${ico('chevronRight',11)}</button>
          <button onclick="moveTag('${key}',${i},1)" ${i===arr.length-1?'disabled':''}>${ico('chevronRight',11)}</button>
        </div></td>
        <td><input class="inp" value="${at(t.label)}" oninput="store.tags.${key}[${i}].label=this.value;save()">
            <div class="t-sub" style="margin-top:3px">key: ${t.key}</div></td>
        <td><input class="inp" value="${at(t.ico||'')}" placeholder="(선택)"
                   oninput="store.tags.${key}[${i}].ico=this.value;save()"></td>
        <td><label class="sw"><input type="checkbox" ${t.on?'checked':''}
              onchange="store.tags.${key}[${i}].on=this.checked;save()"><i></i></label></td>
      </tr>`).join('')}</tbody></table></div>`;
  };
  el('wrap').innerHTML = `
    <div class="card" style="margin-bottom:14px;border-color:var(--pri);background:var(--pri-soft)">
      <div style="font-size:11.5px;line-height:1.75;color:#9DBEFF">
        소비자 <b>맞춤찾기</b>(우리 아이를 알려주세요) 화면에 보이는 고민·나이·체형 옵션과
        아이콘·노출 순서를 관리해요. 옵션의 식별값(key)은 앱 코드와 연결돼 있어 수정할 수 없고,
        보이는 방식만 바꿀 수 있어요.</div></div>
    ${sec('concern','고민','soup','복수 선택 가능 · 앱 홈 칩에도 반영')}
    ${sec('age','나이','baby','단일 선택 나이 구간')}
    ${sec('size','체형','scale','단일 선택 체형(몸무게) 구간')}`;
}
function moveTag(key,i,d){
  const a=store.tags[key], j=i+d; if(j<0||j>=a.length) return;
  [a[i],a[j]]=[a[j],a[i]]; save(); pgTags();
}

/* ═══ 리콜 ═══ */
function pgRecall(){
  el('wrap').innerHTML = `
  <div class="filters"><div style="flex:1"></div>
    <button class="btn pri" onclick="openRecall()">🚨 리콜 등록</button></div>
  <div class="card" style="padding:0">
    ${store.recalls.length?`<table><thead><tr>
      <th>사료</th><th>심각도</th><th>사유</th><th>출처</th><th>등록일</th><th style="width:104px">관리</th>
    </tr></thead><tbody>${store.recalls.map((r,i)=>{
      const f=store.foodById(r.foodId);
      return `<tr>
        <td><div class="t-main">${esc(f?f.name:'—')}</div><div class="t-sub">${esc(f?f.brand:'')}</div></td>
        <td><span class="tag ${r.severity==='critical'?'bad':'warn'}">${r.severity==='critical'?'Critical':'Warning'}</span></td>
        <td><div class="t-sub" style="color:var(--ink2)">${esc(r.reason)}</div></td>
        <td>${esc(r.agency||'—')}</td><td>${r.date}</td>
        <td><button class="btn sm" onclick="toggleRecall(${i})">${r.active?'해제':'재활성'}</button>
            <button class="btn sm dan" onclick="delRecall(${i})">삭제</button></td>
      </tr>`}).join('')}</tbody></table>`:`<div class="empty">등록된 리콜이 없어요</div>`}
  </div>`;
}
function toggleRecall(i){
  const r=store.recalls[i]; r.active=!r.active;
  const f=store.foodById(r.foodId);
  if(f) f.recall = r.active ? r.reason : null;
  save(); pgRecall(); renderNav();
}
function delRecall(i){
  if(!confirm('리콜 기록을 삭제할까요?')) return;
  const r=store.recalls.splice(i,1)[0];
  const f=store.foodById(r.foodId); if(f) f.recall=null;
  save(); pgRecall(); renderNav();
}

/* ═══ 콘텐츠 ═══ */
function pgArticle(){
  el('wrap').innerHTML = `
  <div class="filters">
    <div style="font-size:11.5px;color:var(--muted);align-self:center">
      앱에 노출되는 콘텐츠(아티클)를 관리해요. 발행 상태인 글만 사용자에게 보여요.</div>
    <div style="flex:1"></div>
    <button class="btn pri" onclick="editArticle()">+ 콘텐츠 추가</button>
  </div>
  <div class="card" style="padding:0">
    ${store.articles.length?`<table><thead><tr>
      <th style="width:48px">순서</th><th>제목</th><th>분류</th><th>상태</th><th>수정일</th>
      <th style="width:104px">관리</th></tr></thead><tbody>
    ${store.articles.map((a,i)=>`<tr>
      <td><div class="iarrows">
        <button onclick="moveArticle(${i},-1)" ${i===0?'disabled':''}>${ico('chevronRight',11)}</button>
        <button onclick="moveArticle(${i},1)" ${i===store.articles.length-1?'disabled':''}>${ico('chevronRight',11)}</button>
      </div></td>
      <td><div class="t-main">${esc(a.title)}</div><div class="t-sub">${esc(a.excerpt)}</div></td>
      <td><span class="tag mute">${esc(a.cat)}</span></td>
      <td><span class="tag ${a.status==='published'?'good':'mute'}">${a.status==='published'?'발행':'임시저장'}</span></td>
      <td style="color:var(--sub)">${a.updated||'—'}</td>
      <td><button class="btn sm" onclick="editArticle('${a.id}')">수정</button>
          <button class="btn sm dan" onclick="delArticle('${a.id}')">삭제</button></td>
    </tr>`).join('')}</tbody></table>`:`<div class="empty">등록된 콘텐츠가 없어요</div>`}
  </div>`;
}
function moveArticle(i,d){
  const a=store.articles, j=i+d; if(j<0||j>=a.length) return;
  [a[i],a[j]]=[a[j],a[i]]; save(); pgArticle();
}
function delArticle(id){
  if(!confirm('콘텐츠를 삭제할까요?')) return;
  store.articles=store.articles.filter(a=>a.id!==id); save(); pgArticle(); toast('삭제했어요');
}

/* ═══ 리뷰 (원본 미구현) ═══ */
function pgReview(){
  el('wrap').innerHTML = `<div class="card"><div class="empty">
    ${ico('star',40)}<div style="margin-top:14px">리뷰 기능은 아직 준비 중이에요</div>
    <div style="margin-top:6px;font-size:11px">사용자 리뷰 수집이 시작되면 여기서 관리하게 됩니다.</div>
  </div></div>`;
}

/* ═══ MODALS ═══ */
function closeModal(){ el('ov').classList.remove('on'); el('ovBody').innerHTML=''; }
function showModal(html){ el('ovBody').innerHTML=html; el('ov').classList.add('on'); }

let mIng=null;
function openIngr(id){
  mIng = id ? clone(store.ingredients.find(i=>i.id===id)) : store.newIngredient();
  renderIngrModal();
}
function renderIngrModal(){
  const isNew = !store.ingredients.some(i=>i.id===mIng.id);
  showModal(`<div class="modal">
    <div class="modal-h"><b>${ico('microscope',17)}성분 ${isNew?'등록':'수정'}</b>
      <p>성분 마스터 데이터에 추가됩니다. 사료 원료 입력 시 자동으로 연결돼요.</p></div>
    <div class="row c2">
      <div class="fld"><label>성분명 (한국어) <i>*</i></label>
        <input class="inp" value="${at(mIng.name)}" placeholder="닭고기, BHA, 렌틸콩…"
               oninput="mIng.name=this.value"></div>
      <div class="fld"><label>성분명 (영어)</label>
        <input class="inp" value="${at(mIng.nameEn)}" placeholder="Chicken, BHA, Lentils…"
               oninput="mIng.nameEn=this.value"></div>
    </div>
    <div class="row c2">
      <div class="fld"><label>카테고리 <i>*</i></label>
        <select class="inp" onchange="mIng.cat=this.value">${opts(CATEGORY_KO,mIng.cat,'선택해주세요')}</select></div>
      <div class="fld"><label>안전 등급 <i>*</i></label>
        <div class="seg">${Object.entries(SAFE_KO).map(([k,v])=>
          `<button data-v="${k}" class="${mIng.safe===k?'on':''}" onclick="mIng.safe='${k}';renderIngrModal()">${v}</button>`).join('')}</div></div>
    </div>
    ${mIng.safe!=='safe'?`<div class="condbox">
      <div class="fld" style="margin-bottom:11px"><label>안전등급 근거 <i>*</i></label>
        <textarea class="inp" placeholder="왜 이 등급인지 소비자가 이해할 수 있게 적어주세요"
          oninput="mIng.basis=this.value">${esc(mIng.basis)}</textarea></div>
      <div class="fld" style="margin-bottom:0"><label>출처 URL</label>
        <input class="inp" value="${at(mIng.sourceUrl)}" placeholder="https://www.fda.gov/…"
               oninput="mIng.sourceUrl=this.value"></div></div>`:''}
    <div class="row c2" style="margin-top:15px">
      <div class="swrow"><label class="sw"><input type="checkbox" ${mIng.allergen?'checked':''}
        onchange="mIng.allergen=this.checked"><i></i></label>
        <div><b>알러젠 성분</b><p>알러지 유발 가능성 있음</p></div></div>
      <div class="swrow"><label class="sw"><input type="checkbox" ${mIng.func?'checked':''}
        onchange="mIng.func=this.checked?'eye_tear':'';renderIngrModal()"><i></i></label>
        <div><b>기능성 원료</b><p>눈물·관절 등 특정 기능</p></div></div>
    </div>
    ${mIng.func?`<div class="fld" style="margin-top:13px"><label>기능 종류</label>
      <select class="inp" onchange="mIng.func=this.value">${opts(FUNC_KO,mIng.func)}</select></div>`:''}
    <div class="fld" style="margin-top:13px"><label>성분 설명 <span>앱에 노출되는 설명</span></label>
      <textarea class="inp" placeholder="신선한 닭 근육육, 소화율 높고 단백질 공급원으로 우수"
        oninput="mIng.desc=this.value">${esc(mIng.desc)}</textarea></div>
    ${mIng.safe!=='safe'?`<div class="fld"><label>주의 문구 <span>앱 상세 화면 배지에 표시</span></label>
      <input class="inp" value="${at(mIng.warn)}" placeholder="영양 없는 충전재"
             oninput="mIng.warn=this.value"></div>`:''}
    <div class="modal-f">
      <button class="btn" onclick="closeModal()">취소</button>
      <button class="btn pri" onclick="saveIngr()">저장하기</button></div>
  </div>`);
}
function saveIngr(){
  if(!mIng.name || !mIng.cat){ toast('성분명과 카테고리는 필수예요'); return; }
  if(mIng.safe!=='safe' && !mIng.basis){ toast('주의·논쟁 등급은 근거가 필요해요'); return; }
  const i = store.ingredients.findIndex(x=>x.id===mIng.id);
  i>=0 ? store.ingredients[i]=mIng : store.ingredients.push(mIng);
  store.ingredients.sort((a,b)=>a.name.localeCompare(b.name,'ko'));
  save(); closeModal(); pgIngr(); toast('저장했어요');
}

let mRec=null;
function openRecall(){
  mRec = { foodId:'', severity:'critical', agency:'', url:'', reason:'', lot:'',
           date:new Date().toISOString().slice(0,10), active:true };
  showModal(`<div class="modal">
    <div class="modal-h"><b>🚨 리콜 등록</b>
      <p>농식품부 등 공식 기관의 리콜 정보를 등록해주세요. 등록 즉시 앱 상세화면에 표시됩니다.</p></div>
    <div class="fld"><label>연결할 사료 <i>*</i> <span>등록된 사료 중 선택</span></label>
      <select class="inp" onchange="mRec.foodId=this.value">
        <option value="">사료를 선택해주세요…</option>
        ${store.foods.map(f=>`<option value="${f.id}">${esc(f.brand)} ${esc(f.name)}</option>`).join('')}</select></div>
    <div class="row c2">
      <div class="fld"><label>심각도 <i>*</i></label>
        <select class="inp" onchange="mRec.severity=this.value">
          <option value="critical">🔴 Critical — 즉시 급여 중단</option>
          <option value="warning">🟡 Warning — 주의 필요</option></select></div>
      <div class="fld"><label>출처 기관 <i>*</i></label>
        <input class="inp" placeholder="농식품부, FDA, 브랜드사" oninput="mRec.agency=this.value"></div>
    </div>
    <div class="fld"><label>출처 URL</label>
      <input class="inp" placeholder="https://…" oninput="mRec.url=this.value"></div>
    <div class="fld"><label>리콜 사유 및 조치사항 <i>*</i></label>
      <textarea class="inp" placeholder="어떤 문제가 발견됐는지, 보호자가 어떻게 해야 하는지 적어주세요"
        oninput="mRec.reason=this.value"></textarea></div>
    <div class="fld"><label>영향 받는 제조번호 <span>선택</span></label>
      <input class="inp" placeholder="LOT 번호나 유통기한 범위" oninput="mRec.lot=this.value"></div>
    <div class="warnbox">
      등록 즉시 처리되는 항목<br>
      · 해당 사료 상세화면에 리콜 배너 표시<br>
      · 해당 사료 추천/비교에서 후순위 처리<br>
      · 대시보드 활성 리콜 카운트 +1</div>
    <div class="modal-f">
      <button class="btn" onclick="closeModal()">취소</button>
      <button class="btn pri" style="background:var(--bad);border-color:var(--bad)" onclick="saveRecall()">즉시 등록 & 알림 발송</button></div>
  </div>`);
}
function saveRecall(){
  if(!mRec.foodId || !mRec.agency || !mRec.reason){ toast('사료·출처 기관·사유는 필수예요'); return; }
  store.recalls.unshift(mRec);
  const f=store.foodById(mRec.foodId); if(f) f.recall = mRec.reason;
  save(); closeModal(); renderNav(); go('recall'); toast('리콜을 등록했어요');
}

let mArt=null;
function editArticle(id){
  mArt = id ? clone(store.articles.find(a=>a.id===id))
            : {id:uid(), cat:'건강 고민', ico:'book', title:'', excerpt:'', body:'',
               status:'draft', updated:new Date().toISOString().slice(0,10)};
  const cats=['성분 가이드','영양','건강 고민','사료 종류','생애주기','구매 팁'];
  showModal(`<div class="modal" style="max-width:720px">
    <div class="modal-h"><b>${ico('book',17)}콘텐츠 ${id?'수정':'작성'}</b>
      <p>가벼운 마크다운을 지원해요 — ### 소제목 · - 불릿 · 1. 번호 · &gt; 강조박스 · **굵게**</p></div>
    <div class="row c2">
      <div class="fld"><label>분류 <i>*</i></label>
        <select class="inp" onchange="mArt.cat=this.value">
          ${cats.map(c=>`<option ${c===mArt.cat?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="fld"><label>아이콘 이름</label>
        <input class="inp" value="${at(mArt.ico)}" oninput="mArt.ico=this.value"></div>
    </div>
    <div class="fld"><label>제목 <i>*</i></label>
      <input class="inp" value="${at(mArt.title)}" oninput="mArt.title=this.value"></div>
    <div class="fld"><label>요약 <span>목록 카드에 보여요</span></label>
      <textarea class="inp" oninput="mArt.excerpt=this.value">${esc(mArt.excerpt)}</textarea></div>
    <div class="fld"><label>본문 <i>*</i></label>
      <textarea class="inp" style="min-height:280px;font-family:ui-monospace,monospace;font-size:12px"
        oninput="mArt.body=this.value">${esc(mArt.body)}</textarea></div>
    <div class="modal-f">
      <button class="btn" onclick="closeModal()">취소</button>
      <button class="btn" onclick="saveArticle('draft')">임시저장</button>
      <button class="btn pri" onclick="saveArticle('published')">발행</button></div>
  </div>`);
}
function saveArticle(status){
  if(!mArt.title || !mArt.body){ toast('제목과 본문은 필수예요'); return; }
  mArt.status=status; mArt.updated=new Date().toISOString().slice(0,10);
  const i=store.articles.findIndex(a=>a.id===mArt.id);
  i>=0 ? store.articles[i]=mArt : store.articles.push(mArt);
  save(); closeModal(); pgArticle(); toast(status==='published'?'발행했어요':'임시저장했어요');
}

/* ═══ 내보내기 ═══ */
function openExport(){
  const pub=store.foods.filter(f=>f.status==='published').length;
  const draft=store.foods.length-pub;
  const artPub=store.articles.filter(a=>a.status==='published').length;
  showModal(`<div class="modal">
    <div class="modal-h"><b>${ico('package',17)}데이터 내보내기</b>
      <p>콘텐츠(articles.js)만 파일로 내려받습니다. 사료는 내려받을 필요가 없어요 —
         사료 관리 화면이 GitHub 에 바로 커밋합니다.</p></div>
    <div class="card" style="background:var(--panel2);margin-bottom:14px">
      <div style="font-size:12px;line-height:2">
        발행 사료 <b>${pub}종</b>${draft?` <span style="color:var(--muted)">(임시저장 ${draft}종은 제외)</span>`:''}<br>
        썸네일 <b>${store.foods.filter(f=>f.thumb&&f.thumb.indexOf('data:')===0).length}장</b>
          <span style="color:var(--muted)">(${Math.round(store.thumbBytes()/1024)}KB)</span><br>
        성분 사전 <b>${store.ingredients.length}종</b><br>
        발행 콘텐츠 <b>${artPub}편</b></div></div>
    <div class="warnbox">
      <b>사료(data.js) 내보내기는 막아뒀어요.</b><br>
      이 화면은 지금 데이터 형태가 생기기 전에 만든 거라, 내보내면
      <b>FOODS_ALL 선언</b>과 <b>status·srcState·funcStrength</b>,
      그리고 <b>쿠팡 파트너스 구매 링크</b>가 통째로 빠져요.
      그 파일로 덮으면 사이트가 깨집니다.<br>
      사료는 <b>사료 관리(GitHub)</b> 화면에서 고치세요 — 거기서 고치면 저장소에 바로 커밋되고,
      이 기기 밖에서도 그대로 보여요.</div>
    <div style="display:flex;gap:8px">
      <a class="btn pri" href="foods.html" style="flex:1;justify-content:center">사료 관리 열기</a>
      <button class="btn" style="flex:1;justify-content:center" onclick="dl('articles.js')">articles.js 받기</button>
    </div>
    <div class="modal-f">
      <button class="btn dan" onclick="resetDraft()">임시 데이터 초기화</button>
      <div style="flex:1"></div>
      <button class="btn" onclick="closeModal()">닫기</button></div>
  </div>`);
}
function dl(name){
  /* data.js 는 내보내면 안 된다 — store.exportDataJs 는 FOODS_ALL 선언과
     status·srcState·funcStrength·price.buyUrl 을 모르는 옛 형태로 쓴다.
     그 파일로 덮으면 구매 링크가 전부 사라지고 사이트가 깨진다.
     사료는 foods.html 이 고치고 커밋한다. */
  if(name==='data.js'){ toast('사료는 사료 관리 화면에서 고치면 바로 반영돼요'); return; }
  const text = store.exportArticlesJs();
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([text],{type:'text/javascript'}));
  a.download=name; a.click(); URL.revokeObjectURL(a.href);
  toast(name+' 내려받았어요');
}
function resetDraft(){
  if(!confirm('브라우저에 저장된 수정 내용을 모두 버리고 원본으로 되돌릴까요?')) return;
  store.discard(); closeModal(); markDirty(); go('dash'); toast('원본으로 되돌렸어요');
}

/* ═══ INIT ═══ */
const mode = store.init();
renderNav(); markDirty(); go('dash');
if(mode==='draft') toast('이전에 작업하던 내용을 불러왔어요');
