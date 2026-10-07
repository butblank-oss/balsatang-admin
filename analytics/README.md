# 사용 분석 — 설치

프론트(`balsatang/track.js`)가 익명 이벤트를 Supabase 에 쌓고, 어드민 **사용 분석** 화면이 읽는다.
값을 비워 두면 프론트는 아무것도 보내지 않는다. 아래 순서대로 한 번만 하면 된다.

## 1. Supabase 프로젝트

1. https://supabase.com 에서 프로젝트를 만든다 (리전: Northeast Asia (Seoul)).
2. **SQL Editor** 에 `schema.sql` 을 통째로 붙여 넣고 실행한다. 여러 번 실행해도 된다.
3. (선택) **Database → Extensions** 에서 `pg_cron` 을 켜고 `schema.sql` 을 한 번 더 실행하면
   13개월 지난 기록을 매일 지운다. 개인정보처리방침에 적은 보관 기간이다.

## 2. 운영자 계정

1. **Authentication → Sign In / Providers** 에서 *Allow new users to sign up* 을 **끈다**.
   켜 두면 아무나 가입은 할 수 있다(가입해도 기록은 못 읽는다 — 아래 3번 표에 없으면 거절).
2. **Authentication → Users → Add user** 로 운영자 이메일·비밀번호를 만든다.
3. SQL Editor 에서 그 계정을 분석 권한에 넣는다.

   ```sql
   insert into analytics_admins (user_id, note)
   select id, '운영자' from auth.users where email = '운영자@이메일';
   ```

## 3. 키 넣기

**Project Settings → API** 에서 *Project URL* 과 *anon public* 키를 복사한다.

- 프론트: `balsatang/track.js` 맨 위 `TRACK_CFG` 의 `url`·`key` 에 넣고 커밋한다.
  anon 키는 원래 공개되는 값이다. RLS 가 '넣기' 만 허락한다.
- 어드민: **사용 분석** 화면의 로그인 창에 같은 주소·키와 운영자 계정을 넣는다.
  (매번 넣기 싫으면 `analytics.js` 의 `DEFAULT_CFG` 에 적어도 된다.)

**service_role 키는 어디에도 넣지 않는다.**

## 쌓이는 이벤트

| 이벤트 | 언제 | 주요 값 |
|---|---|---|
| `first_visit` | 이 기기 첫 방문 | 처음 들어온 화면 |
| `session_start` | 방문 시작 (30분 쉬면 새 방문) | 유입(ref·utm), 기기 |
| `screen_view` | 화면 이동 | 화면, 사료 ID, 직전 화면에 머문 시간 |
| `search` | 검색 (입력 멈추고 1.2초 뒤) | 검색어, 결과 수 |
| `buy_click` | 구매 버튼 | 사료 ID, 쇼핑몰, 버튼 위치 |
| `pet_profile_saved` | 맞춤 입력 완료 | 나이대·활동량·고민·피할 원료 (이름·몸무게 없음) |
| `compare_add` · `save_toggle` · `share` · `filter` · `sort` · `request` … | 버튼 클릭 | `data-*` 값 |
| `js_error` | 화면 오류 | 메시지, 파일·줄 |

버튼 클릭은 `app.js` 의 `ACTION` 표가 `data-*` 속성을 이벤트 이름으로 바꾼다.
새 버튼에 `data-xxx` 를 달면 그 표에 한 줄 추가하면 된다.

## 광고 링크

인스타·블로그 링크에 utm 을 붙이면 **캠페인** 표에 나온다.

```
https://balsatang.com/?utm_source=instagram&utm_medium=story&utm_campaign=oct_launch#/
```

`#/` 앞에 붙여야 한다 (화면 주소는 `#` 뒤에 있다).

## 보내는 값을 바꿀 때

`track.js` 에서 보내는 값을 늘리면 **먼저** `balsatang/legal.js` 의 개인정보처리방침을 고친다.
