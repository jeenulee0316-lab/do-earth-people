-- ════════════════════════════════════════════════════════════════════
-- 🗓️ 보관소 방문 예약(Scheduling) — 양도자/양수자가 "며칠, 어느 시간대에 올지" 입력
-- ────────────────────────────────────────────────────────────────────
-- ▸ 배경: 운영팀(어드민)은 "누가 언제 보관소에 오는지"를 알아야 현장 인력을
--   배치하고 혼잡을 피할 수 있어요. 자유 입력(분 단위) 대신, 운영팀이 관리하기
--   쉽도록 "날짜 + 미리 정해진 시간대(예: 13:00~14:00)" 두 조각으로 받습니다.
--
--     · dropoff_date / dropoff_time_slot : 양도자가 물품을 "맡기러 올" 날짜·시간대
--                                          (status = 'reserved' 단계에서 양도자가 입력)
--     · pickup_date  / pickup_time_slot  : 양수자가 물품을 "찾으러 올" 날짜·시간대
--                                          (status = 'stored' 단계에서 양수자가 입력)
--
-- ▸ 이 마이그레이션이 하는 일
--     1) items 테이블에 위 네 컬럼 추가 (모두 NULL 허용 — 선택 입력)
--     2) set_dropoff_schedule RPC 신설 — 양도자 본인 + 'reserved' 상태에서만
--     3) set_pickup_schedule  RPC 신설 — 양수자 본인 + 'stored' 상태에서만
--     4) admin_list_storage_items RPC 갱신 — 위 네 컬럼을 함께 내려주도록 재정의
--
-- ▸ 시간대(time slot)는 프론트엔드 드롭다운과 동일한 네 값만 허용:
--     '13:00~14:00', '14:00~15:00', '15:00~16:00', '16:00~17:00'
--
-- ▸ 적용 방법: Supabase Dashboard → SQL Editor 에 통째로 붙여 실행하세요.
-- ════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 0) (정리) 이전 자유입력(분 단위) 방식의 흔적 제거 — 멱등
-- ─────────────────────────────────────────────────────────────────
-- 이 기능의 초기 버전은 timestamptz 한 컬럼(expected_*_time)에 자유 시각을
-- 저장했어요. 운영팀 요청으로 "날짜 + 정해진 시간대" 방식으로 바꾸면서,
-- 혹시 이전 버전을 이미 적용한 DB가 있다면 옛 함수/컬럼을 깔끔히 정리합니다.
-- (아직 커밋·운영 전 단계의 임시 데이터라 안전하게 제거)
drop function if exists public.set_expected_dropoff_time(uuid, timestamptz);
drop function if exists public.set_expected_pickup_time(uuid, timestamptz);
alter table public.items
  drop column if exists expected_dropoff_time,
  drop column if exists expected_pickup_time;

-- ─────────────────────────────────────────────────────────────────
-- 1) items 테이블에 예약 날짜·시간대 네 컬럼 추가 (멱등 — IF NOT EXISTS)
-- ─────────────────────────────────────────────────────────────────
alter table public.items
  add column if not exists dropoff_date      date,
  add column if not exists dropoff_time_slot text,
  add column if not exists pickup_date       date,
  add column if not exists pickup_time_slot  text;

comment on column public.items.dropoff_date is
  '양도자가 물품을 보관소에 맡기러 올 날짜 (reserved 단계에서 입력). NULL이면 아직 미정.';
comment on column public.items.dropoff_time_slot is
  '양도자 입고 예정 시간대 (예: 13:00~14:00). NULL이면 아직 미정.';
comment on column public.items.pickup_date is
  '양수자가 물품을 찾으러 올 날짜 (stored 단계에서 입력). NULL이면 아직 미정.';
comment on column public.items.pickup_time_slot is
  '양수자 픽업 예정 시간대 (예: 13:00~14:00). NULL이면 아직 미정.';

-- ─────────────────────────────────────────────────────────────────
-- 2) set_dropoff_schedule RPC — 양도자가 입고 예약(날짜+시간대)을 저장
-- ─────────────────────────────────────────────────────────────────
-- 보안: SECURITY DEFINER 로 RLS 를 우회하되, 함수 안에서 owner_id = auth.uid()
--       를 직접 검증해 "내 물품에 대해서만" 호출 가능하도록 보호합니다.
--
-- 'reserved' 상태에서만 허용 — 아직 보관소에 맡기기 전 단계에서만 의미가 있어요.
-- p_date / p_time_slot 둘 다 NULL 을 넘기면 "예약 지우기(미정으로 되돌리기)".
-- 시간대는 미리 정해진 네 값만 허용 (그 외 값은 invalid_time_slot 오류).
--
-- 반환값(jsonb):
--   { ok: true }
--   { ok: false, error_code: 'not_authenticated' | 'item_not_found'
--                            | 'not_your_item' | 'not_reserved' | 'invalid_time_slot' }
create or replace function public.set_dropoff_schedule(
  p_item_id   uuid,
  p_date      date,
  p_time_slot text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id     uuid;
  v_item_owner  uuid;
  v_item_status text;
begin
  -- ① 로그인 확인
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'not_authenticated');
  end if;

  -- ② 시간대 유효성 검사 (NULL 은 "미정"으로 허용, 값이 있으면 정해진 네 값만)
  if p_time_slot is not null
     and p_time_slot not in ('13:00~14:00', '14:00~15:00', '15:00~16:00', '16:00~17:00') then
    return jsonb_build_object('ok', false, 'error_code', 'invalid_time_slot');
  end if;

  -- ③ 물품 행 잠그고 소유자/상태 읽기
  select owner_id, status
    into v_item_owner, v_item_status
  from public.items
  where id = p_item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'item_not_found');
  end if;

  -- ④ 양도자 본인인지 검증
  if v_item_owner <> v_user_id then
    return jsonb_build_object('ok', false, 'error_code', 'not_your_item');
  end if;

  -- ⑤ 'reserved' 단계에서만 입고 예약을 잡을 수 있음
  if v_item_status <> 'reserved' then
    return jsonb_build_object('ok', false, 'error_code', 'not_reserved');
  end if;

  -- ⑥ 예약 저장 (NULL 이면 미정으로 초기화)
  update public.items
     set dropoff_date      = p_date,
         dropoff_time_slot = p_time_slot
   where id = p_item_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_dropoff_schedule(uuid, date, text) from public;
grant execute on function public.set_dropoff_schedule(uuid, date, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 3) set_pickup_schedule RPC — 양수자가 픽업 예약(날짜+시간대)을 저장
-- ─────────────────────────────────────────────────────────────────
-- 호출자 검증: items.receiver_id = auth.uid() 인 경우만 통과.
-- 'stored' 상태에서만 허용 — 보관소에 입고된 뒤 픽업 일정을 잡는 단계.
--
-- 반환값(jsonb):
--   { ok: true }
--   { ok: false, error_code: 'not_authenticated' | 'item_not_found'
--                            | 'not_your_pickup' | 'not_stored' | 'invalid_time_slot' }
create or replace function public.set_pickup_schedule(
  p_item_id   uuid,
  p_date      date,
  p_time_slot text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id        uuid;
  v_item_receiver  uuid;
  v_item_status    text;
begin
  -- ① 로그인 확인
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'not_authenticated');
  end if;

  -- ② 시간대 유효성 검사 (NULL 은 "미정"으로 허용)
  if p_time_slot is not null
     and p_time_slot not in ('13:00~14:00', '14:00~15:00', '15:00~16:00', '16:00~17:00') then
    return jsonb_build_object('ok', false, 'error_code', 'invalid_time_slot');
  end if;

  -- ③ 물품 행 잠그고 양수자/상태 읽기
  select receiver_id, status
    into v_item_receiver, v_item_status
  from public.items
  where id = p_item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'item_not_found');
  end if;

  -- ④ "내가 예약한 물품"만 픽업 일정을 잡을 수 있음
  if v_item_receiver is distinct from v_user_id then
    return jsonb_build_object('ok', false, 'error_code', 'not_your_pickup');
  end if;

  -- ⑤ 'stored' 단계에서만 픽업 예약을 잡을 수 있음
  if v_item_status <> 'stored' then
    return jsonb_build_object('ok', false, 'error_code', 'not_stored');
  end if;

  -- ⑥ 예약 저장 (NULL 이면 미정으로 초기화)
  update public.items
     set pickup_date      = p_date,
         pickup_time_slot = p_time_slot
   where id = p_item_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_pickup_schedule(uuid, date, text) from public;
grant execute on function public.set_pickup_schedule(uuid, date, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 4) admin_list_storage_items RPC 갱신 — 예약 날짜·시간대 네 컬럼 추가 반환
-- ─────────────────────────────────────────────────────────────────
-- 기존 함수에 dropoff/pickup 의 날짜·시간대를 더해, 운영팀 대시보드가
-- "언제(며칠 몇 시대) 누가 오는지"를 표에 표시할 수 있게 합니다.
--
-- ⚠️ RETURNS TABLE(반환 컬럼 구성)이 바뀌므로 CREATE OR REPLACE 만으로는
--    "cannot change return type of existing function" 오류가 납니다.
--    그래서 기존 함수를 먼저 DROP 한 뒤 새로 만듭니다.
drop function if exists public.admin_list_storage_items();

create or replace function public.admin_list_storage_items()
returns table (
  id                 uuid,
  title              text,
  category           text,
  condition          text,
  status             text,
  created_at         timestamptz,
  -- 🗓️ 예약 날짜·시간대 (입고/출고 탭에서 각각 표시)
  dropoff_date       date,
  dropoff_time_slot  text,
  pickup_date        date,
  pickup_time_slot   text,
  -- 양도자(Donor) 정보 — 물품을 맡기러 오는 사람
  donor_nickname     text,
  donor_email        text,
  -- 양수자(Receiver) 정보 — 물품을 찾으러 오는 사람
  receiver_nickname  text,
  receiver_email     text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- ① 권한 게이트 — 호출자가 admin 이 아니면 즉시 차단.
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'not_authorized'
      using errcode = '42501';   -- insufficient_privilege
  end if;

  -- ② 보관소를 거치는 두 상태(reserved/stored)의 물품을 예약 정보와 함께.
  return query
  select
    i.id,
    i.title,
    i.category,
    i.condition,
    i.status,
    i.created_at,
    i.dropoff_date,
    i.dropoff_time_slot,
    i.pickup_date,
    i.pickup_time_slot,
    dp.nickname        as donor_nickname,
    du.email::text     as donor_email,
    rp.nickname        as receiver_nickname,
    ru.email::text     as receiver_email
  from public.items i
    left join public.profiles dp on dp.id = i.owner_id      -- 양도자 프로필
    left join auth.users      du on du.id = i.owner_id      -- 양도자 계정(이메일)
    left join public.profiles rp on rp.id = i.receiver_id   -- 양수자 프로필
    left join auth.users      ru on ru.id = i.receiver_id   -- 양수자 계정(이메일)
  where i.status in ('reserved', 'stored')
  order by i.created_at desc;
end;
$$;

revoke all on function public.admin_list_storage_items() from public;
grant execute on function public.admin_list_storage_items() to authenticated;
