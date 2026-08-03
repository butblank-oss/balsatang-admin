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
    Object.assign(p.facts ??= {}, edit.facts || {});
    Object.assign(p.price ??= {}, edit.price || {});
    if (p.price.p > 0 && p.price.wg > 0) p.price.pKg = Math.round(p.price.p / p.price.wg * 1000);
    p.ratings = {
      ...p.ratings,
      ...ENGINE.rateAll({
        dmCarb: p.facts.dmCarb, protein: p.facts.protein,
        firstIngrCat: p.facts.firstIngrCat,
        cautionN: p.facts.cautionN, dangerN: p.facts.dangerN,
        pKg: p.price.pKg ?? null
      })
    };
    const audit = { ...(item.audit || {}) };
    /* 값이 바뀌었으니 심사 AI 의 대조 결과는 더 이상 이 값에 대한 것이 아니다. */
    if (Object.keys(edit.facts || {}).length) audit.verdict = null;
    return { ...item, proposed: p, audit, humanEdit: { ...edit, at: new Date().toISOString() } };
  },

  /* 실제 발행. decision = { stagingId: 'publish' | 'reject' }, edits = { stagingId: {...} } */
  async run({ decision, edits, review, onStep }) {
    const step = s => onStep?.(s);
    const approve = new Set(Object.entries(decision).filter(([, v]) => v === 'publish').map(([k]) => k));
    const rejectIds = new Set(Object.entries(decision).filter(([, v]) => v === 'reject').map(([k]) => k));
    if (!approve.size && !rejectIds.size) throw new Error('발행하거나 반려할 항목이 없습니다');

    /* 게이트를 통과한 건만 발행할 수 있다 */
    const readyBy = {};
    for (const b of review.batches) for (const it of b.items) readyBy[it.stagingId] = it.ready;
    const refused = [...approve].filter(id => !readyBy[id]);
    for (const id of refused) approve.delete(id);

    step('저장소 상태 확인');
    const baseSha = await GH.headSha();

    step('data.js 읽는 중');
    const data = await GH.getFile(this.DATA);
    const lines = data.text.split('\n');

    const files = [];
    const published = [], rejected = [], details = {};
    const now = new Date().toISOString();

    /* 이미 쓰이고 있는 id 를 피한다 */
    const usedIds = new Set(JSON.parse(
      lines.find(l => l.startsWith('const FOODS_ALL=')).slice('const FOODS_ALL='.length).replace(/;\s*$/, '')
    ).map(f => f.id));
    const newId = () => {
      let u;
      do { u = crypto.randomUUID(); } while (usedIds.has(u));
      usedIds.add(u);
      return u;
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
        const { food, detail } = ENGINE.publishRecord(item, newId(), now);
        published.push(food);
        if (detail) details[food.id] = detail;
        touched = true;
      }

      if (!touched) continue;
      files.push({ path, text: keep.length ? JSON.stringify({ ...batch, items: keep }, null, 2) + '\n' : null });
    }

    if (!published.length && !rejected.length) {
      throw new Error(refused.length
        ? '게이트를 통과하지 않은 건이라 발행하지 않았습니다'
        : '스테이징에서 해당 항목을 찾지 못했습니다');
    }

    /* data.js 병합 */
    if (published.length) {
      step('data.js 병합');
      this.spliceDecl(lines, 'FOODS_ALL', arr => [...arr, ...published]);
      if (Object.keys(details).length)
        this.spliceDecl(lines, 'DETAIL', obj => ({ ...obj, ...details }));
      files.push({ path: this.DATA, text: lines.join('\n') });
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
    const done = new Set([...approve, ...rejectIds]);
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
