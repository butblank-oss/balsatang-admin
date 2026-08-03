/* 어드민 자체 검사 — 저장소가 갈려도 규칙은 그대로다.

   실행: node check.mjs

   1) 채점 로직을 여기 옮겨 적지 않았는가
      engine/ 한 곳에만 있어야 한다. 예전에 심사 화면이 루브릭을 따로 갖고 있어서
      화면 점수와 발행 점수가 달라질 뻔했다.
   2) 앱 데이터를 여기 복사해 두지 않았는가
      data.js 사본이 생기면 어느 쪽이 진짜인지 알 수 없게 된다.
   3) 엔진과 데이터를 앱 도메인에서 읽고 있는가
*/
import fs from 'node:fs';

const problems = [];
const read = p => fs.readFileSync(p, 'utf8');

for (const f of ['foods.js', 'review.html', 'app.js', 'publish.js']) {
  const src = read(f);
  if (/function\s+rateCarb\s*\(|const\s+rateCarb\s*=\s*[^E]|const\s+SCORE_WEIGHT\s*=/.test(src))
    problems.push(`${f} 가 루브릭을 따로 갖고 있습니다 — engine/ 한 곳만 써야 합니다`);
  if (/const\s+(INGREDIENTS|ALIAS)\s*=\s*\{/.test(src))
    problems.push(`${f} 가 원료 사전을 따로 갖고 있습니다`);
}

for (const f of ['data.js', 'articles.js', 'engine.js', 'dict.js', 'phrases.js'])
  if (fs.existsSync(f)) problems.push(`${f} 사본이 있습니다 — 앱 저장소(balsatang.com)에서 읽어야 합니다`);

for (const f of ['foods.html', 'review.html', 'index.html'])
  if (!/balsatang\.com/.test(read(f)))
    problems.push(`${f} 가 앱 도메인을 읽지 않습니다`);

/* 커밋 대상 저장소가 맞는지 */
const gh = read('github.js');
const owner = gh.match(/owner:\s*'([^']+)'/)?.[1];
const repo = gh.match(/repo:\s*'([^']+)'/)?.[1];
if (repo !== 'balsatang') problems.push(`github.js 가 '${owner}/${repo}' 에 커밋합니다 — 앱 저장소여야 합니다`);

console.log('\n어드민 검사');
console.log('─'.repeat(56));
console.log(`  · 커밋 대상 ${owner}/${repo}`);
if (problems.length) {
  console.log('');
  for (const p of problems) console.log(`  ❌ ${p}`);
  console.log('─'.repeat(56) + '\n');
  process.exit(1);
}
console.log('  ✅ 로직·데이터가 한 벌입니다');
console.log('─'.repeat(56) + '\n');
