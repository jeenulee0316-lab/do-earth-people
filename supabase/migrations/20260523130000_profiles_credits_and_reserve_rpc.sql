-- ════════════════════════════════════════════════════════════════════
-- 💰 profiles.credits 컬럼 + 🔒 원자적 예약 함수 reserve_item
-- ────────────────────────────────────────────────────────────────────
-- ▸ 배경: 예약 한 건당 10 크레딧을 차감하는 정책이 들어옵니다.
--   "물품 상태 변경"과 "사용자 크레딧 차감"이 따로따로 일어나면,
--   네트워크가 끊긴 순간에 한 쪽만 성공해 데이터가 어긋날 수 있어요.
--   (예: 크레딧은 빠졌는데 물품 상태는 그대로 → 한 명이 또 예약 가능)
--
--   이걸 막기 위해 Postgres 함수 하나(reserve_item)를 만들어
--   "필요한 모든 검사 + 모든 쓰기" 를 한 트랜잭션으로 묶었어요.
--   클라이언트(웹 페이지)는 supabase.rpc('reserve_item', { p_item_id }) 한 번만
--   부르면, DB 안에서 통째로 성공하거나 통째로 실패하도록 보장됩니다.
--
-- ▸ 이 마이그레이션이 하는 일:
--     1) profiles.credits (int, default 100, not null, ≥ 0) 컬럼 추가
--     2) reserve_item(p_item_id uuid) 함수 생성 — 한 번의 호출로 원자 예약
--     3) authenticated 사용자에게 실행 권한 부여
--
-- ▸ 적용 방법: Supabase Dashboard → SQL Editor 에 통째로 붙여 실행하세요.
--   (또는 supabase CLI로 `supabase db push`)
-- ════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 1) profiles.credits 컬럼 추가
-- ─────────────────────────────────────────────────────────────────
-- 신규/기존 모든 행에 기본값 100 크레딧을 부여합니다 (=10번까지 예약 가능).
-- "IF NOT EXISTS" 로 멱등(여러 번 돌려도 안전)하게 처리.
alter table public.profiles
  add column if not exists credits integer not null default 100;

-- 크레딧은 절대 음수가 될 수 없습니다 — 결제 직후의 일시적 음수도 차단.
-- (reserve_item 함수가 차감 전에 잔액을 검사하지만, DB 레벨에서 한 번 더 방어선)
alter table public.profiles
  drop constraint if exists profiles_credits_nonneg;
alter table public.profiles
  add constraint profiles_credits_nonneg check (credits >= 0);

comment on column public.profiles.credits is
  '사용자가 예약/소비에 쓸 수 있는 크레딧 잔액. 가입 시 기본값 100, 예약 1건당 10 차감.';

-- ─────────────────────────────────────────────────────────────────
-- 2) 원자적 예약 함수
-- ─────────────────────────────────────────────────────────────────
-- 한 호출 안에서 다음을 모두 검사/실행합니다:
--   ① 로그인 여부 (auth.uid())
--   ② 물품 존재 + status = 'available'
--   ③ 양도자 본인이 아닌지
--   ④ 예약 비용(10 크레딧) 보유 여부
--   ⑤ items.status = 'reserved' 로 갱신 (행 잠금 후)
--   ⑥ profiles.credits -= 10
--   ⑦ reservations 테이블에도 한 줄 INSERT (다른 페이지들이 이 테이블을 참조)
--
-- SECURITY DEFINER: 함수가 정의자(예: postgres) 권한으로 실행돼
--   - items_update_owner RLS 정책(소유자만 update)을 우회할 수 있고,
--   - 호출자는 우리가 노출한 reserve_item만 쓸 수 있어 안전합니다.
-- search_path 고정: search_path 하이재킹 공격 방지의 표준 패턴.
--
-- 반환값(jsonb 형태):
--   { ok: true,  new_credits: <남은 크레딧> }
--   { ok: false, error_code: 'not_authenticated' | 'item_not_found'
--                            | 'item_unavailable' | 'own_item'
--                            | 'insufficient_credits',
--                current_credits?: <조회된 현재 크레딧, 잔액 부족 안내용> }
-- ─────────────────────────────────────────────────────────────────
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
  -- ① 로그인된 사용자만 호출 가능
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error_code', 'not_authenticated');
  end if;

  -- ② 물품 행을 잠그고(=다른 동시 예약 차단) 상태/소유자 읽기
  --    FOR UPDATE 가 핵심: 두 사용자가 동시에 같은 물품을 예약 시도해도
  --    한 명만 lock을 얻고, 두 번째는 첫 번째 트랜잭션이 끝난 뒤 진입해
  --    status='reserved'로 바뀐 걸 보고 자연스럽게 'item_unavailable' 응답.
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
    -- profiles 행이 없는 비정상 케이스 — 인증은 됐지만 프로필 트리거가 실패한 경우 등
    return jsonb_build_object('ok', false, 'error_code', 'profile_not_found');
  end if;

  if v_current_credits < v_cost then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'insufficient_credits',
      'current_credits', v_current_credits
    );
  end if;

  -- ⑥ 여기까지 모든 검사 통과 — 두 번의 UPDATE + 한 번의 INSERT를 한 트랜잭션으로 실행
  update public.items
     set status = 'reserved'
   where id = p_item_id;

  update public.profiles
     set credits = credits - v_cost
   where id = v_user_id;

  -- ⑦ reservations 테이블에도 동기 — 마이페이지(양수자/양도자 뷰)가 이 테이블을 봅니다
  --    item_id가 reservations에 UNIQUE 제약이 걸려 있다면 중복 INSERT 시 예외가 발생,
  --    트랜잭션 전체가 롤백돼 일관성이 유지됩니다.
  insert into public.reservations (user_id, item_id)
  values (v_user_id, p_item_id);

  return jsonb_build_object(
    'ok', true,
    'new_credits', v_current_credits - v_cost
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────
-- 3) 실행 권한 부여
-- ─────────────────────────────────────────────────────────────────
-- SECURITY DEFINER 함수는 PUBLIC에 자동으로 EXECUTE가 부여되는 걸 막기 위해
-- 명시적으로 PUBLIC에서 권한을 회수하고, 로그인된 사용자(authenticated)에게만 부여합니다.
revoke all on function public.reserve_item(uuid) from public;
grant execute on function public.reserve_item(uuid) to authenticated;
