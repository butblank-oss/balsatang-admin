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
-- 3. 대시보드 — 기간을 받아 화면에 필요한 숫자를 한 번에 돌려준다
-- ══════════════════════════════════════════════════════════════
create or replace function public.analytics_dashboard(p_from date, p_to date)
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
  ev  as (select * from events where ts >= t0 and ts < t1),
  pev as (select * from events where ts >= q0 and ts < t0),
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
    select distinct on (session_id) session_id, device_id, ref, utm_source, utm_medium, utm_campaign, props->>'landing' as landing
    from ev where name = 'session_start' order by session_id, ts
  ),
  sess_buy as (select distinct session_id from ev where name = 'buy_click'),
  sources as (
    select coalesce(nullif(s.utm_source, ''), nullif(s.ref, ''), '(직접 방문)') as source,
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
    'range',     jsonb_build_object('from', p_from, 'to', p_to, 'days', span),
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

revoke all on function public.analytics_dashboard(date, date) from public, anon;
grant execute on function public.analytics_dashboard(date, date) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- 4. 보관 기간 — 13개월 지난 기록은 지운다 (개인정보처리방침과 같은 숫자)
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
