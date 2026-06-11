-- ════════════════════════════════════════════════════════════════════
-- 🤝 complete_handover RPC — 양도자가 "거래 완료" 처리하는 정산 함수
-- ────────────────────────────────────────────────────────────────────
-- ▸ 시나리오:
--   양도자(Donor)가 물품을 실제로 양수자(Receiver)에게 건네주고 나면,
--   마이페이지의 "거래 완료" 버튼을 눌러 순환을 마무리합니다.
--
--   이 한 번의 클릭으로 두 가지 일이 동시에 일어나야 해요:
--     ① items.status: 'reserved' → 'completed'  (시스템 상태 갱신)
--     ② profiles.credits += 10                  (양도자에게 보상 크레딧 적립)
--
--   두 작업은 반드시 묶여야 합니다. 한 쪽만 성공하면
--   "크레딧은 받았는데 시스템엔 거래 미완료" 같은 어긋남이 생기니까요.
--
-- ▸ 보안:
--   - SECURITY DEFINER 로 정의해 RLS(items_update_owner)를 우회하되,
--   - 함수 안에서 직접 owner_id = auth.uid() 검증을 수행해
--     "내 물품에 대해서만 호출 가능"을 보장합니다.
--
-- ▸ 반환값(jsonb):
--   { ok: true,  new_credits: <적립 후 잔액> }
--   { ok: false, error_code: 'not_authenticated' | 'item_not_found'
--                            | 'not_your_item'   | 'not_reserved' }
-- ════════════════════════════════════════════════════════════════════

create or replace function public.complete_handover(p_item_id uuid)
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

  -- ④ 현재 'reserved' 상태에서만 거래 완료로 넘길 수 있음
  --    ('available' 단계에서 임의로 완료 처리하거나, 이미 'completed' 된 행을
  --     두 번 정산해서 크레딧이 중복 적립되는 일을 막아요)
  if v_item_status <> 'reserved' then
    return jsonb_build_object('ok', false, 'error_code', 'not_reserved');
  end if;

  -- ⑤ 원자적으로 두 쓰기 실행
  update public.items
     set status = 'completed'
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

revoke all on function public.complete_handover(uuid) from public;
grant execute on function public.complete_handover(uuid) to authenticated;
