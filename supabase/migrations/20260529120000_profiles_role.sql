-- ════════════════════════════════════════════════════════════════════
-- 🛡️ profiles.role 컬럼 추가 — 운영팀(Admin) 권한 분리(RBAC)의 토대
-- ────────────────────────────────────────────────────────────────────
-- ▸ 배경: 오프라인 보관소(Storage Hub)를 관리하는 운영팀을 위해
--   "관리자 전용" 화면(/admin)이 필요해졌어요. 일반 사용자와 운영자를
--   구분할 권한 컬럼이 필요합니다.
--
--   ⚠️ 이미 있는 user_role 컬럼('donor' / 'recipient')과는 목적이 달라요!
--      · user_role : 서비스 안에서의 활동 역할 (양도자/양수자) — 온보딩에서 선택
--      · role      : 시스템 접근 권한 (user/admin)         — 이 마이그레이션에서 추가
--   둘은 완전히 별개라 컬럼 이름도 다르게 둡니다. (혼동 방지)
--
-- ▸ 이 마이그레이션이 하는 일:
--     1) profiles.role (text, NOT NULL, default 'user') 컬럼 추가
--        - 기존 모든 행은 default 값 'user' 로 자동 채워짐
--        - 허용 값은 'user' / 'admin' 두 가지로 CHECK 제약
--     2) handle_new_user 트리거 함수 갱신 — 신규 가입자도 항상 role='user' 로 시작
--
-- ▸ 특정 사용자를 관리자로 승격하려면 (Supabase SQL Editor에서 직접 1회):
--     update public.profiles set role = 'admin' where id = '<운영자 user_id>';
--
-- ▸ 적용 방법: Supabase Dashboard → SQL Editor 에 통째로 붙여 실행하세요.
--   (또는 supabase CLI로 `supabase db push`)
-- ════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 1) profiles.role 컬럼 추가
-- ─────────────────────────────────────────────────────────────────
-- default 'user' 를 주면, 컬럼이 새로 생길 때 기존 행들도 모두 'user' 로
-- 채워집니다. NOT NULL 까지 걸어 "권한이 비어있는 행"이 생기지 않도록 방어.
-- (IF NOT EXISTS 로 멱등 — 여러 번 돌려도 안전)
alter table public.profiles
  add column if not exists role text not null default 'user';

-- 허용 값 제약 — 오타나 잘못된 권한값이 들어가는 것을 DB 레벨에서 차단.
-- (기존 제약이 있으면 떼고 다시 추가하는 식으로 멱등성 확보)
alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('user', 'admin'));

comment on column public.profiles.role is
  '시스템 접근 권한. user(일반) / admin(운영팀). 가입 시 기본값 user. '
  '서비스 활동 역할(user_role: donor/recipient)과는 별개의 개념.';

-- ─────────────────────────────────────────────────────────────────
-- 2) handle_new_user 트리거 갱신 — 신규 가입자 role 기본값 보장
-- ─────────────────────────────────────────────────────────────────
-- 새 사용자가 가입(auth.users INSERT)하면, 자동으로 profiles 행을 만들어 주는
-- 트리거 함수입니다. role 을 명시적으로 'user' 로 넣어, 어떤 경로로 가입하든
-- 항상 일반 사용자 권한으로 시작하도록 못 박습니다.
--
--   ※ 다른 컬럼(credits=100, is_verified=false 등)은 각 컬럼의 default 값이
--     자동 적용되므로 여기서 따로 지정하지 않아요.
--   ※ 혹시 기존 트리거가 다른 컬럼도 함께 채우고 있었다면, 그 INSERT 절에
--     `role` 한 줄만 추가로 합쳐주면 됩니다. (아래는 표준 최소 구현)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 가입과 동시에 프로필 행을 생성하며, 권한은 항상 'user' 로 시작.
  -- on conflict do nothing: 어떤 이유로 행이 이미 있어도 에러 없이 통과(멱등).
  insert into public.profiles (id, role)
  values (new.id, 'user')
  on conflict (id) do nothing;

  return new;
end;
$$;

-- 트리거가 없을 수도 있으니 안전하게 다시 연결합니다 (멱등).
-- Supabase 표준 트리거 이름(on_auth_user_created)을 사용합니다.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
