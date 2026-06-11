-- ════════════════════════════════════════════════════════════════════
-- 🖼️  Storage Bucket — 'item-images' + RLS 정책
-- ────────────────────────────────────────────────────────────────────
-- ▸ 양도자가 물품 등록 시 올리는 사진을 보관하는 공개 버킷이에요.
-- ▸ 업로드 경로 규약: '{auth.uid()}/{timestamp}-{rand}-{filename}'
--     예) 'a1b2c3d4-.../1716393600000-x7k2-frying_pan.jpg'
--   사용자별 폴더로 깔끔히 분리되고, RLS로 "남의 폴더 못 건드림"을 강제합니다.
-- ▸ 적용 방법: Supabase Dashboard → SQL Editor에 통째로 붙여 실행하세요.
-- ════════════════════════════════════════════════════════════════════

-- 1) 버킷 생성 (이미 있으면 public 플래그만 갱신)
insert into storage.buckets (id, name, public)
values ('item-images', 'item-images', true)
on conflict (id) do update
  set public = excluded.public;

-- 2) 기존 정책이 있으면 정리 (재실행 안전성)
drop policy if exists "item-images public read"           on storage.objects;
drop policy if exists "item-images authenticated upload"  on storage.objects;
drop policy if exists "item-images owner update"          on storage.objects;
drop policy if exists "item-images owner delete"          on storage.objects;

-- ── 3) 읽기: 누구나 (이미지 URL이 카드 그리드에 그대로 노출되므로 공개) ──
create policy "item-images public read"
  on storage.objects for select
  using (bucket_id = 'item-images');

-- ── 4) 업로드: 로그인 사용자 본인 폴더에만 ──
--    경로 첫 폴더 이름이 본인 uid 여야 통과 → 'others/' 같은 우회 방지
create policy "item-images authenticated upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── 5) 수정/삭제: 본인이 업로드한 파일만 ──
create policy "item-images owner update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'item-images' and owner = auth.uid())
  with check (bucket_id = 'item-images' and owner = auth.uid());

create policy "item-images owner delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'item-images' and owner = auth.uid());
