-- ════════════════════════════════════════════════════════════════════
-- 🎁 reserve_kit — 웰컴 키트 한 번에 예약(원자적)
-- ────────────────────────────────────────────────────────────────────
-- ▸ 배경: 탐색 페이지에서 사용자가 "웰컴 키트"를 통째로 예약합니다. 단품 예약
--   (reserve_item)과 똑같이, "검사 + 모든 쓰기"를 한 트랜잭션으로 묶어야
--   중간에 끊겨도 데이터가 어긋나지 않아요.
--
-- ▸ 한 호출 안에서 하는 일:
--     ① 로그인 확인
--     ② 키트 존재 + status = 'active'(예약 가능) 확인 (행 잠금)
--     ③ 키트 안 '아직 available 인' 구성품 수를 세어 총비용 계산
--          · 총비용 = 10크레딧 × (예약 가능한 구성품 수)  ← 변동 요금
--     ④ 크레딧 잔액 ≥ 총비용 인지 확인
--     ⑤ kits.status = 'reserved' 로 갱신
--     ⑥ 키트 안의 '아직 available 인' 물품들을 모두 'reserved' 로:
--          · receiver_id = 나, verification_code = 4자리 PIN(픽업 본인확인)
--          · reservations 테이블에도 한 줄씩 INSERT (단품과 동일한 자료구조)
--     ⑦ 총비용만큼 크레딧 차감
--
-- ▸ 반환값(jsonb):
--     { ok: true,  reserved_count: <예약된 물품 수>, cost: <차감액>, new_credits }
--     { ok: false, error_code: 'not_authenticated' | 'kit_not_found'
--                              | 'kit_unavailable' | 'kit_empty'
--                              | 'profile_not_found' | 'insufficient_credits',
--                  current_credits?, cost? }
--
-- ▸ 💡 비용 정책: "구성품 1개당 10크레딧"의 변동 요금입니다. 즉 구성품이 3개면
--     30크레딧이 차감돼요. 단가를 바꾸려면 아래 v_cost_per_item 상수만 고치면 됩니다.
--     (프론트 KitCard 도 같은 식(구성품 수 × 10)으로 미리 보여주니, 단가를 바꾸면
--      KitCard 의 CREDIT_PER_ITEM 도 함께 맞춰주세요.)
--
-- ▸ 적용 방법: Supabase Dashboard → SQL Editor 에 통째로 붙여 실행하세요.
--   (kits 테이블 + RLS 가 먼저 있어야 합니다 — 20260618120000 마이그레이션 참고)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.reserve_kit(p_kit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id         uuid;
  v_kit_status      text;
  v_current_credits integer;
  v_cost_per_item   constant integer := 10;  -- 구성품 1개당 단가(크레딧). 단가 바뀌면 여기만 수정.
  v_available_count integer;                 -- 키트 안 '아직 available 인' 구성품 수
  v_cost            integer;                 -- 총비용 = 단가 × 구성품 수 (변동)
  v_reserved_count  integer;
begin
  -- ① 로그인된 사용자만 호출 가능
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'not_authenticated');
  end if;

  -- ② 키트 행을 잠그고(=동시 예약 직렬화) 상태 읽기
  --    FOR UPDATE 로 두 사용자가 동시에 같은 키트를 예약해도 한 명만 통과합니다.
  select status
    into v_kit_status
  from public.kits
  where id = p_kit_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'kit_not_found');
  end if;

  -- ③ 'active'(예약 가능) 상태가 아니면 거절 (이미 예약된 키트 등)
  if v_kit_status <> 'active' then
    return jsonb_build_object('ok', false, 'error_code', 'kit_unavailable');
  end if;

  -- ④ 키트 안 '아직 available 인' 구성품 수를 세어 총비용을 계산.
  --    (키트 행을 이미 FOR UPDATE 로 잠갔으므로, 같은 키트의 또 다른 예약은 직렬화됨)
  --    총비용 = 단가(10) × 구성품 수 → 구성품이 많을수록 더 많은 크레딧이 듭니다.
  select count(*)
    into v_available_count
  from public.items
  where kit_id = p_kit_id
    and status = 'available';

  if v_available_count = 0 then
    -- 예약 가능한 구성품이 하나도 없음(사실상 빈 키트) — 차감/예약할 게 없으니 거절.
    return jsonb_build_object('ok', false, 'error_code', 'kit_empty');
  end if;

  v_cost := v_available_count * v_cost_per_item;

  -- ⑤ 프로필 잠그고 잔액이 총비용 이상인지 확인
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
      'current_credits', v_current_credits,
      'cost', v_cost
    );
  end if;

  -- ⑥ 키트를 '예약됨'으로 — 탐색 목록(active 만 노출)에서 자연히 사라집니다.
  update public.kits
     set status = 'reserved'
   where id = p_kit_id;

  -- ⑦ 키트 안의 '아직 available 인' 물품만 reserved 로 전환하고,
  --    각 물품을 reservations 에도 한 줄씩 기록합니다(마이페이지가 이 표를 봅니다).
  --    데이터 수정 CTE 가 확실히 실행되도록, 마지막 SELECT 가 ins 를 참조하게 둡니다.
  with reserved as (
    update public.items
       set status            = 'reserved',
           receiver_id       = v_user_id,
           verification_code = lpad((floor(random() * 10000))::int::text, 4, '0')
     where kit_id = p_kit_id
       and status = 'available'
    returning id
  ),
  ins as (
    insert into public.reservations (user_id, item_id)
    select v_user_id, id from reserved
    returning item_id
  )
  select count(*) into v_reserved_count from ins;

  -- ⑧ 총비용(단가 × 구성품 수)만큼 크레딧 차감
  update public.profiles
     set credits = credits - v_cost
   where id = v_user_id;

  return jsonb_build_object(
    'ok', true,
    'reserved_count', v_reserved_count,
    'cost', v_cost,
    'new_credits', v_current_credits - v_cost
  );
end;
$$;

-- SECURITY DEFINER 함수 — PUBLIC 자동 EXECUTE 차단 후 로그인 사용자에게만 부여.
revoke all on function public.reserve_kit(uuid) from public;
grant execute on function public.reserve_kit(uuid) to authenticated;
