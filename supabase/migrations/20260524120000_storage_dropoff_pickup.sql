-- ════════════════════════════════════════════════════════════════════
-- 🏬 중앙 보관소(Storage) 모델 도입 — 직거래 → "맡기고 → 픽업" 2단계 흐름
-- ────────────────────────────────────────────────────────────────────
-- ▸ 비즈니스 로직 변경 배경
--   기존: 양도자(Donor) ↔ 양수자(Receiver) 직거래(P2P) 한 번으로 종료.
--   변경: 어드민이 운영하는 보관소(Storage)를 거치는 2단계 흐름으로 전환.
--
--   새 흐름:
--     ① 양도자 업로드 → status = 'available'
--     ② 양수자 예약 → status = 'reserved' (양수자 -10 크레딧)
--     ③ 양도자가 물품을 보관소에 맡김 → status = 'stored' (양도자 +10 크레딧)
--     ④ 양수자가 보관소에서 픽업 → status = 'completed'
--
--   ※ 양도자에게 보상이 지급되는 시점이 "거래 완료"가 아니라 "보관소 입고" 로
--     앞당겨졌습니다. 보관 시점부터는 양도자가 더 이상 할 일이 없으니까요.
--
-- ▸ 이 마이그레이션이 하는 일
--     1) items.status CHECK 제약을 갱신해 'stored' 값을 허용
--     2) drop_off_to_storage RPC 신설 — reserved → stored (+10 크레딧 to 양도자)
--     3) pickup_from_storage  RPC 신설 — stored   → completed (크레딧 이동 없음)
--
--   기존 complete_handover RPC 는 더 이상 UI에서 호출되지 않지만,
--   과거 데이터/호환을 위해 함수 자체는 남겨둡니다. (필요 시 후속 마이그레이션에서 정리)
--
-- ▸ 적용 방법: Supabase Dashboard → SQL Editor 에 통째로 붙여 실행하세요.
-- ════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 1) items.status CHECK 제약 갱신 — 'stored' 값 허용
-- ─────────────────────────────────────────────────────────────────
-- 기존 제약은 이름이 다를 수 있으므로 information_schema 기반으로
-- "items 테이블의 status 컬럼에 걸린 CHECK"를 모두 떼고 다시 답니다.
-- (멱등 — 여러 번 돌려도 안전)
do $$
declare
  v_conname text;
begin
  for v_conname in
    select c.conname
      from pg_constraint c
      join pg_class      t on t.oid  = c.conrelid
      join pg_namespace  n on n.oid  = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'items'
       and c.contype = 'c'                          -- CHECK 제약만
       and pg_get_constraintdef(c.oid) ilike '%status%'
  loop
    execute format('alter table public.items drop constraint %I', v_conname);
  end loop;
end$$;

-- 'stored' 를 포함한 새 CHECK 제약을 답니다.
alter table public.items
  add constraint items_status_check
  check (status in ('available', 'reserved', 'stored', 'completed'));

comment on column public.items.status is
  '물품의 현재 상태. available → reserved → stored → completed 순으로 진행됩니다.';

-- ─────────────────────────────────────────────────────────────────
-- 2) drop_off_to_storage RPC — 양도자가 "보관소에 맡겼어요" 처리
-- ─────────────────────────────────────────────────────────────────
-- 한 번의 호출로 두 일을 원자적으로 처리:
--   ① items.status: 'reserved' → 'stored'
--   ② profiles.credits += 10  (양도자에게 보상 크레딧 지급)
--
-- 보안:
--   - SECURITY DEFINER 로 RLS(items_update_owner)를 우회하되,
--   - 함수 내부에서 owner_id = auth.uid() 를 직접 검증해
--     "내 물품에 대해서만 호출 가능"을 보장합니다.
--
-- 반환값(jsonb):
--   { ok: true,  new_credits: <적립 후 잔액> }
--   { ok: false, error_code: 'not_authenticated' | 'item_not_found'
--                            | 'not_your_item'   | 'not_reserved' }
create or replace function public.drop_off_to_storage(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id        uuid;
  v_item_owner     uuid;
  v_item_status    text;
  v_new_credits    integer;
  v_payout         constant integer := 10;
begin
  -- ① 로그인 확인
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'not_authenticated');
  end if;

  -- ② 물품 행 잠그고 소유자/상태 확인 (동시에 같은 버튼을 두 번 눌러도 1번만 처리)
  select owner_id, status
    into v_item_owner, v_item_status
  from public.items
  where id = p_item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'item_not_found');
  end if;

  -- ③ 양도자 본인이 호출했는지 검증
  if v_item_owner <> v_user_id then
    return jsonb_build_object('ok', false, 'error_code', 'not_your_item');
  end if;

  -- ④ 'reserved' 상태에서만 보관소 입고 처리 가능
  --    (이미 stored/completed 된 행을 다시 정산해 크레딧이 중복 적립되는 일 방지)
  if v_item_status <> 'reserved' then
    return jsonb_build_object('ok', false, 'error_code', 'not_reserved');
  end if;

  -- ⑤ 원자적으로 두 쓰기 실행
  update public.items
     set status = 'stored'
   where id = p_item_id;

  update public.profiles
     set credits = credits + v_payout
   where id = v_user_id
   returning credits into v_new_credits;

  return jsonb_build_object(
    'ok', true,
    'new_credits', v_new_credits
  );
end;
$$;

revoke all on function public.drop_off_to_storage(uuid) from public;
grant execute on function public.drop_off_to_storage(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 3) pickup_from_storage RPC — 양수자가 "보관소에서 픽업했어요" 처리
-- ─────────────────────────────────────────────────────────────────
-- 한 번의 호출로:
--   ① items.status: 'stored' → 'completed'
-- 크레딧 이동은 없습니다 (양도자 보상은 이미 ③ 단계에서 지급).
--
-- 호출자 검증: items.receiver_id = auth.uid() 인 경우만 통과.
--   ▶ 자기 예약 물품만 픽업 처리할 수 있도록 RPC 안에서 직접 보호합니다.
--
-- 반환값(jsonb):
--   { ok: true }
--   { ok: false, error_code: 'not_authenticated' | 'item_not_found'
--                            | 'not_your_pickup' | 'not_stored' }
create or replace function public.pickup_from_storage(p_item_id uuid)
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

  -- ② 물품 행 잠그고 양수자/상태 읽기
  select receiver_id, status
    into v_item_receiver, v_item_status
  from public.items
  where id = p_item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'item_not_found');
  end if;

  -- ③ "내가 예약한 물품"만 픽업 가능
  if v_item_receiver is distinct from v_user_id then
    return jsonb_build_object('ok', false, 'error_code', 'not_your_pickup');
  end if;

  -- ④ 'stored' 상태에서만 픽업 완료 처리 가능
  if v_item_status <> 'stored' then
    return jsonb_build_object('ok', false, 'error_code', 'not_stored');
  end if;

  -- ⑤ 상태만 완료로 갱신 (크레딧 이동 없음)
  update public.items
     set status = 'completed'
   where id = p_item_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.pickup_from_storage(uuid) from public;
grant execute on function public.pickup_from_storage(uuid) to authenticated;
