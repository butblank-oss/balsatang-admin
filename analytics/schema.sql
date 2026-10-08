-- 발사탕 사용 기록 — Supabase SQL Editor 에 통째로 붙여 넣고 실행한다.
-- 여러 번 실행해도 된다 (함수·정책은 갈아끼운다).
--
-- 권한 구조
--   anon(브라우저)     events 에 넣기만 한다. 읽지 못한다.
--   운영자 계정        analytics_admins 에 등록된 auth 사용자만 읽는다.
--   대시보드 숫자      analytics_dashboard() 한 번 호출로 받는다 — 운영자가 아니면 거절.
--
-- 시간대: 모든 '하루' 는 한국 시간(Asia/Seoul) 기준으로 자른다.

-- ══════════════════════════════════════════════════════════════
-- 1. 표
-- ══════════════════════════════════════════════════════════════
create table if not exists public.events (
  id           bigint generated always as identity primary key,
  ts           timestamptz not null default now(),
  client_ts    timestamptz,
  device_id    text not null check (char_length(device_id) between 8 and 64),
  session_id   text not null check (char_length(session_id) between 8 and 64),
  name         text not null check (name ~ '^[a-z][a-z0-9_]{1,39}$'),
  props        jsonb not null default '{}'::jsonb check (jsonb_typeof(props) = 'object' and pg_column_size(props) < 4000),
  screen       text check (char_length(screen) <= 200),
  ref          text check (char_length(ref) <= 120),
  utm_source   text check (char_length(utm_source) <= 100),
  utm_medium   text check (char_length(utm_medium) <= 100),
  utm_campaign text check (char_length(utm_campaign) <= 100),
  app          text check (char_length(app) <= 16),
  os           text check (char_length(os) <= 16),
  browser      text check (char_length(browser) <= 16),
  device       text check (char_length(device) <= 16),
  lang         text check (char_length(lang) <= 16),
  vw           int
);
create index if not exists events_ts_idx        on public.events (ts);
create index if not exists events_name_ts_idx   on public.events (name, ts);
create index if not exists events_device_ts_idx on public.events (device_id, ts);

-- 서버 시간이 진짜다. 브라우저가 ts 를 적어 보내도 덮어쓴다.
create or replace function public.events_stamp() returns trigger language plpgsql as $$
begin
  new.ts := now();
  if new.client_ts is not null and abs(extract(epoch from (new.client_ts - now()))) > 86400 then
    new.client_ts := null;
  end if;
  return new;
end $$;
drop trigger if exists events_stamp on public.events;
create trigger events_stamp before insert on public.events for each row execute function public.events_stamp();

create table if not exists public.analytics_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note    text,
  added   timestamptz not null default now()
);

-- ══════════════════════════════════════════════════════════════
-- 2. 권한 (RLS)
-- ══════════════════════════════════════════════════════════════
alter table public.events enable row level security;
alter table public.analytics_admins enable row level security;

revoke all on public.events from anon, authenticated;
grant insert on public.events to anon, authenticated;
grant select on public.events to authenticated;
revoke all on public.analytics_admins from anon, authenticated;
grant select on public.analytics_admins to authenticated;

create or replace function public.is_analytics_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.analytics_admins where user_id = auth.uid())
$$;

drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to anon, authenticated with check (true);

drop policy if exists events_admin_read on public.events;
create policy events_admin_read on public.events for select to authenticated
  using (public.is_analytics_admin());

drop policy if exists admins_self on public.analytics_admins;
create policy admins_self on public.analytics_admins for select to authenticated
  using (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════
-- 3. 사람/봇 · 유입 종류 — 대시보드·세션·유입 함수가 같이 쓴다
-- ══════════════════════════════════════════════════════════════
-- 세션마다 사람인지 봇인지. 프론트 track.js 가 session_start·first_visit 의 props.agent 에
--   human | crawler(검색 로봇 등) | automation(헤드리스 브라우저·자동화 도구) 를 적는다.
-- 그 값이 없는 예전 기록은, 리눅스 데스크톱인데 화면 폭이 480 이하인 것(=헤드리스로 띄운
-- 모바일 화면, 개발 중 자동 점검)을 봇으로 추정한다. 실제 사람이 그렇게 쓰는 일은 드물다.
create or replace function public.analytics_cls(p_lo timestamptz, p_hi timestamptz)
returns table(session_id text, who text, bot text)
language sql stable security definer set search_path = public as $$
  with s as (
    select e.session_id,
      max(e.props->>'agent') filter (where e.name in ('session_start', 'first_visit')) as ag,
      max(e.props->>'bot')   filter (where e.name in ('session_start', 'first_visit')) as bt,
      bool_or(e.os = 'linux' and e.device = 'desktop' and e.vw <= 480) as legacy
    from events e where e.ts >= p_lo - interval '1 day' and e.ts < p_hi group by e.session_id
  )
  select s.session_id,
    case when s.ag in ('crawler', 'automation') then 'bot'
         when s.ag = 'human' then 'human'
         when s.legacy then 'bot' else 'human' end,
    case when s.ag in ('crawler', 'automation') then coalesce(s.bt, s.ag)
         when s.ag is null and s.legacy then 'headless(추정)' end
  from s
$$;
revoke all on function public.analytics_cls(timestamptz, timestamptz) from public, anon, authenticated;

-- 들어온 곳 이름 — utm 이 있으면 그것, 없으면 앞 사이트 도메인, 그것도 없으면 인앱 브라우저.
create or replace function public.traffic_source(p_ref text, p_utm text, p_browser text)
returns text language sql immutable as $$
  select coalesce(nullif(lower(p_utm), ''), nullif(lower(p_ref), ''),
    case p_browser when 'kakaotalk' then '카카오톡 앱' when 'instagram' then '인스타그램 앱'
                   when 'naver' then '네이버 앱' when 'facebook' then '페이스북 앱' end,
    '(직접 방문)')
$$;

-- 들어온 곳 종류 — search(검색) · video(유튜브) · community(블로그·카페) · social · ai · messenger
--                  · naver_app · shop · referral(그 밖의 사이트) · direct
create or replace function public.traffic_kind(p_ref text, p_utm text, p_browser text)
returns text language sql immutable as $$
  select case
    when v = '' then case p_browser when 'kakaotalk' then 'messenger' when 'instagram' then 'social'
                                    when 'facebook' then 'social' when 'naver' then 'naver_app' else 'direct' end
    when v ~ '(^|\.)(youtube\.com|youtu\.be)$' or v in ('youtube', 'yt') then 'video'
    when v ~ '(^|\.)(blog|cafe|post|in|kin)\.naver\.com$' or v ~ '(tistory\.com|brunch\.co\.kr|velog\.io|cafe\.daum\.net)$'
         or v in ('blog', 'naverblog', 'cafe', 'tistory') then 'community'
    when v ~ '(chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$'
         or v in ('chatgpt', 'perplexity', 'claude', 'gemini', 'copilot') then 'ai'
    when v ~ '(^|\.)(google\.[a-z.]+|naver\.com|daum\.net|bing\.com|zum\.com|yahoo\.[a-z.]+|duckduckgo\.com|baidu\.com|ecosia\.org)$'
         or v in ('google', 'naver', 'daum', 'bing', 'zum') then 'search'
    when v ~ '(instagram\.com|facebook\.com|threads\.net|threads\.com|tiktok\.com|(^|\.)x\.com|(^|\.)t\.co|twitter\.com)$'
         or v in ('instagram', 'ig', 'facebook', 'fb', 'threads', 'tiktok', 'x', 'twitter') then 'social'
    when v ~ 'kakao' then 'messenger'
    when v ~ '(coupang\.com|smartstore\.naver\.com)$' then 'shop'
    else 'referral' end
  from (select lower(coalesce(nullif(p_utm, ''), nullif(p_ref, ''), '')) as v) x
$$;

-- ══════════════════════════════════════════════════════════════
-- 4. 대시보드 — 기간을 받아 화면에 필요한 숫자를 한 번에 돌려준다
--    p_who: human(기본) | bot | all. 숫자는 고른 쪽만 센다.
-- ══════════════════════════════════════════════════════════════
drop function if exists public.analytics_dashboard(date, date);
create or replace function public.analytics_dashboard(p_from date, p_to date, p_who text default 'human')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  t0 timestamptz := (p_from::timestamp at time zone 'Asia/Seoul');
  t1 timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Seoul');
  span int := (p_to - p_from) + 1;
  q0 timestamptz := t0 - make_interval(days => span);
  out jsonb;
begin
  if not public.is_analytics_admin() then
    raise exception 'not an analytics admin' using errcode = '42501';
  end if;

  with
  cls as (select * from analytics_cls(q0, t1)),
  ev  as (select e.* from events e join cls c using (session_id)
          where e.ts >= t0 and e.ts < t1 and (p_who = 'all' or c.who = p_who)),
  pev as (select e.* from events e join cls c using (session_id)
          where e.ts >= q0 and e.ts < t0 and (p_who = 'all' or c.who = p_who)),
  whos as (select c.who, count(distinct e.session_id) as sessions, count(distinct e.device_id) as visitors
           from events e join cls c using (session_id) where e.ts >= t0 and e.ts < t1 group by c.who),
  firsts as (select device_id, min(ts) as first_ts from events group by device_id),
  kpi_of as (
    select x.period,
      count(distinct x.device_id)                                         as visitors,
      count(distinct x.device_id) filter (where f.first_ts >= x.lo and f.first_ts < x.hi) as new_visitors,
      count(distinct x.session_id)                                        as sessions,
      count(*) filter (where x.name = 'screen_view')                      as screen_views,
      count(*) filter (where x.name = 'screen_view' and x.props->>'screen' = 'detail') as food_views,
      count(*) filter (where x.name = 'buy_click')                        as buy_clicks,
      count(distinct x.device_id) filter (where x.name = 'buy_click')     as buyers,
      count(*) filter (where x.name = 'search')                           as searches,
      count(*) filter (where x.name = 'pet_profile_saved')                as profiles,
      count(*) filter (where x.name = 'js_error')                         as errors
    from (
      select 'cur' as period, t0 as lo, t1 as hi, ev.* from ev
      union all
      select 'prev', q0, t0, pev.* from pev
    ) x join firsts f using (device_id)
    group by x.period
  ),
  daily as (
    select (ev.ts at time zone 'Asia/Seoul')::date as d,
      count(distinct ev.device_id) as visitors,
      count(distinct ev.device_id) filter (where (f.first_ts at time zone 'Asia/Seoul')::date = (ev.ts at time zone 'Asia/Seoul')::date) as new_visitors,
      count(distinct ev.session_id) as sessions,
      count(*) filter (where ev.name = 'buy_click') as buy_clicks
    from ev join firsts f using (device_id) group by 1 order by 1
  ),
  starts as (
    select distinct on (session_id) session_id, device_id, ref, utm_source, utm_medium, utm_campaign, browser, props->>'landing' as landing
    from ev where name = 'session_start' order by session_id, ts
  ),
  sess_buy as (select distinct session_id from ev where name = 'buy_click'),
  sources as (
    select traffic_source(s.ref, s.utm_source, s.browser) as source,
      min(traffic_kind(s.ref, s.utm_source, s.browser)) as kind,
      count(*) as sessions,
      count(distinct s.device_id) filter (where f.first_ts >= t0) as new_visitors,
      count(b.session_id) as buy_sessions
    from starts s join firsts f using (device_id) left join sess_buy b using (session_id)
    group by 1 order by 2 desc limit 20
  ),
  campaigns as (
    select utm_source as source, coalesce(utm_medium, '') as medium, utm_campaign as campaign, count(*) as sessions,
      count(b.session_id) as buy_sessions
    from starts s left join sess_buy b using (session_id)
    where utm_campaign is not null group by 1,2,3 order by 4 desc limit 20
  ),
  kinds as (
    select traffic_kind(s.ref, s.utm_source, s.browser) as kind, count(*) as sessions,
      count(distinct s.device_id) as visitors, count(b.session_id) as buy_sessions
    from starts s left join sess_buy b using (session_id) group by 1 order by 2 desc
  ),
  landings as (
    select split_part(coalesce(landing, '#/'), '?', 1) as landing, count(*) as sessions
    from starts group by 1 order by 2 desc limit 10
  ),
  screens as (
    select props->>'screen' as screen, count(*) as views, count(distinct device_id) as visitors
    from ev where name = 'screen_view' group by 1 order by 2 desc
  ),
  dwell as (   -- 화면을 떠날 때 기록되는 prev_ms 로 '그 화면에 머문 시간' 을 센다
    select props->>'prev' as screen, round((percentile_cont(0.5) within group (order by (props->>'prev_ms')::numeric))::numeric / 1000, 1) as median_sec
    from ev where name = 'screen_view' and props->>'prev' is not null and (props->>'prev_ms')::numeric < 1800000
    group by 1
  ),
  foods as (
    select id,
      count(*) filter (where name = 'screen_view')       as views,
      count(distinct device_id) filter (where name = 'screen_view') as visitors,
      count(*) filter (where name = 'buy_click')          as buy_clicks,
      count(*) filter (where name = 'compare_add')        as compare_adds,
      count(*) filter (where name = 'save_toggle' and (props->>'on')::boolean) as saves,
      count(*) filter (where name = 'share')              as shares
    from (select name, device_id, props, props->>'id' as id from ev
          where (name = 'screen_view' and props->>'screen' = 'detail') or name in ('buy_click','compare_add','save_toggle','share')) z
    where id is not null group by id order by views desc limit 50
  ),
  searches as (
    select lower(props->>'q') as q, count(*) as n, count(distinct device_id) as visitors,
      min((props->>'n')::int) as min_results, max((props->>'n')::int) as max_results
    from ev where name = 'search' group by 1 order by 2 desc limit 30
  ),
  zero as (
    select lower(props->>'q') as q, count(*) as n, count(distinct device_id) as visitors
    from ev where name = 'search' and (props->>'n')::int = 0 group by 1 order by 2 desc limit 30
  ),
  requests as (
    select props->>'type' as type, coalesce(props->>'id', props->>'q') as target, count(*) as n
    from ev where name = 'request' group by 1, 2 order by 3 desc limit 30
  ),
  funnel as (
    select
      count(distinct device_id) as visited,
      count(distinct device_id) filter (where name in ('search','search_chip','concern_click','food_click')) as explored,
      count(distinct device_id) filter (where name = 'screen_view' and props->>'screen' = 'detail') as viewed_food,
      count(distinct device_id) filter (where name in ('compare_add','save_toggle','pet_profile_saved')) as engaged,
      count(distinct device_id) filter (where name = 'buy_click') as clicked_buy
    from ev
  ),
  concerns as (
    select c as concern, count(*) as n from ev, jsonb_array_elements_text(coalesce(props->'concerns', '[]'::jsonb)) c
    where name = 'pet_profile_saved' group by 1 order by 2 desc
  ),
  actions as (select name, count(*) as n, count(distinct device_id) as visitors from ev group by 1 order by 2 desc),
  envs as (
    select 'device' as k, coalesce(device, '?') as v, count(distinct device_id) as visitors from ev group by 2
    union all select 'os', coalesce(os, '?'), count(distinct device_id) from ev group by 2
    union all select 'browser', coalesce(browser, '?'), count(distinct device_id) from ev group by 2
    union all select 'app', coalesce(app, '?'), count(distinct device_id) from ev group by 2
  ),
  hours as (
    select extract(isodow from ts at time zone 'Asia/Seoul')::int as dow,
           extract(hour from ts at time zone 'Asia/Seoul')::int as h,
           count(distinct session_id) as sessions
    from ev group by 1, 2
  ),
  -- 주간 재방문: 처음 온 주(월요일 시작) 기준, n주 뒤에 다시 온 기기 비율. 기간과 상관없이 최근 8주.
  cohort_base as (
    select device_id, date_trunc('week', first_ts at time zone 'Asia/Seoul')::date as wk from firsts
    where first_ts >= date_trunc('week', now() at time zone 'Asia/Seoul') - interval '7 weeks'
  ),
  activity as (
    select distinct device_id, date_trunc('week', ts at time zone 'Asia/Seoul')::date as wk
    from events where ts >= now() - interval '8 weeks' and name = 'session_start'
  ),
  cohorts as (
    select b.wk, count(distinct b.device_id) as size,
      count(distinct a.device_id) filter (where a.wk = b.wk + 7)  as w1,
      count(distinct a.device_id) filter (where a.wk = b.wk + 14) as w2,
      count(distinct a.device_id) filter (where a.wk = b.wk + 21) as w3,
      count(distinct a.device_id) filter (where a.wk = b.wk + 28) as w4
    from cohort_base b left join activity a using (device_id)
    group by b.wk order by b.wk
  ),
  errors as (
    select props->>'msg' as msg, props->>'src' as src, props->>'line' as line, count(*) as n, max(ts) as last
    from ev where name = 'js_error' group by 1, 2, 3 order by 4 desc limit 10
  )
  select jsonb_build_object(
    'range',     jsonb_build_object('from', p_from, 'to', p_to, 'days', span, 'who', p_who),
    'whos',      coalesce((select jsonb_agg(whos) from whos), '[]'),
    'kinds',     coalesce((select jsonb_agg(kinds) from kinds), '[]'),
    'kpi',       (select jsonb_object_agg(period, to_jsonb(k) - 'period') from kpi_of k),
    'daily',     coalesce((select jsonb_agg(daily) from daily), '[]'),
    'sources',   coalesce((select jsonb_agg(sources) from sources), '[]'),
    'campaigns', coalesce((select jsonb_agg(campaigns) from campaigns), '[]'),
    'landings',  coalesce((select jsonb_agg(landings) from landings), '[]'),
    'screens',   coalesce((select jsonb_agg(jsonb_build_object('screen', s.screen, 'views', s.views, 'visitors', s.visitors, 'median_sec', d.median_sec))
                           from screens s left join dwell d using (screen)), '[]'),
    'foods',     coalesce((select jsonb_agg(foods) from foods), '[]'),
    'searches',  coalesce((select jsonb_agg(searches) from searches), '[]'),
    'zero',      coalesce((select jsonb_agg(zero) from zero), '[]'),
    'requests',  coalesce((select jsonb_agg(requests) from requests), '[]'),
    'funnel',    (select to_jsonb(funnel) from funnel),
    'concerns',  coalesce((select jsonb_agg(concerns) from concerns), '[]'),
    'actions',   coalesce((select jsonb_agg(actions) from actions), '[]'),
    'envs',      coalesce((select jsonb_agg(envs) from envs), '[]'),
    'hours',     coalesce((select jsonb_agg(hours) from hours), '[]'),
    'cohorts',   coalesce((select jsonb_agg(cohorts) from cohorts), '[]'),
    'errors',    coalesce((select jsonb_agg(errors) from errors), '[]')
  ) into out;
  return out;
end $$;

revoke all on function public.analytics_dashboard(date, date, text) from public, anon;
grant execute on function public.analytics_dashboard(date, date, text) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- 5. 유입 — 사람과 봇을 나란히. 고르는 값 없이 둘 다 돌려준다.
-- ══════════════════════════════════════════════════════════════
create or replace function public.analytics_traffic(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  t0 timestamptz := (p_from::timestamp at time zone 'Asia/Seoul');
  t1 timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Seoul');
  out jsonb;
begin
  if not public.is_analytics_admin() then
    raise exception 'not an analytics admin' using errcode = '42501';
  end if;
  with
  cls as (select * from analytics_cls(t0, t1)),
  ev as (select e.*, c.who, c.bot from events e join cls c using (session_id) where e.ts >= t0 and e.ts < t1),
  sess as (
    select session_id, min(who) as who, min(bot) as bot, min(device_id) as device_id, min(ts) as started,
      count(*) as events, bool_or(name = 'buy_click') as bought,
      (array_agg(traffic_source(ref, utm_source, browser) order by name <> 'session_start', ts))[1] as source,
      (array_agg(traffic_kind(ref, utm_source, browser) order by name <> 'session_start', ts))[1] as kind
    from ev group by session_id
  ),
  summary as (select who, count(*) as sessions, count(distinct device_id) as visitors, sum(events) as events
              from sess group by who),
  kinds as (select who, kind, count(*) as sessions, count(distinct device_id) as visitors,
              count(*) filter (where bought) as buy_sessions from sess group by 1, 2 order by 3 desc),
  sources as (select who, kind, source, count(*) as sessions, count(distinct device_id) as visitors,
                count(*) filter (where bought) as buy_sessions from sess group by 1, 2, 3 order by 4 desc limit 60),
  bots as (select bot, count(*) as sessions, count(distinct device_id) as devices, sum(events) as events,
             max(started) as last from sess where who = 'bot' group by 1 order by 2 desc),
  daily as (select (started at time zone 'Asia/Seoul')::date as d,
              count(*) filter (where who = 'human') as human, count(*) filter (where who = 'bot') as bot
            from sess group by 1 order by 1)
  select jsonb_build_object(
    'summary', coalesce((select jsonb_agg(summary) from summary), '[]'),
    'kinds',   coalesce((select jsonb_agg(kinds) from kinds), '[]'),
    'sources', coalesce((select jsonb_agg(sources) from sources), '[]'),
    'bots',    coalesce((select jsonb_agg(bots) from bots), '[]'),
    'daily',   coalesce((select jsonb_agg(daily) from daily), '[]')
  ) into out;
  return out;
end $$;
revoke all on function public.analytics_traffic(date, date) from public, anon;
grant execute on function public.analytics_traffic(date, date) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- 6. 세션 목록 — 한 번 방문(30분 쉬면 새 방문)마다 한 줄. 최신 순.
--    한 세션의 자세한 기록은 events 표를 session_id 로 바로 읽는다(운영자만 읽힘).
-- ══════════════════════════════════════════════════════════════
create or replace function public.analytics_sessions(p_from date, p_to date, p_who text default 'human',
  p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  t0 timestamptz := (p_from::timestamp at time zone 'Asia/Seoul');
  t1 timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Seoul');
  out jsonb;
begin
  if not public.is_analytics_admin() then
    raise exception 'not an analytics admin' using errcode = '42501';
  end if;
  with
  cls as (select * from analytics_cls(t0, t1)),
  ev as (select e.*, c.who, c.bot from events e join cls c using (session_id)
         where e.ts >= t0 and e.ts < t1 and (p_who = 'all' or c.who = p_who)),
  firsts as (select device_id, min(ts) as first_ts from events
             where device_id in (select distinct device_id from ev) group by device_id),
  sess as (
    select ev.session_id, min(ev.who) as who, min(ev.bot) as bot, min(ev.device_id) as device_id,
      min(ev.ts) as started, max(ev.ts) as ended, count(*) as events,
      count(*) filter (where ev.name = 'screen_view') as screens,
      count(distinct ev.props->>'id') filter (where ev.name = 'screen_view' and ev.props->>'screen' = 'detail') as foods,
      count(*) filter (where ev.name = 'search') as searches,
      count(*) filter (where ev.name = 'buy_click') as buys,
      bool_or(ev.name = 'pet_profile_saved') as profile,
      bool_or(ev.name = 'js_error') as error,
      (array_agg(traffic_source(ev.ref, ev.utm_source, ev.browser) order by ev.name <> 'session_start', ev.ts))[1] as source,
      (array_agg(traffic_kind(ev.ref, ev.utm_source, ev.browser) order by ev.name <> 'session_start', ev.ts))[1] as kind,
      (array_agg(ev.props->>'landing' order by ev.ts) filter (where ev.name = 'session_start'))[1] as landing,
      min(ev.device) as device, min(ev.os) as os, min(ev.browser) as browser
    from ev group by ev.session_id
  ),
  page as (
    select s.*, (f.first_ts >= s.started - interval '1 minute') as is_new
    from sess s join firsts f using (device_id)
    order by s.started desc limit greatest(1, least(p_limit, 200)) offset greatest(0, p_offset)
  )
  select jsonb_build_object(
    'total', (select count(*) from sess),
    'rows',  coalesce((select jsonb_agg(page order by page.started desc) from page), '[]')
  ) into out;
  return out;
end $$;
revoke all on function public.analytics_sessions(date, date, text, int, int) from public, anon;
grant execute on function public.analytics_sessions(date, date, text, int, int) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- 7. 보관 기간 — 13개월 지난 기록은 지운다 (개인정보처리방침과 같은 숫자)
-- ══════════════════════════════════════════════════════════════
create or replace function public.analytics_purge() returns int
language sql security definer set search_path = public as $$
  with d as (delete from events where ts < now() - interval '13 months' returning 1)
  select count(*)::int from d
$$;
revoke all on function public.analytics_purge() from public, anon, authenticated;

-- pg_cron 이 켜져 있으면 (Database → Extensions → pg_cron) 매일 새벽 4시(KST)에 돌린다.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'analytics_purge';
    perform cron.schedule('analytics_purge', '0 19 * * *', 'select public.analytics_purge()');
  end if;
end $$;
