-- ════════════════════════════════════════════════════════════════════
-- 💰 물품별 크레딧 가격(price) — 운영팀이 입고 시 직접 설정
-- ────────────────────────────────────────────────────────────────────
-- ▸ 배경: 지금까지 모든 예약은 "10 크레딧 고정"이었어요(reserve_item 안의
--   상수 v_cost := 10). 이제 운영팀이 물품마다 가격을 다르게 매길 수 있도록
--   items 에 price 컬럼을 두고, 예약(차감)·예약취소(환불)가 이 값을 따르게 합니다.
--
-- ▸ 이 마이그레이션이 하는 일
--     1) items.price (integer, not null, default 10, >= 0) 컬럼 추가
--        - 기존 행은 모두 10 으로 backfill (default 가 채워줌)
--     2) reserve_item 갱신 — 고정 10 대신 그 물품의 price 만큼 차감
--        (receiver_id 기록 + 4자리 PIN 발급은 그대로 유지)
--     3) unreserve_item 갱신 — 고정 10 대신 그 물품의 price 만큼 환불
--        ⚠️ 차감과 환불이 같은 값(price)을 쓰지 않으면 크레딧이 새어나가요.
--
-- ▸ 적용 방법: Supabase Dashboard → SQL Editor 에 통째로 붙여 실행하세요.
-- ════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 1) items.price 컬럼 추가 (멱등 — IF NOT EXISTS)
-- ─────────────────────────────────────────────────────────────────
alter table public.items
  add column if not exists price integer not null default 10;

-- 가격은 음수가 될 수 없습니다 (0 = 무료 나눔 허용).
alter table public.items
  drop constraint if exists items_price_nonneg;
alter table public.items
  add constraint items_price_nonneg check (price >= 0);

comment on column public.items.price is
  '이 물품을 예약할 때 차감되는 크레딧 가격. 운영팀이 입고 시 설정. 기본 10.';

-- ─────────────────────────────────────────────────────────────────
-- 2) reserve_item 갱신 — 물품의 price 만큼 차감
-- ─────────────────────────────────────────────────────────────────
-- 직전 버전과 동일하게 receiver_id 기록 + 4자리 PIN 발급을 유지하고,
-- 비용(v_cost)만 상수 10 → 잠근 물품 행의 price 값에서 읽어오도록 바꿉니다.
create or replace function public.reserve_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id          uuid;
  v_item_owner       uuid;
  v_item_status      text;
  v_current_credits  integer;
  v_cost             integer;   -- 물품별 가격(price)을 담는다 (더 이상 상수 아님)
  v_pin              text;
begin
  -- ① 로그인 확인
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'not_authenticated');
  end if;

  -- ② 물품 행 잠그고 상태/소유자/가격 읽기 (동시 예약 직렬화)
  select owner_id, status, price
    into v_item_owner, v_item_status, v_cost
  from public.items
  where id = p_item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'item_not_found');
  end if;

  -- ③ 양수 가능 상태가 아니면 거절
  if v_item_status <> 'available' then
    return jsonb_build_object('ok', false, 'error_code', 'item_unavailable');
  end if;

  -- ④ 양도자 본인은 예약 불가
  if v_item_owner = v_user_id then
    return jsonb_build_object('ok', false, 'error_code', 'own_item');
  end if;

  -- ⑤ 프로필 잠그고 잔액 확인
  select credits
    into v_current_credits
  from public.profiles
  where id = v_user_id
  for update;

  if v_current_credits is null then
    return jsonb_build_object('ok', false, 'error_code', 'profile_not_found');
  end if;

  if v_current_credits < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'insufficient_credits',
      'current_credits', v_current_credits
    );
  end if;

  -- ⑥ 픽업 본인 확인용 4자리 PIN 생성 (0000~9999, 앞자리 0 보존)
  v_pin := lpad((floor(random() * 10000))::int::text, 4, '0');

  -- ⑦ 원자적 쓰기 — status + receiver_id + PIN 을 한 번에.
  update public.items
     set status            = 'reserved',
         receiver_id       = v_user_id,
         verification_code = v_pin
   where id = p_item_id;

  update public.profiles
     set credits = credits - v_cost
   where id = v_user_id;

  insert into public.reservations (user_id, item_id)
  values (v_user_id, p_item_id);

  return jsonb_build_object(
    'ok', true,
    'new_credits', v_current_credits - v_cost
  );
end;
$$;

revoke all on function public.reserve_item(uuid) from public;
grant execute on function public.reserve_item(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 3) unreserve_item 갱신 — 물품의 price 만큼 환불
-- ─────────────────────────────────────────────────────────────────
-- 차감 때와 동일한 금액(price)을 돌려줘야 크레딧 총량이 보존됩니다.
create or replace function public.unreserve_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id          uuid;
  v_item_receiver    uuid;
  v_item_status      text;
  v_current_credits  integer;
  v_refund           integer;   -- 물품별 가격(price)을 환불액으로 사용
begin
  -- ① 로그인 확인
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'not_authenticated');
  end if;

  -- ② 물품 행 잠그고 예약자/상태/가격 읽기
  select receiver_id, status, price
    into v_item_receiver, v_item_status, v_refund
  from public.items
  where id = p_item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'item_not_found');
  end if;

  -- ③ "내가 예약한 물품"만 취소 가능
  if v_item_receiver is distinct from v_user_id or v_item_status <> 'reserved' then
    return jsonb_build_object('ok', false, 'error_code', 'not_reserved_by_you');
  end if;

  -- ④ 내 프로필 잠그고 환불용 잔액 읽기
  select credits
    into v_current_credits
  from public.profiles
  where id = v_user_id
  for update;

  -- ⑤ 원자적으로 모든 되돌림 (status/receiver_id 복귀 + price 만큼 환불)
  update public.items
     set status      = 'available',
         receiver_id = null
   where id = p_item_id;

  update public.profiles
     set credits = credits + v_refund
   where id = v_user_id;

  -- reservations 호환: 이 사용자/물품 조합의 모든 줄 정리
  delete from public.reservations
   where user_id = v_user_id and item_id = p_item_id;

  return jsonb_build_object(
    'ok', true,
    'new_credits', coalesce(v_current_credits, 0) + v_refund
  );
end;
$$;

revoke all on function public.unreserve_item(uuid) from public;
grant execute on function public.unreserve_item(uuid) to authenticated;
