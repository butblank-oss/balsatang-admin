/* 발사탕 어드민 — 사용 분석

   프론트(track.js)가 Supabase 의 events 표에 쌓은 익명 기록을 읽는다.
   숫자는 DB 함수 analytics_dashboard() 가 한 번에 계산해 준다. 여기서 다시 세지 않는다 —
   화면과 DB 가 각자 세면 둘이 어긋난다.

   ── 로그인 ──
   anon 키로는 읽을 수 없다(RLS). Supabase 에 만든 운영자 계정으로 로그인해야 하고,
   그 계정이 analytics_admins 에 들어 있어야 한다. 세션은 이 브라우저 localStorage 에만 둔다.
   설치 방법: analytics/README.md */
(function (global) {
'use strict';

const CFG_KEY = 'balsatang.sb.cfg';
const SES_KEY = 'balsatang.sb.session';
/* 프론트 track.js 의 TRACK_CFG 와 같은 값. 비워 두면 로그인 창에서 받는다. */
const DEFAULT_CFG = {
  url: 'https://lcynjpiclpedxflfvhns.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjeW5qcGljbHBlZHhmbGZ2aG5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzMTE4MTUsImV4cCI6MjEwNjg4NzgxNX0.NHEB02OtA0zYevKMeWnIDQaT7nl-toqn7Nka---8tZE'
};

const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
  del(k) { try { localStorage.removeItem(k); } catch { } }
};
const cfg = () => ({ ...DEFAULT_CFG, ...(ls.get(CFG_KEY) || {}) });
const base = () => cfg().url.replace(/\/$/, '');

/* ── 인증 ── */
async function authCall(path, body) {
  const r = await fetch(base() + '/auth/v1/' + path, {
    method: 'POST', headers: { apikey: cfg().key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.msg || j.message || `로그인 실패 (${r.status})`);
  const s = { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, email: j.user?.email };
  ls.set(SES_KEY, s);
  return s;
}
const login = (email, password) => authCall('token?grant_type=password', { email, password });
async function session() {
  const s = ls.get(SES_KEY);
  if (!s) return null;
  if (Date.now() < s.exp - 60000) return s;
  try { return await authCall('token?grant_type=refresh_token', { refresh_token: s.refresh }); }
  catch { ls.del(SES_KEY); return null; }
}
function logout() { ls.del(SES_KEY); }

async function api(path, opt = {}) {
  const s = await session();
  if (!s) throw Object.assign(new Error('로그인이 필요해요'), { auth: true });
  const r = await fetch(base() + path, {
    ...opt,
    headers: { apikey: cfg().key, Authorization: 'Bearer ' + s.access, 'Content-Type': 'application/json', ...(opt.headers || {}) }
  });
  const j = await r.json().catch(() => null);
  if (r.status === 401) { ls.del(SES_KEY); throw Object.assign(new Error('로그인이 만료됐어요'), { auth: true }); }
  if (!r.ok) {
    const msg = j?.message || `응답 ${r.status}`;
    throw new Error(/not an analytics admin/.test(msg) ? '이 계정은 분석 권한이 없어요 — analytics_admins 에 등록해 주세요' : msg);
  }
  return j;
}
const dashboard = (from, to) => api('/rest/v1/rpc/analytics_dashboard', { method: 'POST', body: JSON.stringify({ p_from: from, p_to: to }) });
const recent = (n = 100) => api(`/rest/v1/events?select=ts,device_id,session_id,name,props,screen,ref,utm_source,device,os,browser&order=id.desc&limit=${n}`);

/* ── 화면 ── */
const $esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = n => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const pct = (a, b) => (b ? Math.round(a / b * 1000) / 10 + '%' : '—');
const kst = d => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);

const SCREEN_KO = { home: '홈', search: '검색', detail: '사료 상세', compare: '비교', content: '콘텐츠',
  article: '글 상세', custom: '맞춤 결과', wizard: '맞춤 입력', terms: '이용약관', privacy: '개인정보처리방침' };
const EVENT_KO = {
  first_visit: '첫 방문', session_start: '방문 시작', screen_view: '화면 보기', search: '검색',
  buy_click: '구매 클릭', compare_add: '비교 담기', compare_remove: '비교 빼기', compare_reset: '비교 비우기',
  compare_slot: '비교 칸 선택', save_toggle: '찜', share: '공유', filter: '필터', sort: '정렬 선택',
  sort_open: '정렬 열기', concern_click: '고민 바로가기', search_chip: '추천 검색어', tab_click: '하단 탭',
  detail_tab: '상세 탭', request: '요청', ingredients_open: '원료 전체 보기', recent_open: '최근 본 사료',
  feeding_meals: '끼니 수', feeding_bag: '봉지 용량', pet_edit: '아이 정보 수정', wizard_answer: '맞춤 답변',
  wizard_submit: '맞춤 제출', pet_profile_saved: '맞춤 완료', article_click: '글 열기', article_category: '글 분류',
  nav: '화면 이동', food_click: '사료 카드', search_clear: '검색 지우기', back: '뒤로', js_error: '오류',
  tracking_on: '기록 켬', tracking_off: '기록 끔'
};
/* app.js 가 이 파일보다 늦게 읽히므로 부를 때 찾는다 */
const CONCERN_SHORT = { skin: '피부', eye_tear: '눈물자국', digestive: '소화', weight: '체중', joint: '관절',
  senior: '노령', picky_eater: '입맛', value: '가성비', none: '딱히 없음' };
const concernLabel = k => CONCERN_SHORT[k] || ((typeof BS !== 'undefined' && BS.CONCERN_KO) || {})[k] || k;

function foodName(id) {
  const f = ((typeof store !== 'undefined' && store.foods) || []).find(x => x.id === id);
  return f ? `${f.brand} ${f.name}` : id;
}
const screenName = s => SCREEN_KO[s] || s || '(알 수 없음)';

let range = { days: 7 };
let last = null;

function rangeDates() {
  const to = new Date();
  const from = new Date(to.getTime() - (range.days - 1) * 86400e3);
  return { from: kst(from), to: kst(to) };
}

function shell(inner) {
  el('wrap').innerHTML = `
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px">
    <div class="seg" id="anRange">${[[1, '오늘'], [7, '7일'], [30, '30일'], [90, '90일']].map(([d, l]) =>
      `<button class="${range.days === d ? 'on' : ''}" data-d="${d}" style="${range.days === d ? 'background:var(--pri-soft);border-color:var(--pri);color:#7FA9FF' : ''}">${l}</button>`).join('')}</div>
    <span style="font-size:11px;color:var(--muted)" id="anRangeTxt"></span>
    <div style="flex:1"></div>
    <button class="btn sm" id="anRefresh">새로고침</button>
    <button class="btn sm ghost" id="anLogin">${ls.get(SES_KEY)?.email ? $esc(ls.get(SES_KEY).email) + ' · 로그아웃' : '로그인'}</button>
  </div>
  <div id="anBody">${inner}</div>`;
  el('anRange').onclick = e => { const d = +e.target.dataset.d; if (d) { range.days = d; page(); } };
  el('anRefresh').onclick = () => page();
  el('anLogin').onclick = () => {
    if (ls.get(SES_KEY)) { logout(); page(); } else openLogin();
  };
}

function openLogin(errMsg) {
  const c = cfg();
  global.showModal(`<div class="modal" style="max-width:480px">
    <div class="modal-h"><b>분석 로그인</b>
      <p>Supabase 에 만든 <b>운영자 계정</b>으로 로그인해요. 세션은 이 브라우저에만 저장돼요.
         프로젝트 주소와 anon 키는 프론트 <b>track.js</b> 에 넣은 값과 같아요.</p></div>
    <label>Supabase 프로젝트 주소<input id="sbUrl" value="${$esc(c.url)}" placeholder="https://xxxx.supabase.co" autocapitalize="off" spellcheck="false"></label>
    <label>anon 키<input id="sbKey" value="${$esc(c.key)}" placeholder="eyJ…" autocapitalize="off" spellcheck="false"></label>
    <label>이메일<input id="sbEmail" type="email" autocomplete="username" value="${$esc(ls.get(SES_KEY)?.email || '')}"></label>
    <label>비밀번호<input id="sbPw" type="password" autocomplete="current-password"></label>
    <div id="sbMsg" style="min-height:18px;font-size:12px;color:var(--bad)">${$esc(errMsg || '')}</div>
    <div class="modal-f"><button class="btn" onclick="closeModal()">닫기</button>
      <button class="btn pri" id="sbGo">로그인</button></div>
  </div>`);
  const go = async () => {
    const url = el('sbUrl').value.trim(), key = el('sbKey').value.trim();
    if (!/^https:\/\/.+/.test(url) || !key) { el('sbMsg').textContent = '주소와 anon 키를 넣어주세요'; return; }
    ls.set(CFG_KEY, { url, key });
    el('sbMsg').style.color = 'var(--sub)'; el('sbMsg').textContent = '확인하는 중…';
    try {
      await login(el('sbEmail').value.trim(), el('sbPw').value);
      global.closeModal(); global.toast('로그인했어요'); page();
    } catch (e) { el('sbMsg').style.color = 'var(--bad)'; el('sbMsg').textContent = e.message; }
  };
  el('sbGo').onclick = go;
  el('sbPw').onkeydown = e => { if (e.key === 'Enter') go(); };
}

async function page() {
  if (!cfg().url || !ls.get(SES_KEY)) {
    shell(`<div class="card"><div class="empty">
      ${ico('chart', 40)}<div style="margin-top:14px">사용 분석을 보려면 로그인해 주세요</div>
      <div style="margin-top:6px;font-size:11px">Supabase 운영자 계정이 필요해요 · 설치 방법은 analytics/README.md</div>
      <button class="btn pri" style="margin-top:16px" onclick="ANALYTICS.openLogin()">로그인</button></div></div>`);
    return;
  }
  shell(`<div class="card"><div class="empty">불러오는 중…</div></div>`);
  const { from, to } = rangeDates();
  el('anRangeTxt').textContent = `${from} ~ ${to} (한국 시간)`;
  try {
    const [d, r] = await Promise.all([dashboard(from, to), recent(80)]);
    last = d;
    el('anBody').innerHTML = view(d, r);
    wireChart(d);
  } catch (e) {
    if (e.auth) { openLogin(e.message); return; }
    el('anBody').innerHTML = `<div class="card"><div class="empty" style="color:#FF8088">${$esc(e.message)}</div></div>`;
  }
}

/* ── 인사이트 — 숫자를 읽어 할 일로 바꾼다 ── */
function insights(d) {
  const out = [];
  const c = d.kpi?.cur || {}, p = d.kpi?.prev || {};
  const delta = (a, b) => (b ? Math.round((a - b) / b * 100) : null);
  const dv = delta(c.visitors, p.visitors);
  if (dv != null && Math.abs(dv) >= 20) out.push({ c: dv > 0 ? 'var(--good)' : 'var(--warn)',
    t: `방문자가 직전 기간보다 <b>${dv > 0 ? '+' : ''}${dv}%</b> ${dv > 0 ? '늘었어요' : '줄었어요'}. 유입 경로 표에서 어디가 움직였는지 보세요.` });
  const z = d.zero || [];
  if (z.length) out.push({ c: 'var(--bad)',
    t: `결과 0건 검색이 <b>${num(z.reduce((a, x) => a + x.n, 0))}회</b> — 1위 '<b>${$esc(z[0].q)}</b>'(${num(z[0].n)}회). 사료 추가나 동의어 등록 후보예요.` });
  const f = d.funnel || {};
  if (f.viewed_food && f.clicked_buy != null) {
    const cr = f.clicked_buy / f.viewed_food;
    out.push({ c: 'var(--pri)', t: `사료 상세를 본 사람 중 <b>${pct(f.clicked_buy, f.viewed_food)}</b>가 구매 버튼을 눌렀어요.${cr < 0.05 ? ' 낮은 편이에요 — 가격·구매 링크가 없는 사료가 많은지 확인해 보세요.' : ''}` });
  }
  const foods = (d.foods || []).filter(x => x.views >= 10);
  const weak = foods.filter(x => x.buy_clicks === 0).slice(0, 3);
  if (weak.length) out.push({ c: 'var(--warn)', t: `많이 보는데 구매 클릭이 0인 사료: ${weak.map(x => `<b>${$esc(foodName(x.id))}</b>`).join(', ')} — 구매 링크가 있는지 확인하세요.` });
  const src = (d.sources || []).filter(x => x.sessions >= 10).map(x => ({ ...x, r: x.buy_sessions / x.sessions })).sort((a, b) => b.r - a.r);
  if (src.length >= 2) out.push({ c: 'var(--good)', t: `구매로 가장 잘 이어지는 유입은 <b>${$esc(src[0].source)}</b> (방문의 ${pct(src[0].buy_sessions, src[0].sessions)}).` });
  if (c.errors) out.push({ c: 'var(--bad)', t: `화면 오류가 <b>${num(c.errors)}건</b> 기록됐어요. 아래 '오류' 표를 확인하세요.` });
  const req = (d.requests || []).filter(x => x.type === 'analysis');
  if (req.length) out.push({ c: 'var(--pri)', t: `분석 요청 ${num(req.reduce((a, x) => a + x.n, 0))}건 — 1위 <b>${$esc(foodName(req[0].target))}</b>.` });
  return out;
}

function kpiTile(label, icon, cur, prev, sub) {
  const d = prev ? Math.round((cur - prev) / prev * 100) : null;
  const arrow = d == null ? '' : `<span style="color:${d >= 0 ? 'var(--good)' : 'var(--warn)'};font-weight:800">${d >= 0 ? '▲' : '▼'} ${Math.abs(d)}%</span> `;
  return `<div class="kpi"><div class="kpi-l">${ico(icon, 14)}${label}</div>
    <div class="kpi-v">${num(cur)}</div><div class="kpi-s">${arrow}${sub || (prev != null ? `직전 ${num(prev)}` : '')}</div></div>`;
}

function table(cols, rows, empty = '아직 기록이 없어요') {
  if (!rows.length) return `<div class="empty" style="padding:28px">${empty}</div>`;
  return `<div style="overflow-x:auto"><table><thead><tr>${cols.map(c => `<th style="${c.r ? 'text-align:right' : ''}">${c.h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${cols.map(c => `<td style="${c.r ? 'text-align:right;font-variant-numeric:tabular-nums' : ''}">${c.f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function bars(rows, key, labelFn, valFn) {
  const max = Math.max(1, ...rows.map(r => r[key]));
  return rows.map(r => `<div style="display:flex;align-items:center;gap:10px;padding:5px 0">
    <div style="width:42%;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${labelFn(r)}</div>
    <div style="flex:1;height:14px;background:var(--panel2);border-radius:4px;overflow:hidden">
      <div style="height:100%;width:${r[key] / max * 100}%;background:var(--pri);border-radius:0 4px 4px 0"></div></div>
    <div style="width:86px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;color:var(--ink2)">${valFn(r)}</div></div>`).join('');
}

function view(d, ev) {
  const c = d.kpi?.cur || {}, p = d.kpi?.prev || {};
  const f = d.funnel || {};
  const ins = insights(d);
  const steps = [['방문', f.visited], ['탐색 (검색·카드)', f.explored], ['사료 상세', f.viewed_food], ['찜·비교·맞춤', f.engaged], ['구매 클릭', f.clicked_buy]];
  const env = k => (d.envs || []).filter(x => x.k === k).sort((a, b) => b.visitors - a.visitors);
  const sec = (t, body, extra = '') => `<div class="card" style="margin-bottom:14px"><div class="sec-t">${t}${extra}</div>${body}</div>`;

  return `
  <div class="kpis an-kpis">
    ${kpiTile('방문자', 'smile', c.visitors, p.visitors)}
    ${kpiTile('신규 유입', 'plus', c.new_visitors, p.new_visitors)}
    ${kpiTile('방문 수', 'refresh', c.sessions, p.sessions)}
    ${kpiTile('사료 상세 조회', 'eye', c.food_views, p.food_views)}
    ${kpiTile('구매 클릭', 'coins', c.buy_clicks, p.buy_clicks, `${num(c.buyers)}명 · 방문자의 ${pct(c.buyers, c.visitors)}`)}
    ${kpiTile('맞춤 완료', 'paw', c.profiles, p.profiles)}
  </div>

  ${ins.length ? sec('인사이트', ins.map(i => `<div class="todo"><span class="bul" style="background:${i.c}"></span><span style="line-height:1.6">${i.t}</span></div>`).join('')) : ''}

  ${sec('일별 방문자', `<div id="anChart" style="position:relative"></div>`, ' <span style="font-weight:500;color:var(--muted);font-size:11px">막대에 올리면 신규·방문·구매 클릭이 보여요</span>')}

  <div class="grid2 an2">
    ${sec('전환 퍼널 <span style="font-weight:500;color:var(--muted);font-size:11px">— 기간 내 기기 기준</span>',
      bars(steps.map(([l, v]) => ({ l, v: v || 0 })), 'v', r => r.l, r => `${num(r.v)} · ${pct(r.v, f.visited)}`))}
    ${sec('유입 경로', table([
      { h: '경로', f: r => $esc(r.source) }, { h: '방문', r: 1, f: r => num(r.sessions) },
      { h: '신규', r: 1, f: r => num(r.new_visitors) }, { h: '구매 전환', r: 1, f: r => pct(r.buy_sessions, r.sessions) }], d.sources || []))}
  </div>

  <div class="grid2 an2">
    ${sec('많이 본 사료', table([
      { h: '사료', f: r => `<div class="t-main">${$esc(foodName(r.id))}</div>` },
      { h: '조회', r: 1, f: r => num(r.views) }, { h: '사람', r: 1, f: r => num(r.visitors) },
      { h: '구매 클릭', r: 1, f: r => `${num(r.buy_clicks)} <span style="color:var(--muted)">${pct(r.buy_clicks, r.views)}</span>` },
      { h: '비교', r: 1, f: r => num(r.compare_adds) }, { h: '찜', r: 1, f: r => num(r.saves) }], (d.foods || []).slice(0, 15)))}
    ${sec('화면별', table([
      { h: '화면', f: r => screenName(r.screen) }, { h: '조회', r: 1, f: r => num(r.views) },
      { h: '사람', r: 1, f: r => num(r.visitors) }, { h: '머문 시간(중간값)', r: 1, f: r => r.median_sec == null ? '—' : r.median_sec + '초' }],
      (d.screens || []).filter(r => r.screen)))}
  </div>

  <div class="grid2 an2">
    ${sec('검색어 TOP', table([
      { h: '검색어', f: r => $esc(r.q) }, { h: '횟수', r: 1, f: r => num(r.n) }, { h: '사람', r: 1, f: r => num(r.visitors) },
      { h: '결과', r: 1, f: r => r.max_results === 0 ? '<span class="tag bad">0건</span>' : num(r.max_results) }], d.searches || []))}
    ${sec('결과 0건 검색 <span style="font-weight:500;color:var(--muted);font-size:11px">— 사료·동의어 추가 후보</span>', table([
      { h: '검색어', f: r => $esc(r.q) }, { h: '횟수', r: 1, f: r => num(r.n) }, { h: '사람', r: 1, f: r => num(r.visitors) }], d.zero || [], '결과 없는 검색이 없어요'))}
  </div>

  <div class="grid2 an2">
    ${sec('주간 재방문 <span style="font-weight:500;color:var(--muted);font-size:11px">— 처음 온 주 기준 · 최근 8주</span>', table([
      { h: '첫 방문 주', f: r => r.wk }, { h: '신규', r: 1, f: r => num(r.size) },
      ...[1, 2, 3, 4].map(n => ({ h: n + '주 뒤', r: 1, f: r => cohortCell(r, n) }))], d.cohorts || []))}
    ${sec('맞춤 추천 고민', (d.concerns || []).length
      ? bars(d.concerns, 'n', r => $esc(concernLabel(r.concern)), r => num(r.n))
      : '<div class="empty" style="padding:28px">아직 기록이 없어요</div>')}
  </div>

  <div class="grid2 an2">
    ${sec('캠페인 (utm)', table([
      { h: 'source / medium', f: r => `${$esc(r.source)}${r.medium ? ' / ' + $esc(r.medium) : ''}` }, { h: '캠페인', f: r => $esc(r.campaign) },
      { h: '방문', r: 1, f: r => num(r.sessions) }, { h: '구매 전환', r: 1, f: r => pct(r.buy_sessions, r.sessions) }], d.campaigns || [],
      '링크에 ?utm_source=…&utm_campaign=… 를 붙이면 여기 나와요'))}
    ${sec('처음 들어온 화면', table([
      { h: '화면', f: r => $esc(r.landing) }, { h: '방문', r: 1, f: r => num(r.sessions) }], d.landings || []))}
  </div>

  <div class="grid2 an2">
    ${sec('기기', ['device', 'os', 'browser', 'app'].map(k => `<div style="margin-bottom:10px"><div style="font-size:11px;color:var(--muted);margin-bottom:4px">${{ device: '기기', os: '운영체제', browser: '브라우저', app: '앱/웹' }[k]}</div>
      <div class="chips">${env(k).map(x => `<span class="chip" style="cursor:default">${$esc(x.v)} <b style="margin-left:4px">${num(x.visitors)}</b></span>`).join('') || '—'}</div></div>`).join(''))}
    ${sec('모든 행동', table([
      { h: '이벤트', f: r => `${$esc(EVENT_KO[r.name] || r.name)} <span style="color:var(--muted);font-size:10.5px">${$esc(r.name)}</span>` },
      { h: '횟수', r: 1, f: r => num(r.n) }, { h: '사람', r: 1, f: r => num(r.visitors) }], d.actions || []))}
  </div>

  ${(d.errors || []).length ? sec('오류', table([
    { h: '메시지', f: r => $esc(r.msg) }, { h: '위치', f: r => `${$esc(r.src)}:${$esc(r.line)}` },
    { h: '횟수', r: 1, f: r => num(r.n) }, { h: '마지막', f: r => new Date(r.last).toLocaleString('ko-KR') }], d.errors)) : ''}

  ${sec('실시간 기록 <span style="font-weight:500;color:var(--muted);font-size:11px">— 최근 80건</span>', table([
    { h: '시각', f: r => `<span style="white-space:nowrap">${new Date(r.ts).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>` },
    { h: '기기', f: r => `<span style="font-family:ui-monospace,monospace;color:var(--sub)">${$esc(String(r.device_id).slice(0, 6))}</span>` },
    { h: '행동', f: r => $esc(EVENT_KO[r.name] || r.name) },
    { h: '내용', f: r => `<span style="color:var(--sub)">${$esc(describe(r))}</span>` }], ev || []))}
  `;
}

function cohortCell(r, n) {
  const v = r['w' + n];
  const wkEnd = new Date(r.wk).getTime() + (n + 1) * 7 * 86400e3;
  if (wkEnd > Date.now() + 7 * 86400e3) return '<span style="color:var(--muted)">·</span>';
  if (!r.size) return '—';
  const p = v / r.size;
  return `<span style="padding:2px 6px;border-radius:4px;background:rgba(47,111,237,${(0.1 + p * 0.8).toFixed(2)})">${Math.round(p * 100)}%</span>`;
}

function describe(r) {
  const p = r.props || {};
  if (r.name === 'screen_view') return screenName(p.screen) + (p.id ? ' · ' + foodName(p.id) : '') + (p.q ? ` · "${p.q}"` : '');
  if (r.name === 'search') return `"${p.q}" → ${p.n}건`;
  if (r.name === 'session_start' || r.name === 'first_visit') return [r.utm_source || r.ref || '직접', r.device, r.browser].filter(Boolean).join(' · ');
  if (p.id) return foodName(p.id) + (p.at ? ` · ${p.at}` : '');
  const rest = Object.entries(p).filter(([k]) => k !== 'screen').map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`);
  return rest.join(' ');
}

/* 일별 방문자 — 한 계열이라 범례 없이 제목이 이름이 된다. 세부 숫자는 툴팁. */
function wireChart(d) {
  const host = el('anChart');
  if (!host) return;
  const { from, to } = rangeDates();
  const byDay = Object.fromEntries((d.daily || []).map(x => [x.d, x]));
  const days = [];
  for (let t = new Date(from + 'T00:00:00Z'); t.toISOString().slice(0, 10) <= to; t = new Date(t.getTime() + 86400e3)) {
    const k = t.toISOString().slice(0, 10);
    days.push(byDay[k] || { d: k, visitors: 0, new_visitors: 0, sessions: 0, buy_clicks: 0 });
    if (days.length > 120) break;
  }
  const W = Math.max(320, host.clientWidth || 600), H = 180, padL = 34, padB = 22, padT = 8;
  const max = Math.max(1, ...days.map(x => x.visitors));
  const nice = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / nice) * nice;
  const bw = (W - padL) / days.length;
  const y = v => padT + (H - padT - padB) * (1 - v / top);
  const ticks = [0, top / 2, top];
  const every = Math.ceil(days.length / 8);
  host.innerHTML = `<svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block" role="img" aria-label="일별 방문자">
    ${ticks.map(t => `<line x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-width="1"/>
      <text x="${padL - 6}" y="${y(t) + 3}" text-anchor="end" font-size="10" fill="var(--muted)">${num(t)}</text>`).join('')}
    ${days.map((x, i) => {
      const h = Math.max(0, y(0) - y(x.visitors)), bx = padL + i * bw + Math.min(2, bw * 0.15), w = Math.max(1, bw - Math.min(4, bw * 0.3));
      const r = Math.min(4, w / 2, h);
      return `<g data-i="${i}">
        <rect x="${padL + i * bw}" y="${padT}" width="${bw}" height="${H - padT - padB}" fill="transparent"/>
        ${h ? `<path d="M${bx},${y(0)} V${y(x.visitors) + r} Q${bx},${y(x.visitors)} ${bx + r},${y(x.visitors)} H${bx + w - r} Q${bx + w},${y(x.visitors)} ${bx + w},${y(x.visitors) + r} V${y(0)} Z" fill="var(--pri)"/>` : ''}
        ${i % every === 0 ? `<text x="${padL + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${x.d.slice(5).replace('-', '/')}</text>` : ''}
      </g>`;
    }).join('')}
  </svg>
  <div id="anTip" style="position:absolute;display:none;pointer-events:none;padding:8px 10px;border-radius:8px;background:var(--panel2);border:1px solid var(--line2);font-size:11.5px;line-height:1.6;white-space:nowrap"></div>`;
  const tip = el('anTip');
  host.querySelector('svg').addEventListener('mousemove', e => {
    const g = e.target.closest('g[data-i]');
    if (!g) { tip.style.display = 'none'; return; }
    const x = days[+g.dataset.i];
    tip.innerHTML = `<b>${x.d}</b><br>방문자 ${num(x.visitors)} · 신규 ${num(x.new_visitors)}<br>방문 ${num(x.sessions)} · 구매 클릭 ${num(x.buy_clicks)}`;
    const rc = host.getBoundingClientRect();
    tip.style.display = 'block';
    tip.style.left = Math.min(rc.width - tip.offsetWidth, Math.max(0, e.clientX - rc.left + 12)) + 'px';
    tip.style.top = (e.clientY - rc.top - 10) + 'px';
  });
  host.querySelector('svg').addEventListener('mouseleave', () => { tip.style.display = 'none'; });
}

global.ANALYTICS = { page, openLogin, logout, last: () => last };
})(window);
