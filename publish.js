/* 심사 화면에서 곧바로 발행한다.

   지금까지는 승인을 눌러도 '/publish …' 라는 명령문만 복사됐고, 그걸 누군가
   터미널에서 실행해 줘야 사이트에 올라갔다. 사람이 하나 더 필요한 자리였다.
   이 파일이 그 자리를 없앤다 — 승인을 누르면 브라우저가 직접 병합해 커밋한다.

   ── 무엇을 건드리나 ──
   · balsatang/data.js               발행된 사료를 FOODS_ALL·DETAIL 에 더한다
   · data/staging/<배치>.json        처리한 항목을 뺀다. 다 비면 파일을 지운다
   · data/rejected/YYYY-MM-DD.json   반려한 건을 기록으로 남긴다
   · data/staging/review.json        심사 목록에서 처리한 항목을 뺀다
   · data/staging/_review.json       같은 내용(로컬 스크립트용 원본)

   네 파일이 한꺼번에 바뀌므로 한 커밋으로 올린다. 하나씩 올리면 중간에
   실패했을 때 반쪽만 반영된 상태가 남는다.

   ── 지키는 것 ──
   · 게이트를 통과하지 않은 건은 승인해도 발행하지 않는다. 명령보다 게이트가 앞선다.
   · 점수는 제출값을 쓰지 않고 항상 루브릭으로 다시 계산한다.
   · 사람이 고친 값(edits)은 발행 전에 반영하고, 무엇을 고쳤는지 커밋에 남긴다.
   · 우리가 읽은 시점 이후 저장소가 바뀌었으면 밀어붙이지 않고 막힌다.
*/
'use strict';

const PUB = {
  DATA: 'data.js',
  STAGING: 'data/staging',

  /* ── 대표 책임 승인 ──
     게이트가 막은 항목도 대표가 이유를 하나씩 확인하고 승인하면 발행한다.
     예: 원재료(한국)와 보장성분(해외)이 다른 출처라 막혔지만, 대표가 국내 판매 봉투를
     직접 보고 값이 맞다고 판단한 경우. 승인 기록(무엇을 넘겼는지·왜)은 발행 데이터의
     src.override 에 남는다.

     ⚠ 아래는 승인으로도 못 넘긴다. 값 자체가 비어 있거나 형식이 깨져 화면이 그릴 수
     없는 것들이다 — 넘기면 별점이 비고 화면이 깨진다. 고치기 칸에서 값을 채워야 풀린다. */
  HARD: new Set(['E_ITEM_FIELD', 'E_FIELD', 'E_TYPE', 'E_ENUM', 'E_INGR_NONE', 'E_INGR',
    'E_FACTS_NONE', 'E_FACTS', 'E_RATING', 'E_RATING_RUBRIC', 'E_SCORE',
    'E_DUP', 'E_DUP_BATCH', 'E_DRAFT', 'E_GATE']),

  /* 승인으로 넘긴 탈락을 뺀 나머지. 메시지 단위로 맞춘다 — 승인한 뒤 값을 또 고쳐
     메시지가 바뀌면(숫자가 달라지면) 다시 확인해야 한다. */
  afterOverride(fail, ov) {
    if (!ov || !Array.isArray(ov.msgs) || !String(ov.reason || '').trim()) return fail;
    const ok = new Set(ov.msgs);
    return fail.filter(f => this.HARD.has(f.code) || !ok.has(f.msg));
  },

  /* 스테이징 디렉터리의 배치 파일 목록. _ 로 시작하는 것과 review.json 은 배치가 아니다. */
  async batchFiles() {
    const r = await GH.api(`/repos/${GH.owner}/${GH.repo}/contents/${this.STAGING}?ref=${GH.branch}`);
    return r.filter(x => x.type === 'file' && x.name.endsWith('.json')
      && !x.name.startsWith('_') && x.name !== 'review.json').map(x => x.name);
  },

  /* data.js 는 선언 하나가 한 줄이다. 그 줄만 갈아끼운다. */
  spliceDecl(lines, name, mutate) {
    const head = `const ${name}=`;
    const i = lines.findIndex(l => l.startsWith(head));
    if (i < 0) throw new Error(`data.js 에서 ${name} 선언을 찾지 못했습니다`);
    const value = JSON.parse(lines[i].slice(head.length).replace(/;\s*$/, ''));
    lines[i] = head + JSON.stringify(mutate(value)) + ';';
  },

  /* 사람이 고친 값을 발행 직전에 반영한다.
     별점과 총점은 여기서 다시 계산한다 — 사람이 점수를 직접 쓰는 경로는 없다. */
  applyEdits(item, edit) {
    if (!edit) return item;
    const p = JSON.parse(JSON.stringify(item.proposed));
    let sources = item.sources || [], evidence = { ...(item.evidence || {}) };

    /* ── 라벨 판독 ──
       심사자가 라벨을 붙여넣어 원료와 보장성분이 들어왔으면, 막고 있던 이유가
       사라졌으므로 '자료 수집 중'(draft)을 푼다. 라벨은 그 자체가 A등급 출처다
       (DATA-POLICY 3.1) — 사료관리법이 표기를 강제하는 1차 자료다.
       근거 문장도 같이 남긴다. 없으면 게이트가 '근거 누락' 으로 막는다. */
    const L = edit.label;
    if (L) {
      /* 라벨이 못 읽은 칸(null)은 원래 값을 지우지 않는다. 수분 한 줄만 붙여넣어도
         나머지 보장성분이 통째로 비던 것을 막는다. */
      const gaIn = Object.fromEntries(Object.entries(L.ga || {}).filter(([, v]) => v != null));
      if (L.ingredients?.length) p.ingredients = L.ingredients;
      p.ga = { ...(p.ga || {}), ...gaIn };
      if (L.kcalPerKg != null) p.kcalPerKg = L.kcalPerKg;
      if (L.thumb) p.thumb = L.thumb;
      delete p.draft;

      const i = sources.length;
      sources = [...sources, {
        role: 'label', url: L.srcUrl || sources[0]?.url || '',
        fetchedAt: L.at, title: '제품 라벨 판독 (심사 화면에서 사람이 입력)'
      }];
      evidence = { ...evidence };
      const q = (k, text) => { evidence[k] = { src: i, quote: text }; };
      /* 라벨에서 읽은 원료·보장성분·열량에도 근거를 단다. 안 달면 게이트가
         '근거 누락: ga.moisture' 처럼 막는다 — 라벨로 새로 채운 칸은 원래 근거가 없다. */
      const GA_KO = { protein: '조단백', fat: '조지방', fiber: '조섬유', moisture: '수분', ash: '조회분' };
      for (const [k, v] of Object.entries(gaIn)) q(`ga.${k}`, `라벨 보장성분 — ${GA_KO[k] || k} ${v}%`);
      if (L.ingredients?.length) q('ingredients', `라벨 원재료: ${L.ingredients.slice(0, 8).join(', ')}${L.ingredients.length > 8 ? ' …' : ''}`);
      if (L.kcalPerKg != null) q('kcal', `라벨 열량 — ${L.kcalPerKg} kcal/kg`);
      q('facts.protein', `라벨 보장성분 — 조단백 ${L.ga.protein}%`);
      q('facts.firstIngrCat', `원료 표기 1번: ${L.ingredients[0] ?? '—'}`);
      q('facts.cautionN', `원료 ${L.ingredients.length}종 중 주의 ${L.dist?.caution ?? '?'}종`);
      q('facts.dangerN', `위험 ${L.dist?.danger ?? 0}종`);
    }

    /* 제품명·열량·썸네일 — 심사자가 직접 넣은 값. 라벨 판독보다 뒤에 둔다.
       사람이 고쳐 놓은 걸 라벨이 도로 덮으면 고칠 방법이 없어진다. */
    /* meta 는 proposed 바로 아래 값들이다 — 제품명·열량·썸네일.
       열량은 숫자다. 문자열로 넣으면 급여량 계산이 조용히 어긋난다. */
    for (const [k, v] of Object.entries(edit.meta || {})) {
      if (v == null || String(v).trim() === '') continue;
      p[k] = k === 'kcalPerKg' ? Number(v) : String(v).trim();
    }

    Object.assign(p.facts ??= {}, edit.facts || {});
    /* 화면의 '주의성분 N종' 은 warnN 이다. 라벨로 원료가 바뀌면 주의·위험 수도 바뀌는데
       warnN 을 그대로 두면 게이트가 'warnN 이 사실값과 다릅니다' 로 막는다.
       사람이 쓰는 칸이 아니라 facts 에서 나오는 값이라 여기서 다시 맞춘다. */
    if (p.facts.cautionN != null) p.warnN = p.facts.cautionN + (p.facts.dangerN ?? 0);
    if (L) evidence['facts.dmCarb'] = { src: sources.length - 1,
      quote: `조단백 ${L.ga.protein} / 조지방 ${L.ga.fat} / 조섬유 ${L.ga.fiber} / 수분 ${L.ga.moisture} → 건물기준 탄수 ${p.facts.dmCarb}%` };

    /* 가격이 들어왔으면 보류를 푼다. 가격이 없으면 pricePending 을 유지해야 한다 —
       게이트가 'pricePending 인데 price 가 있다' 로 탈락시킨다. */
    const priceIn = { ...(edit.price || {}) };
    const buyUrl = priceIn.buyUrl;
    const srcUrl = priceIn.srcUrl;
    delete priceIn.buyUrl; delete priceIn.srcUrl;
    if (p.pricePending && priceIn.p > 0 && priceIn.wg > 0) delete p.pricePending;
    if (!p.pricePending) {
      Object.assign(p.price ??= {}, priceIn);
      if (buyUrl) p.price.buyUrl = buyUrl;
      p.price.shop ??= 'coupang';
      if (p.price.p > 0 && p.price.wg > 0) p.price.pKg = Math.round(p.price.p / p.price.wg * 1000);
      /* 가격 근거는 쿠팡 상품 페이지여야 한다(DATA-POLICY 3.2). 심사자가 넣은
         주소를 retail 출처로 더하고, 그 값이 어디서 왔는지 문장으로 남긴다. */
      const url = srcUrl || sources.find(s => s.role === 'retail')?.url;
      if (url && !sources.some(s => s.role === 'retail' && s.url === url)) {
        sources = [...sources, { role: 'retail', url, fetchedAt: new Date().toISOString(),
                                 title: '쿠팡 상품 페이지 (가격 근거)' }];
      }
      const ri = sources.findIndex(s => s.role === 'retail' && s.url === url);
      if (ri >= 0) evidence['price.p'] = { src: ri,
        quote: `쿠팡 ${p.price.wg}g ${Number(p.price.p).toLocaleString('ko-KR')}원 (심사 화면에서 사람이 확인)` };
    }

    const pending = p.pricePending === true;
    p.ratings = {
      ...p.ratings,
      ...ENGINE.rateAll({
        dmCarb: p.facts.dmCarb, protein: p.facts.protein,
        firstIngrCat: p.facts.firstIngrCat,
        cautionN: p.facts.cautionN, dangerN: p.facts.dangerN,
        pKg: pending ? null : (p.price?.pKg ?? null)
      })
    };
    if (pending) { p.ratings.value = null; p.score = null; }
    else if (['quality', 'carb', 'additive', 'value'].every(k => p.ratings[k] != null)) {
      p.score = ENGINE.computeScore(p.ratings);
    }

    const audit = { ...(item.audit || {}) };
    /* 값이 바뀌었으니 심사 AI 의 대조 결과는 더 이상 이 값에 대한 것이 아니다. */
    if (L || Object.keys(edit.facts || {}).length) audit.verdict = null;
    return { ...item, proposed: p, sources, evidence, audit,
             humanEdit: { ...edit, at: new Date().toISOString() } };
  },

  /* 실제 발행. decision = { stagingId: 'publish' | 'reject' }, edits = { stagingId: {...} } */
  async run({ decision, edits, review, onStep }) {
    const step = s => onStep?.(s);
    const approve = new Set(Object.entries(decision).filter(([, v]) => v === 'publish').map(([k]) => k));
    const rejectIds = new Set(Object.entries(decision).filter(([, v]) => v === 'reject').map(([k]) => k));
    if (!approve.size && !rejectIds.size) throw new Error('발행하거나 반려할 항목이 없습니다');

    step('저장소 상태 확인');
    const baseSha = await GH.headSha();

    step('data.js 읽는 중');
    const data = await GH.getFile(this.DATA);
    const lines = data.text.split('\n');
    const publishedFoods = JSON.parse(
      lines.find(l => l.startsWith('const FOODS_ALL=')).slice('const FOODS_ALL='.length).replace(/;\s*$/, ''));

    const files = [];
    const published = [], rejected = [], details = {};
    const now = new Date().toISOString();

    /* 이미 쓰이고 있는 id 를 피한다 */
    const usedIds = new Set(publishedFoods.map(f => f.id));
    const newId = () => {
      let u;
      do { u = crypto.randomUUID(); } while (usedIds.has(u));
      usedIds.add(u);
      return u;
    };

    /* ── 게이트 ──
       예전에는 build-review 가 미리 계산해 둔 item.ready 만 봤다. 그래서 심사자가
       화면에서 라벨을 다 채워도 '자료 수집 중' 상태의 옛 판정에 막혀 발행이 안 됐다.
       이제 고친 값을 반영한 뒤 게이트를 그 자리에서 다시 돌린다.
       느슨해지는 게 아니다 — engine/gate1.js 의 같은 checkItem 이고, 여기서는
       data.js 까지 읽어 중복 검사까지 한다. 화면 미리보기보다 오히려 엄격하다. */
    const refused = [];
    const seenKeys = new Set();
    const gateOk = (item) => {
      try { return GATE1.checkItem(item, publishedFoods, seenKeys).fail; }
      catch (e) { return [{ code: 'E_GATE', msg: '게이트 검사 실패: ' + e.message }]; }
    };

    step('스테이징 배치 읽는 중');
    for (const name of await this.batchFiles()) {
      const path = `${this.STAGING}/${name}`;
      const file = await GH.getFile(path);
      const batch = JSON.parse(file.text);
      const keep = [];
      let touched = false;

      for (const raw of batch.items ?? []) {
        const id = raw.stagingId;
        if (rejectIds.has(id)) {
          rejected.push({ ...raw, rejectedAt: now, batchFile: name });
          touched = true;
          continue;
        }
        if (!approve.has(id)) { keep.push(raw); continue; }

        const item = this.applyEdits(raw, edits[id]);
        /* 아직 라벨을 못 본 항목은 검사할 단계가 아니다 — 발행도 될 수 없다. */
        const fail = item.proposed.draft === true
          ? [{ code: 'E_DRAFT', msg: '자료 수집 중 — 라벨을 채워야 발행할 수 있습니다' }]
          : this.afterOverride(gateOk(item), edits[id]?.override);
        if (fail.length) {
          refused.push({ stagingId: id, label: `${item.proposed.brand} ${item.proposed.name}`, fail });
          keep.push(raw);
          continue;
        }
        const { food, detail } = ENGINE.publishRecord(item, newId(), now);
        /* 해외 정보 안내문은 대표가 직접 쓴 문구가 있을 때만 싣는다. 비어 있으면
           프론트가 브랜드 이름으로 기본 문구를 만든다. */
        if (item.proposed.specNote) food.specNote = item.proposed.specNote;
        const ov = edits[id]?.override;
        if (ov) food.src.override = { msgs: ov.msgs, reason: ov.reason, at: ov.at };
        published.push(food);
        if (detail) details[food.id] = detail;
        touched = true;
      }

      if (!touched) continue;
      files.push({ path, text: keep.length ? JSON.stringify({ ...batch, items: keep }, null, 2) + '\n' : null });
    }

    if (!published.length && !rejected.length) {
      /* 왜 막혔는지 말해 준다. '게이트 미통과' 만 뜨면 무엇을 고쳐야 할지 알 수 없다. */
      if (refused.length) {
        const why = refused.flatMap(r => r.fail.map(f => `· ${r.label}: ${f.msg}`)).slice(0, 4);
        throw new Error('게이트를 통과하지 못했습니다\n' + why.join('\n'));
      }
      throw new Error('스테이징에서 해당 항목을 찾지 못했습니다');
    }

    /* data.js 병합 */
    if (published.length) {
      step('data.js 병합');
      this.spliceDecl(lines, 'FOODS_ALL', arr => [...arr, ...published]);
      if (Object.keys(details).length)
        this.spliceDecl(lines, 'DETAIL', obj => ({ ...obj, ...details }));
      files.push({ path: this.DATA, text: lines.join('\n') });

      /* 캐시 깨기 —
         index.html 이 data.js?v=2 를 부르는데 이 번호가 고정이었다. GitHub Pages 는
         모든 파일에 max-age=600 을 건다. 그래서 발행해도 브라우저는 같은 주소의 옛
         data.js 를 계속 썼다. index.html 캐시 10분이 풀린 뒤에도 data.js 주소가
         그대로라 또 10분을 캐시에서 읽는다 — 새로 올린 사료가 20분 넘게 안 보였다.
         발행할 때마다 번호를 올려 주소를 바꾼다. 주소가 다르면 캐시가 안 걸린다. */
      const html = await GH.getFileOrNull('index.html');
      if (html) {
        const stamp = now.replace(/\D/g, '').slice(0, 12);   // 202608031433
        const next = html.text.replace(/\?v=[0-9]+/g, `?v=${stamp}`);
        if (next !== html.text) files.push({ path: 'index.html', text: next });
      }
    }

    /* 반려 기록 — 있으면 이어 쓴다 */
    if (rejected.length) {
      const stamp = now.slice(0, 10);
      const path = `data/rejected/${stamp}.json`;
      const prev = await GH.getFileOrNull(path);
      let list = [];
      if (prev) { try { list = JSON.parse(prev.text); } catch { list = []; } }
      files.push({ path, text: JSON.stringify([...list, ...rejected], null, 2) + '\n' });
    }

    /* 심사 목록에서 처리한 항목을 뺀다. 안 그러면 발행한 게 계속 대기로 보인다. */
    step('심사 목록 갱신');
    /* 게이트에 막힌 건은 스테이징에 그대로 남겼으니 심사 목록에서도 빼면 안 된다.
       빼 버리면 화면에서 사라져 다시 손볼 방법이 없어진다. */
    const done = new Set([...published.map(f => f.src?.stagingId), ...rejectIds]);
    const nextReview = {
      ...review,
      batches: review.batches
        .map(b => ({ ...b, items: b.items.filter(i => !done.has(i.stagingId)) }))
        .filter(b => b.items.length)
    };
    nextReview.summary = {
      total: nextReview.batches.reduce((a, b) => a + b.items.length, 0),
      ready: nextReview.batches.reduce((a, b) => a + b.items.filter(i => i.ready).length, 0),
      blocked: nextReview.batches.reduce((a, b) => a + b.items.filter(i => !i.ready).length, 0),
      pricePending: nextReview.batches.reduce((a, b) => a + b.items.filter(i => i.pricePending).length, 0)
    };
    const reviewText = JSON.stringify(nextReview, null, 2);
    files.push({ path: `${this.STAGING}/review.json`, text: reviewText });
    files.push({ path: `${this.STAGING}/_review.json`, text: reviewText });

    step('커밋 올리는 중');
    const commit = await GH.commitFiles(files, this.message(published, rejected, edits), baseSha);
    return { commit, published, rejected, refused, review: nextReview };
  },

  message(published, rejected, edits) {
    const head = published.length && rejected.length
      ? `발행 ${published.length}종 · 반려 ${rejected.length}건`
      : published.length ? `사료 발행 — ${published.length}종` : `사료 반려 — ${rejected.length}건`;
    const body = [];
    for (const f of published) {
      const e = edits[f.src?.stagingId];
      const changed = e ? Object.keys({ ...(e.facts || {}), ...(e.price || {}) }) : [];
      body.push(`- 발행 ${f.brand} ${f.name} (총점 ${f.score})${changed.length ? ` · 심사에서 고침: ${changed.join(', ')}` : ''}`);
      if (e?.reason) body.push(`    사유: ${e.reason}`);
    }
    for (const r of rejected) body.push(`- 반려 ${r.proposed?.brand} ${r.proposed?.name}`);
    return `${head}\n\n${body.join('\n')}\n\n심사 화면에서 발행했습니다.`;
  }
};
