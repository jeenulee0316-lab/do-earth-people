-- ════════════════════════════════════════════════════════════════════
-- 🔓 마이페이지 "받을 물품" 빈 화면 수정 — receiver SELECT 정책 + receiver_id 보강
-- ────────────────────────────────────────────────────────────────────
-- ▸ 증상: 예약은 되는데(크레딧 차감·status='reserved'·어드민엔 보임) 사용자
--   마이페이지의 "받을 물품" 탭이 텅 비어 보임.
--
-- ▸ 원인 분석(정확히):
--   (a) RLS 는 사실 범인이 아니에요. items 의 SELECT 정책은 `items_select_all`
--       = USING (true) 라서 "누구나 모든 행 읽기 가능"입니다. 즉 receiver 도
--       reserved 행을 읽을 수 있어요.  ← 그래도 혹시 모를 환경(누가 정책을 손댄
--       경우 등)을 위해, 이 마이그레이션은 receiver 전용 SELECT 정책을 "명시적으로"
--       하나 더 추가해 방어선을 둡니다. (정책은 OR 로 합쳐지므로 추가는 항상 안전)
--   (b) 진짜 원인: items.receiver_id 가 NULL. 마이페이지 쿼리는
--         where receiver_id = 나 and status = 'reserved'
--       이므로, 예약 시 receiver_id 가 안 채워지면 결과가 0건이 됩니다.
--       reserve_item RPC 가 receiver_id 를 채우도록 보장하고(아래 재정의),
--       이미 비어버린 기존 행은 reservations 에서 backfill 합니다.
--
-- ▸ 이 파일은 "통째로 한 번 붙여넣으면 끝"이 되도록 자급자족형으로 작성했어요.
--   (reserve_item 은 직전 PIN 마이그레이션과 동일 본문 — create or replace 라 멱등)
--
-- ▸ 적용 방법: Supabase Dashboard → SQL Editor 에 통째로 붙여 실행하세요.
-- ════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 1) receiver 전용 SELECT 정책 (명시적 방어선)
-- ─────────────────────────────────────────────────────────────────
-- 기존 items_select_all(USING true) 이 살아 있는 한 동작은 그대로지만,
-- "예약자는 자기 행을 반드시 읽을 수 있다"를 정책으로 못박아 둡니다. 혹시
-- 나중에 items_select_all 을 좁히더라도 마이페이지가 깨지지 않게 하는 안전장치예요.
drop policy if exists "items_select_receiver" on public.items;

create policy "items_select_receiver"
  on public.items for select
  to authenticated
  using (auth.uid() = receiver_id);

-- ─────────────────────────────────────────────────────────────────
-- 2) reserve_item 재확인 — 예약 시 receiver_id(+PIN) 를 반드시 채움
-- ─────────────────────────────────────────────────────────────────
-- 이 한 줄(receiver_id = v_user_id)이 빠지면 마이페이지가 빈 화면이 됩니다.
-- verification_code 4자리 PIN 발급도 함께 유지합니다.
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
  v_cost             constant integer := 10;
  v_pin              text;
begin
  -- ① 로그인 확인
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'not_authenticated');
  end if;

  -- ② 물품 행 잠그고 상태/소유자 읽기 (동시 예약 직렬화)
  select owner_id, status
    into v_item_owner, v_item_status
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
  --    ⚠️ receiver_id 를 꼭 채워야 마이페이지(받을 물품)에 보입니다.
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
-- 3) 이미 예약됐지만 receiver_id 가 비어버린 행 복구 (멱등 backfill)
-- ─────────────────────────────────────────────────────────────────
-- 버그가 살아 있던 동안 예약된 행을 reservations 테이블의 정답으로 되살립니다.
-- 이걸 돌려야 "지금 텅 빈" 마이페이지의 기존 예약이 다시 나타납니다.
update public.items i
   set receiver_id = r.user_id
  from public.reservations r
 where i.id = r.item_id
   and i.receiver_id is null
   and i.status = 'reserved';
