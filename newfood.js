/* 사료 등록 — 사람이 라벨을 보고 직접 올린다.

   ── 왜 바로 발행하지 않나 ──
   여기서 입력한 건 곧장 사이트에 올라가지 않는다. 스테이징에 쌓이고,
   게이트가 검사하고, 심사 화면에서 사람이 한 번 더 보고 발행한다.
   그래야 "출처 없이 생긴 데이터" 가 섞이지 않는다. 발사탕이 광고를 안 받고
   버티는 근거가 그거라서, 등록 경로만 뒷문으로 열어두면 전부 무너진다.

   ── 사람이 넣는 것 / 기계가 채우는 것 ──
   사람: 브랜드·제품명·원산지·제형·연령·체형, 보장성분표, 원료, 가격, 출처 URL
   기계: 별점·총점·기능 태그·고민 태그·건물기준 탄수 — 전부 엔진이 계산한다.
        점수를 사람이 적는 경로는 여기에도 없다.
*/
'use strict';

const NEWFOOD = {
  /* 게이트가 아는 값들. 여기 없는 값을 넣으면 탈락한다. */
  TYPE: { dry: '건식', wet: '습식', freeze_dried: '동결건조', air_dried: '에어드라이', raw: '화식', topping: '토핑' },
  COUNTRY: { KR: '대한민국', CA: '캐나다', US: '미국', FR: '프랑스', NZ: '뉴질랜드', AU: '호주',
    DE: '독일', IT: '이탈리아', NL: '네덜란드', BE: '벨기에', GB: '영국', JP: '일본', TH: '태국' },
  AGE: { puppy: '퍼피', adult: '성견', senior: '시니어', all: '전연령' },
  SIZE: { small: '소형', medium: '중형', large: '대형', all: '전체' },
  SHOP: { coupang: '쿠팡', brand_official: '공식몰', naver: '네이버', other: '기타' },

  f: null,

  open() {
    this.f = {
      brand: '', name: '', brandSlug: '', country: 'KR', type: 'dry', rx: false,
      ages: ['adult'], sizes: ['all'],
      ga: { protein: '', fat: '', fiber: '', moisture: '', ash: '' },
      kcal100: '', meat: '', thumb: '', ingredients: '', priceLines: '',
      price: { p: '', wg: '', shop: 'coupang', wgOptions: '', buyUrl: '' },
      specOrigin: 'domestic',
      srcKind: 'label', srcOfficial: '', srcRetail: ''
    };
    this.render();
  },

  render() {
    const f = this.f;
    const sel = (k, dict, path) => `<select data-nf="${path}">${Object.entries(dict)
      .map(([v, l]) => `<option value="${v}"${this.get(path) === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    const inp = (path, ph = '', num = false) =>
      `<input data-nf="${path}" value="${esc(this.get(path) ?? '')}" placeholder="${esc(ph)}"${num ? ' inputmode="decimal"' : ''}>`;
    const multi = (path, dict) => `<div style="display:flex;gap:6px;flex-wrap:wrap">${Object.entries(dict)
      .map(([v, l]) => `<button class="chip ${(this.get(path) || []).includes(v) ? 'on' : ''}" data-nfm="${path}" data-v="${v}">${l}</button>`).join('')}</div>`;

    showModal(`<div class="modal" style="max-width:900px">
      <div class="modal-h"><b>사료 등록</b>
        <p>여기서 올린 건 <b>바로 발행되지 않아요.</b> 게이트 검사를 거쳐 발행 심사에 올라가고,
           거기서 한 번 더 확인한 뒤에 사이트에 나갑니다.<br>
           별점·총점·기능 태그는 적지 않아요 — 입력한 사실로 엔진이 계산합니다.</p></div>

      <div class="nf-sec">기본</div>
      <div class="nf-g2">
        <label>브랜드 <i>*</i>${inp('brand', '오리젠')}</label>
        <label>제품명 <i>*</i>${inp('name', '오리지널 독')}</label>
        <label>브랜드 슬러그 <i>*</i>${inp('brandSlug', 'orijen — 영문 소문자')}</label>
        <label>원산지 ${sel('country', this.COUNTRY, 'country')}</label>
        <label>제형 ${sel('type', this.TYPE, 'type')}</label>
        <label>처방식 <select data-nf="rx"><option value="">일반</option><option value="1"${f.rx ? ' selected' : ''}>처방식</option></select></label>
      </div>
      <label class="nf-l">연령 <i>*</i>${multi('ages', this.AGE)}</label>
      <label class="nf-l">체형 <i>*</i>${multi('sizes', this.SIZE)}</label>

      <div class="nf-sec">보장성분표 <span>봉지에 적힌 값 그대로</span></div>
      <div class="nf-g5">
        <label>조단백 %<i>*</i>${inp('ga.protein', '', true)}</label>
        <label>조지방 %<i>*</i>${inp('ga.fat', '', true)}</label>
        <label>조섬유 %<i>*</i>${inp('ga.fiber', '', true)}</label>
        <label>수분 %<i>*</i>${inp('ga.moisture', '', true)}</label>
        <label>조회분 %${inp('ga.ash', '', true)}</label>
      </div>
      <div class="nf-g2">
        <label>칼로리 (100g당 kcal)${inp('kcal100', '340', true)}
          <small>라벨에 있으면 꼭 넣어주세요. 없으면 영양성분으로 추정하는데, 지방이 높은 사료일수록 급여량이 어긋납니다.</small></label>
        <label>생육 함량 %${inp('meat', '', true)}
          <small>"생고기 70%" 처럼 적혀 있을 때만. 비교 화면의 생육 함량 줄에 씁니다.</small></label>
      </div>

      <div class="nf-sec">원료 <span>표기 순서 그대로, 한 줄에 하나</span></div>
      <textarea data-nf="ingredients" class="nf-ta" placeholder="닭고기&#10;현미&#10;닭기름&#10;…">${esc(f.ingredients)}</textarea>

      <div class="nf-sec">제품 사진 <span>봉지 사진이어야 해요</span></div>
      <label class="nf-l">썸네일 주소${inp('thumb', 'https://…')}
        <small>브랜드 로고나 다른 맛 사진이면 사용자가 헷갈립니다. 주소를 넣으면 아래에 그대로 보여드려요.</small></label>
      <div id="nfThumb"></div>

      <div class="nf-sec">가격 <span>가장 작은 용량 기준</span></div>
      <div class="nf-g4">
        <label>가격(원) <i>*</i>${inp('price.p', '', true)}</label>
        <label>용량(g) <i>*</i>${inp('price.wg', '', true)}</label>
        <label>판매처 ${sel('shop', this.SHOP, 'price.shop')}</label>
        <label>판매 용량 전부 <i>*</i>${inp('price.wgOptions', '2000, 6000')}</label>
      </div>
      <label class="nf-l">쿠팡 파트너스 구매 링크${inp('price.buyUrl', 'https://link.coupang.com/a/…')}</label>
      <label class="nf-l">용량별 가격 <span style="color:var(--muted);font-weight:400">— 상세 화면의 최저가 비교에 씁니다</span>
        <textarea data-nf="priceLines" class="nf-ta" style="min-height:70px"
          placeholder="1000, 8500, https://link.coupang.com/a/…&#10;6000, 39900, https://link.coupang.com/a/…">${esc(f.priceLines)}</textarea>
        <small>한 줄에 하나 — <b>용량(g), 가격(원), 구매링크</b> 순서. 링크는 없으면 비워도 돼요.</small></label>

      <div class="nf-sec">출처 <span>게이트가 실제로 열어 봅니다</span></div>
      <label class="nf-l">성분 근거가 무엇인가요
        <select data-nf="srcKind">
          <option value="label"${f.srcKind === 'label' ? ' selected' : ''}>제품 라벨 (봉지·상세이미지 성분분석표)</option>
          <option value="official"${f.srcKind === 'official' ? ' selected' : ''}>제조사 공식 페이지</option>
          <option value="importer"${f.srcKind === 'importer' ? ' selected' : ''}>수입사 페이지</option>
        </select></label>
      <label class="nf-l">그 성분 근거가 있는 주소 <i>*</i>${inp('srcOfficial', 'https://…')}
        <small>라벨 사진이면 그 사진이 실린 페이지 주소를 적으세요.</small></label>
      <label class="nf-l">판매처 상품 주소 <i>*</i>${inp('srcRetail', 'https://www.coupang.com/vp/products/…')}</label>
      <label class="nf-l">성분표 기준
        <select data-nf="specOrigin">
          <option value="domestic"${f.specOrigin === 'domestic' ? ' selected' : ''}>국내 표기</option>
          <option value="overseas"${f.specOrigin === 'overseas' ? ' selected' : ''}>해외 표기만 확인됨</option>
        </select></label>

      <div class="nf-out" id="nfOut"></div>

      <div class="modal-f">
        <button class="btn" onclick="tryCloseModal()">닫기</button>
        <div style="flex:1"></div>
        <button class="btn pri" id="nfSubmit">심사에 올리기</button>
      </div>
    </div>`);

    this.bind();
    this.preview();
  },

  /* 사람이 뭔가 적었는지. 처음 열었을 때 그대로면 닫아도 잃을 게 없다. */
  dirty() {
    const f = this.f;
    if (!f) return false;
    return !!(f.brand || f.name || f.brandSlug || f.ingredients.trim() ||
      f.price.p || f.price.wg || f.srcOfficial || f.srcRetail || f.thumb || f.priceLines.trim() ||
      Object.values(f.ga).some(v => v !== ''));
  },

  get(path) { return path.split('.').reduce((o, k) => o?.[k], this.f); },
  set(path, v) {
    const ks = path.split('.'), last = ks.pop();
    let o = this.f; for (const k of ks) o = o[k];
    o[last] = v;
  },

  bind() {
    for (const el of document.querySelectorAll('[data-nf]')) {
      el.oninput = el.onchange = () => {
        const p = el.dataset.nf;
        this.set(p, p === 'rx' ? el.value === '1' : el.value);
        this.preview();
      };
    }
    for (const el of document.querySelectorAll('[data-nfm]')) {
      el.onclick = () => {
        const arr = this.get(el.dataset.nfm), v = el.dataset.v;
        const i = arr.indexOf(v);
        i < 0 ? arr.push(v) : arr.splice(i, 1);
        el.classList.toggle('on', i < 0);
        this.preview();
      };
    }
    document.getElementById('nfSubmit').onclick = () => this.submit();
  },

  /* 입력한 사실에서 엔진이 뽑아내는 값. 사람에게 미리 보여준다. */
  derive() {
    const f = this.f;
    const num = v => (v === '' || v == null ? null : Number(v));
    const ga = Object.fromEntries(Object.entries(f.ga).map(([k, v]) => [k, num(v)]));
    const list = String(f.ingredients).split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    const ingr = ENGINE.deriveIngredients(list);
    const dist = ENGINE.deriveDist(ingr);
    const funcIngr = ENGINE.deriveFuncIngr(list);
    /* 라벨은 100g당 kcal 로 적는다. 엔진은 kg당으로 받는다. 여기서 한 번만 바꾼다. */
    const kcal100 = num(f.kcal100);
    const nutrient = ENGINE.deriveNutrient(
      { ...ga, kcalPerKg: kcal100 != null ? Math.round(kcal100 * 10) : null },
      { meatRatio: num(f.meat) });
    const p = num(f.price.p), wg = num(f.price.wg);
    const pKg = (p && wg) ? Math.round(p / wg * 1000) : null;

    /* 용량별 가격 — "용량(g), 가격(원), 링크" 한 줄에 하나. */
    const prices = String(f.priceLines).split('\n').map(s => s.trim()).filter(Boolean)
      .map(line => {
        const [wgS, pS, url] = line.split(',').map(x => (x ?? '').trim());
        const w = num(wgS), pr = num(pS);
        if (!w || !pr) return null;
        return { wg: w, shop: f.price.shop, price: pr,
          pKg: Math.round(pr / w * 1000), ...(url ? { url } : {}) };
      }).filter(Boolean).sort((a, b) => a.wg - b.wg);
    const facts = {
      protein: ga.protein, dmCarb: nutrient.dmCarb,
      firstIngrCat: ingr[0]?.cat ?? null,
      cautionN: dist.caution, dangerN: dist.danger, pKg
    };
    const ratings = ENGINE.rateAll(facts);
    const score = Object.values(ratings).every(v => v != null) ? ENGINE.computeScore(ratings) : null;
    const { fit } = ENGINE.deriveFit({ nutrient, ingr, dist, funcIngr });
    return { ga, list, ingr, dist, funcIngr, nutrient, facts, ratings, score, pKg, prices,
      func: Object.keys(funcIngr), concerns: [...new Set(fit.map(x => x.concernType))].sort() };
  },

  preview() {
    const d = this.derive();
    const box = document.getElementById('nfOut');
    if (!box) return;
    const unknown = d.ingr.filter(i => i.safe === 'unknown');
    box.innerHTML = `
      <b>엔진이 계산한 값</b><br>
      건물기준 탄수 <b>${d.nutrient.dmCarb ?? '—'}%</b> ·
      원료 ${d.ingr.length}종 (주의 ${d.dist.caution} / 위험 ${d.dist.danger} / 사전에 없음 ${d.dist.unknown}) ·
      kg당 ${d.pKg ? d.pKg.toLocaleString('ko-KR') + '원' : '—'}<br>
      별점 원료 ${d.ratings.quality ?? '—'} · 첨가물 ${d.ratings.additive ?? '—'} ·
      탄수 ${d.ratings.carb ?? '—'} · 가성비 ${d.ratings.value ?? '—'} · <b>총점 ${d.score ?? '—'}</b>
      칼로리 ${d.nutrient.calKg ? d.nutrient.calKg.toLocaleString('ko-KR') + 'kcal/kg' : '<span style="color:var(--warn)">미입력 — 급여량을 추정으로 냅니다</span>'} ·
      생육 함량 ${d.nutrient.meat != null ? d.nutrient.meat + '%' : '표기 없음'} ·
      용량별 가격 ${d.prices.length}줄
      ${unknown.length ? `<br><span style="color:var(--warn)">사전에 없는 원료 ${unknown.length}종 — ${esc(unknown.map(i => i.name).join(', '))}</span>` : ''}`;

    /* 썸네일은 주소만 봐선 맞는지 알 수 없다. 눌러보지 않아도 보이게 띄운다 —
       브랜드 로고나 다른 맛 사진이 들어가는 사고가 실제로 있었다. */
    const tb = document.getElementById('nfThumb');
    if (tb) {
      const u = this.f.thumb.trim();
      tb.innerHTML = !u ? ''
        : !/^https:\/\//.test(u)
          ? `<div style="color:var(--warn);font-size:12px;margin-top:6px">https 주소여야 해요 — 이 주소는 사이트에서 안 뜹니다.</div>`
          : `<div style="margin-top:8px;display:flex;align-items:center;gap:12px">
               <div style="width:88px;height:88px;border-radius:12px;background:#fff;
                    box-shadow:inset 0 0 0 1px var(--line);display:grid;place-items:center;overflow:hidden">
                 <img src="${esc(u)}" alt="" style="max-width:76px;max-height:76px;object-fit:contain"
                      onerror="this.parentElement.innerHTML='<span style=&quot;font-size:11px;color:var(--bad)&quot;>안 열려요</span>'">
               </div>
               <div style="font-size:12px;color:var(--sub);line-height:1.6">
                 이 사진이 <b>이 제품 봉지</b>가 맞나요?<br>다른 맛·다른 용량이면 사용자가 헷갈립니다.</div>
             </div>`;
    }
  },

  /* 게이트가 잡기 전에, 여기서 먼저 막을 수 있는 것들 */
  validate(d) {
    const f = this.f, e = [];
    if (!f.brand.trim() || !f.name.trim()) e.push('브랜드와 제품명을 적어주세요');
    if (!/^[a-z0-9-]+$/.test(f.brandSlug.trim())) e.push('브랜드 슬러그는 영문 소문자·숫자·하이픈만 됩니다');
    if (!f.ages.length || !f.sizes.length) e.push('연령과 체형을 하나 이상 골라주세요');
    for (const k of ['protein', 'fat', 'fiber', 'moisture'])
      if (d.ga[k] == null) e.push('보장성분표에서 조단백·조지방·조섬유·수분은 모두 필요합니다');
    if (d.list.length < 3) e.push('원료를 표기 순서대로 적어주세요 (최소 3개)');
    if (!d.pKg) e.push('가격과 용량을 적어주세요');
    else if (d.pKg < 1000 || d.pKg > 200000) e.push(`kg당 ${d.pKg.toLocaleString('ko-KR')}원은 상식 범위 밖이에요. 가격·용량을 확인해 주세요`);
    const opts = String(f.price.wgOptions).split(/[,\s]+/).map(Number).filter(n => n > 0);
    if (!opts.length) e.push('판매 용량을 하나 이상 적어주세요');
    else if (Number(f.price.wg) !== Math.min(...opts))
      e.push(`가격은 가장 작은 용량(${Math.min(...opts)}g) 기준이어야 합니다`);
    if (!/^https:\/\//.test(f.srcOfficial)) e.push('성분 근거 주소를 https 로 적어주세요');
    if (!/^https:\/\//.test(f.srcRetail)) e.push('판매처 상품 주소를 https 로 적어주세요');
    if (f.price.buyUrl && !/^https:\/\/(link\.|www\.|m\.)?coupang\.com\//.test(f.price.buyUrl))
      e.push('구매 링크는 쿠팡 주소여야 합니다');
    return [...new Set(e)];
  },

  async submit() {
    if (!GH.token) { toast('이 브라우저엔 아직 토큰이 없어요 — 넣는 창을 열게요'); GH.ask(() => document.getElementById('tokenBtn')?.click()); return; }
    const d = this.derive();
    const errs = this.validate(d);
    if (errs.length) { toast(errs[0]); return; }

    const f = this.f, now = new Date().toISOString();
    const slug = f.brandSlug.trim().replace(/[^a-z0-9]/g, '');
    const item = {
      stagingId: `stg_${slug}_${Date.now().toString(36)}`,
      proposed: {
        brand: f.brand.trim(), brandSlug: slug, country: f.country, name: f.name.trim(),
        type: f.type, rx: !!f.rx, ages: f.ages, sizes: f.sizes,
        ratings: d.ratings, score: d.score,
        func: d.func, warnN: d.dist.caution + d.dist.danger, concerns: d.concerns,
        facts: d.facts, specOrigin: f.specOrigin,
        ga: d.ga, ingredients: d.list,
        ...(f.thumb.trim() ? { thumb: f.thumb.trim() } : {}),
        /* 칼로리와 생육 함량은 상세 화면이 쓰는 값이다. 칼로리가 없으면 급여량을
           영양성분으로 추정하는데, 지방이 높은 사료일수록 그 오차가 커진다. */
        ...(d.nutrient.calKg != null ? { kcalPerKg: d.nutrient.calKg } : {}),
        ...(d.nutrient.meat != null ? { meatRatio: d.nutrient.meat } : {}),
        ...(d.prices.length ? { prices: d.prices } : {}),
        price: {
          p: Number(f.price.p), wg: Number(f.price.wg), shop: f.price.shop, pKg: d.pKg,
          wgOptions: String(f.price.wgOptions).split(/[,\s]+/).map(Number).filter(n => n > 0).sort((a, b) => a - b),
          ...(f.price.buyUrl ? { buyUrl: f.price.buyUrl.trim() } : {})
        }
      },
      sources: [
        { role: f.srcKind, url: f.srcOfficial.trim(), fetchedAt: now,
          title: f.srcKind === 'label' ? '제품 라벨 성분분석표 (사람이 사진으로 판독)' : '공식 성분표 (사람이 확인)' },
        { role: 'retail', url: f.srcRetail.trim(), fetchedAt: now, title: '판매처 상품 페이지 (사람이 확인)' }
      ],
      /* 게이트 1 은 REQUIRED_FACT_KEYS 다섯 개와 price.p 에 대해 { src, quote } 를 요구한다.
         예전에는 ga.* 키에 문자열만 넣어서, 이 폼으로 올린 사료는 하나도 게이트를
         통과하지 못했다 — 심사 화면까지 가지도 못했다. */
      evidence: {
        'facts.protein': { src: 0, quote: `조단백 ${d.ga.protein}% 이상 (라벨 표기)` },
        'facts.dmCarb': { src: 0, quote:
          `조단백 ${d.ga.protein} + 조지방 ${d.ga.fat} + 조섬유 ${d.ga.fiber} + 수분 ${d.ga.moisture}` +
          ` → 건물기준 탄수 ${d.nutrient.dmCarb}%` },
        'facts.firstIngrCat': { src: 0, quote: `1번 원료 = ${d.ingr[0]?.name ?? '—'} (${d.ingr[0]?.cat ?? '—'})` },
        'facts.cautionN': { src: 0, quote:
          `주의로 판정된 원료 ${d.dist.caution}종: ${d.ingr.filter(i => i.safe === 'caution').map(i => i.name).join(', ') || '없음'}` },
        'facts.dangerN': { src: 0, quote:
          `위험으로 판정된 원료 ${d.dist.danger}종: ${d.ingr.filter(i => i.safe === 'danger').map(i => i.name).join(', ') || '없음'}` },
        'price.p': { src: 1, quote: `${Number(f.price.p).toLocaleString('ko-KR')}원 / ${f.price.wg}g` }
      },
      /* 사람이 직접 넣었다는 걸 남긴다. 심사 화면에서 이 표시를 보고 판단한다. */
      collector: { agent: '사람', via: 'admin.balsatang.com', at: now }
    };

    const btn = document.getElementById('nfSubmit');
    btn.disabled = true; btn.textContent = '올리는 중…';
    try {
      const path = `data/staging/manual-${now.slice(0, 10)}.json`;
      const prev = await GH.getFileOrNull(path);
      let batch = { batchId: `manual-${now.slice(0, 10)}`, collectedAt: now,
        collector: { agent: '사람', model: null }, items: [] };
      if (prev) { try { batch = JSON.parse(prev.text); } catch { } }
      batch.items.push(item);

      await GH.putFile(path, JSON.stringify(batch, null, 2) + '\n', prev?.sha,
        `사료 등록 — ${item.proposed.brand} ${item.proposed.name}\n\n` +
        `어드민에서 사람이 직접 넣었습니다. 게이트를 거쳐 발행 심사에 올라갑니다.\n` +
        `총점 ${d.score ?? '—'} · 원료 ${d.list.length}종 · kg당 ${d.pKg?.toLocaleString('ko-KR')}원`);

      this.f = null;   /* 올렸으니 이제 잃을 게 없다 */
      closeModal();
      toast('올렸어요 — 게이트 검사 뒤 발행 심사에 나타나요');
    } catch (e) {
      toast(e.message);
      console.error(e);
    } finally {
      btn.disabled = false; btn.textContent = '심사에 올리기';
    }
  }
};

function newFood() { NEWFOOD.open(); }
