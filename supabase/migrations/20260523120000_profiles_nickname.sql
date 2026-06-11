-- ════════════════════════════════════════════════════════════════════
-- 👤 profiles.nickname 컬럼 추가 + 닉네임을 다른 사용자에게도 노출
-- ────────────────────────────────────────────────────────────────────
-- ▸ 배경: 양수자 상세 페이지(/receiver/item/[id])에서 "이 물품을 올린 사람"
--   을 카드로 보여줄 때, 양도자의 닉네임을 함께 표시해 신뢰감을 만들고 싶었어요.
--   하지만 profiles 테이블에는 닉네임 컬럼이 없었고, 또 RLS가 자기 행만
--   읽을 수 있도록 막혀 있어 "남의 닉네임"을 가져올 수 없었습니다.
--
-- ▸ 이 마이그레이션이 하는 일 (두 단계):
--     1) profiles.nickname (text) 컬럼을 추가 — 길이 40자 이하로 제한.
--     2) "모든 사람이 모든 프로필 row를 SELECT 할 수 있다"는 정책을 추가
--        → 다른 사용자의 닉네임을 보여줄 수 있게 됩니다.
--
-- ▸ ⚠️ 보안 메모:
--   PostgreSQL의 RLS는 row 단위라 "이 컬럼만 공개"는 직접 지원하지 않습니다.
--   따라서 이 정책을 켜면 profiles의 모든 컬럼(credits, is_verified, user_role 등)
--   도 함께 anon 사용자에게 노출돼요.
--   - 현재 단계(캠퍼스 시연용 MVP)에서는 트레이드오프를 감수합니다.
--   - 추후 민감 정보가 늘면 `public_profiles` 뷰를 만들고 거기에만 SELECT
--     권한을 부여하는 패턴으로 옮기는 걸 권장합니다.
--
-- ▸ 적용 방법: Supabase Dashboard → SQL Editor 에 통째로 붙여넣고 실행하세요.
--   (또는 supabase CLI로 `supabase db push`)
-- ════════════════════════════════════════════════════════════════════

-- 1) nickname 컬럼 추가 (이미 있으면 건너뜀 — 재실행 안전)
alter table public.profiles
  add column if not exists nickname text;

-- 컬럼 설명을 DB에 적어두면 Dashboard에서 동료가 바로 의미를 알 수 있어요.
comment on column public.profiles.nickname is
  '사용자가 직접 설정하는 표시 이름. 다른 사용자에게도 공개됨 (양도자 카드 등). 40자 이하.';

-- 2) 길이 제한 — 너무 긴 닉네임이 UI를 무너뜨리지 않도록 40자 cap
--    (기존 제약이 있으면 떼고 다시 추가하는 식으로 멱등성 확보)
alter table public.profiles
  drop constraint if exists profiles_nickname_length;
alter table public.profiles
  add constraint profiles_nickname_length
  check (nickname is null or char_length(nickname) <= 40);

-- 3) RLS 활성화 — 이미 켜져 있어도 멱등 (반복 실행해도 안전)
alter table public.profiles enable row level security;

-- 4) "모든 사람이 모든 profile row를 SELECT 할 수 있다" 정책 추가
--    PostgreSQL의 RLS는 여러 permissive 정책을 OR로 결합하므로,
--    기존에 "자기 행만 읽기" 같은 더 좁은 정책이 있어도 이 한 줄이 더해지면
--    그 합집합으로 동작해 다른 사람의 닉네임을 가져올 수 있게 됩니다.
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all"
  on public.profiles for select
  using (true);
