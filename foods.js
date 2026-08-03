/* 사료 관리 — 발행된 데이터를 고치고 GitHub 에 바로 커밋한다.

   지금까지는 한 번 발행하면 손댈 방법이 없었다. 가격이 바뀌어도, 썸네일이
   틀려도, 구매 링크를 새로 받아도 전부 로컬에서 스크립트를 돌려야 했다.
   이 화면이 그 자리를 메운다.

   ── 무엇을 고칠 수 있나 ──
   브랜드·제품명·제형·원산지·연령/체형, 썸네일, 가격, 구매 링크.
   즉 "사람이 눈으로 확인해서 고치는 값"만 연다.

   ── 무엇을 못 고치나 ──
   별점(ratings)과 총점(score)은 직접 못 고친다. 루브릭이 계산하는 값이고,
   사람이 손대는 순간 점수의 근거가 사라진다. 가격을 바꿔서 가성비 구간이
   달라지면 "다시 계산할까요?" 를 물어보고, 사람이 눌러야 반영한다.
   원료·영양 수치도 여기서는 못 고친다 — 그건 출처와 증거가 같이 바뀌어야
   하는 값이라 심사 화면(스테이징)의 몫이다.

   ── 파일을 어떻게 고치나 ──
   data.js 는 선언 하나가 한 줄이다(1행 FOODS_ALL, 3행 DETAIL). 그래서
   그 두 줄만 통째로 갈아끼운다. ICONS 같은 나머지 줄은 원문 그대로 둔다.
   전체를 다시 직렬화하면 손대지 않은 곳까지 diff 가 뒤집힌다.
*/
'use strict';

const PATH = 'data.js';

const TYPE_KO = { dry: '건식', wet: '습식', freeze_dried: '동결건조', air_dried: '에어드라이', raw: '화식', topping: '토핑' };
const AGE_KO = { puppy: '퍼피', adult: '성견', senior: '시니어', all: '전연령' };
const SIZE_KO = { small: '소형', medium: '중형', large: '대형', all: '전체' };
const SHOP_KO = { coupang: '쿠팡', brand_official: '공식몰', naver: '네이버', other: '판매처' };
const COUNTRY_KO = {
  KR: '대한민국', CA: '캐나다', US: '미국', FR: '프랑스', NZ: '뉴질랜드', AU: '호주',
  DE: '독일', IT: '이탈리아', NL: '네덜란드', BE: '벨기에', GB: '영국', JP: '일본', TH: '태국'
};

/* 채점은 engine.js 한 곳에서만 한다. 여기 옮겨 적으면 두 벌이 되어 어긋난다.
   (engine.js 가 전역에 rateValue 를 두므로 같은 이름을 다시 선언하면 안 된다.) */
const PRICE_KG = { min: 1000, max: 200000 };

/* ── 상태 ── */
const S = {
  sha: null,
  lines: null,        // data.js 원문을 줄 단위로 보관. 우리가 고치는 건 2줄뿐이다.
  iFoods: -1, iDetail: -1,
  foods: [], detail: {},
  orig: new Map(),    // id → 원본 food JSON 문자열
  origDetail: new Map(),
  cur: null,          // 편집 중인 food (있으면 화면이 편집 페이지)
  listScroll: 0,      // 목록으로 돌아왔을 때 보던 자리
  q: '', filter: 'all'
};

/* ── 잡동사니 ── */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = n => (n ?? 0).toLocaleString('ko-KR');
const clone = o => JSON.parse(JSON.stringify(o));
let toastT;
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', !!err);
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), err ? 4200 : 2200);
}
const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
function set(o, p, v) {
  const ks = p.split('.');
  const last = ks.pop();
  let t = o;
  for (const k of ks) { if (t[k] == null || typeof t[k] !== 'object') t[k] = {}; t = t[k]; }
  if (v === null || v === '') delete t[last]; else t[last] = v;
}

/* ── data.js 읽기 ──
   선언 한 줄을 통째로 JSON.parse 한다. 형태가 조금이라도 다르면 파싱을
   포기하고 편집을 막는다. 짐작해서 고치면 파일이 깨진다. */
function pickDecl(lines, name) {
  const head = `const ${name}=`;
  const i = lines.findIndex(l => l.startsWith(head));
  if (i < 0) return { i: -1, value: null };
  const body = lines[i].slice(head.length).replace(/;\s*$/, '');
  try { return { i, value: JSON.parse(body) }; }
  catch { return { i: -1, value: null }; }
}

async function load() {
  $('#meta').textContent = '불러오는 중…';
  const file = await GH.getFile(PATH);
  S.sha = file.sha;
  S.lines = file.text.split('\n');

  const a = pickDecl(S.lines, 'FOODS_ALL');
  const d = pickDecl(S.lines, 'DETAIL');
  if (a.i < 0 || d.i < 0) {
    throw new Error('data.js 형태가 예상과 달라 편집할 수 없습니다. 로컬에서 확인해 주세요');
  }
  S.iFoods = a.i; S.iDetail = d.i;
  S.foods = a.value; S.detail = d.value;
  S.orig = new Map(S.foods.map(f => [f.id, JSON.stringify(f)]));
  S.origDetail = new Map(Object.entries(S.detail).map(([k, v]) => [k, JSON.stringify(v)]));

  $('#meta').textContent = `${S.foods.length}종 · ${S.sha.slice(0, 7)}`;
  render();
}

/* ── 변경 여부 ── */
const dirtyFood = f => S.orig.get(f.id) !== JSON.stringify(f);
/* DETAIL 이 아예 없는 사료가 있다(분석 전). '없음' 과 '없음' 을 같게 봐야 한다 —
   여기서 undefined 와 "null" 을 비교하면 열어보지도 않은 사료가 수정됨으로 잡힌다. */
const dirtyDetail = id =>
  (S.origDetail.get(id) ?? null) !== (S.detail[id] ? JSON.stringify(S.detail[id]) : null);
const isDirty = f => dirtyFood(f) || dirtyDetail(f.id);
const dirtyList = () => S.foods.filter(isDirty);

/* ── 목록 ── */
const analyzed = f => !!(S.detail[f.id]?.ingr || []).length;
const buyOf = f => f.price?.buyUrl || (S.detail[f.id]?.prices || []).find(p => p.url)?.url || null;

/* 썸네일은 '있다/없다' 가 아니라 '불러와지느냐' 로 봐야 한다.
   예전 앱이 남긴 /objects/uploads/... 같은 주소는 값은 있지만 죽은 링크라
   화면에는 브랜드 이니셜만 나온다. 그런 건 없는 것으로 센다. */
const hasThumb = f => /^https:\/\//.test(f.thumb || '');

const FILTERS = [
  { k: 'all', label: '전체' },
  { k: 'nothumb', label: '썸네일 없음', test: f => !hasThumb(f) },
  { k: 'nobuy', label: '구매링크 없음', test: f => !buyOf(f) },
  { k: 'noprice', label: '가격 없음', test: f => !f.price?.p },
  { k: 'pending', label: '분석 준비 중', test: f => !analyzed(f) },
  { k: 'rx', label: '처방식', test: f => !!f.rx },
  { k: 'edited', label: '수정함', test: isDirty }
];

function visible() {
  const q = S.q.trim().toLowerCase();
  const f0 = FILTERS.find(x => x.k === S.filter);
  return S.foods.filter(f => {
    if (f0?.test && !f0.test(f)) return false;
    if (!q) return true;
    return (`${f.brand} ${f.name}`).toLowerCase().includes(q);
  });
}

/* 검색칸이 든 바와, 조건에 따라 바뀌는 목록을 나눈다.

   한 덩어리로 다시 그리면 입력칸이 문서에서 잠깐 떨어져 나간다. 노드를
   붙잡았다가 도로 꽂아도 소용없다 — 떨어지는 순간 브라우저가 한글 조합을
   취소해서 자모가 흩어진다. 그래서 바는 한 번만 그리고 목록만 갈아끼운다. */
function render() {
  /* 편집 중이면 화면을 통째로 편집 페이지로 바꾼다. 팝업이 아니다. */
  if (S.cur) { renderEditor(); return; }
  if (!$('#bar')) {
    $('#wrap').innerHTML = `
      <div class="note">사료를 고치는 곳이에요. <b>커밋하면 몇 분 뒤 사이트에 그대로 반영돼요.</b>
        내려받거나 따로 올릴 필요 없어요.<br>
        별점·총점만 직접 못 고쳐요 — 원료와 성분표를 고치면 루브릭이 다시 계산한 값을 보여주고,
        누르면 반영돼요.</div>
      <div class="bar" id="bar">
        <input class="search" id="q" placeholder="브랜드 · 제품명 검색" value="${esc(S.q)}">
        <span id="chips" style="display:flex;gap:8px;flex-wrap:wrap"></span>
      </div>
      <div id="list"></div>`;
    const qi = $('#q');
    const apply = () => { S.q = qi.value; renderList(); };
    qi.addEventListener('input', apply);
    qi.addEventListener('compositionend', apply);
  }
  renderList();
}

function renderList() {
  const rows = visible();
  const counts = {};
  for (const x of FILTERS) counts[x.k] = x.test ? S.foods.filter(x.test).length : S.foods.length;

  $('#chips').innerHTML = FILTERS.map(x =>
    `<button class="chip ${S.filter === x.k ? 'on' : ''}" data-filter="${x.k}">${x.label} ${counts[x.k]}</button>`).join('');

  $('#list').innerHTML = rows.length ? `<table>
      <thead><tr>
        <th style="width:52px"></th><th>사료</th><th style="width:76px">제형</th>
        <th style="width:130px" class="num">가격</th><th style="width:96px" class="num">kg당</th>
        <th style="width:210px">상태</th>
      </tr></thead>
      <tbody>${rows.map(rowHtml).join('')}</tbody>
    </table>` : `<div class="empty"><b>해당하는 사료가 없어요</b>다른 조건으로 찾아보세요</div>`;

  for (const b of document.querySelectorAll('[data-filter]'))
    b.onclick = () => { S.filter = b.dataset.filter; renderList(); };
  for (const tr of document.querySelectorAll('[data-id]'))
    tr.onclick = () => openPanel(tr.dataset.id);

  const dl = dirtyList();
  $('#dock').hidden = dl.length === 0;
  $('#count').innerHTML = `<b>${dl.length}건</b> 수정함 — ${dl.map(f => esc(f.name)).slice(0, 3).join(', ')}${dl.length > 3 ? ' 외' : ''}`;
}

function rowHtml(f) {
  const pills = [];
  if (!hasThumb(f)) pills.push('<span class="pill no">썸네일 없음</span>');
  if (!buyOf(f)) pills.push('<span class="pill wa">구매링크 없음</span>');
  if (!analyzed(f)) pills.push('<span class="pill wa">분석 준비 중</span>');
  if (f.rx) pills.push('<span class="pill ok">처방식</span>');
  if (!pills.length) pills.push('<span class="pill ok">정상</span>');
  return `<tr data-id="${f.id}" class="${isDirty(f) ? 'edited' : ''}">
    <td>${hasThumb(f)
      ? `<img class="thumb" src="${esc(f.thumb)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'thumb none',textContent:'?'}))">`
      : `<div class="thumb none">?</div>`}</td>
    <td><div class="br">${esc(f.brand)}</div><div class="nm">${esc(f.name)}</div></td>
    <td>${TYPE_KO[f.type] || esc(f.type || '')}</td>
    <td class="num">${f.price?.p ? won(f.price.p) + '원' : '—'}<div class="br">${f.price?.wg ? f.price.wg + 'g' : ''}</div></td>
    <td class="num">${f.price?.pKg ? won(f.price.pKg) : '—'}</td>
    <td>${pills.join(' ')}</td>
  </tr>`;
}

/* ── 편집 패널 ── */
const FIELDS = [
  { k: 'brand', label: '브랜드' },
  { k: 'brandSlug', label: '브랜드 슬러그' },
  { k: 'name', label: '제품명', wide: true },
  { k: 'type', label: '제형', sel: TYPE_KO },
  { k: 'country', label: '원산지', sel: COUNTRY_KO },
  { k: 'rx', label: '처방식 여부', sel: { '': '일반', '1': '처방식' }, bool: true },
  { k: 'thumb', label: '썸네일 URL', wide: true, hint: '쿠팡·다나와 상품 이미지 주소' }
];

function openPanel(id) {
  const f = S.foods.find(x => x.id === id);
  if (!f) return;
  S.cur = f;
  S.listScroll = window.scrollY;
  render();
  window.scrollTo(0, 0);
}
function closePanel() {
  S.cur = null;
  $('#wrap').innerHTML = '';     /* 목록 껍데기를 다시 짓게 한다 */
  render();
  window.scrollTo(0, S.listScroll || 0);
}

/* 편집 페이지 */
function renderEditor() {
  const f = S.cur;
  $('#wrap').innerHTML = `
    <div class="edit-head">
      <button class="btn" data-back>← 목록</button>
      <div style="min-width:0">
        <div class="br">${esc(f.brand)}</div>
        <h2>${esc(f.name)}</h2>
      </div>
      <div style="flex:1"></div>
      <span style="font-size:11.5px;color:var(--muted)">고친 내용은 아래 <b style="color:var(--sub)">GitHub 에 커밋</b>을 눌러야 반영돼요</span>
      <button class="btn" data-reset>이 사료 되돌리기</button>
    </div>
    <div id="panelBody"></div>`;
  $('#panelBody').innerHTML = panelHtml(f);
  bindPanel(f);
  $('[data-back]').onclick = closePanel;
  $('[data-reset]').onclick = () => {
    if (!confirm('이 사료의 수정을 전부 되돌릴까요?')) return;
    const o = JSON.parse(S.orig.get(f.id));
    for (const k of Object.keys(f)) if (!(k in o)) delete f[k];
    Object.assign(f, o);
    const od = S.origDetail.get(f.id);
    if (od) S.detail[f.id] = JSON.parse(od); else delete S.detail[f.id];
    closePanel();
  };
  const dl = dirtyList();
  $('#dock').hidden = dl.length === 0;
  $('#count').innerHTML = `<b>${dl.length}건</b> 수정함 — ${dl.map(x => esc(x.name)).slice(0, 3).join(', ')}${dl.length > 3 ? ' 외' : ''}`;
}

function panelHtml(f) {
  const o = JSON.parse(S.orig.get(f.id));
  const d = S.detail[f.id] || {};
  const prices = d.prices || [];

  const field = spec => {
    const v = get(f, spec.k);
    const ov = get(o, spec.k);
    const changed = JSON.stringify(v ?? null) !== JSON.stringify(ov ?? null);
    const inner = spec.sel
      ? `<select data-k="${spec.k}"${spec.bool ? ' data-bool="1"' : ''}>${Object.entries(spec.sel)
        .map(([k, l]) => `<option value="${esc(k)}"${String(spec.bool ? (v ? '1' : '') : (v ?? '')) === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`
      : `<input data-k="${spec.k}" value="${esc(v ?? '')}"${spec.num ? ' inputmode="numeric"' : ''}>`;
    return `<div class="f ${changed ? 'ch' : ''}" style="${spec.wide ? 'grid-column:1/-1' : ''}">
      <label>${spec.label}</label>${inner}
      <div class="was">${changed ? `원래: ${esc(fmt(ov))}` : (spec.hint || '')}</div></div>`;
  };

  const nut = (k, label) => nutField(f, k, label);

  const multi = (k, dict) => {
    const cur = f[k] || [];
    const changed = JSON.stringify(cur) !== JSON.stringify(o[k] || []);
    return `<div class="f ${changed ? 'ch' : ''}"><label>${k === 'ages' ? '연령' : '체형'}</label>
      <div style="display:flex;gap:7px;flex-wrap:wrap">${Object.entries(dict).map(([v, l]) =>
      `<button class="chip ${cur.includes(v) ? 'on' : ''}" data-multi="${k}" data-v="${v}">${l}</button>`).join('')}</div>
      <div class="was">${changed ? `원래: ${esc((o[k] || []).map(x => dict[x] || x).join(', ') || '없음')}` : ''}</div></div>`;
  };

  const card = (title, body, wide) =>
    `<section class="edit-card${wide ? ' wide' : ''}">
       <div class="sect" style="margin-top:0">${title}</div>${body}</section>`;

  return `<div class="edit-grid">
  ${card('기본 정보', `<div class="grid2">${FIELDS.map(field).join('')}</div>
    ${multi('ages', AGE_KO)}${multi('sizes', SIZE_KO)}`)}

  ${card('썸네일', `
    <div style="display:flex;gap:12px;align-items:center">
      <div style="width:84px;height:84px;border-radius:10px;background:#fff;display:grid;place-items:center;overflow:hidden;flex-shrink:0">
        ${hasThumb(f) ? `<img src="${esc(f.thumb)}" style="max-width:100%;max-height:100%;object-fit:contain">`
        : `<span style="color:#5B5B5B;font-size:11px">없음</span>`}</div>
      <div style="flex:1;min-width:0;color:var(--sub);font-size:11.5px;line-height:1.6">
        사료 봉지 사진이어야 해요. 브랜드 로고나 다른 제품 사진이면 사용자가 헷갈려요.
        위 <b style="color:var(--ink2)">기본 정보</b>의 썸네일 URL 을 바꾸면 갱신돼요.</div>
    </div>`)}

  ${card('대표 가격 <span style="font-weight:500;color:var(--muted)">— 목록·카드에 쓰는 값</span>', `
    <div class="grid2">
      ${field({ k: 'price.p', label: '가격 (원)', num: true })}
      ${field({ k: 'price.wg', label: '용량 (g)', num: true })}
      ${field({ k: 'price.shop', label: '판매처', sel: SHOP_KO })}
      ${field({ k: 'price.buyUrl', label: '구매 링크', wide: true, hint: '쿠팡 파트너스 링크 (link.coupang.com)' })}
    </div>
    <div class="derived" id="derived"></div>`)}

  ${card('판매처별 가격 <span style="font-weight:500;color:var(--muted)">— 상세 화면 최저가 비교</span>', `
    <div id="prices">${prices.map(priceRow).join('') || '<div class="was" style="color:var(--muted)">등록된 행이 없어요. 대표 가격이 대신 보여요.</div>'}</div>
    <button class="btn" data-addprice style="margin-top:8px">행 추가</button>`)}

  ${card('보장성분표 <span style="font-weight:500;color:var(--muted)">— 봉지에 적힌 값 그대로</span>', `
    <div class="grid2">
      ${nut('protein', '조단백 (%)')}${nut('fat', '조지방 (%)')}
      ${nut('fiber', '조섬유 (%)')}${nut('moisture', '수분 (%)')}
      ${nut('ash', '조회분 (%)')}${nut('meat', '생육 함량 (%)')}
    </div>
    <div class="derived" id="nutOut"></div>`)}

  ${card('원료 <span style="font-weight:500;color:var(--muted)">— 표기 순서 그대로, 한 줄에 하나</span>', `
    <textarea id="ingrText" style="width:100%;min-height:180px;padding:9px 11px;border-radius:var(--r);
      background:var(--panel2);border:1px solid var(--line);font-size:13px;line-height:1.7;resize:vertical"
      placeholder="닭고기&#10;현미&#10;닭기름&#10;…">${esc((d.ingr || []).map(i => i.name).join('\n'))}</textarea>
    <div class="derived" id="ingrOut" style="margin-top:8px"></div>`)}

  ${card('별점 <span style="font-weight:500;color:var(--muted)">— 루브릭이 계산해요. 직접 못 고쳐요</span>', `
    <div class="derived" id="rateOut"></div>`)}

  ${card('소비자 요약 카드 <span style="font-weight:500;color:var(--muted)">— 앱 상세에 그대로 보이는 문장</span>', `
    <div style="display:flex;gap:6px;margin-bottom:9px;flex-wrap:wrap">
      <button class="btn" data-vauto>사실에서 자동 생성</button>
      <button class="btn" data-vadd>템플릿에서 고르기</button>
    </div>
    <div id="verdictList"></div>`, true)}

  ${card('맞춤 태그 <span style="font-weight:500;color:var(--muted)">— 고르면 문장이 채워져요. 그 자리에서 고칠 수 있어요</span>', `
    <div style="font-size:11.5px;font-weight:700;color:var(--good);margin-bottom:7px">이런 아이에게 잘 맞아요</div>
    <div id="fitChips" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:9px"></div>
    <div id="fitRows"></div>
    <div style="font-size:11.5px;font-weight:700;color:var(--warn);margin:18px 0 7px">이런 경우 주의해요</div>
    <div id="cauChips" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:9px"></div>
    <div id="cauRows"></div>`, true)}
  </div>`;
}


/* 보장성분표 한 칸. 값은 DETAIL.nutrient 에 바로 들어간다. */
function nutField(f, k, label) {
  const d = S.detail[f.id] || {};
  const o = S.origDetail.get(f.id) ? JSON.parse(S.origDetail.get(f.id)) : {};
  const v = d.nutrient?.[k], ov = o.nutrient?.[k];
  const changed = (v ?? null) !== (ov ?? null);
  return `<div class="f ${changed ? 'ch' : ''}"><label>${label}</label>
    <input data-nut="${k}" value="${esc(v ?? '')}" inputmode="decimal">
    <div class="was">${changed ? `원래: ${ov ?? '없음'}` : ''}</div></div>`;
}

/* 판정 카드 한 장 */
function verdictRow(kind, i, c) {
  const KIND = { pos: ['✅ 좋은 점', 'var(--good)'], cau: ['⚠️ 주의할 점', 'var(--warn)'], dan: ['🚨 위험', 'var(--warn)'] };
  const [label, color] = KIND[kind] || KIND.cau;
  return `<div style="border:1px solid var(--line);border-radius:var(--r);padding:11px;margin-bottom:8px"
       data-vrow="${kind}:${i}">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
      <select data-vkind style="width:auto;padding:4px 8px;border-radius:6px;background:var(--panel2);
        border:1px solid var(--line);font-size:11.5px;font-weight:700;color:${color}">
        ${Object.entries(KIND).map(([k, [l]]) =>
          `<option value="${k}"${k === kind ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <div style="flex:1"></div>
      <button class="btn" data-vdel style="padding:0 9px;height:26px">삭제</button>
    </div>
    <input data-vtitle value="${esc(c.title ?? '')}" placeholder="한 줄 제목"
      style="width:100%;padding:8px 10px;border-radius:var(--r);background:var(--panel2);
             border:1px solid var(--line);font-size:13px;font-weight:600;margin-bottom:6px">
    <textarea data-vbody placeholder="왜 그런지 한두 문장"
      style="width:100%;min-height:56px;padding:8px 10px;border-radius:var(--r);background:var(--panel2);
             border:1px solid var(--line);font-size:12.5px;line-height:1.6;resize:vertical">${esc(c.body ?? '')}</textarea>
  </div>`;
}

function priceRow(p, i) {
  return `<div style="display:grid;grid-template-columns:88px 1fr 90px 28px;gap:6px;margin-bottom:6px" data-prow="${i}">
    <input data-pk="wg" value="${esc(p.wg ?? '')}" placeholder="용량g" inputmode="numeric">
    <input data-pk="url" value="${esc(p.url ?? '')}" placeholder="구매 링크">
    <input data-pk="price" value="${esc(p.price ?? '')}" placeholder="가격" inputmode="numeric">
    <button class="btn" data-delprice="${i}" style="padding:0">✕</button>
  </div>`;
}

function fmt(v) {
  if (v == null || v === '') return '없음';
  if (v === true) return '처방식';
  if (v === false) return '일반';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}


/* ═══ 분석 데이터 ═══
   원료와 보장성분표를 고치면 그로부터 나오는 값(영양·분포·기능성·별점)을
   엔진이 다시 계산한다. 어드민이 따로 계산하지 않는다 — 두 벌이 되면 어긋난다. */

function detailOf(f) { return (S.detail[f.id] ??= {}); }

/* 원료 글상자 → DETAIL.ingr / dist / funcIngr */
function applyIngredients(f, text) {
  const list = String(text).split(/[\n,]/).map(x => x.trim()).filter(Boolean);
  const d = detailOf(f);
  d.ingr = ENGINE.deriveIngredients(list);
  d.dist = ENGINE.deriveDist(d.ingr);
  d.funcIngr = ENGINE.deriveFuncIngr(list);
  f.func = Object.keys(d.funcIngr);
  f.warnN = d.dist.caution + d.dist.danger;
}

/* 원료 판정 미리보기 — 사전에 없는 원료를 반드시 보여준다.
   모르는 걸 조용히 '안전' 으로 넘기면 그게 제일 위험하다. */
function renderIngrOut(f) {
  const box = $('#ingrOut'); if (!box) return;
  const d = detailOf(f), ingr = d.ingr || [];
  if (!ingr.length) { box.innerHTML = '원료를 넣으면 여기서 판정을 보여줘요.'; return; }
  const COLOR = { safe: 'var(--good)', caution: 'var(--warn)', danger: '#FCA5A5', unknown: 'var(--sub)' };
  const KO = { safe: '양호', caution: '논쟁중', danger: '주의', unknown: '사전에 없음' };
  const unknown = ingr.filter(i => i.safe === 'unknown');
  box.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px">
      ${ingr.map((i, n) => `<span title="${esc(KO[i.safe])}" style="display:inline-flex;align-items:center;gap:4px;
        height:22px;padding:0 8px;border-radius:99px;font-size:11px;font-weight:600;
        border:1px solid ${COLOR[i.safe]};color:${COLOR[i.safe]}">${n < 5 ? '★' : ''}${esc(i.name)}</span>`).join('')}
    </div>
    안전 <b>${d.dist.safe}</b> · 논쟁중 <b>${d.dist.caution}</b> · 주의 <b>${d.dist.danger}</b> · 사전에 없음 <b>${d.dist.unknown}</b>
    ${unknown.length ? `<br><span style="color:var(--warn)">사전에 없는 원료 ${unknown.length}종 — ${esc(unknown.map(i => i.name).join(', '))}.
      판정을 미룬 상태라 안전하다고 보지 않아요.</span>` : ''}
    <br><span style="color:var(--muted)">★ 은 주원료(상위 5개)예요. 기능성: ${
      Object.keys(d.funcIngr || {}).length ? Object.entries(d.funcIngr).map(([k, v]) =>
        `${ENGINE.FUNC_LABEL[k] || k} ${v.length}`).join(' · ') : '없음'}</span>`;
}

/* 보장성분표 → DETAIL.nutrient */
function renderNutOut(f) {
  const box = $('#nutOut'); if (!box) return;
  const d = detailOf(f), n = d.nutrient || {};
  const out = [];
  if (n.dmCarb != null) out.push(`건물기준 탄수 <b>${n.dmCarb}%</b> (조회분은 빼지 않아요)`);
  else out.push('조단백·조지방·조섬유·수분을 다 넣으면 탄수화물이 계산돼요');
  const sum = ['protein', 'fat', 'fiber', 'moisture', 'ash'].reduce((a, k) => a + (Number(n[k]) || 0), 0);
  if (sum > 100) out.push(`<span style="color:var(--warn)">합이 ${Math.round(sum * 10) / 10}% 예요 — 100%를 넘습니다. 옮겨 적은 값을 확인해 주세요</span>`);
  box.innerHTML = out.join('<br>');
}

/* 판정 카드 목록 */
function renderVerdict(f) {
  const box = $('#verdictList'); if (!box) return;
  const v = detailOf(f).verdict ??= { pos: [], cau: [], dan: [] };
  const rows = [];
  for (const kind of ['pos', 'cau', 'dan'])
    (v[kind] || []).forEach((c, i) => rows.push(verdictRow(kind, i, c)));
  box.innerHTML = rows.join('') ||
    '<div class="was" style="color:var(--muted)">카드가 없어요. 자동 생성하거나 템플릿에서 고르세요.</div>';
  bindVerdict(f);
}

/* 맞춤 태그 — 고른 태그마다 한 줄. 문구는 템플릿에서 채우고 사람이 고친다. */
function renderFit(f) {
  const d = detailOf(f);
  d.fit ??= []; d.fitCaution ??= [];
  for (const [key, list, chipId, rowId] of
    [['fit', d.fit, '#fitChips', '#fitRows'], ['fitCaution', d.fitCaution, '#cauChips', '#cauRows']]) {
    const chips = $(chipId), rows = $(rowId);
    if (!chips) continue;
    const on = new Set(list.map(x => x.concernType));
    chips.innerHTML = Object.entries(PHRASES.concerns).map(([k, c]) =>
      `<button class="chip ${on.has(k) ? 'on' : ''}" data-fit="${key}" data-c="${k}">${esc(c.label)}</button>`).join('');
    rows.innerHTML = list.map((x, i) => `
      <div style="display:grid;grid-template-columns:110px 1fr;gap:8px;align-items:center;margin-bottom:6px">
        <div style="font-size:11.5px;font-weight:600;color:var(--sub)">${esc(PHRASES.concerns[x.concernType]?.label || x.concernType)}</div>
        <input data-fitrow="${key}:${i}" value="${esc(x.label ?? '')}"
          placeholder="이 아이에게 왜 맞는지 한 줄로"
          style="width:100%;padding:8px 10px;border-radius:var(--r);background:var(--panel2);
                 border:1px solid var(--line);font-size:12.5px">
      </div>`).join('');
  }
  bindFit(f);
}

/* 별점 — 사실에서 다시 계산해 지금 값과 견준다. 사람이 눌러야 반영한다. */
function renderRate(f) {
  const box = $('#rateOut'); if (!box) return;
  const d = detailOf(f), n = d.nutrient || {}, dist = d.dist || {};
  const next = ENGINE.rateAll({
    dmCarb: n.dmCarb, protein: n.protein,
    firstIngrCat: (d.ingr || [])[0]?.cat ?? null,
    cautionN: dist.caution, dangerN: dist.danger, pKg: f.price?.pKg ?? null
  });
  const cur = f.ratings || {};
  const KO = { quality: '원료', additive: '첨가물', carb: '탄수', value: '가성비' };
  const diff = Object.keys(KO).filter(k => next[k] != null && next[k] !== cur[k]);
  box.innerHTML = `
    ${Object.entries(KO).map(([k, l]) =>
      `${l} <b>${cur[k] ?? '—'}</b>${next[k] != null && next[k] !== cur[k] ? ` → <span style="color:var(--warn)">${next[k]}</span>` : ''}`).join(' · ')}
    · 총점 <b>${f.score ?? '—'}</b>
    ${diff.length ? `<br><label style="display:inline-flex;gap:6px;align-items:center;margin-top:6px;color:var(--warn)">
      <input type="checkbox" id="reScore" style="width:auto" ${f.__reScore ? 'checked' : ''}>
      바뀐 사실대로 별점·총점 다시 계산</label>`
      : '<br><span style="color:var(--muted)">지금 사실과 별점이 맞아요.</span>'}`;
  const cb = $('#reScore');
  if (cb) cb.onchange = () => { if (cb.checked) f.__reScore = true; else delete f.__reScore; };
}

function renderAnalysis(f) {
  renderNutOut(f); renderIngrOut(f); renderVerdict(f); renderFit(f); renderRate(f);
}

/* 대표 가격에서 파생되는 값 — kg당 가격과, 그로 인해 달라지는 가성비 별점 */
function refreshDerived() {
  const f = S.cur;
  if (!f) return;
  const box = $('#derived');
  if (!box) return;
  const p = Number(f.price?.p) || null, wg = Number(f.price?.wg) || null;
  const pKg = (p && wg) ? Math.round(p / wg * 1000) : null;
  const cur = f.ratings?.value ?? null;
  const next = ENGINE.rateValue(pKg);
  const out = [];
  out.push(pKg ? `kg당 <b>${won(pKg)}원</b>` : 'kg당 가격 — 가격과 용량을 둘 다 넣어야 계산돼요');
  if (pKg && (pKg < PRICE_KG.min || pKg > PRICE_KG.max))
    out.push(`<span style="color:var(--warn)">kg당 가격이 상식 범위(${won(PRICE_KG.min)}~${won(PRICE_KG.max)}원)를 벗어났어요. 오타인지 확인해 주세요</span>`);
  if (next != null && cur != null && next !== cur) {
    out.push(`이 가격이면 가성비 별점은 <b>${next}점</b>이에요 (지금 ${cur}점).
      <label style="display:inline-flex;gap:6px;align-items:center;margin-left:6px;color:var(--warn)">
        <input type="checkbox" id="reScore" style="width:auto" ${f.__reScore ? 'checked' : ''}> 별점·총점 다시 계산</label>`);
  }
  box.innerHTML = out.join('<br>');
  const cb = $('#reScore');
  /* 껐다 켰다 한 흔적이 남으면 고치지도 않은 사료가 '수정함' 으로 잡힌다 */
  if (cb) cb.onchange = () => { if (cb.checked) f.__reScore = true; else delete f.__reScore; };
}

function bindPanel(f) {
  const body = $('#panelBody');
  for (const el of body.querySelectorAll('[data-k]')) {
    el.oninput = el.onchange = () => {
      const k = el.dataset.k;
      let v = el.value;
      if (el.dataset.bool) v = v === '1';
      else if (/price\.(p|wg)$/.test(k)) v = v.trim() === '' ? null : Number(String(v).replace(/[^\d.-]/g, ''));
      else if (typeof v === 'string') v = v.trim();
      set(f, k, v);
      if (/price\.(p|wg)$/.test(k)) {
        const p = Number(f.price?.p), wg = Number(f.price?.wg);
        if (p && wg) f.price.pKg = Math.round(p / wg * 1000); else delete f.price?.pKg;
      }
      refreshDerived();
    };
  }
  for (const b of body.querySelectorAll('[data-multi]')) {
    b.onclick = () => {
      const k = b.dataset.multi, v = b.dataset.v;
      const arr = f[k] = f[k] || [];
      const i = arr.indexOf(v);
      if (i < 0) arr.push(v); else arr.splice(i, 1);
      $('#panelBody').innerHTML = panelHtml(f); bindPanel(f);
    };
  }
  const d = S.detail[f.id];
  for (const el of body.querySelectorAll('[data-pk]')) {
    el.oninput = () => {
      const i = Number(el.closest('[data-prow]').dataset.prow);
      const row = d.prices[i];
      const k = el.dataset.pk;
      const v = el.value.trim();
      if (k === 'url') row.url = v || null;
      else {
        row[k] = v === '' ? null : Number(v.replace(/[^\d]/g, ''));
        if (row.price && row.wg) row.pKg = Math.round(row.price / row.wg * 1000);
      }
    };
  }
  for (const b of body.querySelectorAll('[data-delprice]')) {
    b.onclick = () => {
      d.prices.splice(Number(b.dataset.delprice), 1);
      $('#panelBody').innerHTML = panelHtml(f); bindPanel(f);
    };
  }
  /* 보장성분표 */
  for (const el of body.querySelectorAll('[data-nut]')) {
    el.oninput = () => {
      const dd = detailOf(f);
      const ga = { ...(dd.nutrient || {}) };
      ga[el.dataset.nut] = el.value.trim() === '' ? null : Number(el.value);
      const n = ENGINE.deriveNutrient(ga, { meatRatio: ga.meat ?? null, src: dd.nutrient?.src });
      /* 생육 함량은 보장성분표에 없는 값이라 엔진이 계산하지 않는다. 그대로 살린다. */
      n.meat = ga.meat ?? null;
      dd.nutrient = n;
      renderNutOut(f); renderRate(f);
    };
  }

  /* 원료 */
  const ing = body.querySelector('#ingrText');
  if (ing) {
    let t;
    ing.oninput = () => {
      clearTimeout(t);
      t = setTimeout(() => { applyIngredients(f, ing.value); renderIngrOut(f); renderRate(f); }, 250);
    };
  }

  /* 판정 카드 — 사실에서 자동 생성 / 템플릿에서 고르기 */
  const vauto = body.querySelector('[data-vauto]');
  if (vauto) vauto.onclick = () => {
    const dd = detailOf(f);
    if (!(dd.ingr || []).length) { toast('원료를 먼저 넣어주세요', true); return; }
    if ((dd.verdict?.pos?.length || dd.verdict?.cau?.length || dd.verdict?.dan?.length)
      && !confirm('지금 카드를 지우고 사실에서 다시 만들까요?')) return;
    dd.verdict = ENGINE.deriveVerdict({
      nutrient: dd.nutrient || {}, ingr: dd.ingr, dist: dd.dist,
      funcIngr: dd.funcIngr || {}, price: f.price || {}, facts: {}
    });
    renderVerdict(f);
    toast('사실에서 다시 만들었어요');
  };
  const vadd = body.querySelector('[data-vadd]');
  if (vadd) vadd.onclick = () => openTemplatePicker(f);

  const add = body.querySelector('[data-addprice]');
  if (add) add.onclick = () => {
    const dd = S.detail[f.id] = S.detail[f.id] || {};
    (dd.prices = dd.prices || []).push({ wg: f.price?.wg ?? null, shop: 'coupang', price: null, pKg: null, url: null, avail: true });
    $('#panelBody').innerHTML = panelHtml(f); bindPanel(f);
  };
  refreshDerived();
  renderAnalysis(f);      /* 원료·성분표·판정·맞춤 태그 구역을 채운다 */
}


/* ── 판정 카드 조작 ── */
function bindVerdict(f) {
  const v = detailOf(f).verdict;
  const pick = el => {
    const [kind, i] = el.closest('[data-vrow]').dataset.vrow.split(':');
    return { kind, i: +i, card: v[kind][+i] };
  };
  for (const el of document.querySelectorAll('[data-vtitle]'))
    el.oninput = () => { pick(el).card.title = el.value; };
  for (const el of document.querySelectorAll('[data-vbody]'))
    el.oninput = () => { pick(el).card.body = el.value; };
  for (const el of document.querySelectorAll('[data-vkind]'))
    el.onchange = () => {
      const { kind, i, card } = pick(el);
      v[kind].splice(i, 1);
      (v[el.value] ??= []).push(card);
      renderVerdict(f);
    };
  for (const el of document.querySelectorAll('[data-vdel]'))
    el.onclick = () => { const { kind, i } = pick(el); v[kind].splice(i, 1); renderVerdict(f); };
}

/* ── 맞춤 태그 조작 ──
   태그를 켜면 템플릿 문장이 채워진다. 이미 쓴 문장은 덮어쓰지 않는다.
   같은 태그라도 '잘 맞아요' 와 '주의해요' 는 다른 문장이 온다. */
function bindFit(f) {
  const d = detailOf(f);
  for (const el of document.querySelectorAll('[data-fit]')) {
    el.onclick = () => {
      const key = el.dataset.fit, c = el.dataset.c;
      const list = d[key];
      const at = list.findIndex(x => x.concernType === c);
      if (at >= 0) list.splice(at, 1);
      else {
        const tpl = PHRASES.concerns[c]?.[key === 'fit' ? 'fit' : 'caution'] ?? '';
        list.push({ concernType: c, label: ENGINE.fillPhrase(tpl, ENGINE.phraseVars({
          nutrient: d.nutrient, ingr: d.ingr, price: f.price
        })) });
      }
      f.concerns = [...new Set(d.fit.map(x => x.concernType))].sort();
      renderFit(f);
    };
  }
  for (const el of document.querySelectorAll('[data-fitrow]')) {
    el.oninput = () => {
      const [key, i] = el.dataset.fitrow.split(':');
      d[key][+i].label = el.value;
    };
  }
}

/* ── 템플릿에서 판정 카드 고르기 ── */
function openTemplatePicker(f) {
  const d = detailOf(f);
  const vars = ENGINE.phraseVars({ nutrient: d.nutrient, ingr: d.ingr, price: f.price });
  const KIND = { pos: '좋은 점', cau: '주의할 점', dan: '위험' };
  const html = PHRASES.verdict.map((t, i) => `
    <button data-tpl="${i}" style="display:block;width:100%;text-align:left;padding:10px 12px;
      border-radius:var(--r);border:1px solid var(--line);background:var(--panel2);margin-bottom:6px">
      <div style="font-size:11px;font-weight:700;color:var(--sub)">${t.icon} ${KIND[t.kind]}</div>
      <div style="font-size:13px;font-weight:700;margin-top:3px">${esc(t.title)}</div>
      <div style="font-size:11.5px;color:var(--sub);margin-top:3px;line-height:1.5">${esc(ENGINE.fillPhrase(t.body, vars))}</div>
    </button>`).join('');
  showSheet('템플릿에서 고르기', html, el => {
    for (const b of el.querySelectorAll('[data-tpl]')) b.onclick = () => {
      const t = PHRASES.verdict[+b.dataset.tpl];
      const v = d.verdict ??= { pos: [], cau: [], dan: [] };
      (v[t.kind] ??= []).push({
        icon: t.icon, category: t.id,
        title: ENGINE.fillPhrase(t.title, vars),
        body: ENGINE.fillPhrase(t.body, vars)
      });
      closeSheet();
      renderVerdict(f);
    };
  });
}

/* 가벼운 시트 — 템플릿 고르기용 */
function showSheet(title, html, wire) {
  let sh = $('#sheet');
  if (!sh) {
    sh = document.createElement('div');
    sh.id = 'sheet';
    sh.innerHTML = `<div class="sh-in"><div class="sh-h"><b></b>
      <button class="btn" data-shclose>닫기</button></div><div class="sh-b"></div></div>`;
    document.body.appendChild(sh);
  }
  sh.querySelector('.sh-h b').textContent = title;
  sh.querySelector('.sh-b').innerHTML = html;
  sh.classList.add('on');
  sh.querySelector('[data-shclose]').onclick = closeSheet;
  wire?.(sh.querySelector('.sh-b'));
}
function closeSheet() { $('#sheet')?.classList.remove('on'); }

/* ── 검증 ── 커밋 전에 기계가 잡을 수 있는 건 여기서 잡는다. */
function validate() {
  const out = [];
  for (const f of dirtyList()) {
    const at = `${f.brand} ${f.name}`;
    if (!f.brand?.trim() || !f.name?.trim()) out.push(`${at} — 브랜드와 제품명은 비울 수 없어요`);
    if (f.thumb && !/^https:\/\//.test(f.thumb)) out.push(`${at} — 썸네일은 https 주소여야 해요`);
    if (!(f.ages || []).length) out.push(`${at} — 연령을 최소 하나 골라주세요`);
    if (!(f.sizes || []).length) out.push(`${at} — 체형을 최소 하나 골라주세요`);
    const p = f.price?.p, wg = f.price?.wg;
    if (p != null && !(p > 0)) out.push(`${at} — 가격이 숫자가 아니에요`);
    if (wg != null && !(wg > 0)) out.push(`${at} — 용량이 숫자가 아니에요`);
    if (p && !wg) out.push(`${at} — 가격을 넣었으면 용량도 있어야 kg당 가격이 나와요`);
    for (const url of [f.price?.buyUrl, ...(S.detail[f.id]?.prices || []).map(x => x.url)]) {
      if (!url) continue;
      if (!/^https:\/\/(link\.coupang\.com|www\.coupang\.com|m\.coupang\.com)\//.test(url))
        out.push(`${at} — 구매 링크는 쿠팡 주소여야 해요: ${url}`);
    }
    for (const row of (S.detail[f.id]?.prices || [])) {
      if (row.price && !row.wg) out.push(`${at} — 판매처 가격 행에 용량이 비었어요`);
    }
  }
  return out;
}

/* ── 커밋 ── */
function serialize() {
  const lines = S.lines.slice();
  /* 별점을 다시 계산하기로 한 건만 반영한다. 나머지는 원래 점수를 그대로 둔다 —
     예전 41종은 지금 루브릭이 아니라 원본 앱의 점수를 물려받았고,
     여기서 전부 다시 계산하면 손대지 않은 사료의 점수까지 움직인다. */
  const foods = S.foods.map(f => {
    const c = { ...f };
    delete c.__reScore;
    if (f.__reScore) {
      const d = S.detail[f.id] || {}, n = d.nutrient || {}, dist = d.dist || {};
      const next = ENGINE.rateAll({
        dmCarb: n.dmCarb, protein: n.protein,
        firstIngrCat: (d.ingr || [])[0]?.cat ?? null,
        cautionN: dist.caution, dangerN: dist.danger, pKg: c.price?.pKg ?? null
      });
      /* 계산이 안 되는 항목(사실이 비었을 때)은 원래 값을 지킨다 */
      c.ratings = { ...c.ratings };
      for (const k of ['quality', 'carb', 'additive', 'value'])
        if (next[k] != null) c.ratings[k] = next[k];
      if (Object.values(c.ratings).every(v => v != null)) c.score = ENGINE.computeScore(c.ratings);
    }
    return c;
  });
  lines[S.iFoods] = 'const FOODS_ALL=' + JSON.stringify(foods) + ';';
  lines[S.iDetail] = 'const DETAIL=' + JSON.stringify(S.detail) + ';';
  return lines.join('\n');
}

function commitMessage(dl) {
  const head = dl.length === 1
    ? `사료 수정 — ${dl[0].brand} ${dl[0].name}`
    : `사료 수정 — ${dl.length}건`;
  const body = dl.map(f => {
    const o = JSON.parse(S.orig.get(f.id));
    const ch = [];
    for (const k of ['brand', 'name', 'brandSlug', 'type', 'country', 'rx', 'thumb'])
      if (JSON.stringify(f[k] ?? null) !== JSON.stringify(o[k] ?? null)) ch.push(k);
    for (const k of ['p', 'wg', 'shop', 'buyUrl'])
      if (JSON.stringify(f.price?.[k] ?? null) !== JSON.stringify(o.price?.[k] ?? null)) ch.push('price.' + k);
    for (const k of ['ages', 'sizes'])
      if (JSON.stringify(f[k] ?? null) !== JSON.stringify(o[k] ?? null)) ch.push(k);
    if (f.__reScore) ch.push('ratings.value', 'score');
    if (dirtyDetail(f.id)) ch.push('prices');
    return `- ${f.brand} ${f.name}: ${ch.join(', ') || '변경'}`;
  }).join('\n');
  return `${head}\n\n${body}\n\n어드민 화면에서 커밋했습니다.`;
}

async function commit() {
  const dl = dirtyList();
  if (!dl.length) return;
  const errs = validate();
  if (errs.length) { toast(errs[0], true); return; }
  if (!confirm(`${dl.length}건을 main 에 커밋합니다.\n\n${dl.map(f => `· ${f.brand} ${f.name}`).join('\n')}`)) return;

  const btn = $('#commit');
  btn.disabled = true; btn.textContent = '커밋 중…';
  try {
    const res = await GH.putFile(PATH, serialize(), S.sha, commitMessage(dl));
    S.sha = res.content.sha;
    S.orig = new Map(S.foods.map(f => { delete f.__reScore; return [f.id, JSON.stringify(f)]; }));
    S.origDetail = new Map(Object.entries(S.detail).map(([k, v]) => [k, JSON.stringify(v)]));
    $('#meta').textContent = `${S.foods.length}종 · ${S.sha.slice(0, 7)}`;
    toast(`커밋했어요 — ${res.commit.sha.slice(0, 7)}. 몇 분 뒤 사이트에 반영돼요`);
    render();
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false; btn.textContent = 'GitHub 에 커밋';
  }
}

/* ── 토큰 ── */
async function askToken() {
  const cur = GH.token;
  const v = prompt(
    'fine-grained personal access token 을 넣어주세요.\n' +
    '· Repository access: butblank-oss/gsso_scat 하나만\n' +
    '· Permissions: Contents = Read and write\n' +
    '· Expiration: 되도록 짧게\n\n' +
    '이 브라우저에만 저장되고 저장소에는 들어가지 않아요. 비우면 삭제돼요.',
    cur ? '••••••••' : '');
  if (v === null) return;
  if (v === '••••••••') return;
  GH.token = v.trim();
  await boot();
}

async function boot() {
  $('#wrap').innerHTML = '';
  /* 엔진은 앱 도메인에서 읽어 온다. 못 읽었는데 목록만 띄우면 반쪽으로 돌다가
     별점·판정이 조용히 틀어진다. 그럴 바엔 멈추고 이유를 말한다. */
  if (typeof ENGINE === 'undefined' || typeof DICT === 'undefined') {
    $('#meta').textContent = '엔진을 못 읽었어요';
    $('#wrap').innerHTML = `<div class="empty"><b>채점 엔진을 불러오지 못했어요</b>
      ${esc(window.APP_BASE || '')}engine/ 을 읽지 못했습니다.<br>
      앱(balsatang.com)이 배포 중이거나 네트워크가 막혔을 수 있어요. 잠시 뒤 새로고침해 주세요.</div>`;
    return;
  }
  if (!GH.token) {
    $('#meta').textContent = '토큰이 필요해요';
    /* 어드민 안에서는 이 화면의 머리가 감춰져 있다. '오른쪽 위' 라고만 하면
       어느 오른쪽 위인지 알 수 없다 — 껍데기 것을 가리켜 준다. */
    const inShell = document.documentElement.classList.contains('embedded');
    $('#wrap').innerHTML = `<div class="empty"><b>먼저 토큰을 넣어주세요</b>
      ${inShell
        ? '이 화면 맨 위 <b>토큰</b> 버튼을 누르면 넣을 수 있어요. 한 번 넣으면 사료 관리·가격·심사가 함께 씁니다.'
        : '오른쪽 위 <b>토큰</b> 버튼을 누르면 넣을 수 있어요.'}</div>`;
    return;
  }
  try {
    const who = await GH.check();
    if (!who.canWrite) throw new Error(`${who.name} 에 쓰기 권한이 없는 토큰이에요`);
    await load();
  } catch (e) {
    $('#meta').textContent = '오류';
    $('#wrap').innerHTML = `<div class="empty"><b>${esc(e.message)}</b>토큰을 다시 확인해 주세요.</div>`;
  }
}

$('#tokenBtn').onclick = askToken;
$('#revert').onclick = () => {
  if (!confirm('수정한 내용을 전부 되돌릴까요?')) return;
  S.foods = S.foods.map(f => JSON.parse(S.orig.get(f.id)));
  for (const [k, v] of S.origDetail) S.detail[k] = JSON.parse(v);
  render();
};
$('#commit').onclick = commit;
/* 페이지 전환이라 실수로 닫힐 일이 없다. Escape 는 목록으로 돌아가는 지름길. */
addEventListener('keydown', e => { if (e.key === 'Escape' && S.cur) closePanel(); });
addEventListener('beforeunload', e => { if (dirtyList().length) { e.preventDefault(); e.returnValue = ''; } });

boot();
