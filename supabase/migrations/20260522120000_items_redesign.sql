-- ════════════════════════════════════════════════════════════════════
-- 📦 items 테이블 재설계 — Donor 단건 등록(form) 스키마로 전환
-- ────────────────────────────────────────────────────────────────────
-- ▸ 배경: 기존 items 테이블은 AI 일괄 입력용으로 (user_id/name/grade/image_url)
--   컬럼을 갖고 있었지만, 양도자 페이지가 단건 상세 등록 폼으로 바뀌면서
--   (owner_id/title/description/category/condition/location/image_urls[])
--   형태가 필요해졌어요.
-- ▸ 영향: 기존 items 행과, items.id를 참조하는 reservations 행은 모두 폐기됩니다.
--   (현재 데이터는 개발용 더미라 문제 없음)
-- ▸ 적용 방법: Supabase Dashboard → SQL Editor에 통째로 붙여 실행하세요.
-- ════════════════════════════════════════════════════════════════════

-- 1) 예약 데이터 비우기 — 곧 items 행이 사라지므로 참조 무효화 방지
--    (reservations 테이블이 아직 없으면 그냥 통과)
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'reservations'
  ) then
    execute 'truncate table public.reservations';
  end if;
end$$;

-- 2) 기존 items 테이블 제거 (의존 객체 함께 정리)
drop table if exists public.items cascade;

-- 3) 새 items 테이블 생성
create table public.items (
  -- 고유 식별자(uuid). 외부 URL에 그대로 노출돼도 안전한 비순차 id.
  id           uuid        primary key default gen_random_uuid(),

  -- "이 물품의 주인" — auth.users.id 와 연결. 회원 탈퇴 시 함께 삭제.
  owner_id     uuid        not null references auth.users(id) on delete cascade,

  -- 단건 등록에 필요한 본문 필드들 (제목은 필수, 나머지는 선택)
  title        text        not null,
  description  text,
  category     text,
  condition    text,                                  -- 'S' / 'A' / 'B' 등급 문자열
  location     text,                                  -- 픽업 가능 위치 메모

  -- 이미지 공개 URL 배열 (최대 5장은 앱 레이어에서 제한). 비어있어도 OK.
  image_urls   text[]      not null default '{}',

  created_at   timestamptz not null default now()
);

-- 4) 자주 쓰는 조회 패턴에 맞춘 인덱스
--    (a) 마이페이지 양도자 뷰: 내가 올린 물품 최신순
create index items_owner_id_created_at_idx
  on public.items (owner_id, created_at desc);

--    (b) 탐색 페이지: 전체 최신순
create index items_created_at_idx
  on public.items (created_at desc);

-- 5) reservations.item_id 타입 정합성 — items.id가 uuid로 바뀌었으므로 맞춰줌
--    (reservations 테이블이 존재할 때만 수행)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reservations' and column_name = 'item_id'
  ) then
    -- 기존 FK가 있으면 떼고
    alter table public.reservations
      drop constraint if exists reservations_item_id_fkey;

    -- 타입을 uuid로 통일 (이미 비웠으므로 캐스팅 문제 없음)
    alter table public.reservations
      alter column item_id type uuid using null;

    -- 다시 FK 연결
    alter table public.reservations
      add constraint reservations_item_id_fkey
      foreign key (item_id) references public.items(id) on delete cascade;
  end if;
end$$;

-- ════════════════════════════════════════════════════════════════════
-- 🔐 RLS (Row Level Security) 정책
-- ────────────────────────────────────────────────────────────────────
-- ▸ SELECT  : 누구나 OK — 탐색 페이지가 anon 키로 카드 그리드를 그림.
-- ▸ INSERT  : 로그인 사용자 본인 + profiles.is_verified = true 인 경우만.
-- ▸ UPDATE  : 본인 행만 수정.
-- ▸ DELETE  : 본인 행만 삭제.
-- ════════════════════════════════════════════════════════════════════

alter table public.items enable row level security;

-- (재실행 안전성 — 이미 존재할 수 있는 동일 이름 정책 제거 후 새로 만들기)
drop policy if exists "items_select_all"      on public.items;
drop policy if exists "items_insert_verified" on public.items;
drop policy if exists "items_update_owner"    on public.items;
drop policy if exists "items_delete_owner"    on public.items;

-- 누구나 읽기 가능 (탐색은 비로그인 anon 키로도 동작)
create policy "items_select_all"
  on public.items for select
  using (true);

-- 작성: 로그인된 본인 + 학생 인증 통과자만
create policy "items_insert_verified"
  on public.items for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_verified = true
    )
  );

-- 수정/삭제: 본인 행만
create policy "items_update_owner"
  on public.items for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "items_delete_owner"
  on public.items for delete
  to authenticated
  using (owner_id = auth.uid());
