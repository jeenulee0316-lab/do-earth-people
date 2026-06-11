-- ════════════════════════════════════════════════════════════════════
-- 🔐 픽업 인증 코드(Pickup Verification PIN) — 현장 본인 확인 시스템
-- ────────────────────────────────────────────────────────────────────
-- ▸ 배경: 사용자가 보관소(오프라인 거점)에 와서 물품을 찾아갈 때, "정말 예약한
--   본인이 맞는지"를 운영팀이 확인할 방법이 필요해요. 그래서 예약 시점에 4자리
--   숫자 PIN(예: '4928')을 자동 발급하고, 사용자 마이페이지에만 보여줍니다.
--   픽업 현장에서 사용자가 이 PIN 을 운영팀에게 불러주면, 운영팀이 대시보드에
--   입력 → DB 에 저장된 코드와 일치할 때만 "수령 완료" 처리가 됩니다.
--
-- ▸ 이 마이그레이션이 하는 일
--     1) items 테이블에 verification_code (varchar(10)) 컬럼 추가
--     2) reserve_item 갱신 — 예약 성공 시 4자리 PIN 을 자동 생성·저장
--     3) admin_complete_pickup 갱신 — PIN(p_code) 을 받아 일치할 때만 완료 처리
--        (틀리면 error_code = 'incorrect_pin' 반환)
--
-- ▸ 보안 메모: 발급된 PIN 은 "예약한 사용자 본인"만 자기 마이페이지에서 볼 수
--   있어요(items 의 receiver 본인 SELECT). 운영팀 대시보드 목록(admin_list_storage_items)
--   에는 일부러 코드를 내려주지 않습니다 — 그래야 "사용자가 코드를 불러줘야만
--   완료된다"는 본인 확인의 의미가 살아납니다.
--
-- ▸ 적용 방법: Supabase Dashboard → SQL Editor 에 통째로 붙여 실행하세요.
-- ════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 1) items 테이블에 verification_code 컬럼 추가 (멱등 — IF NOT EXISTS)
-- ─────────────────────────────────────────────────────────────────
alter table public.items
  add column if not exists verification_code varchar(10);

comment on column public.items.verification_code is
  '픽업 본인 확인용 4자리 PIN. 예약(reserve_item) 시 자동 발급되며, 예약한 사용자 본인만 마이페이지에서 확인. NULL이면 아직 미발급(예약 전).';

-- ─────────────────────────────────────────────────────────────────
-- 1.5) (복구) receiver_id 가 비어버린 reserved 행 backfill
-- ─────────────────────────────────────────────────────────────────
-- 이 마이그레이션의 초기 버전이 reserve_item 을 옛 코드 기준으로 다시 쓰면서
-- receiver_id 를 채우는 줄이 잠깐 빠졌던 적이 있어요. 그 사이 예약된 행은
-- receiver_id 가 NULL 이라 마이페이지(받을 물품)에 안 보입니다. 정답이 아직
-- reservations 테이블에 남아 있으니, 거기서 user_id 를 가져와 되살립니다. (멱등)
update public.items i
   set receiver_id = r.user_id
  from public.reservations r
 where i.id = r.item_id
   and i.receiver_id is null
   and i.status = 'reserved';

-- ─────────────────────────────────────────────────────────────────
-- 2) reserve_item 갱신 — 예약 성공 시 4자리 PIN 자동 발급
-- ─────────────────────────────────────────────────────────────────
-- 기존 로직(크레딧 차감 + 상태 변경 + reservations INSERT)은 그대로 두고,
-- items.status 를 'reserved' 로 바꾸는 그 UPDATE 에서 verification_code 도 함께
-- 채웁니다. PIN 은 0000~9999 사이 난수를 4자리(앞자리 0 보존)로 만들어요.
--   예) floor(random()*10000) = 928  →  lpad('928', 4, '0') = '0928'
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
  -- ① 로그인된 사용자만 호출 가능
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'not_authenticated');
  end if;

  -- ② 물품 행을 잠그고(=다른 동시 예약 차단) 상태/소유자 읽기
  select owner_id, status
    into v_item_owner, v_item_status
  from public.items
  where id = p_item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'item_not_found');
  end if;

  -- ③ 물품이 '양수 가능' 상태가 아니면 거절
  if v_item_status <> 'available' then
    return jsonb_build_object('ok', false, 'error_code', 'item_unavailable');
  end if;

  -- ④ 양도자 본인은 자기 물품을 예약할 수 없음
  if v_item_owner = v_user_id then
    return jsonb_build_object('ok', false, 'error_code', 'own_item');
  end if;

  -- ⑤ 사용자 프로필 행을 잠그고 잔액 읽기
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

  -- ⑦ 모든 검사 통과 — 상태 변경(+예약자 기록 +PIN 발급) + 크레딧 차감
  --    + reservations INSERT 를 한 트랜잭션으로 실행.
  --    ⚠️ receiver_id 를 꼭 함께 채워야 합니다! 마이페이지(받을 물품)는
  --       `where receiver_id = 나 and status = 'reserved'` 로 조회하므로,
  --       이 줄이 빠지면 예약은 됐는데 마이페이지가 텅 비어 보입니다.
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
-- 3) admin_complete_pickup 갱신 — PIN 검증 후에만 완료 처리
-- ─────────────────────────────────────────────────────────────────
-- 운영팀이 현장에서 사용자가 불러준 PIN 을 입력하면(p_code), DB 에 저장된
-- verification_code 와 일치할 때만 status 를 'completed' 로 바꿉니다.
-- 틀리면 error_code='incorrect_pin' 을 돌려줘 대시보드가 오류를 보여줍니다.
--
-- ⚠️ 파라미터(시그니처)가 (uuid) → (uuid, text) 로 바뀌므로, CREATE OR REPLACE
--    만 쓰면 옛 1-인자 버전이 따로 남습니다. 그래서 옛 버전을 먼저 DROP 합니다.
--
-- 반환값(jsonb):
--   { ok: true }
--   { ok: false, error_code: 'not_authenticated' | 'not_authorized'
--                            | 'item_not_found' | 'invalid_status' | 'incorrect_pin' }
drop function if exists public.admin_complete_pickup(uuid);

create or replace function public.admin_complete_pickup(
  p_item_id uuid,
  p_code    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id     uuid;
  v_item_status text;
  v_code        text;
begin
  -- ① 로그인 확인
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'not_authenticated');
  end if;

  -- ② 운영팀(admin) 권한 확인
  if not exists (
    select 1 from public.profiles p
    where p.id = v_user_id and p.role = 'admin'
  ) then
    return jsonb_build_object('ok', false, 'error_code', 'not_authorized');
  end if;

  -- ③ 물품 행 잠그고 상태 + 저장된 PIN 읽기
  select status, verification_code
    into v_item_status, v_code
  from public.items
  where id = p_item_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'item_not_found');
  end if;

  -- ④ 예약(reserved) 상태(또는 legacy stored)에서만 완료 처리 가능
  if v_item_status not in ('reserved', 'stored') then
    return jsonb_build_object('ok', false, 'error_code', 'invalid_status');
  end if;

  -- ⑤ PIN 본인 확인 — 입력한 코드가 저장된 코드와 일치해야 함.
  --    (legacy: 이 마이그레이션 이전에 예약돼 코드가 없는 행은 v_code 가 NULL.
  --     그런 행은 PIN 없이도 완료할 수 있게 둬, 기존 예약이 막히지 않도록 함.)
  if v_code is not null and (p_code is null or btrim(p_code) <> v_code) then
    return jsonb_build_object('ok', false, 'error_code', 'incorrect_pin');
  end if;

  -- ⑥ 상태를 완료로 갱신 (receiver_id 는 이력용으로 그대로 둠)
  update public.items
     set status = 'completed'
   where id = p_item_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_complete_pickup(uuid, text) from public;
grant execute on function public.admin_complete_pickup(uuid, text) to authenticated;
