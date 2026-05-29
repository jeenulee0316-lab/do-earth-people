-- ════════════════════════════════════════════════════════════════════
-- 🗄️ admin_list_storage_items RPC — 운영팀 대시보드 전용 물품 조회
-- ────────────────────────────────────────────────────────────────────
-- ▸ 배경: /admin 대시보드는 보관소를 거치는 물품들을 한 화면에서 봅니다.
--     · 입고 대기(Pending Drop-off) : status = 'reserved'
--         → 양수자가 예약했고, 양도자가 보관소에 가져오기를 기다리는 물품
--     · 출고 대기(Pending Pick-up)  : status = 'stored'
--         → 보관소에 입고됐고, 양수자가 픽업하러 오기를 기다리는 물품
--
--   운영팀은 "누가 맡기러 오고(양도자), 누가 찾으러 오는지(양수자)"를 알아야
--   현장에서 본인 확인을 할 수 있어요. 그래서 각 물품의 양도자/양수자
--   닉네임과 이메일을 함께 내려줍니다.
--
-- ▸ 왜 일반 SELECT 가 아니라 RPC(함수)인가?
--     · 이메일은 auth.users 테이블에 있는데, 이 테이블은 일반 클라이언트(anon/
--       authenticated 키)로는 읽을 수 없습니다(보안상 차단).
--     · SECURITY DEFINER 함수는 정의자(postgres) 권한으로 실행돼 auth.users 를
--       읽을 수 있고, 함수 안에서 "호출자가 admin 인지"를 직접 검사해
--       관리자에게만 데이터를 노출합니다. → 권한 분리를 DB 레벨에서 강제.
--
-- ▸ 반환: 물품 1건당 한 행. (입고/출고 구분은 status 컬럼으로 프론트가 분리)
--
-- ▸ 적용 방법: Supabase Dashboard → SQL Editor 에 통째로 붙여 실행하세요.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.admin_list_storage_items()
returns table (
  id                uuid,
  title             text,
  category          text,
  condition         text,
  status            text,
  created_at        timestamptz,
  -- 양도자(Donor) 정보 — 물품을 맡기러 오는 사람
  donor_nickname    text,
  donor_email       text,
  -- 양수자(Receiver) 정보 — 물품을 찾으러 오는 사람
  receiver_nickname text,
  receiver_email    text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- ① 권한 게이트 — 호출자가 admin 이 아니면 즉시 차단.
  --    (프론트에서도 막지만, 데이터 접근의 마지막 방어선은 DB여야 안전)
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'not_authorized'
      using errcode = '42501';   -- insufficient_privilege
  end if;

  -- ② 보관소를 거치는 두 상태(reserved/stored)의 물품만, 양도자·양수자 정보와 함께.
  --    profiles(닉네임) 와 auth.users(이메일) 를 각각 양도자/양수자 기준으로 LEFT JOIN.
  --    LEFT JOIN 이라 양수자가 아직 없는 행이 와도(이론상 reserved 면 항상 있음) 안전.
  return query
  select
    i.id,
    i.title,
    i.category,
    i.condition,
    i.status,
    i.created_at,
    dp.nickname        as donor_nickname,
    du.email::text     as donor_email,
    rp.nickname        as receiver_nickname,
    ru.email::text     as receiver_email
  from public.items i
    left join public.profiles dp on dp.id = i.owner_id      -- 양도자 프로필
    left join auth.users      du on du.id = i.owner_id      -- 양도자 계정(이메일)
    left join public.profiles rp on rp.id = i.receiver_id   -- 양수자 프로필
    left join auth.users      ru on ru.id = i.receiver_id   -- 양수자 계정(이메일)
  where i.status in ('reserved', 'stored')
  order by i.created_at desc;
end;
$$;

-- SECURITY DEFINER 함수는 PUBLIC 자동 EXECUTE 를 막고, 로그인 사용자에게만 부여.
-- (실제 admin 검사는 함수 내부에서 수행 — authenticated 라도 비관리자면 예외 발생)
revoke all on function public.admin_list_storage_items() from public;
grant execute on function public.admin_list_storage_items() to authenticated;
