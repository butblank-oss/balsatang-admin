# 발사탕 어드민

**https://admin.balsatang.com**

발사탕 데이터를 고치고 [balsatang](https://github.com/butblank-oss/balsatang) 저장소에
GitHub API 로 직접 커밋한다. 커밋하면 몇 분 뒤 https://balsatang.com 에 반영된다.

## 화면

| 화면 | 하는 일 |
|---|---|
| `index.html` | 셸. 성분 사전 · 콘텐츠 · 태그 · 리콜. 사료·심사는 아래 화면을 그 자리에 띄운다 |
| `foods.html` | 사료 편집 — 기본 정보 · 썸네일 · 가격 · 구매 링크 · **보장성분표 · 원료 · 판정 카드 · 맞춤 태그** |
| `analytics.js` | 사용 분석 — 프론트가 Supabase 에 쌓은 익명 기록을 읽는다. 설치는 [`analytics/README.md`](analytics/README.md) |
| `review.html` | 발행 심사 — 수집된 사료를 검토하고 승인하면 그 자리에서 발행한다 |

## 왜 도메인이 갈렸나

프론트와 같은 도메인에 있으면, 프론트 어디든 XSS 가 하나 생겼을 때 어드민 토큰이
같이 샌다(`localStorage` 는 오리진 단위다). 오리진을 갈라 두면 그 경로가 막힌다.

## 로직은 여기 없다

채점·원료 판정·문구 템플릿은 앱 저장소의 `engine/` 한 곳에만 있고,
이 화면이 `https://balsatang.com/engine/` 에서 그대로 읽는다.
여기에 옮겨 적으면 두 벌이 되어 반드시 어긋난다 — 예전에 그래서 구매 링크가 사라졌다.

데이터(`data.js`)도 마찬가지로 앱에서 읽는다. 사본을 두지 않는다.

```
node check.mjs    로직·데이터가 한 벌인지 검사
```

## 토큰

fine-grained personal access token 이 필요하다.

- Repository access: `butblank-oss/balsatang` **하나만** (이 저장소는 필요 없다)
- Permissions: **Contents = Read and write** 하나만
- Expiration: 되도록 짧게 (90일)

토큰은 이 브라우저의 `localStorage` 에만 둔다. 저장소에 넣지 않는다.
