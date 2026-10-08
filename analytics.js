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
/* p_who 를 받는 새 함수(analytics/schema.sql 4~6번)가 아직 DB 에 없으면 PostgREST 가
   'Could not find the function' 으로 거절한다. 그때는 예전 함수로 받고 화면에 'SQL 업데이트' 를 띄운다. */
const missingFn = e => /Could not find the function|PGRST202|does not exist/i.test(e && e.message || '');
let needSql = false;
async function dashboard(from, to, who) {
  try {
    return await api('/rest/v1/rpc/analytics_dashboard', { method: 'POST', body: JSON.stringify({ p_from: from, p_to: to, p_who: who }) });
  } catch (e) {
    if (!missingFn(e)) throw e;
    needSql = true;
    return api('/rest/v1/rpc/analytics_dashboard', { method: 'POST', body: JSON.stringify({ p_from: from, p_to: to }) });
  }
}
const traffic = (from, to) => api('/rest/v1/rpc/analytics_traffic', { method: 'POST', body: JSON.stringify({ p_from: from, p_to: to }) });
const sessions = (from, to, who, limit, offset) => api('/rest/v1/rpc/analytics_sessions', { method: 'POST',
  body: JSON.stringify({ p_from: from, p_to: to, p_who: who, p_limit: limit, p_offset: offset }) });
const sessionEvents = sid => api(`/rest/v1/events?select=ts,name,props,screen,ref,utm_source,device,os,browser&session_id=eq.${encodeURIComponent(sid)}&order=id.asc&limit=500`);
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

/* ── 탭 ──
   한 화면에 표 열여섯 개를 쌓았더니 무엇을 봐야 할지 몰랐다. 질문 단위로 나눈다.
   대시보드(요즘 어때?) · 유입(어디서 왔어? 사람이야?) · 세션(한 사람은 뭘 했어?)
   · 사료·검색(뭘 찾았어?) · 행동·오류(어디서 막혔어?) */
const TABS = [['dash', '대시보드'], ['traffic', '유입 · 사람/봇'], ['sessions', '세션별'], ['gsc', '검색어 (구글)'], ['foods', '사료 · 검색'], ['acts', '행동 · 오류']];
const WHO = [['human', '사람만'], ['bot', '봇만'], ['all', '전체']];
const KIND_KO = { search: '검색 (구글·네이버 등)', video: '유튜브', community: '블로그·카페', social: 'SNS', ai: 'AI 답변',
  messenger: '카카오톡 등 메신저', naver_app: '네이버 앱', shop: '쇼핑몰', referral: '다른 사이트', direct: '직접 방문' };
const BOT_KO = { googlebot: '구글 검색 로봇', naver: '네이버 검색 로봇 (Yeti)', daum: '다음 검색 로봇', bing: '빙 검색 로봇',
  kakao: '카카오톡 링크 미리보기', facebook: '페이스북·메타 미리보기', twitter: 'X 링크 미리보기', apple: '애플 검색 로봇',
  yandex: '얀덱스 로봇', baidu: '바이두 로봇', ai: 'AI 수집기 (GPT·Claude·Perplexity 등)', seo: 'SEO 분석 로봇',
  other: '그 밖의 로봇', headless: '자동화 브라우저 (자동 점검·수집)', lighthouse: '성능 측정 도구',
  'headless(추정)': '자동화 브라우저 (추정 · 예전 기록)', automation: '자동화 도구', crawler: '로봇' };
const kindName = k => KIND_KO[k] || k || '—';
const botName = b => BOT_KO[b] || b || '로봇';
const whoTag = (who, bot) => who === 'bot'
  ? `<span class="tag warn" title="${$esc(bot || '')}">봇 · ${$esc(botName(bot))}</span>` : '<span class="tag good">사람</span>';

const st = { tab: 'dash', who: 'human', sess: [], sessTotal: 0, open: null };
try { const s = JSON.parse(localStorage.getItem('balsatang.an.ui') || 'null'); if (s) { st.tab = s.tab || st.tab; st.who = s.who || st.who; } } catch { }
const saveUi = () => { try { localStorage.setItem('balsatang.an.ui', JSON.stringify({ tab: st.tab, who: st.who })); } catch { } };

let range = { days: 7 };
let last = null;

function rangeDates() {
  const to = new Date();
  const from = new Date(to.getTime() - (range.days - 1) * 86400e3);
  return { from: kst(from), to: kst(to) };
}

const segBtn = (on, attr, v, l) => `<button class="${on ? 'on' : ''}" ${attr}="${v}" style="${on ? 'background:var(--pri-soft);border-color:var(--pri);color:#1F57C8' : ''}">${l}</button>`;

function shell(inner) {
  el('wrap').innerHTML = `
  <div class="tabs" id="anTabs" style="flex-wrap:wrap">${TABS.map(([k, l]) => `<button class="${st.tab === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px">
    <div class="seg" id="anRange">${[[1, '오늘'], [7, '7일'], [30, '30일'], [90, '90일']].map(([d, l]) => segBtn(range.days === d, 'data-d', d, l)).join('')}</div>
    ${st.tab === 'traffic' || st.tab === 'gsc' ? '' : `<div class="seg" id="anWho" title="봇: 검색 로봇·자동화 브라우저(자동 점검 포함)">${WHO.map(([k, l]) => segBtn(st.who === k, 'data-w', k, l)).join('')}</div>`}
    <span style="font-size:11px;color:var(--muted)" id="anRangeTxt"></span>
    <div style="flex:1"></div>
    <button class="btn sm" id="anRefresh">새로고침</button>
    <button class="btn sm ghost" id="anLogin">${ls.get(SES_KEY)?.email ? $esc(ls.get(SES_KEY).email) + ' · 로그아웃' : '로그인'}</button>
  </div>
  <div id="anSql"></div>
  <div id="anBody">${inner}</div>`;
  el('anTabs').onclick = e => { const t = e.target.closest('[data-t]'); if (t) { st.tab = t.dataset.t; st.open = null; saveUi(); page(); } };
  el('anRange').onclick = e => { const d = +e.target.dataset.d; if (d) { range.days = d; page(); } };
  const w = document.getElementById('anWho');
  if (w) w.onclick = e => { const v = e.target.dataset.w; if (v) { st.who = v; saveUi(); page(); } };
  el('anRefresh').onclick = () => page();
  el('anLogin').onclick = () => {
    if (ls.get(SES_KEY)) { logout(); page(); } else openLogin();
  };
}

function sqlBanner(what) {
  const host = document.getElementById('anSql');
  if (!host) return;
  host.innerHTML = `<div class="card" style="margin-bottom:14px;border-color:#F2D49B;background:var(--warn-soft)">
    <b>DB 업데이트가 한 번 필요해요</b>
    <div style="margin-top:6px;font-size:12.5px;line-height:1.7">${what}<br>
      Supabase → <b>SQL Editor</b> 에 <b>analytics/schema.sql</b> 을 통째로 붙여 넣고 <b>Run</b> 을 누르세요. 여러 번 실행해도 괜찮아요.
      <a href="https://github.com/butblank-oss/balsatang-admin/blob/main/analytics/schema.sql" target="_blank" rel="noopener" style="color:var(--pri-ink);font-weight:700">schema.sql 열기 ↗</a></div></div>`;
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
  /* 검색어 탭은 Supabase 가 아니라 구글에서 읽는다 — 분석 로그인 없이도 열린다. */
  if (st.tab === 'gsc') {
    shell(`<div class="card"><div class="empty">불러오는 중…</div></div>`);
    const { from, to } = rangeDates();
    el('anRangeTxt').textContent = `${from} ~ ${to}`;
    try { await viewGsc(el('anBody')); }
    catch (e) {
      if (e.gauth) { page(); return; }
      el('anBody').innerHTML = `<div class="card"><div class="empty" style="color:#B91C1C">${$esc(e.message)}</div></div>`;
    }
    return;
  }
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
  needSql = false;
  try {
    const body = el('anBody');
    if (st.tab === 'traffic') {
      const [t, d] = await Promise.all([traffic(from, to).catch(e => { if (missingFn(e)) { needSql = true; return null; } throw e; }), dashboard(from, to, 'human')]);
      last = d;
      body.innerHTML = t ? viewTraffic(t, d) : viewTrafficOld(d);
      if (t) wireStack(t);
    } else if (st.tab === 'sessions') {
      st.sess = []; st.sessTotal = 0;
      try { await moreSessions(from, to); body.innerHTML = viewSessions(); wireSessions(); }
      catch (e) { if (!missingFn(e)) throw e; needSql = true; body.innerHTML = '<div class="card"><div class="empty">세션별 보기는 DB 업데이트 뒤에 열려요</div></div>'; }
    } else {
      const [d, r] = await Promise.all([dashboard(from, to, st.who), st.tab === 'acts' ? recent(80) : null]);
      last = d;
      body.innerHTML = st.tab === 'foods' ? viewFoods(d) : st.tab === 'acts' ? viewActs(d, r) : viewDash(d);
      if (st.tab === 'dash') wireChart(d);
    }
    if (needSql) sqlBanner('사람·봇 구분, 유입 종류, 세션별 보기를 쓰려면 새 DB 함수가 있어야 해요. 지금 숫자에는 봇이 섞여 있어요.');
  } catch (e) {
    if (e.auth) { openLogin(e.message); return; }
    el('anBody').innerHTML = `<div class="card"><div class="empty" style="color:#B91C1C">${$esc(e.message)}</div></div>`;
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

const sec = (t, body, extra = '') => `<div class="card" style="margin-bottom:14px"><div class="sec-t">${t}${extra}</div>${body}</div>`;
const hint = t => ` <span style="font-weight:500;color:var(--muted);font-size:11px">${t}</span>`;
const whoNote = () => st.who === 'human' ? '' : st.who === 'bot' ? hint('— 봇만 센 숫자') : hint('— 사람과 봇을 합친 숫자');

/* ── 대시보드 — 요즘 어떤가. 핵심 숫자·추이·퍼널·유입 요약만. ── */
function viewDash(d) {
  const c = d.kpi?.cur || {}, p = d.kpi?.prev || {};
  const f = d.funnel || {};
  const ins = insights(d);
  const steps = [['방문', f.visited], ['탐색 (검색·카드)', f.explored], ['사료 상세', f.viewed_food], ['찜·비교·맞춤', f.engaged], ['구매 클릭', f.clicked_buy]];
  const env = k => (d.envs || []).filter(x => x.k === k).sort((a, b) => b.visitors - a.visitors);
  const wb = (d.whos || []).find(x => x.who === 'bot');
  return `
  <div class="kpis an-kpis">
    ${kpiTile('방문자', 'smile', c.visitors, p.visitors)}
    ${kpiTile('신규 유입', 'plus', c.new_visitors, p.new_visitors)}
    ${kpiTile('방문 수', 'refresh', c.sessions, p.sessions)}
    ${kpiTile('사료 상세 조회', 'eye', c.food_views, p.food_views)}
    ${kpiTile('구매 클릭', 'coins', c.buy_clicks, p.buy_clicks, `${num(c.buyers)}명 · 방문자의 ${pct(c.buyers, c.visitors)}`)}
    ${kpiTile('맞춤 완료', 'paw', c.profiles, p.profiles)}
  </div>
  ${st.who === 'human' && wb && wb.sessions ? `<div style="margin:-6px 0 14px;font-size:11.5px;color:var(--muted)">이 기간 봇 방문 ${num(wb.sessions)}회는 빼고 셌어요 · <a href="#" onclick="ANALYTICS.tab('traffic');return false" style="color:var(--pri-ink);font-weight:700">유입 탭에서 보기</a></div>` : ''}

  ${ins.length ? sec('인사이트', ins.map(i => `<div class="todo"><span class="bul" style="background:${i.c}"></span><span style="line-height:1.6">${i.t}</span></div>`).join('')) : ''}

  ${sec('일별 방문자' + whoNote(), `<div id="anChart" style="position:relative"></div>`, hint('막대에 올리면 신규·방문·구매 클릭이 보여요'))}

  <div class="grid2 an2">
    ${sec('전환 퍼널' + hint('— 기간 내 기기 기준'),
      bars(steps.map(([l, v]) => ({ l, v: v || 0 })), 'v', r => r.l, r => `${num(r.v)} · ${pct(r.v, f.visited)}`))}
    ${sec('어디서 왔나' + hint('— 방문 기준'), (d.kinds || []).length
      ? bars(splitSearch(d.kinds, d.sources), 'sessions', r => $esc(kindLabel(r)), r => `${num(r.sessions)} · 구매 ${pct(r.buy_sessions, r.sessions)}`)
      : table([{ h: '경로', f: r => $esc(r.source) }, { h: '방문', r: 1, f: r => num(r.sessions) }], d.sources || []))}
  </div>

  <div class="grid2 an2">
    ${sec('주간 재방문' + hint('— 처음 온 주 기준 · 최근 8주'), table([
      { h: '첫 방문 주', f: r => r.wk }, { h: '신규', r: 1, f: r => num(r.size) },
      ...[1, 2, 3, 4].map(n => ({ h: n + '주 뒤', r: 1, f: r => cohortCell(r, n) }))], d.cohorts || []))}
    ${sec('기기', ['device', 'os', 'browser', 'app'].map(k => `<div style="margin-bottom:10px"><div style="font-size:11px;color:var(--muted);margin-bottom:4px">${{ device: '기기', os: '운영체제', browser: '브라우저', app: '앱/웹' }[k]}</div>
      <div class="chips">${env(k).map(x => `<span class="chip" style="cursor:default">${$esc(x.v)} <b style="margin-left:4px">${num(x.visitors)}</b></span>`).join('') || '—'}</div></div>`).join(''))}
  </div>`;
}

/* ── 유입 — 어디서 왔고, 사람인가 ── */
function viewTraffic(t, d) {
  const sum = Object.fromEntries((t.summary || []).map(x => [x.who, x]));
  const h = sum.human || {}, b = sum.bot || {};
  const all = (h.sessions || 0) + (b.sessions || 0);
  const hk = splitSearch((t.kinds || []).filter(x => x.who === 'human'), (t.sources || []).filter(x => x.who === 'human'));
  return `
  <div class="kpis an-kpis">
    <div class="kpi ok"><div class="kpi-l">${ico('smile', 14)}사람 방문</div><div class="kpi-v">${num(h.sessions || 0)}</div><div class="kpi-s">${num(h.visitors || 0)}명</div></div>
    <div class="kpi"><div class="kpi-l">${ico('refresh', 14)}봇 방문</div><div class="kpi-v">${num(b.sessions || 0)}</div><div class="kpi-s">${num(b.visitors || 0)}개 기기 · 기록 ${num(b.events || 0)}건</div></div>
    <div class="kpi"><div class="kpi-l">${ico('chart', 14)}봇 비율</div><div class="kpi-v">${pct(b.sessions || 0, all)}</div><div class="kpi-s">전체 방문 ${num(all)}회 중</div></div>
  </div>

  ${sec('일별 방문 — 사람 / 봇', `<div id="anStack"></div>
    <div style="display:flex;gap:14px;margin-top:8px;font-size:11.5px;color:var(--sub)">
      <span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--pri);margin-right:5px"></i>사람</span>
      <span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#F2B544;margin-right:5px"></i>봇</span></div>`)}

  <div class="grid2 an2">
    ${sec('사람은 어디서 왔나', hk.length
      ? bars(hk, 'sessions', r => $esc(kindLabel(r)), r => `${num(r.sessions)} · 구매 ${pct(r.buy_sessions, r.sessions)}`)
      : '<div class="empty" style="padding:28px">아직 기록이 없어요</div>')}
    ${sec('봇 종류', table([
      { h: '봇', f: r => `<div class="t-main">${$esc(botName(r.bot))}</div><div style="font-size:10.5px;color:var(--muted)">${$esc(r.bot || '')}</div>` },
      { h: '방문', r: 1, f: r => num(r.sessions) }, { h: '기록', r: 1, f: r => num(r.events) },
      { h: '마지막', r: 1, f: r => `<span style="white-space:nowrap">${new Date(r.last).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>` }],
      t.bots || [], '이 기간에 들어온 봇이 없어요'))}
  </div>

  ${sec('들어온 곳 자세히', table([
    { h: '구분', f: r => r.who === 'bot' ? '<span class="tag warn">봇</span>' : '<span class="tag good">사람</span>' },
    { h: '종류', f: r => $esc(r.kind === 'search' ? '검색 · ' + engineOf(r.source) : kindName(r.kind)) }, { h: '출처', f: r => `<span class="t-main">${$esc(r.source)}</span>` },
    { h: '방문', r: 1, f: r => num(r.sessions) }, { h: '사람/기기', r: 1, f: r => num(r.visitors) },
    { h: '구매 전환', r: 1, f: r => pct(r.buy_sessions, r.sessions) }], t.sources || []))}

  <div class="grid2 an2">
    ${sec('캠페인 (utm)' + hint('— 사람만'), table([
      { h: 'source / medium', f: r => `${$esc(r.source)}${r.medium ? ' / ' + $esc(r.medium) : ''}` }, { h: '캠페인', f: r => $esc(r.campaign) },
      { h: '방문', r: 1, f: r => num(r.sessions) }, { h: '구매 전환', r: 1, f: r => pct(r.buy_sessions, r.sessions) }], d.campaigns || [],
      '링크에 ?utm_source=…&utm_campaign=… 를 붙이면 여기 나와요'))}
    ${sec('처음 들어온 화면' + hint('— 사람만'), table([
      { h: '화면', f: r => $esc(r.landing) }, { h: '방문', r: 1, f: r => num(r.sessions) }], d.landings || []))}
  </div>

  <div style="font-size:11.5px;color:var(--muted);line-height:1.7;margin:4px 2px 0">
    봇은 브라우저가 스스로 밝히는 값(검색 로봇 이름, 자동화 표시)으로 가려요. curl·API 처럼 화면을 실행하지 않는 수집은
    이 기록에 아예 남지 않아요 — GitHub Pages 는 서버 접속 기록을 주지 않거든요.</div>`;
}

/* 새 DB 함수가 없을 때 — 예전 유입 표만 */
function viewTrafficOld(d) {
  return sec('유입 경로' + hint('— 사람·봇 섞임'), table([
    { h: '경로', f: r => $esc(r.source) }, { h: '방문', r: 1, f: r => num(r.sessions) },
    { h: '신규', r: 1, f: r => num(r.new_visitors) }, { h: '구매 전환', r: 1, f: r => pct(r.buy_sessions, r.sessions) }], d.sources || []));
}

/* 사람/봇 쌓은 막대 */
function wireStack(t) {
  const host = document.getElementById('anStack');
  if (!host) return;
  const { from, to } = rangeDates();
  const by = Object.fromEntries((t.daily || []).map(x => [x.d, x]));
  const days = [];
  for (let d = new Date(from + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= to && days.length <= 120; d = new Date(d.getTime() + 86400e3)) {
    const k = d.toISOString().slice(0, 10); days.push(by[k] || { d: k, human: 0, bot: 0 });
  }
  const W = Math.max(320, host.clientWidth || 600), H = 150, padL = 34, padB = 22, padT = 8;
  const top = Math.max(1, ...days.map(x => x.human + x.bot));
  const bw = (W - padL) / days.length, y = v => padT + (H - padT - padB) * (1 - v / top);
  const every = Math.ceil(days.length / 8);
  host.innerHTML = `<svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block" role="img" aria-label="일별 사람·봇 방문">
    ${[0, top].map(v => `<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${padL - 6}" y="${y(v) + 3}" text-anchor="end" font-size="10" fill="var(--muted)">${num(v)}</text>`).join('')}
    ${days.map((x, i) => {
      const bx = padL + i * bw + Math.min(2, bw * .15), w = Math.max(1, bw - Math.min(4, bw * .3));
      return `<g><title>${x.d} · 사람 ${x.human} · 봇 ${x.bot}</title>
        <rect x="${bx}" y="${y(x.human)}" width="${w}" height="${y(0) - y(x.human)}" fill="var(--pri)"/>
        <rect x="${bx}" y="${y(x.human + x.bot)}" width="${w}" height="${y(x.human) - y(x.human + x.bot)}" fill="#F2B544"/>
        ${i % every === 0 ? `<text x="${padL + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${x.d.slice(5).replace('-', '/')}</text>` : ''}</g>`;
    }).join('')}</svg>`;
}

/* ── 세션별 — 한 번 방문에 무엇을 했나 ── */
const PAGE = 50;
async function moreSessions(from, to) {
  const r = await sessions(from, to, st.who, PAGE, st.sess.length);
  st.sess = st.sess.concat(r.rows || []); st.sessTotal = r.total || 0;
}
const dur = (a, b) => { const s = Math.round((new Date(b) - new Date(a)) / 1000); return s < 60 ? s + '초' : s < 3600 ? Math.floor(s / 60) + '분 ' + (s % 60) + '초' : Math.floor(s / 3600) + '시간 ' + Math.floor(s % 3600 / 60) + '분'; };
const hhmm = d => new Date(d).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function viewSessions() {
  const rows = st.sess;
  if (!rows.length) return sec('세션' + whoNote(), '<div class="empty" style="padding:28px">이 기간에 방문이 없어요</div>');
  return sec(`세션 ${num(st.sessTotal)}개` + whoNote(), `<div style="font-size:11.5px;color:var(--muted);margin:-6px 0 10px">한 줄이 한 번의 방문이에요 (30분 쉬면 새 방문). 누르면 그 방문에서 한 일을 순서대로 보여줘요.</div>
    <div style="overflow-x:auto"><table id="anSess"><thead><tr>
      <th>시작</th><th>구분</th><th>들어온 곳</th><th>기기</th><th style="text-align:right">머문 시간</th>
      <th style="text-align:right">화면</th><th style="text-align:right">사료</th><th style="text-align:right">검색</th><th>결과</th></tr></thead>
    <tbody>${rows.map(r => `<tr data-sid="${$esc(r.session_id)}" style="cursor:pointer${st.open === r.session_id ? ';background:var(--panel2)' : ''}">
      <td style="white-space:nowrap">${hhmm(r.started)}<div style="font-size:10.5px;color:var(--muted)">${r.is_new ? '첫 방문' : '재방문'} · <span style="font-family:ui-monospace,monospace">${$esc(String(r.device_id).slice(0, 6))}</span></div></td>
      <td>${whoTag(r.who, r.bot)}</td>
      <td><div class="t-main">${$esc(r.kind === 'search' ? '검색 · ' + engineOf(r.source) : kindName(r.kind))}</div><div style="font-size:10.5px;color:var(--muted)">${$esc(r.source || '')}</div></td>
      <td style="white-space:nowrap">${$esc([r.device, r.os, r.browser].filter(Boolean).join(' · '))}</td>
      <td style="text-align:right;white-space:nowrap">${dur(r.started, r.ended)}</td>
      <td style="text-align:right">${num(r.screens)}</td><td style="text-align:right">${num(r.foods)}</td><td style="text-align:right">${num(r.searches)}</td>
      <td>${[r.buys ? `<span class="tag good">구매 클릭 ${r.buys}</span>` : '', r.profile ? '<span class="tag info">맞춤 완료</span>' : '', r.error ? '<span class="tag bad">오류</span>' : ''].join(' ') || '<span style="color:var(--muted)">—</span>'}</td>
    </tr>${st.open === r.session_id ? `<tr><td colspan="9" style="background:var(--panel2);padding:14px 16px" id="anTl">불러오는 중…</td></tr>` : ''}`).join('')}</tbody></table></div>
    ${st.sess.length < st.sessTotal ? `<div style="text-align:center;margin-top:12px"><button class="btn sm" id="anMore">${num(st.sessTotal - st.sess.length)}개 더 보기</button></div>` : ''}`);
}

function wireSessions() {
  const t = document.getElementById('anSess');
  if (t) t.onclick = e => {
    const tr = e.target.closest('tr[data-sid]');
    if (!tr) return;
    st.open = st.open === tr.dataset.sid ? null : tr.dataset.sid;
    el('anBody').innerHTML = viewSessions(); wireSessions();
  };
  const m = document.getElementById('anMore');
  if (m) m.onclick = async () => {
    m.disabled = true; m.textContent = '불러오는 중…';
    const { from, to } = rangeDates();
    try { await moreSessions(from, to); } catch (e) { global.toast(e.message); }
    el('anBody').innerHTML = viewSessions(); wireSessions();
  };
  const tl = document.getElementById('anTl');
  if (tl && st.open) sessionEvents(st.open).then(ev => {
    if (!ev.length) { tl.textContent = '기록이 없어요'; return; }
    const t0 = new Date(ev[0].ts).getTime();
    tl.innerHTML = `<div style="display:grid;grid-template-columns:64px 120px 1fr;gap:6px 12px;font-size:12px;line-height:1.5">
      ${ev.map(r => `<span style="color:var(--muted);font-variant-numeric:tabular-nums">+${dur(t0, r.ts)}</span>
        <b style="font-weight:700">${$esc(EVENT_KO[r.name] || r.name)}</b>
        <span style="color:var(--sub)">${$esc(describe(r))}</span>`).join('')}</div>`;
  }).catch(e => { tl.textContent = e.message; });
}

/* ── 사료·검색 ── */
function viewFoods(d) {
  return `
  ${sec('많이 본 사료' + whoNote(), table([
    { h: '사료', f: r => `<div class="t-main">${$esc(foodName(r.id))}</div>` },
    { h: '조회', r: 1, f: r => num(r.views) }, { h: '사람', r: 1, f: r => num(r.visitors) },
    { h: '구매 클릭', r: 1, f: r => `${num(r.buy_clicks)} <span style="color:var(--muted)">${pct(r.buy_clicks, r.views)}</span>` },
    { h: '비교', r: 1, f: r => num(r.compare_adds) }, { h: '찜', r: 1, f: r => num(r.saves) }, { h: '공유', r: 1, f: r => num(r.shares) }], (d.foods || []).slice(0, 30)))}
  <div class="grid2 an2">
    ${sec('검색어 TOP', table([
      { h: '검색어', f: r => $esc(r.q) }, { h: '횟수', r: 1, f: r => num(r.n) }, { h: '사람', r: 1, f: r => num(r.visitors) },
      { h: '결과', r: 1, f: r => r.max_results === 0 ? '<span class="tag bad">0건</span>' : num(r.max_results) }], d.searches || []))}
    ${sec('결과 0건 검색' + hint('— 사료·동의어 추가 후보'), table([
      { h: '검색어', f: r => $esc(r.q) }, { h: '횟수', r: 1, f: r => num(r.n) }, { h: '사람', r: 1, f: r => num(r.visitors) }], d.zero || [], '결과 없는 검색이 없어요'))}
  </div>
  <div class="grid2 an2">
    ${sec('맞춤 추천 고민', (d.concerns || []).length
      ? bars(d.concerns, 'n', r => $esc(concernLabel(r.concern)), r => num(r.n))
      : '<div class="empty" style="padding:28px">아직 기록이 없어요</div>')}
    ${sec('분석 요청', table([
      { h: '종류', f: r => $esc(r.type === 'analysis' ? '분석 요청' : r.type) }, { h: '대상', f: r => $esc(foodName(r.target)) },
      { h: '횟수', r: 1, f: r => num(r.n) }], d.requests || [], '아직 요청이 없어요'))}
  </div>`;
}

/* ── 행동·오류 ── */
function viewActs(d, ev) {
  return `
  <div class="grid2 an2">
    ${sec('화면별' + whoNote(), table([
      { h: '화면', f: r => screenName(r.screen) }, { h: '조회', r: 1, f: r => num(r.views) },
      { h: '사람', r: 1, f: r => num(r.visitors) }, { h: '머문 시간(중간값)', r: 1, f: r => r.median_sec == null ? '—' : r.median_sec + '초' }],
      (d.screens || []).filter(r => r.screen)))}
    ${sec('모든 행동', table([
      { h: '이벤트', f: r => `${$esc(EVENT_KO[r.name] || r.name)} <span style="color:var(--muted);font-size:10.5px">${$esc(r.name)}</span>` },
      { h: '횟수', r: 1, f: r => num(r.n) }, { h: '사람', r: 1, f: r => num(r.visitors) }], d.actions || []))}
  </div>
  ${sec('오류', table([
    { h: '메시지', f: r => $esc(r.msg) }, { h: '위치', f: r => `${$esc(r.src)}:${$esc(r.line)}` },
    { h: '횟수', r: 1, f: r => num(r.n) }, { h: '마지막', f: r => new Date(r.last).toLocaleString('ko-KR') }], d.errors || [], '기록된 오류가 없어요'))}
  ${sec('실시간 기록' + hint('— 최근 80건 · 사람·봇 모두'), table([
    { h: '시각', f: r => `<span style="white-space:nowrap">${new Date(r.ts).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>` },
    { h: '기기', f: r => `<span style="font-family:ui-monospace,monospace;color:var(--sub)">${$esc(String(r.device_id).slice(0, 6))}</span>` },
    { h: '행동', f: r => $esc(EVENT_KO[r.name] || r.name) + (r.props?.agent && r.props.agent !== 'human' ? ' <span class="tag warn">봇</span>' : '') },
    { h: '내용', f: r => `<span style="color:var(--sub)">${$esc(describe(r))}</span>` }], ev || []))}`;
}

/* ── 검색엔진 나누기 ──
   '검색' 하나로 묶으면 네이버로 오는지 구글로 오는지가 안 보인다. 출처 도메인으로 엔진을 가른다.
   (검색어는 엔진이 넘겨주지 않는다 — 구글 검색어는 '검색어' 탭에서 서치 콘솔로 본다.) */
const ENGINES = [['네이버', /(^|\.)naver\.com$|^naver$/], ['구글', /(^|\.)google\.[a-z.]+$|^google$/], ['다음', /(^|\.)daum\.net$|^daum$/],
  ['빙', /(^|\.)bing\.com$|^bing$/], ['줌', /(^|\.)zum\.com$|^zum$/], ['야후', /(^|\.)yahoo\.[a-z.]+$/], ['덕덕고', /duckduckgo\.com$/], ['바이두', /baidu\.com$/]];
const engineOf = src => (ENGINES.find(([, re]) => re.test(String(src || '').toLowerCase())) || [src || '기타'])[0];
/* kinds(종류별 합계) 에서 검색 한 줄을 엔진별 줄로 바꾼다. sources 에 종류·출처가 같이 있어야 한다. */
function splitSearch(kinds, sources) {
  const srch = (sources || []).filter(x => x.kind === 'search');
  if (!srch.length) return kinds;
  const by = {};
  for (const x of srch) {
    const e = engineOf(x.source);
    const o = by[e] || (by[e] = { kind: 'search', engine: e, sessions: 0, buy_sessions: 0 });
    o.sessions += x.sessions || 0; o.buy_sessions += x.buy_sessions || 0;
  }
  /* 출처 표는 상위 몇십 개만 온다. 거기 안 든 검색 방문은 '기타' 로 남겨 합이 맞게 한다. */
  const k = kinds.find(x => x.kind === 'search');
  const got = Object.values(by).reduce((n, x) => n + x.sessions, 0);
  if (k && k.sessions > got) by['기타'] = { kind: 'search', engine: '기타', sessions: k.sessions - got, buy_sessions: Math.max(0, (k.buy_sessions || 0) - Object.values(by).reduce((n, x) => n + x.buy_sessions, 0)) };
  return kinds.filter(k => k.kind !== 'search').concat(Object.values(by)).sort((a, b) => b.sessions - a.sessions);
}
const kindLabel = r => r.engine ? `검색 · ${r.engine}` : kindName(r.kind);

/* ── 구글 서치 콘솔 — 어떤 검색어로 들어왔나 ──
   브라우저에서 바로 구글에 로그인해 읽기 전용 권한(webmasters.readonly)을 받는다.
   서버가 없어서 비밀 키를 둘 곳이 없다 — OAuth 클라이언트 ID 는 원래 공개되는 값이고,
   받은 접근 토큰은 이 탭(sessionStorage)에만 1시간 둔다. 네이버는 이런 API 가 없다. */
const GSC_CID = 'balsatang.gsc.cid', GSC_SITE = 'balsatang.gsc.site', GSC_TOK = 'balsatang.gsc.tok';
/* 대표님이 만든 OAuth 클라이언트 ID — 공개 값이라 여기 둔다. 기기마다 붙여 넣지 않게. 연결 설정에서 바꿀 수 있다. */
const GSC_DEFAULT_CID = '774539790108-4ekpj7n16vt7iv8uo17jckonbc0eomeu.apps.googleusercontent.com';
const gscCid = () => ls.get(GSC_CID) || GSC_DEFAULT_CID;
function gscTok() {
  try { const t = JSON.parse(sessionStorage.getItem(GSC_TOK) || 'null'); return t && Date.now() < t.exp - 60000 ? t.v : null; } catch { return null; }
}
function gisLoad() {
  return new Promise((res, rej) => {
    if (global.google?.accounts?.oauth2) return res();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new Error('구글 로그인 스크립트를 불러오지 못했어요'));
    document.head.appendChild(s);
  });
}
async function gscLogin() {
  await gisLoad();
  return new Promise((res, rej) => {
    const c = global.google.accounts.oauth2.initTokenClient({
      client_id: gscCid(), scope: 'https://www.googleapis.com/auth/webmasters.readonly',
      callback: r => {
        if (r.error) return rej(new Error(r.error_description || r.error));
        try { sessionStorage.setItem(GSC_TOK, JSON.stringify({ v: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 })); } catch { }
        res(r.access_token);
      },
      error_callback: e => rej(new Error(e.type === 'popup_closed' ? '로그인 창을 닫았어요' : e.type === 'popup_failed_to_open' ? '팝업이 막혔어요 — 주소창 오른쪽에서 팝업을 허용해 주세요' : (e.message || e.type)))
    });
    c.requestAccessToken();
  });
}
async function gapi(path, body) {
  const t = gscTok();
  if (!t) throw Object.assign(new Error('구글 로그인이 필요해요'), { gauth: true });
  const r = await fetch('https://www.googleapis.com/webmasters/v3' + path, {
    method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { try { sessionStorage.removeItem(GSC_TOK); } catch { } throw Object.assign(new Error('구글 로그인이 만료됐어요'), { gauth: true }); }
  if (!r.ok) throw new Error(j.error?.message || `구글 응답 ${r.status}`);
  return j;
}
async function gscSite() {
  const list = (await gapi('/sites')).siteEntry || [];
  const ok = list.filter(s => s.permissionLevel !== 'siteUnverifiedUser');
  const saved = ls.get(GSC_SITE);
  const pick = ok.find(s => s.siteUrl === saved) || ok.find(s => s.siteUrl === 'sc-domain:balsatang.com')
    || ok.find(s => /balsatang\.com/.test(s.siteUrl) && !/admin\./.test(s.siteUrl)) || ok[0];
  return { list: ok, site: pick?.siteUrl || null };
}
const gq = (site, from, to, dims, n = 100) => gapi(`/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
  { startDate: from, endDate: to, dimensions: dims, rowLimit: n, dataState: 'all' });

function gscSetup(msg) {
  global.showModal(`<div class="modal" style="max-width:600px">
    <div class="modal-h"><b>구글 서치 콘솔 연결</b>
      <p>처음 한 번만 하면 돼요. 구글 클라우드에서 <b>OAuth 클라이언트 ID</b> 를 만들어 아래에 붙여 넣으세요.
      클라이언트 ID 는 공개돼도 되는 값이에요(비밀번호가 아니에요).</p></div>
    <ol style="margin:0 0 12px 18px;font-size:12.5px;line-height:1.8;color:var(--ink2)">
      <li><a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">console.cloud.google.com</a> 에서 새 프로젝트 만들기 (이름: balsatang-admin)</li>
      <li><a href="https://console.cloud.google.com/apis/library/searchconsole.googleapis.com" target="_blank" rel="noopener">Google Search Console API</a> → <b>사용</b></li>
      <li><a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noopener">OAuth 동의 화면</a> → 앱 이름 '발사탕 어드민', 대상 <b>외부</b>, <b>테스트 사용자</b>에 서치 콘솔을 쓰는 내 구글 계정 추가</li>
      <li><a href="https://console.cloud.google.com/auth/clients/create" target="_blank" rel="noopener">클라이언트 만들기</a> → 유형 <b>웹 애플리케이션</b> → 승인된 JavaScript 원본에 <code>https://admin.balsatang.com</code></li>
      <li>만들어진 <b>클라이언트 ID</b>(…apps.googleusercontent.com) 복사해서 아래에</li>
    </ol>
    <label>클라이언트 ID<input id="gCid" value="${$esc(gscCid())}" placeholder="1234-abcd.apps.googleusercontent.com" autocapitalize="off" spellcheck="false"></label>
    <div id="gMsg" style="min-height:18px;font-size:12px;color:var(--bad)">${$esc(msg || '')}</div>
    <div class="modal-f"><button class="btn" onclick="closeModal()">닫기</button>
      <button class="btn pri" id="gGo">저장하고 로그인</button></div>
  </div>`);
  el('gGo').onclick = async () => {
    const v = el('gCid').value.trim();
    if (!/\.apps\.googleusercontent\.com$/.test(v)) { el('gMsg').textContent = '…apps.googleusercontent.com 으로 끝나는 값이에요'; return; }
    ls.set(GSC_CID, v);
    try { await gscLogin(); global.closeModal(); page(); } catch (e) { el('gMsg').textContent = e.message; }
  };
}

async function viewGsc(body) {
  const naver = sec('네이버 검색어', `<div style="font-size:12.5px;line-height:1.7;color:var(--ink2)">네이버는 검색어를 가져오는 방법(API)을 주지 않아요.
    <a href="https://searchadvisor.naver.com/console/board" target="_blank" rel="noopener" style="color:var(--pri-ink);font-weight:700">서치어드바이저 ↗</a> → 리포트 → <b>검색 유입</b> 에서 봐 주세요.</div>`);
  if (!gscCid()) {
    body.innerHTML = sec('구글 검색어', `<div class="empty" style="padding:28px">${ico('search', 34)}
      <div style="margin-top:12px">구글에서 어떤 검색어로 들어왔는지 보려면 서치 콘솔을 한 번 연결해야 해요</div>
      <button class="btn pri" style="margin-top:14px" onclick="ANALYTICS.gscSetup()">연결하기</button></div>`) + naver;
    return;
  }
  if (!gscTok()) {
    body.innerHTML = sec('구글 검색어', `<div class="empty" style="padding:28px">
      <div>구글 계정으로 로그인하면 검색어를 불러와요 (읽기 전용)</div>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:14px">
        <button class="btn pri" id="gIn">구글 로그인</button><button class="btn ghost" onclick="ANALYTICS.gscSetup()">연결 설정</button></div></div>`) + naver;
    el('gIn').onclick = async () => { try { await gscLogin(); page(); } catch (e) { global.toast(e.message); } };
    return;
  }
  const { from, to } = rangeDates();
  const { list, site } = await gscSite();
  if (!site) {
    body.innerHTML = sec('구글 검색어', '<div class="empty" style="padding:28px">이 구글 계정으로 볼 수 있는 서치 콘솔 사이트가 없어요. 서치 콘솔에 balsatang.com 을 등록한 계정으로 로그인해 주세요.</div>') + naver;
    return;
  }
  const [tot, qs, pages, dev] = await Promise.all([gq(site, from, to, [], 1), gq(site, from, to, ['query'], 200), gq(site, from, to, ['page'], 50), gq(site, from, to, ['device'], 5)]);
  const T = (tot.rows || [])[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const p1 = v => (Math.round(v * 1000) / 10) + '%';
  const pos = v => v ? (Math.round(v * 10) / 10) + '위' : '—';
  const q = qs.rows || [];
  const miss = q.filter(r => r.impressions >= 20 && r.ctr < 0.02).slice(0, 10);
  const devKo = { MOBILE: '휴대폰', DESKTOP: 'PC', TABLET: '태블릿' };
  body.innerHTML = `
  <div style="display:flex;align-items:center;gap:8px;margin:-4px 0 12px;font-size:11.5px;color:var(--muted)">
    <span>구글 서치 콘솔 · ${list.length > 1 ? `<select id="gSite" style="font-size:11.5px">${list.map(s => `<option ${s.siteUrl === site ? 'selected' : ''}>${$esc(s.siteUrl)}</option>`).join('')}</select>` : $esc(site)}</span>
    <span>· 최근 2~3일은 아직 덜 모인 숫자예요</span></div>
  <div class="kpis an-kpis">
    <div class="kpi"><div class="kpi-l">${ico('eye', 14)}노출</div><div class="kpi-v">${num(T.impressions)}</div><div class="kpi-s">구글 검색 결과에 보인 횟수</div></div>
    <div class="kpi"><div class="kpi-l">${ico('smile', 14)}클릭</div><div class="kpi-v">${num(T.clicks)}</div><div class="kpi-s">눌러서 들어온 횟수</div></div>
    <div class="kpi"><div class="kpi-l">${ico('chart', 14)}클릭률</div><div class="kpi-v">${p1(T.ctr)}</div><div class="kpi-s">노출 중 클릭 비율</div></div>
    <div class="kpi"><div class="kpi-l">${ico('trophy', 14)}평균 순위</div><div class="kpi-v">${pos(T.position)}</div><div class="kpi-s">낮을수록 위쪽</div></div>
  </div>
  ${miss.length ? sec('보이는데 안 눌리는 검색어' + hint('— 노출 20회 이상 · 클릭률 2% 미만 → 제목·설명을 다듬을 후보'), table([
    { h: '검색어', f: r => `<b>${$esc(r.keys[0])}</b>` }, { h: '노출', r: 1, f: r => num(r.impressions) },
    { h: '클릭', r: 1, f: r => num(r.clicks) }, { h: '순위', r: 1, f: r => pos(r.position) }], miss)) : ''}
  ${sec(`구글 검색어 ${num(q.length)}개` + hint('— 클릭 순'), table([
    { h: '검색어', f: r => `<span class="t-main">${$esc(r.keys[0])}</span>` }, { h: '클릭', r: 1, f: r => num(r.clicks) },
    { h: '노출', r: 1, f: r => num(r.impressions) }, { h: '클릭률', r: 1, f: r => p1(r.ctr) }, { h: '평균 순위', r: 1, f: r => pos(r.position) }],
    q, '이 기간에 구글 검색 기록이 없어요. 사이트가 새로 등록됐다면 며칠 뒤부터 쌓여요.'))}
  <div class="grid2 an2">
    ${sec('검색으로 들어온 페이지', table([
      { h: '페이지', f: r => { const path = decodeURIComponent(String(r.keys[0]).replace(/^https?:\/\/[^/]+/, '')) || '/';
        const id = (path.match(/^\/food\/([^/]+)/) || [])[1];
        return id ? `<div class="t-main">${$esc(foodName(id))}</div><div style="font-size:10.5px;color:var(--muted)">${$esc(path)}</div>` : $esc(path); } },
      { h: '클릭', r: 1, f: r => num(r.clicks) }, { h: '노출', r: 1, f: r => num(r.impressions) }], pages.rows || []))}
    ${sec('기기', table([{ h: '기기', f: r => devKo[r.keys[0]] || r.keys[0] }, { h: '클릭', r: 1, f: r => num(r.clicks) },
      { h: '노출', r: 1, f: r => num(r.impressions) }], dev.rows || []))}
  </div>
  ${naver}
  <div style="text-align:right;margin-top:-4px"><button class="btn sm ghost" onclick="ANALYTICS.gscSetup()">연결 설정</button></div>`;
  const sel = document.getElementById('gSite');
  if (sel) sel.onchange = () => { ls.set(GSC_SITE, sel.value); page(); };
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

global.ANALYTICS = { page, openLogin, logout, last: () => last,
  tab(t) { st.tab = t; st.open = null; saveUi(); page(); }, gscSetup: m => gscSetup(m) };
})(window);
