-- ════════════════════════════════════════════════════════════════════
-- 🧭 items.receiver_id 도입 + reserve_item/unreserve_item RPC 재정의
-- ────────────────────────────────────────────────────────────────────
-- ▸ 배경: 지금까지 "누가 이 물품을 예약했는가?"는 별도 reservations 테이블의
--   한 줄로만 표현했는데, 양수자 마이페이지(/mypage) 같은 화면에서는 한 번의
--   쿼리로 "내가 예약한 물품들"을 깔끔하게 가져오기 어려웠어요.
--
--   그래서 items 테이블에 receiver_id 컬럼을 두 가지 의도로 추가합니다:
--     · "이 물품을 예약한 사람"을 items 안에서 바로 알 수 있게 함
--     · 마이페이지가 reservations 테이블을 우회하고 items 한 곳만 보면 되게 함
--
--   reservations 테이블은 곧바로 없애지 않고 그대로 둡니다.
--   (기존 코드 중 일부가 아직 이 테이블을 참조하고 있어, 호환을 위해 양쪽 모두 갱신)
--
-- ▸ 이 마이그레이션이 하는 일:
--     1) items.receiver_id (uuid, nullable, FK→auth.users) 추가 + 인덱스
--     2) 기존 reserved 행에 reservations 데이터를 가지고 backfill
--     3) reserve_item RPC 재정의 — items.receiver_id 도 함께 채움
--     4) unreserve_item RPC 신설 — 예약 취소(원자적): receiver_id 비우기 +
--        status='available' 복귀 + 크레딧 10 환불 + reservations 행 삭제
--
-- ▸ 적용 방법: Supabase Dashboard → SQL Editor 에 통째로 붙여 실행하세요.
-- ════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 1) items.receiver_id 컬럼 추가
-- ─────────────────────────────────────────────────────────────────
-- 회원이 탈퇴해도 물품 행은 살려두되 "예약자 정보만 비우는" 동작을 위해
-- ON DELETE SET NULL 로 연결합니다. (반대로 양도자 owner_id는 CASCADE)
alter table public.items
  add column if not exists receiver_id uuid
  references auth.users(id) on delete set null;

comment on column public.items.receiver_id is
  '이 물품을 예약한 양수자(receiver)의 user_id. 예약 전/취소 후에는 NULL.';

-- 마이페이지 양수자 뷰의 핵심 쿼리:
--   select * from items where receiver_id = $1 and status = 'reserved'
-- 위 두 컬럼을 묶은 부분 인덱스로 빠르게 응답하게 함.
create index if not exists items_receiver_id_status_idx
  on public.items (receiver_id, status)
  where receiver_id is not null;

-- ─────────────────────────────────────────────────────────────────
-- 2) 기존 reserved 물품 백필
-- ─────────────────────────────────────────────────────────────────
-- 마이그레이션 적용 전에 예약된 행은 receiver_id 가 NULL 상태입니다.
-- 정답이 이미 reservations 테이블에 있으니, 거기서 user_id를 가져와 채워줍니다.
update public.items i
   set receiver_id = r.user_id
  from public.reservations r
 where i.id = r.item_id
   and i.receiver_id is null
   and i.status = 'reserved';

-- ─────────────────────────────────────────────────────────────────
-- 3) reserve_item 재정의 — receiver_id 도 함께 저장
-- ─────────────────────────────────────────────────────────────────
-- 이전 버전과 동일한 시그니처/반환 형태를 유지하고,
-- "items UPDATE" 한 줄에 receiver_id 만 새로 추가합니다.
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

  -- ⑤ 프로필 행 잠그고 잔액 확인
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

  -- ⑥ 모든 검사 통과 — 원자적으로 모든 쓰기 실행
  --    receiver_id 도 함께 채워 mypage가 items 한 테이블만 봐도 되게 함.
  update public.items
     set status      = 'reserved',
         receiver_id = v_user_id
   where id = p_item_id;

  update public.profiles
     set credits = credits - v_cost
   where id = v_user_id;

  -- ⑦ reservations 동기 — 아직 이 테이블을 참조하는 다른 페이지 호환 유지
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
-- 4) unreserve_item — 예약 취소를 원자적으로 처리
-- ─────────────────────────────────────────────────────────────────
-- 동기·환불을 모두 하나의 트랜잭션 안에서:
--   · items.receiver_id 를 NULL 로
--   · items.status 를 'available' 로 되돌림
--   · profiles.credits 에 10 환불
--   · reservations 의 해당 행 삭제 (다른 페이지 호환)
--
-- 호출자 검증: items.receiver_id = auth.uid() 인 경우만 통과.
--   ▶ 자기 예약만 취소할 수 있도록 RPC 안에서 직접 보호합니다.
--
-- 반환:
--   { ok: true, new_credits: <환불 후 잔액> }
--   { ok: false, error_code: 'not_authenticated' | 'item_not_found'
--                            | 'not_reserved_by_you' }
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
  v_refund           constant integer := 10;
begin
  -- ① 로그인 확인
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'not_authenticated');
  end if;

  -- ② 물품 행 잠그고 예약자/상태 읽기
  select receiver_id, status
    into v_item_receiver, v_item_status
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

  -- ⑤ 원자적으로 모든 되돌림
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
