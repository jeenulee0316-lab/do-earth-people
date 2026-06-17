-- ════════════════════════════════════════════════════════════════════
-- 🎁 웰컴 키트(kits) 테이블 + 권한(RLS) 정의
-- ────────────────────────────────────────────────────────────────────
-- ▸ 배경: 운영팀이 여러 물품을 하나의 "웰컴 키트"(예: 첫 학기 생존 키트)로
--   묶어 큐레이션할 수 있게 하는 기능입니다. /admin 대시보드에서 재고 물품을
--   체크박스로 골라 키트로 묶으면, 각 물품의 items.kit_id 가 이 키트를 가리킵니다.
--
-- ▸ 이미 SQL Editor 에서 손으로 만든 테이블이라도, 이 파일은 "되돌려도 안전한"
--   (idempotent) 형태로 작성해 두어 형상 관리(버전 관리)의 기준 문서가 됩니다.
--     · create table IF NOT EXISTS / add column IF NOT EXISTS 로 중복 실행 방지.
--
-- ▸ 이 마이그레이션이 하는 일
--     1) kits 테이블 정의 (없으면 생성)
--     2) items.kit_id 외래 키 컬럼 추가 (없으면 추가)
--     3) kits 에 RLS 켜고 정책 부여
--          · 읽기(SELECT)  : 누구나(anon/authenticated) — 추후 수령자도 키트를 탐색
--          · 쓰기(INSERT/UPDATE/DELETE) : 운영팀(admin) 만
--   ⚠️ 3) 이 없으면 RLS 가 켜진 kits 에 admin 도 INSERT 하지 못해(0행/오류)
--       "키트로 묶기"가 동작하지 않습니다. 반드시 함께 적용하세요.
--
-- ▸ 적용 방법: Supabase Dashboard → SQL Editor 에 통째로 붙여 실행하세요.
-- ════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 1) kits 테이블 — 웰컴 키트 한 묶음을 나타내는 행
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.kits (
  id            uuid        primary key default gen_random_uuid(),
  name          text        not null,
  description   text,
  thumbnail_url text,
  status        text        default 'active',
  created_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────
-- 2) items.kit_id — 이 물품이 어떤 키트에 묶였는지(없으면 NULL = 단품)
-- ─────────────────────────────────────────────────────────────────
alter table public.items
  add column if not exists kit_id uuid references public.kits(id) on delete set null;

-- 키트별 물품 조회가 잦으므로 인덱스 하나 — 없으면 추가.
create index if not exists items_kit_id_idx on public.items(kit_id);

-- ─────────────────────────────────────────────────────────────────
-- 3) kits RLS — 읽기는 공개, 쓰기는 admin 전용
-- ─────────────────────────────────────────────────────────────────
alter table public.kits enable row level security;

-- 재실행 안전성 — 같은 이름 정책이 있으면 먼저 제거
drop policy if exists "kits_select_all"    on public.kits;
drop policy if exists "kits_insert_admin"  on public.kits;
drop policy if exists "kits_update_admin"  on public.kits;
drop policy if exists "kits_delete_admin"  on public.kits;

-- 읽기(SELECT) — 누구나. (탐색 페이지에서 키트를 보여줄 수 있도록 items 와 동일 정책)
create policy "kits_select_all"
  on public.kits for select
  using (true);

-- 생성(INSERT) — 운영팀(admin) 만
create policy "kits_insert_admin"
  on public.kits for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- 수정(UPDATE) — 운영팀(admin) 만
create policy "kits_update_admin"
  on public.kits for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- 삭제(DELETE) — 운영팀(admin) 만
create policy "kits_delete_admin"
  on public.kits for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );
