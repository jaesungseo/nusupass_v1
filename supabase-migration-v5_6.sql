-- ═══════════════════════════════════════════════════════════════
-- supabase-migration-v5.6.sql
-- 누수패스 Sabi v5.6 — 동시 배정 + purpose 분리 시스템
-- ═══════════════════════════════════════════════════════════════
--
-- 적용 상태: ✅ Supabase 프로덕션 적용 완료
--
-- 적용 이력:
--   2026-04-19 09:08  v5_6_0_multi_partner_assignment_structure    (DB 스키마)
--   2026-04-19 12:05  v5_6_1_rpc_purpose_aware_and_cancel          (RPC 4개)
--   2026-04-19 12:15  v5_6_2_views_purpose_aware                   (뷰 3개)
--   2026-04-19 12:30  v5_6_3_admin_case_detail_v_purpose_aware     (뷰 버그픽스)
--   2026-04-19 12:45  v5_6_4_security_invoker_on_partner_views     (🚨 RLS 보안 픽스)
--   2026-04-19 12:55  v5_6_5_partner_rls_allow_requested           (파트너 응답대기 조회 가능)
--   2026-04-19 13:05  v5_6_6_partner_work_storage_policies         (Storage 버킷 정책 추가)
--   2026-04-19 13:15  v5_6_7_log_event_security_definer            (🐛 파트너 권한 이벤트 로그 RLS)
--   2026-04-19 13:18  v5_6_8_add_status_history_security_definer   (🐛 파트너 권한 상태이력 RLS)
--   2026-04-19 13:35  v5_6_9_leak_area_room_based                  (CHECK 제약 방 기준 전환 + interior_scope 확장)
--
-- 이 파일은 깃허브 레포 /migrations/ 폴더 보관용 참고 파일입니다.
-- 재실행 금지. 실 적용은 Supabase apply_migration 이력에서 확인.
-- ═══════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────
-- 변경 요약 (한 줄 정리)
-- ───────────────────────────────────────────────────────────────
-- 1. 한 케이스에 누수탐지(detection) + 인테리어(interior) 업체를 동시 배정 가능
-- 2. 같은 purpose 내에서만 경쟁 만료 (다른 purpose 배정은 영향 없음)
-- 3. 3주체(admin/partner/customer) 취소 로직 + 사유 필수
-- 4. 수리완료 보고서 purpose별 필수 필드 분리 (탐지 vs 인테리어)
-- 5. 케이스 전체 상태는 모든 purpose 종합해 자동 계산
-- ───────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════
-- Migration 4: v5_6_0_multi_partner_assignment_structure
-- (DB 스키마 변경)
-- ═══════════════════════════════════════════════════════════════

-- 4-1. intake_cases 컬럼 추가
ALTER TABLE public.intake_cases
  ADD COLUMN IF NOT EXISTS needs_detection      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS needs_interior       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS insurance_subscribed text    NOT NULL DEFAULT 'unknown'
    CHECK (insurance_subscribed IN ('yes','no','unknown'));

-- 최소 1개 업종 필요
ALTER TABLE public.intake_cases
  ADD CONSTRAINT chk_needs_at_least_one
  CHECK (needs_detection = true OR needs_interior = true);

-- 4-2. partner_assignments 컬럼 추가
ALTER TABLE public.partner_assignments
  ADD COLUMN IF NOT EXISTS assignment_purpose text NOT NULL
    CHECK (assignment_purpose IN ('detection','interior')),
  -- 취소 메타
  ADD COLUMN IF NOT EXISTS cancelled_by      text
    CHECK (cancelled_by IS NULL OR cancelled_by IN ('admin','partner','customer')),
  ADD COLUMN IF NOT EXISTS cancelled_reason  text,
  ADD COLUMN IF NOT EXISTS cancelled_at      timestamptz,
  -- detection 전용 필드
  ADD COLUMN IF NOT EXISTS leak_detail_part  text,
  ADD COLUMN IF NOT EXISTS detection_tools   text[],
  ADD COLUMN IF NOT EXISTS detection_count   smallint,
  -- interior 전용 필드
  ADD COLUMN IF NOT EXISTS interior_scope          text[],
  ADD COLUMN IF NOT EXISTS worker_count            smallint,
  ADD COLUMN IF NOT EXISTS construction_start_date date,
  ADD COLUMN IF NOT EXISTS construction_end_date   date;

-- 4-3. partner_companies.specialty_codes (배열) — purpose 매칭용
ALTER TABLE public.partner_companies
  ADD COLUMN IF NOT EXISTS specialty_codes text[];

-- 기존 specialties 문자열 → specialty_codes 배열 마이그레이션
UPDATE public.partner_companies
SET specialty_codes = CASE
  WHEN specialties LIKE '%누수탐지%' AND specialties LIKE '%인테리어%' THEN ARRAY['detection','interior']
  WHEN specialties LIKE '%누수탐지%' THEN ARRAY['detection']
  WHEN specialties LIKE '%인테리어%' THEN ARRAY['interior']
  ELSE ARRAY[]::text[]
END
WHERE specialty_codes IS NULL;

-- assignment_status에 'cancelled' 값 허용
ALTER TABLE public.partner_assignments
  DROP CONSTRAINT IF EXISTS partner_assignments_assignment_status_check;

ALTER TABLE public.partner_assignments
  ADD CONSTRAINT partner_assignments_assignment_status_check
  CHECK (assignment_status IN ('requested','accepted','rejected','expired','cancelled'));


-- ═══════════════════════════════════════════════════════════════
-- Migration 5: v5_6_1_rpc_purpose_aware_and_cancel
-- (RPC 4개 + 헬퍼 1개)
-- ═══════════════════════════════════════════════════════════════

-- 5-1. rpc_create_partner_assignment (6-arg, purpose 필수)
--   · specialty_codes와 purpose 일치 검증
--   · 같은 case + 같은 purpose의 기존 active 배정 차단
--   · assignment_round는 purpose별로 독립 증가
-- (전체 소스는 Supabase 프로덕션에 배포되어 있음)

-- 5-2. rpc_respond_partner_assignment
--   · 중요 변경: accepted 시 같은 case_id + 같은 purpose + requested만 expired 처리
--   · 다른 purpose의 배정은 건드리지 않음 (독립 운영 보장)

-- 5-3. rpc_submit_work_done (16-arg)
--   · 공통: repair_cost, repair_opinion, 사고일시, 가해/피해세대, 누수부위/원인
--   · detection 필수: leak_detail_part, detection_count
--   · interior 필수: interior_scope, worker_count, 착공일, 완공일
--   · 잘못된 purpose에 반대쪽 필드 섞어 보내면 RAISE EXCEPTION

-- 5-4. rpc_cancel_partner_assignment (신설, 3-arg)
--   · requested/accepted 상태만 취소 가능
--   · admin/partner/customer 중 취소 주체 기록
--   · 사유 필수
--   · 다른 purpose 배정에 영향 없음

-- 5-5. _update_case_status_by_assignments (헬퍼, 신설)
--   · 모든 purpose 종합해 케이스 display_status 자동 계산
--   · 필요한 모든 업종 수리완료 → '수리완료'
--   · 필요한 모든 업종 최소 accepted → '배정완료'
--   · 그 외 → '파트너배정중'


-- ═══════════════════════════════════════════════════════════════
-- Migration 6: v5_6_2_views_purpose_aware
-- (프론트엔드 연동 뷰 3개)
-- ═══════════════════════════════════════════════════════════════

-- 6-1. admin_case_list_v (재정의)
--   · 신규 컬럼: needs_detection, needs_interior, insurance_subscribed
--   · detection/interior 각각의 partner_id, partner_name, 
--     assignment_status, work_status 분리 노출
--   · LEFT JOIN LATERAL로 purpose별 최신 active 배정만 연결

-- 6-2. partner_web_assignment_list_v (재정의)
--   · assignment_purpose 컬럼 추가
--   · needs_detection, needs_interior 추가

-- 6-3. partner_web_assignment_detail_v (재정의)
--   · assignment_purpose 컬럼 추가
--   · 사고정보: accident_datetime_at_site, accident_datetime_note,
--              attacker_unit, victim_unit, leak_area_type, leak_cause
--   · detection 필드: leak_detail_part, detection_tools, detection_count
--   · interior 필드: interior_scope, worker_count, 
--                   construction_start_date, construction_end_date


-- ═══════════════════════════════════════════════════════════════
-- Migration 7: v5_6_3_admin_case_detail_v_purpose_aware
-- (뷰 버그픽스 — v5.6.2의 누락 보완)
-- ═══════════════════════════════════════════════════════════════

-- 7-1. admin_case_detail_v (재정의)
--   · 버그: v5.6.2에서 admin_case_list_v만 업데이트하고 detail_v를 빼먹음
--   · 증상: 접수 상세 모달에서 needs_detection/needs_interior가 undefined
--          → "이 접수건에는 불필요" 오표시 + 배정 버튼 미표시
--   · 해결: admin_case_detail_v에도 needs_detection, needs_interior,
--          insurance_subscribed 컬럼 노출


-- ═══════════════════════════════════════════════════════════════
-- Migration 8: v5_6_4_security_invoker_on_partner_views
-- (🚨 치명적 보안 버그 — RLS 우회 픽스)
-- ═══════════════════════════════════════════════════════════════

-- 8-1. partner_web_assignment_list_v / _detail_v 재생성
--   · 🚨 버그: 뷰가 SECURITY DEFINER 기본 모드로 생성되어
--            postgres 슈퍼유저 권한으로 실행 → partner_assignments RLS 우회
--            → 파트너A 로그인 시 파트너B의 모든 배정까지 조회됨
--   · 해결: CREATE VIEW ... WITH (security_invoker = on)
--          → 뷰 호출자 권한으로 base table 접근
--          → partner_company_id = my_partner_company_id() RLS 자동 적용
--   · 프론트엔드: loadPartnerHome / loadPartnerAssignments에도
--                .eq('partner_company_id', curUser.company_id) 추가 (2중 방어)


-- ═══════════════════════════════════════════════════════════════
-- Migration 9: v5_6_5_partner_rls_allow_requested
-- (🐛 Migration 8 적용 후 표면화된 RLS 버그 픽스)
-- ═══════════════════════════════════════════════════════════════

-- 9-1. intake_cases_partner_select 정책 확장
--   · 버그: 기존 정책이 assignment_status='accepted'만 허용
--          → Migration 8로 security_invoker=on 적용 후
--            partner_web_assignment_list_v가 intake_cases JOIN 할 때
--            requested 상태 배정의 intake_cases를 조회 못해
--            파트너 배정 목록이 빈 상태로 표시됨
--   · 해결: assignment_status IN ('requested','accepted')로 확장
--   · 개인정보 보호: 뷰 레벨 RLS가 아니라 프론트 마스킹으로 처리
--                  (openPartnerAssignDetail에서 isAcc 체크해 이미 구현됨)


-- ═══════════════════════════════════════════════════════════════
-- Migration 10: v5_6_6_partner_work_storage_policies
-- (🐛 버킷 존재하지만 Storage RLS 정책 누락 → 사진 업로드 403)
-- ═══════════════════════════════════════════════════════════════

-- 10-1. storage.objects에 partner-work 버킷용 정책 4개 추가
--   · 버그: 파트너가 수리완료 보고서 제출 시 사진 업로드 실패 (영문 RLS 에러)
--   · 원인: partner-work 버킷은 생성돼 있었으나 storage.objects에
--          해당 버킷용 정책이 0개 → 모든 접근 RLS로 차단
--   · 해결: 4개 정책 추가
--     - partner_work_partner_insert: 자사 배정 폴더에 업로드 가능
--     - partner_work_partner_select: 자사 배정 폴더 조회 가능
--     - partner_work_partner_update: upsert:true 모드 대응
--     - partner_work_admin_all: 관리자는 모든 작업 가능
--   · 경로 규칙: {assignment_id}/{stage}_{ts}.jpg (최상위 폴더=UUID)
--                storage.foldername(name)[1]로 assignment_id 추출하여
--                partner_company_id = my_partner_company_id() 검증


-- ═══════════════════════════════════════════════════════════════
-- Migration 11: v5_6_7_log_event_security_definer
-- (🐛 파트너 권한으로 이벤트 로그 INSERT 불가 버그)
-- ═══════════════════════════════════════════════════════════════

-- 11-1. log_partner_assignment_event 함수 SECURITY DEFINER 승격
--   · 버그: 파트너가 rpc_submit_work_done 호출하면 오류
--   · 원인: rpc_submit_work_done(SECURITY DEFINER)이 내부에서
--          log_partner_assignment_event(SECURITY INVOKER = 일반 SQL 함수)를 호출
--          → partner_assignment_events 테이블 INSERT는 파트너 권한으로 실행
--          → INSERT 정책이 관리자용만 있어 RLS 거부 → 전체 롤백
--   · 해결: PL/pgSQL + SECURITY DEFINER로 재작성


-- ═══════════════════════════════════════════════════════════════
-- Migration 12: v5_6_8_add_status_history_security_definer
-- (🐛 v5.6.7과 동일 패턴의 숨어있던 버그)
-- ═══════════════════════════════════════════════════════════════

-- 12-1. add_case_status_history 함수 SECURITY DEFINER 승격
--   · 원인: _update_case_status_by_assignments(SECURITY DEFINER)가 내부에서
--          add_case_status_history(SECURITY INVOKER = 일반 SQL 함수)를 호출
--          → 파트너가 수리완료 보고 시 케이스 상태 이력 기록 단계에서
--            case_status_history INSERT RLS 거부 → 전체 롤백
--   · 해결: PL/pgSQL + SECURITY DEFINER로 재작성


-- ═══════════════════════════════════════════════════════════════
-- Migration 13: v5_6_9_leak_area_room_based
-- (CHECK 제약 방 기준 전환 + HTML 전수 정합성 픽스)
-- ═══════════════════════════════════════════════════════════════

-- 13-1. leak_area_type CHECK 제약 교체
--   · 배경: 기존 값 ['공용부','전유부','미상']은 손해사정사의 법적 판단 영역
--          현장 기사가 찍는 필드로는 부적합
--   · 변경: 방 기준 영문 코드 11개로 전환
--          living / kitchen / main_room / sub_room_1~3
--          bathroom / boiler_room / utility_room / veranda / other

-- 13-2. interior_scope CHECK 제약 확장
--   · 기존: 8개 (living/kitchen/main_room/sub_room_1~3/veranda/other)
--   · 추가: bathroom, boiler_room, utility_room (누수 빈발 공간 보강)
--   · 결과: leak_area_type과 동일한 11개 코드 체계

-- 13-3. 프론트엔드(index.html) 6군데 수정
--   · wd_leak_area 드롭다운: 주방/욕실/... 9개 → 영문 코드 11개
--   · wd_detection_tool: 한글→영문(thermal/acoustic/gas_trace/moisture/other)
--     * 내시경/수압테스트 제거 (DB CHECK에 없음)
--   · wd_interior_scope: 공정(도배/장판) → 방 기준 11개
--     * "공정은 사진으로 확인" 안내 문구 추가
--   · wd_leak_detail_part: 자유 텍스트 → 드롭다운 (배관/방수층/분배기/창틀코킹/보일러/기타)
--   · wd_detection_count: max=20 → max=3 (DB CHECK 일치)
--   · wd_worker_count: max=99 → max=10 (DB CHECK 일치)
--
-- 13-4. 관리자 상세 모달 강화
--   · partner_assignments SELECT에 모든 보고서 필드 포함
--   · renderRepairReports()가 purpose별 상세 섹션 렌더링
--   · AREA_LABELS/DETECTION_TOOL_LABELS로 영문 코드 → 한글 변환


-- ═══════════════════════════════════════════════════════════════
-- 검증 쿼리 (수동 확인용)
-- ═══════════════════════════════════════════════════════════════

-- 신규 컬럼 존재 확인
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='intake_cases'
--   AND column_name IN ('needs_detection','needs_interior','insurance_subscribed');

-- RPC 시그니처 확인
-- SELECT proname, pg_get_function_arguments(oid)
-- FROM pg_proc WHERE proname IN (
--   'rpc_create_partner_assignment',
--   'rpc_respond_partner_assignment',
--   'rpc_submit_work_done',
--   'rpc_cancel_partner_assignment'
-- );

-- 파트너 회사 specialty_codes 채워졌는지
-- SELECT company_name, specialties, specialty_codes FROM partner_companies;

-- 뷰 컬럼 확인
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name='admin_case_list_v' ORDER BY ordinal_position;


-- ═══════════════════════════════════════════════════════════════
-- 프론트엔드 연동 계약 (index.html v5.6)
-- ═══════════════════════════════════════════════════════════════
--
-- 사고접수 (intake_cases INSERT):
--   needs_detection, needs_interior, insurance_subscribed, insurance_known
--   (구/신 insurance 컬럼은 v5.7에서 insurance_known DROP 예정)
--
-- 파트너 배정 (rpc_create_partner_assignment):
--   p_case_id, p_partner_company_id, p_assigned_by,
--   p_assignment_purpose ('detection' | 'interior'),
--   p_partner_note, p_expires_hours
--   → 업체 선택은 specialty_codes @> ARRAY[purpose] 로 필터링
--
-- 배정 취소 (rpc_cancel_partner_assignment):
--   p_assignment_id, p_cancelled_by ('admin' | 'partner' | 'customer'), p_reason
--
-- 수리완료 (rpc_submit_work_done):
--   16 args. purpose='detection'면 leak_detail_part/detection_count 필수,
--   purpose='interior'면 interior_scope/worker_count/
--   construction_start_date/construction_end_date 필수
--
-- ═══════════════════════════════════════════════════════════════
