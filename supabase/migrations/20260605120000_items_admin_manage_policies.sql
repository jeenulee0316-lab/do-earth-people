-- ════════════════════════════════════════════════════════════════════
-- 🛠️ 운영팀(admin) 전용 재고 수정·삭제 권한(RLS) 추가
-- ────────────────────────────────────────────────────────────────────
-- ▸ 배경: 지금까지 items 의 UPDATE/DELETE 정책은 "본인 행만"(owner_id = auth.uid())
--   이었어요. B2C 중앙집중 모델에서는 운영팀(admin)이 공동으로 재고를 관리하는데,
--   A 운영진이 등록한 물품을 B 운영진이 수정/삭제하려 하면 RLS 가 조용히 막아
--   (에러 없이 0행 처리) UI 만 바뀌고 DB 는 그대로 남는 버그가 생깁니다.
--
-- ▸ 이 마이그레이션이 하는 일
--     1) items_update_admin — admin 이면 어떤 물품이든 UPDATE 허용
--     2) items_delete_admin — admin 이면 어떤 물품이든 DELETE 허용
--   (기존 items_update_owner / items_delete_owner 는 그대로 두어, 본인 행은
--    계속 수정·삭제 가능. 둘 중 하나라도 통과하면 허용되는 OR 결합이라 안전.)
--
-- ▸ 적용 방법: Supabase Dashboard → SQL Editor 에 통째로 붙여 실행하세요.
-- ════════════════════════════════════════════════════════════════════

-- 재실행 안전성 — 같은 이름 정책이 있으면 먼저 제거
drop policy if exists "items_update_admin" on public.items;
drop policy if exists "items_delete_admin" on public.items;

-- ─────────────────────────────────────────────────────────────────
-- 1) 수정(UPDATE) — 운영팀(admin)은 모든 물품을 수정할 수 있음
-- ─────────────────────────────────────────────────────────────────
-- using(읽을 수 있는 행) + with check(수정 후에도 만족해야 하는 조건) 둘 다
-- "요청자가 admin 인가" 로 둡니다. owner_id 를 그대로 둔 채 다른 컬럼만 바꾸는
-- 일반적인 수정 흐름을 막지 않도록, owner_id 비교는 넣지 않습니다.
create policy "items_update_admin"
  on public.items for update
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

-- ─────────────────────────────────────────────────────────────────
-- 2) 삭제(DELETE) — 운영팀(admin)은 모든 물품을 삭제할 수 있음
-- ─────────────────────────────────────────────────────────────────
create policy "items_delete_admin"
  on public.items for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );
