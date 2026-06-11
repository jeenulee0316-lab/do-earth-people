-- ════════════════════════════════════════════════════════════════════
-- 🔄 비즈니스 모델 피벗 — P2P 마켓플레이스 → 중앙집중형 B2C(운영팀→사용자)
-- ────────────────────────────────────────────────────────────────────
-- ▸ 무엇이 바뀌나
--   기존(P2P): 아무 (인증된) 사용자나 물품을 등록(양도자) → 다른 사용자가 예약(양수자)
--              → 양도자가 보관소 입고(stored) → 양수자 픽업(completed)
--   변경(B2C): 운영팀(admin)만 물품을 등록·관리. 일반 사용자는 "양수자"로만 활동.
--
--   새 흐름 (stored 단계를 건너뜀):
--     ① 운영팀이 물품 등록      → status = 'available'
--     ② 사용자가 예약          → status = 'reserved'  (사용자 -10 크레딧)
--     ③ 운영팀/사용자가 픽업 확정 → status = 'completed'
--
-- ▸ 이 마이그레이션이 하는 일
--     1) items INSERT 정책 교체 — 이제 'admin' 만 물품을 올릴 수 있음
--     2) set_pickup_schedule 갱신 — 'reserved' 단계에서 픽업 예약을 잡도록 (stored 건너뜀)
--     3) admin_complete_pickup RPC 신설 — 운영팀이 "수령 완료" 를 눌러 completed 처리
--     4) admin_list_storage_items 갱신 — 재고 전체(available/reserved/completed)를 반환
--
-- ▸ 비고: drop-off 관련 컬럼/함수(dropoff_*, drop_off_to_storage)는 굳이 지우지 않고
--   둡니다. 새 흐름에서 호출되지 않을 뿐, 남아 있어도 무해해요.
--
-- ▸ 적용 방법: Supabase Dashboard → SQL Editor 에 통째로 붙여 실행하세요.
-- ════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 1) items INSERT 정책 교체 — 운영팀(admin)만 물품 등록 가능
-- ─────────────────────────────────────────────────────────────────
-- 기존엔 "본인 + 학생 인증(is_verified)" 이면 누구나 올릴 수 있었어요.
-- 중앙집중형으로 바뀌면서, 등록은 운영팀 전용이 됩니다. UI 에서도 막지만
-- 진짜 방어선은 DB(RLS)여야 안전하므로 여기서 admin 역할을 강제합니다.
drop policy if exists "items_insert_verified" on public.items;
drop policy if exists "items_insert_admin"    on public.items;

create policy "items_insert_admin"
  on public.items for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ─────────────────────────────────────────────────────────────────
-- 2) set_pickup_schedule 갱신 — 'reserved' 단계에서 픽업 예약을 잡도록
-- ─────────────────────────────────────────────────────────────────
-- 새 흐름은 stored 단계를 건너뛰므로, 사용자는 "예약(reserved)" 상태에서 바로
-- 픽업 날짜·시간대를 정합니다. (혹시 남아 있을 legacy 'stored' 행도 함께 허용)
-- 시간대는 프론트 드롭다운과 동일한 네 값만 허용.
--
-- 반환값(jsonb):
--   { ok: true }
--   { ok: false, error_code: 'not_authenticated' | 'item_not_found'
--                            | 'not_your_pickup' | 'invalid_status' | 'invalid_time_slot' }
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

  -- ⑤ 'reserved'(또는 legacy 'stored') 단계에서만 픽업 예약을 잡을 수 있음
  if v_item_status not in ('reserved', 'stored') then
    return jsonb_build_object('ok', false, 'error_code', 'invalid_status');
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
-- 3) admin_complete_pickup RPC — 운영팀이 "수령 완료" 를 눌러 거래 종료
-- ─────────────────────────────────────────────────────────────────
-- 사용자가 보관소(운영팀)에 와서 물품을 실제로 가져가면, 운영팀이 이 버튼을
-- 눌러 items.status 를 'completed' 로 바꿉니다. 크레딧 이동은 없어요
-- (예약 시점에 이미 -10 크레딧 차감됨).
--
-- 보안: SECURITY DEFINER 로 실행하되 함수 안에서 호출자가 admin 인지 직접 검증.
--
-- 반환값(jsonb):
--   { ok: true }
--   { ok: false, error_code: 'not_authenticated' | 'not_authorized'
--                            | 'item_not_found' | 'invalid_status' }
create or replace function public.admin_complete_pickup(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id     uuid;
  v_item_status text;
begin
  -- ① 로그인 확인
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'not_authenticated');
  end if;

  -- ② 운영팀(admin) 권한 확인 — 운영팀만 픽업을 확정할 수 있음
  if not exists (
    select 1 from public.profiles p
    where p.id = v_user_id and p.role = 'admin'
  ) then
    return jsonb_build_object('ok', false, 'error_code', 'not_authorized');
  end if;

  -- ③ 물품 행 잠그고 상태 읽기 (같은 버튼을 두 번 눌러도 1번만 처리)
  select status
    into v_item_status
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

  -- ⑤ 상태만 완료로 갱신 (예약자 정보 receiver_id 는 이력용으로 그대로 둠)
  update public.items
     set status = 'completed'
   where id = p_item_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_complete_pickup(uuid) from public;
grant execute on function public.admin_complete_pickup(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 4) admin_list_storage_items 갱신 — 재고 전체를 반환 (3개 탭 지원)
-- ─────────────────────────────────────────────────────────────────
-- 대시보드가 [재고(available) / 출고 대기(reserved) / 완료(completed)] 세 탭으로
-- 바뀌었으므로, 이제 세 상태(+legacy stored)를 모두 내려줍니다.
-- 반환 컬럼 구성은 직전(예약 스케줄링) 버전과 동일하므로 CREATE OR REPLACE 로 충분.
create or replace function public.admin_list_storage_items()
returns table (
  id                 uuid,
  title              text,
  category           text,
  condition          text,
  status             text,
  created_at         timestamptz,
  dropoff_date       date,
  dropoff_time_slot  text,
  pickup_date        date,
  pickup_time_slot   text,
  donor_nickname     text,
  donor_email        text,
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

  -- ② 재고 전체 — available/reserved/completed(+legacy stored) 를 한 번에.
  --    available 물품은 예약자(receiver)가 없어 receiver_* 가 NULL (LEFT JOIN 으로 안전).
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
    left join public.profiles dp on dp.id = i.owner_id      -- 등록자(운영팀) 프로필
    left join auth.users      du on du.id = i.owner_id      -- 등록자 계정(이메일)
    left join public.profiles rp on rp.id = i.receiver_id   -- 양수자 프로필
    left join auth.users      ru on ru.id = i.receiver_id   -- 양수자 계정(이메일)
  where i.status in ('available', 'reserved', 'stored', 'completed')
  order by i.created_at desc;
end;
$$;

revoke all on function public.admin_list_storage_items() from public;
grant execute on function public.admin_list_storage_items() to authenticated;
