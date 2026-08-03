/* 발사탕 어드민 — 데이터 계층
   지금은 data.js / articles.js 를 읽어 브라우저에 보관하고 파일로 내보낸다.
   서버가 붙으면 이 파일의 함수 본문만 fetch 로 교체하면 된다. */
(function(global){
'use strict';

const LS = 'balsatang_admin_draft';

const CATEGORY_KO = {
  meat:'육류', organ:'내장', fish:'어류', grain:'곡물', legume:'콩류',
  vegetable:'채소·과일', fat:'지방', oil:'오일', probiotic:'유익균',
  herb:'허브', vitamin:'비타민·미네랄', other:'기타'
};
const SAFE_KO   = { safe:'양호', caution:'논쟁중', danger:'주의' };
const FUNC_KO   = { eye_tear:'눈물·피모', joint:'관절', digestive:'소화', immune:'면역',
                    heart:'심장', weight:'체중', kidney:'신장', liver:'간', dental:'치아' };
const TYPE_KO   = { dry:'건식', wet:'습식', freeze_dried:'동결건조', air_dried:'에어드라이',
                    raw:'화식', topping:'토핑' };
const AGE_KO    = { puppy:'퍼피', adult:'성견', senior:'시니어', all:'전연령' };
const SIZE_KO   = { small:'소형', medium:'중형', large:'대형', all:'전체' };
const SHOP_KO   = { coupang:'쿠팡', naver:'네이버', mypet:'마이펫', gmarket:'G마켓',
                    auction:'옥션', eleven_st:'11번가', brand_official:'공식몰', other:'기타' };
const COUNTRY_KO= { CA:'캐나다', NZ:'뉴질랜드', US:'미국', FR:'프랑스', KR:'대한민국',
                    DE:'독일', GB:'영국', AU:'호주', TH:'태국', IT:'이탈리아',
                    NL:'네덜란드', BE:'벨기에' };
const CONCERN_KO= { healthy:'건강한 아이', picky_eater:'입맛 까다로운', weight:'체중 관리 중',
                    eye_tear:'눈물 많은 아이', allergy:'알러지 의심', digestive:'소화가 약한',
                    joint:'관절이 걱정', post_surgery:'수술·회복 중', senior:'시니어',
                    puppy:'어린 강아지', liver:'간 질환 아이', kidney:'신장 케어' };
/* 점수 가중치 — 원본 어드민 표기 기준 */
const WEIGHTS = { quality:0.40, carb:0.25, additive:0.25, value:0.10 };

const uid = () => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const clone = o => JSON.parse(JSON.stringify(o));

/* ── 원본 데이터 → 편집 가능한 레코드로 평탄화 ── */
function buildFoods(){
  return FOODS.map(f => {
    const d = DETAIL[f.id] || {};
    const funcOf = {};
    for(const [ft, arr] of Object.entries(d.funcIngr || {}))
      for(const x of arr) if(x.n) funcOf[x.n] = ft;
    return {
      id: f.id,
      brand: f.brand, brandSlug: f.brandSlug, country: f.country,
      name: f.name, type: f.type, rx: f.rx,
      ages: [...(f.ages||[])], sizes: [...(f.sizes||[])],
      thumb: f.thumb || null, ico: f.ico,
      status: 'published',
      ratings: { ...(f.ratings||{}) },
      score: f.score,
      headline: null,                       // 한줄평 (비우면 점수 기준 자동)
      nutrient: { ...(d.nutrient||{}) },
      ingr: (d.ingr||[]).slice()
        .sort((a,b)=>(a.rank||99)-(b.rank||99))
        .map(i => ({ name:i.name, func: funcOf[i.name] || '' })),
      verdict: {
        pos: clone(d.verdict?.pos || []),
        cau: clone(d.verdict?.cau || []),
        bad: clone(d.verdict?.bad || [])
      },
      fit:        clone(d.fit || []),
      fitCaution: clone(d.fitCaution || []),
      weightOpts: clone(d.weightOpts || []),
      prices:     clone(d.prices || []),
      rxInfo:     d.rxInfo || null,
      recall:     d.recall || null
    };
  });
}

/* ── 사료들의 원료에서 성분 마스터 사전 생성 ── */
function buildIngredients(){
  const m = new Map();
  for(const d of Object.values(DETAIL)){
    for(const i of (d.ingr || [])){
      if(!m.has(i.name)) m.set(i.name, {
        id: uid(), name: i.name, nameEn: '', cat: i.cat || 'other',
        safe: i.safe || 'safe', basis: i.basis || '', sourceUrl: '',
        desc: i.desc || '', warn: i.warn || '',
        allergen: !!i.allergen, func: ''
      });
    }
    for(const [ft, arr] of Object.entries(d.funcIngr || {}))
      for(const x of arr) if(m.has(x.n)) m.get(x.n).func = ft;
  }
  return [...m.values()].sort((a,b)=>a.name.localeCompare(b.name,'ko'));
}

function buildTags(){
  return {
    concern: [
      {key:'healthy',      label:'건강한 아이예요',      ico:'smile',    on:true},
      {key:'picky_eater',  label:'입맛이 까다로워요',    ico:'utensils', on:true},
      {key:'weight',       label:'체중 관리가 필요해요', ico:'scale',    on:true},
      {key:'eye_tear',     label:'눈물이 많아요',        ico:'droplet',  on:true},
      {key:'allergy',      label:'알러지가 의심돼요',    ico:'wind',     on:true},
      {key:'digestive',    label:'소화가 약해요',        ico:'soup',     on:true},
      {key:'joint',        label:'관절이 걱정돼요',      ico:'bone',     on:true},
      {key:'post_surgery', label:'수술·질환 후예요',     ico:'cross',    on:true}
    ],
    age: [
      {key:'puppy',  label:'퍼피 ~1세',   ico:'', on:true},
      {key:'adult',  label:'성견 1~7세',  ico:'', on:true},
      {key:'senior', label:'시니어 7세+', ico:'', on:true}
    ],
    size: [
      {key:'small',  label:'소형 10kg 미만', ico:'', on:true},
      {key:'medium', label:'중형 10~25kg',   ico:'', on:true},
      {key:'large',  label:'대형 25kg 초과', ico:'', on:true}
    ]
  };
}

/* ── 파생 계산 ── */
/* 탄수화물 추정 = 100 − (단백 + 지방 + 섬유 + 수분 + 회분) */
function estimateCarb(n){
  const v = 100 - ((+n.protein||0) + (+n.fat||0) + (+n.fiber||0) + (+n.moisture||0) + (+n.ash||0));
  return v > 0 ? Math.round(v * 10) / 10 : 0;
}
/* 총점 = 별점 4축 가중 평균 × 2 (5점 만점 → 10점) */
function totalScore(r){
  const s = (+r.quality||0)*WEIGHTS.quality + (+r.carb||0)*WEIGHTS.carb
          + (+r.additive||0)*WEIGHTS.additive + (+r.value||0)*WEIGHTS.value;
  return Math.round(s * 2 * 10) / 10;
}
function autoHeadline(f){
  if(f.rx) return '특정 질환 아이를 위한 처방식이에요. 반드시 수의사 처방 후 급여하세요';
  const s = f.score || 0;
  if(s >= 9) return '성분만 보면 최상위권 사료예요';
  if(s >= 8) return '전반적으로 우수한 성분 구성이에요';
  if(s >= 6) return '괜찮은 사료지만 아쉬운 점도 있어요';
  return '성분 구성에서 아쉬운 점이 많아요';
}
/* 주원료 첫 항목으로 아이콘 결정 — 앱과 동일 규칙 */
function deriveIco(f){
  if(f.rx) return 'cross';
  const first = (f.ingr[0]?.name) || '';
  if(/소고기|소간|소심장|우육|우심|비프|한우/.test(first)) return 'beef';
  if(/칠면조|오리/.test(first)) return 'bird';
  if(/닭|가금|치킨|계육/.test(first)) return 'drumstick';
  if(/연어|청어|어유|생선|고등어|참치|명태|대구|어육|북어/.test(first)) return 'fish';
  if(/양고기|양육/.test(first)) return 'beef';
  if(/돼지|돈육|포크/.test(first)) return 'ham';
  if(['freeze_dried','air_dried','raw'].includes(f.type)) return 'beef';
  if(f.type === 'wet') return 'container';
  return 'dog';
}

/* ── 스토어 ── */
const store = {
  foods: [], ingredients: [], articles: [], tags: null, recalls: [],
  dirty: false,

  init(){
    const saved = localStorage.getItem(LS);
    if(saved){
      try {
        const d = JSON.parse(saved);
        Object.assign(this, d);
        this.dirty = true;
        return 'draft';
      } catch(e){ localStorage.removeItem(LS); }
    }
    this.foods = buildFoods();
    this.ingredients = buildIngredients();
    this.articles = (typeof ARTICLES !== 'undefined' ? ARTICLES : []).map(a=>({
      id:a.id, cat:a.cat, ico:a.ico, title:a.title, excerpt:a.excerpt,
      body:a.body, status:'published', updated:'2026-06-09'
    }));
    this.tags = buildTags();
    this.recalls = [];
    this.dirty = false;
    return 'fresh';
  },
  save(){
    this.dirty = true;
    try {
      localStorage.setItem(LS, JSON.stringify({
        foods:this.foods, ingredients:this.ingredients, articles:this.articles,
        tags:this.tags, recalls:this.recalls
      }));
      return true;
    } catch(e){
      console.warn('임시저장 실패', e);
      return false;                       // 대개 브라우저 저장 용량(약 5MB) 초과
    }
  },
  /* 썸네일이 차지하는 용량 */
  thumbBytes(){
    return this.foods.reduce((a,f)=>
      a + (f.thumb && f.thumb.indexOf('data:')===0 ? f.thumb.length*3/4 : 0), 0);
  },
  discard(){ localStorage.removeItem(LS); this.init(); },

  ingByName(name){ return this.ingredients.find(i=>i.name===name); },
  foodById(id){ return this.foods.find(f=>f.id===id); },

  newFood(){
    return { id: uid(), brand:'', brandSlug:'', country:'', name:'', type:'dry', rx:false,
      ages:['all'], sizes:['all'], thumb:null, ico:'dog', status:'draft',
      ratings:{quality:3,carb:3,additive:3,value:3}, score:6, headline:null,
      nutrient:{protein:null,fat:null,fiber:null,moisture:null,ash:null,carb:null,
                dmCarb:null,meat:null,calKg:null,src:'label'},
      ingr:[], verdict:{pos:[],cau:[],bad:[]}, fit:[], fitCaution:[],
      weightOpts:[], prices:[], rxInfo:null, recall:null };
  },
  newIngredient(){
    return { id: uid(), name:'', nameEn:'', cat:'', safe:'safe', basis:'', sourceUrl:'',
             desc:'', warn:'', allergen:false, func:'' };
  },

  /* 성분 마스터에 없는 원료 이름 목록 */
  unknownIngredients(){
    const known = new Set(this.ingredients.map(i=>i.name));
    const out = new Map();
    for(const f of this.foods)
      for(const i of f.ingr)
        if(i.name && !known.has(i.name)) out.set(i.name, (out.get(i.name)||0)+1);
    return [...out.entries()].map(([name,n])=>({name,n}));
  },
  ingredientUsage(name){ return this.foods.filter(f=>f.ingr.some(i=>i.name===name)).length; },

  /* ── 내보내기: 앱이 읽는 형식으로 환원 ── */
  exportDataJs(){
    const list = [], detail = {};
    for(const f of this.foods){
      if(f.status === 'draft') continue;
      const funcIngr = {};
      let warnN = 0;
      const ingrOut = f.ingr.map((it, idx)=>{
        const m = this.ingByName(it.name) || {};
        if(m.safe === 'caution' || m.safe === 'danger') warnN++;
        const ft = it.func || m.func || '';
        if(ft) (funcIngr[ft] = funcIngr[ft] || []).push({n: it.name, note: null, ev: 'possible'});
        return { rank: idx+1, main: idx < 5, name: it.name, cat: m.cat || 'other',
                 safe: m.safe || 'safe', basis: m.basis || null, desc: m.desc || null,
                 warn: m.warn || null, allergen: !!m.allergen };
      });
      const dist = { safe:0, caution:0, danger:0, unknown:0, total:ingrOut.length };
      for(const i of ingrOut) dist[i.safe] = (dist[i.safe]||0) + 1;
      const cheap = f.prices.filter(p=>p.price).sort((a,b)=>(a.pKg||9e9)-(b.pKg||9e9))[0];

      list.push({
        id:f.id, brand:f.brand, brandSlug:f.brandSlug, country:f.country,
        name:f.name, type:f.type, rx:f.rx, ages:f.ages, sizes:f.sizes,
        thumb:f.thumb, ico: deriveIco(f), score: f.score, ratings: f.ratings,
        func: Object.keys(funcIngr), warnN,
        concerns: f.fit.map(x=>x.concernType),
        price: cheap ? {p:cheap.price, wg:cheap.wg, shop:cheap.shop, pKg:cheap.pKg} : null
      });
      detail[f.id] = {
        rxInfo:f.rxInfo, weightOpts:f.weightOpts, verdict:f.verdict,
        nutrient:f.nutrient, ingr:ingrOut, funcIngr, dist,
        fit:f.fit, fitCaution:f.fitCaution, prices:f.prices, recall:f.recall
      };
    }
    list.sort((a,b)=>(b.score||0)-(a.score||0));
    const j = o => JSON.stringify(o);
    return 'const FOODS=' + j(list) + ';\n'
         + 'const DETAIL=' + j(detail) + ';\n'
         + 'const ICONS=' + j(ICONS) + ';\n';
  },
  exportArticlesJs(){
    const src = typeof ARTICLES !== 'undefined' ? ARTICLES : [];
    const body = this.articles.filter(a=>a.status !== 'draft').map(a=>{
      const orig = src.find(x=>x.id === a.id);
      const match = orig ? orig.match.toString() : 'f => false';
      return '{\n  id:' + JSON.stringify(a.id) + ', cat:' + JSON.stringify(a.cat)
           + ', ico:' + JSON.stringify(a.ico) + ',\n  title:' + JSON.stringify(a.title)
           + ',\n  excerpt:' + JSON.stringify(a.excerpt)
           + ',\n  match: ' + match
           + ',\n  body: ' + JSON.stringify(a.body) + '\n}';
    }).join(',\n');
    return '/* 발사탕 콘텐츠 — 어드민에서 생성됨 */\nconst ARTICLES = [\n' + body + '\n];\n';
  }
};

global.BS = { store, CATEGORY_KO, SAFE_KO, FUNC_KO, TYPE_KO, AGE_KO, SIZE_KO,
              SHOP_KO, COUNTRY_KO, CONCERN_KO, WEIGHTS,
              estimateCarb, totalScore, autoHeadline, deriveIco, uid, clone };
})(window);
