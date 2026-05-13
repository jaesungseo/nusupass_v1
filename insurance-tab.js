// v2026-04-19-v5.5 — v5.4.3 (공동소유·마스킹·세대주) + v5.5 (파트너 사고일시)
/**
 * insurance-tab.js  v5.5
 * 누수패스 보험자료 탭
 *
 * 의존성: sb, toast(), curUser (index.html)
 *
 * ✨ v5.5 변경사항 (2026-04-19)
 *   🔴 FEAT: 파트너 현장 파악 사고일시 STEP 2 자동 반영
 *      - loadPartnerAccidentData(): partner_assignments.accident_datetime_at_site 로드
 *      - STEP 2 진입 시 insurance_claims.accident_datetime 비어있으면 파트너값 자동 복사
 *      - 추출 정보 카드에 파트너 파악 배너 추가 (사고일시 + 메모 + 파악방법)
 *      - _insPartnerAccident 전역 변수
 *
 *   🔴 FEAT: STEP 2 재진입 시 DB 강제 재로드 (화면-DB 동기화 안전망)
 *      - insGoStep(2) 호출 시 insurance_claims 최신 값 강제 fetch
 *      - AI 재분석 후 저장 없이 STEP 3 → STEP 2 돌아올 때 값 잃지 않게
 *
 * ✨ v5.4.3 변경사항 (2026-04-19) — 공동소유·마스킹·세대주
 *   🔴 FEAT: 피보험자 성명 마스킹 언마스킹 (insured_name_resolved)
 *      - 보험증권 '서재*' → 주민등록등본 '서재성(900222-...)' 교차검증
 *      - 매칭 근거: 주민번호 앞 6자리 (YYMMDD)
 *      - namesMatch() 유틸로 마스킹 대응 이름 매칭
 *
 *   🔴 FEAT: 공동소유 지원 (insured_owners JSON 배열)
 *      - 기존 insured_owner_name(단일 문자열) → insured_owners([{name, share}]) 배열
 *      - 2차 프롬프트에서 공동소유자 모두 배열로 반환
 *      - 하위호환: D_owners는 배열/단일 문자열 모두 허용
 *
 *   🔴 FEAT: 세대주 추출 (household_head)
 *      - 주민등록등본에서 세대주 성명 분리 추출
 *      - 가족 풀에 자동 포함 (피보험자 + 배우자 + 세대주 + 동거인)
 *
 *   🔴 FEAT: 소유자 이름 정화 (sanitizeOwnerName)
 *      - '서재성 (900222-1******)' → '서재성' (주민번호/괄호 제거)
 *      - '- 이하여백 -' 행은 배열에서 제외
 *
 *   🔴 FEAT: 지위 판정 불일치 감지 배너 (detectStatusMismatch)
 *      - AI 서술 문장에 언급된 지위 vs 필드값 비교
 *      - 불일치 시 STEP 2 상단에 빨간 배너 표시
 *
 *   🔴 FEAT: 저장 로직 확장 (insured_name_resolved, insured_owners_json, insured_household_head)
 *
 * ✨ v5.4.2 변경사항 (2026-04-17 밤 Phase 3 최종)
 *   🔴 FEAT: STEP 3 손해사정보고서 10섹션 풀 구현 (파란손해사정 시안 기반)
 *      - 표지: 회사정보·수신/참조/제목·본문 인사말·손해사정사/조사자 서명·대표이사 직인
 *      - 1. 총괄표: 보험정보 KV + 금액 테이블 (손해방지비용 + 대물배상 + 합계)
 *      - 2. 보험계약사항: 증권 정보 + 일치/불일치 비고
 *      - 3. 일반사항: 가.피보험자 개요 + 나.피해자 개요 (배열 반복 렌더)
 *      - 4. 사고사항 + 현장사진 3단계 (case_documents signed URL, 다중 사진 그리드)
 *      - 5. 법률상 배상책임: 성립/불성립 + 면·부책 + 과실비율 + 손해방지비용 (판단근거 textarea)
 *      - 6. 손해액 평가내역 (개발 진행중 플레이스홀더)
 *      - 7·8. 잔존물·구상 (해당 없음 고정)
 *      - 9. 검토요청사항·향후진행방안 (기본 템플릿)
 *      - 10. 첨부자료 목록 (insurance_doc_uploads 순서대로 소팅)
 *
 *   🔴 FEAT: 편집 가능한 필드 (연노랑 배경, s3SaveReport)
 *      - insurer_name, insurer_contact, report_recipient
 *      - liability_reasoning, coverage_reasoning, fault_ratio, fault_ratio_note
 *      - prevention_cost_memo, examination_request, future_plan
 *      - report_no 미생성 시 rpc_next_report_no() 자동 채번
 *
 *   🔴 FEAT: PDF 출력 (s3ExportPdf)
 *      - body.printing-report 클래스 토글 + window.print()
 *      - @media print: A4 레이아웃, 인쇄 시 편집 필드 배경 제거, 색상 보존
 *      - 브라우저 인쇄 다이얼로그에서 "PDF로 저장" 선택
 *
 *   🔴 FEAT: 데이터 자동 로드 (s3LoadReportData)
 *      - STEP 3 진입 시 파트너 수리 보고 레코드 비동기 로드
 *      - case_documents의 repair_photo_* 사진 signed URL 생성
 *      - _insPartnerReport, _insRepairPhotos 전역
 *
 * ✨ v5.4.1 변경사항 (2026-04-17 밤 핫픽스)
 *   🔴 BUGFIX: liability_reasoning / coverage_reasoning이 DB에 NULL로 저장되던 문제
 *      - 원인: AI 4차 응답에서 reasoning 필드가 빈 문자열 또는 생략되면 그대로 NULL
 *      - 해결: enforceSabiRuleEngine 끝에 "reasoning 자동 생성 안전망" 추가
 *        · liability_reasoning 비어있으면 룰북 카테고리·지위 기반으로 자동 작성
 *        · coverage_reasoning 비어있으면 면부책 사유별 템플릿 자동 작성
 *        · _liability_reasoning_autogen / _coverage_reasoning_autogen 플래그
 *      - 결과: 모든 판정에 최소한의 서술형 근거 보장
 *
 *   🔴 FEAT: 판단근거 textarea로 수정 가능
 *      - 기존 읽기 전용 div → textarea로 변경
 *      - j-liab-reason / j-cov-reason ID로 s2Save에서 수정값 반영
 *      - 손해사정사가 약관 문장 다듬을 수 있음
 *
 *   🔴 FEAT: 사고일시 필드 (ex-accident-dt, datetime-local)
 *      - 추출정보 카드에 신규 필드
 *      - _insResult.accident_datetime 또는 _insClaim.accident_datetime에서 로드
 *      - s2Save에서 accident_datetime으로 저장 (기존 UPDATE 경로 재사용)
 *
 * ✨ v5.4 변경사항 (2026-04-17 밤)
 *   🔴 FEAT: 가족 범위 지위 판정 (온프레미스 STEP 1 벤치마킹)
 *      - computeInsuredStatus에 E_spouse, E_cohabitants 파라미터 추가
 *      - 소유자(D)가 피보험자 본인 / 배우자 / 동거가족 중 하나면 "소유자 측"으로 간주
 *      - 4분기 로직 재편:
 *        · 가족포함 AND C==B → 소유자겸점유자
 *        · 가족밖   AND C==B → 임차인겸점유자
 *        · 가족포함 AND C!=B → 임대인
 *        · 가족밖   AND C!=B → 임차인 (단독)
 *      - 2차 프롬프트 STEP 1에 가족 단위 피보험자 개념 명시
 *      - JSON에 insured_spouse 필드 신설
 *      - enforceSabiRuleEngine R5에 '임차인' 상태도 포함
 *
 *   🔴 FEAT: 피해자 배열 지원 (insurance_victims 테이블)
 *      - _insVictims 전역 변수 + CRUD 헬퍼 3개 (insFetchVictims/Save/Delete)
 *      - STEP 2에 피해자 배열 카드 신설 (추가/수정/삭제 가능)
 *      - 3차 분석에서 피해세대 소유자료로 첫 피해자 자동 채움
 *      - s2Save에서 _insVictims 일괄 저장 (victim_order 재정렬)
 *      - legacy victim_address 필드는 첫 피해자 주소로 동기화 (보고서 호환)
 *
 *   🔴 FEAT: 회사설정 UI (index.html 쪽에서 구현)
 *      - 사이드바 "회사설정" 메뉴 + 전용 화면
 *      - 기본정보(한/영문 이름, 사업자번호, 주소, 전화, FAX, 이메일)
 *      - 손해사정사·조사자 (이름 + 등록번호 각 2쌍)
 *      - 직인 이미지 업로드 (company-assets 버킷)
 *
 *   🔴 DB 마이그레이션 (Phase 1에서 적용 완료)
 *      - insurance_victims 테이블 신설
 *      - insurance_claims 보고서 편집 필드 5개 추가
 *      - rpc_next_report_no() RPC
 *      - company-assets Storage 버킷
 *
 * ✨ v5.3.2 변경사항 (2026-04-17 밤)
 *   🔴 BUGFIX: 같은 doc_code로 재업로드 시 UNIQUE 제약 위반 에러
 *      "duplicate key value violates unique constraint insurance_doc_uploads_claim_doc_unique"
 *      - 원인: v5.3.1 UNIQUE 제약 + 구 로직(is_latest 플래그로 이력 보존)의 충돌
 *             is_latest=false 만 표시하고 INSERT → 중복 레코드 발생 → UNIQUE 위반
 *      - 해결: 덮어쓰기 정책으로 전환
 *             · 기존 Storage 파일 삭제
 *             · 기존 DB 레코드 DELETE
 *             · 새 파일 업로드 + INSERT
 *             · 같은 doc_code 재업로드가 자연스럽게 "교체"로 동작
 *      - Toast 메시지: 신규=" 업로드 완료" / 교체=" 교체 완료"
 *
 * ✨ v5.3.1 변경사항 (2026-04-17 저녁 최종)
 *   🔴 BUGFIX: AI가 필드-텍스트 불일치로 반환 (근거는 "확인불가", 필드는 "임대인")
 *      - 원인: 프롬프트 절대규칙만으로는 모델 inconsistent output 완전 차단 불가
 *      - 해결: 결정론적 판정기 JS 룰엔진 도입
 *        · computeInsuredStatus(): 5축(A~E) 기반 지위 확정
 *        · computeAddressMatch(): A vs B 담보범위 확정
 *        · reconcileInsuredStatus(): AI 반환값과 JS 계산값 비교, JS 승리
 *        · enforceSabiRuleEngine(): 4차 판단 결과 룰 기반 교정
 *          - address_match=error → 면책 강제
 *          - insured_status=확인불가 → liability=no, coverage=판단유보 강제
 *          - 임차인+ⓐ설비하자 → liability=no 강제 (758 단서)
 *          - ⓓ공용부/ⓔ시공불량 → liability=no, coverage=면책 강제
 *
 *   🔴 BUGFIX (DB): (claim_id, doc_code) 중복 업로드로 분석 결과 비결정적
 *      - 해결: v5_3_1_dedupe_doc_uploads_and_unique_constraint 적용
 *        · 과거 7건 중복 제거
 *        · UNIQUE 제약 신설로 재발 원천 차단
 *
 * ✨ v5.3 변경사항 (2026-04-17 저녁)
 *   🔴 구조 개편 1: 서류 용어 재정의
 *      - ownership_insured → ownership_accident (사고발생장소 소유자료)
 *      - "피보험자 세대" 개념 제거 → "사고발생장소" / "피해세대" 이분법
 *      - UI 라벨: "사고발생장소 소유자료" / "피해세대 소유자료" / "피보험자 주민등록등본"
 *      - DB 마이그레이션 v5_3_ownership_accident_rename_and_consistency 적용
 *
 *   🔴 구조 개편 2: 판정 5축 재설계 (재성님 원칙 반영)
 *      A = 보험증권 소재지 / B = 사고발생장소 / C = 피보험자 실거주지
 *      D = 사고발생장소 소유자 / E = 피보험자 성명
 *      · 1단계: A vs B → 담보범위 체크 (다르면 기본 면책)
 *      · 2단계: D,E,B,C 교차 → 피보험자 지위 (소유자겸점유자/임차인/임대인/확인불가)
 *      · 3단계: Sabi 9단계 약관 분기 (기존 유지)
 *      이전 버그: C(실거주지)와 B(사고발생장소)가 다를 때 혼동 → 임차인/임대인 잘못 판정
 *
 *   🔴 구조 개편 3: 배서 확인 권고 자동 삽입
 *      - 담보범위 불일치(error) 케이스에서 면책 처리 시
 *        investigator_opinion에 "배서 이력 확인 권고" 자동 삽입
 *      - 원칙: 증권 주소 ≠ 사고장소 = 기본 면책. 사람이 배서 확인 후 수동 변경.
 *
 *   🔴 구조 개편 4: DB 정합성 — 레거시 doc_code 전수 정리
 *      - insurance_doc_uploads에 CHECK 제약 신설 (6종 doc_code 고정)
 *      - 레거시 데이터(building_register_at, resident_registration 등) 일괄 마이그레이션
 *
 * ✨ v5.2.1 변경사항 (2026-04-17 오후)
 *   🔴 BUGFIX 1: "Unexpected non-whitespace character after JSON at position N"
 *      - 원인: Claude 응답 JSON 뒤 설명/개행 덧붙음 → JSON.parse 실패
 *      - 해결: parseClaudeJson() 헬퍼 (중첩 괄호 카운팅)
 *
 *   🔴 BUGFIX 2: 사고원인 미지정인데 "부책" 오판정
 *      - 원인: accident_cause_type 기본값이 '배관'으로 하드코딩
 *      - 해결: 기본값 '미지정' + STEP 8-0 조기반환 (판단유보)
 *
 *   🔴 BUGFIX 3: 소재지 불일치(error)인데 "부책" 오판정
 *      - 원인: 9단계 STEP C 약관 분기 안쪽 address_match 체크 누락 쉬움
 *      - 해결: STEP 9-B2 최우선 가드 (약관 분기 전 전역 차단)
 *
 *   🔴 BUGFIX 4: AI가 insured_status 필드와 reasoning 불일치 반환
 *      - 해결: 프롬프트 상단 절대규칙에 필드-텍스트 일관성 자기점검 명시
 *
 *   🔴 BUGFIX 5: 임차인+배관(노후) → 부책 오판정 (핵심 구조 결함)
 *      - 원인: 사고원인 옵션이 "부위"(배관/방수층)만 있고 책임주체(ⓐ/ⓑ) 축 없음
 *             → 모델이 임차인에 대해 ⓑ(관리과실)로 추측하는 경향
 *      - 해결: INS_CAUSES 2-depth 확장 (부위 × 하위원인) +
 *             INS_CAUSE_RULEBOOK_MAP로 프롬프트에 사전 매핑 전달 +
 *             절대규칙 5번 "임차인 ⓐ 디폴트" 명시
 *
 *   🔴 BUGFIX 6: rpc_save_judgment이 신 컬럼(liability_result/coverage_result)에 안 씀
 *      - 원인: RPC가 구 컬럼(liability_established/liability_pay)에만 UPDATE
 *             + insurance_tab_status='judgment_done' (CHECK 위반으로 silent fail)
 *      - 해결: DB 측 마이그레이션 v5_2_1_rpc_bugfix_and_accident_type_expand 적용
 *             RPC 15-arg 확장 + status='ready_for_draft' + 구 8-arg 오버로드 삭제
 *      - 클라: s2Save()가 신규 파라미터 전달
 *
 *   🔴 BUGFIX 7: DB CHECK 제약에 '미지정' 없어서 STEP 8-0 적용 시 INSERT 에러 유발
 *      - 해결: 동일 마이그레이션에서 accident_type_check에 '미지정' 추가
 *
 * ✨ v5.2 변경사항 (2026-04-17 저녁)
 *   1. 누수원인 룰북 신설: 5개 책임주체 × 대표 케이스 + 키워드 힌트
 *   2. 민법 제758조 본문/단서 프롬프트 명시 구분
 *   3. 서류 체계 재정비: building_reg_* → ownership_* (등기부 OR 건축물대장 통합)
 *      (ownership_insured / ownership_victim)
 *   4. 추출 항목 확장 (20개 → 25개): 소유자명, 소유권이전일, 동거인, 사고일시, 피해사항 등
 *   5. Reasoning 스타일 가이드: "피보험자의 손해배상책임은 [성립/불성립]함" 명시 필수
 *   6. 등기부등본 1순위 / 건축물대장 보조 판단 규칙
 *
 * ✨ v5.1 변경사항 (2026-04-17 아침)
 *   🔴 CRITICAL BUGFIX: 8단계 STEP A가 "주택관리는 무조건 성립"으로 잘못 판정하던 문제 수정
 *      → Sabi 레퍼런스 v5.1 대로 피보험자 지위별 분기 적용
 *
 * ✨ v5 변경사항
 *   1. 약관 체계 재정의: 가족일상생활(구형) / 가족일상생활(신형) / 일상생활(일배책) 3종
 *   2. INS_TYPE_CONTEXT: Sabi v2.3 원칙 반영
 *   3. Sabi 8·9단계 프롬프트 + 3-value coverage_result
 *
 * 3단계:
 *   STEP 1. 준비      — 보고서 기본정보 + 약관구분 선택 + 서류 업로드
 *   STEP 2. 분석·판단 — Claude 자동 추출 결과 + 책임 판단 (한 화면, 모두 수정 가능)
 *   STEP 3. 보고서    — 손해사정서 양식 미리보기 + 수정 + PDF 출력
 */
'use strict';

// ─────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────
const INS_MODEL      = 'claude-sonnet-4-6';
const INS_PROMPT_VER = 'v5.5';
const INS_LEGAL_VER  = 'v2.0';

const INS_LEGAL = `[민법 제750조] 고의 또는 과실로 인한 위법행위로 타인에게 손해를 가한 자는 그 손해를 배상할 책임이 있다.
[민법 제758조] 공작물의 설치 또는 보존의 하자로 인하여 타인에게 손해를 가한 때에는 공작물점유자가 손해를 배상할 책임이 있다. 그러나 점유자가 손해의 방지에 필요한 주의를 해태하지 아니한 때에는 그 소유자가 배상할 책임이 있다.
[상법 제680조] 보험계약자와 피보험자는 손해의 방지와 경감을 위하여 노력하여야 한다.`;

// ─────────────────────────────────────────────
// 약관 라벨 (UI 표시용)
// ─────────────────────────────────────────────
const INS_TYPE_LABELS = {
  family_daily_old: '가족일상생활배상책임 (구형)',
  family_daily_new: '가족일상생활배상책임 (신형)',
  personal_daily:   '일상생활배상책임 (일배책)',
};

// v6.2: 약관 종류 드롭다운 옵션 (준비중 표시용)
const INS_TYPE_OPTIONS = [
  { value: 'family_daily_new',  label: '가족일상생활배상책임 (신형)',  enabled: true },
  { value: 'family_daily_old',  label: '가족일상생활배상책임 (구형)',  enabled: true },
  { value: 'personal_daily',    label: '일상생활배상책임',              enabled: true },
  { value: 'facility_owner',    label: '시설소유배상책임',              enabled: false, note: '준비중' },
  { value: 'lessor',            label: '임대인배상책임',                enabled: false, note: '준비중' },
  { value: 'water_leak_rider',  label: '급배수누출손해특약',            enabled: false, note: '준비중' },
];

// ─────────────────────────────────────────────
// 약관별 핵심 분기 (Sabi v2.3 원칙: 임대인+주택관리 한 점에서만 갈림)
// ─────────────────────────────────────────────
const INS_TYPE_CONTEXT = {
  family_daily_old: `약관 구분: 가족일상생활배상책임 (구형)
- 제1호 "보험증권에 기재된 주택에 주거하는 피보험자가 주택의 소유·사용·관리에 기인하는 사고"
- 제2호 "주택 이외의 부동산의 소유·사용·관리 제외" — 일상생활 조항은 피보험자 거주 주택 외 부동산 관리 제외
- 피보험자 범위: 기명 피보험자 + 배우자 + 동거친족 + 별거 미혼자녀 (가족 단위)
- 임대인(소유자지만 비거주자) 면책: 제1호의 "주거하는" 조건 불충족 → 면책
- 주택관리 + 소유자겸점유자 + 소재지 일치 → 부책`,

  family_daily_new: `약관 구분: 가족일상생활배상책임 (신형)
- 제1호 범위 확대: "피보험자가 주거하고 있는 주택 AND 소유자인 피보험자가 임대 등을 통해 주거를 허락한 자가 살고 있는 주택"
- 제2호 일상생활 조항 동일
- 피보험자 범위: 기명 피보험자 + 배우자 + 동거친족 + 별거 미혼자녀 (가족 단위)
- 임대인(소유자지만 비거주자) 부책 가능: 제1호 확대로 임대한 주택도 담보 범위 포함
- 구형과의 유일한 차이: 임대인 + 주택관리 사고 케이스 → 부책 가능`,

  personal_daily: `약관 구분: 일상생활배상책임 (일배책, 개인용)
- 제1호 "피보험자가 주거용으로 사용하는 보험증권에 기재된 주택의 소유·사용·관리에 기인하는 사고"
- 제2호 "피보험자의 일상생활에 기인하는 우연한 사고"
- 피보험자 범위: 기명 피보험자 + 그와 동거하는 배우자 한정 (가족 특약보다 좁음)
- 면·부책 로직은 구형과 완전 동일: 임대인(소유자지만 비거주자) → "주거용으로 사용하는" 조건 불충족 → 면책
- 구형과의 유일한 차이는 피보험자 범위 축소 (가족 단위 → 본인+동거배우자 한정)`,
};

const INS_INSURERS = [
  '삼성화재해상보험','현대해상화재보험','DB손해보험주식회사',
  'KB손해보험','메리츠화재','한화손해보험','흥국화재해상보험',
  '롯데손해보험','농협손해보험',
];

// ─────────────────────────────────────────────
// 사고원인 옵션 (v5.2.1 확장)
//
// 기존 INS_CAUSES는 "부위"(배관/방수층/...)만 있었음 → 모델이 ⓐ vs ⓑ 구분을 추측하게 되어
// 임차인+배관(노후) 케이스가 ⓑ(관리과실)로 오판정되는 구조적 문제 있었음.
//
// v5.2.1: [부위] + [하위원인]을 결합한 2-depth 옵션으로 확장.
// 하위원인은 룰북 ⓐ·ⓑ·ⓒ·ⓓ·ⓔ 중 하나로 사전 매핑되어 프롬프트에 명시 전달됨.
//
// 기존 데이터 호환: accident_cause_type 컬럼은 text이므로 과거 '배관' 같은 단순 값도 허용.
//                   프롬프트에서 하위원인 없으면 ⓐ(설비하자) 디폴트 규칙 적용.
// ─────────────────────────────────────────────
const INS_CAUSES = [
  '배관 (노후/파손)',           // → ⓐ 전유부 설비하자 (758 단서, 소유자)
  '배관 (관리과실/동파)',       // → ⓑ 전유부 관리과실 (758 본문, 점유자)
  '배관 (시공불량 10년이내)',   // → ⓔ 시공불량 (시공사)
  '방수층 (노후/파손)',         // → ⓐ
  '방수층 (시공불량 10년이내)', // → ⓔ
  '분배기 (고장/노후)',         // → ⓐ
  '보일러 (고장/노후)',         // → ⓐ
  '세탁기 호스이탈',            // → ⓒ 행위과실 (750, 점유자)
  '배수구 막힘 (관리태만)',     // → ⓑ
  '수도꼭지 미잠금',            // → ⓒ
  '공용부 (공용배관/옥상/지하)', // → ⓓ 공용부 (관리단)
  '원인미상 (누수탐지 필요)',   // → 판단유보
  '기타(직접입력)',             // → 수리소견 기반 판단
];

// 사고원인별 룰북 카테고리 사전 매핑 (프롬프트 주입용)
// key: INS_CAUSES의 value, value: { rulebook_category, 설명 }
const INS_CAUSE_RULEBOOK_MAP = {
  '배관 (노후/파손)':           { cat: 'ⓐ', label: '전유부 설비하자 (민법 제758조 제1항 단서, 소유자 책임)' },
  '배관 (관리과실/동파)':       { cat: 'ⓑ', label: '전유부 관리과실 (민법 제758조 제1항 본문, 점유자 책임)' },
  '배관 (시공불량 10년이내)':   { cat: 'ⓔ', label: '시공불량 (민법 제750조, 시공사 책임)' },
  '방수층 (노후/파손)':         { cat: 'ⓐ', label: '전유부 설비하자 (민법 제758조 제1항 단서, 소유자 책임)' },
  '방수층 (시공불량 10년이내)': { cat: 'ⓔ', label: '시공불량 (민법 제750조, 시공사 책임)' },
  '분배기 (고장/노후)':         { cat: 'ⓐ', label: '전유부 설비하자 (민법 제758조 제1항 단서, 소유자 책임)' },
  '보일러 (고장/노후)':         { cat: 'ⓐ', label: '전유부 설비하자 (민법 제758조 제1항 단서, 소유자 책임)' },
  '세탁기 호스이탈':            { cat: 'ⓒ', label: '행위과실 (민법 제750조, 점유자 책임)' },
  '배수구 막힘 (관리태만)':     { cat: 'ⓑ', label: '전유부 관리과실 (민법 제758조 제1항 본문, 점유자 책임)' },
  '수도꼭지 미잠금':            { cat: 'ⓒ', label: '행위과실 (민법 제750조, 점유자 책임)' },
  '공용부 (공용배관/옥상/지하)': { cat: 'ⓓ', label: '공용부 하자 (공동주택관리법 제63조·집합건물법 제16조, 관리단 책임)' },
  '원인미상 (누수탐지 필요)':   { cat: '미지정', label: '사고원인 미확정 (판단유보)' },
  // 레거시 호환 (v5.2 이전 값)
  '배관':       { cat: 'ⓐ?', label: '전유부 설비하자 추정 (하위원인 미지정 — 수리소견으로 재확인 필요)' },
  '방수층':     { cat: 'ⓐ?', label: '전유부 설비하자 추정 (하위원인 미지정 — 수리소견으로 재확인 필요)' },
  '분배기':     { cat: 'ⓐ?', label: '전유부 설비하자 추정 (하위원인 미지정 — 수리소견으로 재확인 필요)' },
  '보일러':     { cat: 'ⓐ?', label: '전유부 설비하자 추정 (하위원인 미지정 — 수리소견으로 재확인 필요)' },
  '배수구 막힘': { cat: 'ⓑ?', label: '전유부 관리과실 추정 (하위원인 미지정)' },
  '기타':        { cat: '?',   label: '수리소견으로 판단' },
  '기타(직접입력)': { cat: '?', label: '수리소견으로 판단' },
};

// v6.2 INS_DOCS — 3그룹 A안 (사용자 결정사항 반영)
//   group: 'A_contract'  = A. 계약 서류 (보험증권 + 약관)
//          'B_claim'      = B. 청구·소견·경위 서류
//          'C_public_insured' = C. 공공서류 — 피보험자(가해자)
//          'C_public_victim'  = C. 공공서류 — 피해자
//
// multipleFiles: true 슬롯은 한 슬롯에 파일 2개까지 업로드 가능
//                (등본+가족관계증명서 통합, 또는 건축물대장+등기부등본 통합)
const INS_DOCS = [
  // A. 계약 서류
  { code:'insurance_policy',   name:'보험증권',                            type:'pdf', required:true,  group:'A_contract',       multipleFiles:false },

  // B. 청구·소견·경위 서류
  { code:'claim_form',         name:'보험청구서 또는 사고접수지',          type:'pdf', required:false, group:'B_claim',          multipleFiles:false },
  { code:'leak_opinion_external', name:'누수소견서',                        type:'pdf', required:false, group:'B_claim',          multipleFiles:false, hasModal:true },
  { code:'incident_statement', name:'경위서',                              type:'pdf', required:false, group:'B_claim',          multipleFiles:false },

  // C. 공공서류 — 피보험자(가해자)
  { code:'family_doc',         name:'주민등록등본 / 가족관계증명서',       type:'pdf', required:true,  group:'C_public_insured', multipleFiles:true  },
  { code:'ownership_insured',  name:'건축물대장 / 등기부등본',             type:'pdf', required:true,  group:'C_public_insured', multipleFiles:true  },

  // C. 공공서류 — 피해자 (1명 기본, [+ 피해자 추가]로 N명 확장)
  { code:'ownership_doc_victim', name:'건축물대장 / 등기부등본',           type:'pdf', required:false, group:'C_public_victim',  multipleFiles:true  },
  { code:'family_doc_victim',  name:'주민등록등본 / 가족관계증명서',       type:'pdf', required:false, group:'C_public_victim',  multipleFiles:true  },

  // 레거시 호환 (v5.x 기존 케이스 표시용 — 신규 케이스는 위 doc_code 사용)
  { code:'resident_reg',       name:'피보험자 주민등록등본 (legacy)',      type:'pdf', required:false, group:'_legacy',          multipleFiles:false, legacy:true },
  { code:'family_cert',        name:'가족관계증명서 (legacy)',             type:'pdf', required:false, group:'_legacy',          multipleFiles:false, legacy:true },
  { code:'ownership_accident', name:'사고세대 건축물대장+등기부 (legacy)', type:'pdf', required:false, group:'_legacy',          multipleFiles:false, legacy:true },
  { code:'ownership_victim',   name:'피해세대 건축물대장+등기부 (legacy)', type:'pdf', required:false, group:'_legacy',          multipleFiles:false, legacy:true },
];

// v6.2 카드 메타데이터 (3그룹)
const INS_DOC_GROUPS = {
  A_contract:        { icon:'📄', cls:'v6-icon-policy',   title:'A. 계약 서류',         sub:'보험증권 + 약관 종류' },
  B_claim:           { icon:'📋', cls:'v6-icon-claim',    title:'B. 청구·소견·경위 서류', sub:'보험청구서 + 누수소견서 + 경위서' },
  C_public_insured:  { icon:'👤', cls:'v6-icon-insured',  title:'C. 공공서류 — 피보험자(가해자)', sub:'등본·가족관계증명서·건축물대장·등기부' },
  C_public_victim:   { icon:'🏠', cls:'v6-icon-victim',   title:'C. 공공서류 — 피해자',  sub:'등본·가족관계·건축물대장·등기부 (피해자별)' },
  _legacy:           { icon:'📦', cls:'v6-icon-legacy',   title:'레거시 (v5.x)',         sub:'기존 케이스 호환' },
};

// ─────────────────────────────────────────────
// v6.2: 시스템 지식 (법률·전유공용·약관) — 7~9단계 분석 시 프롬프트에 자동 주입
// ─────────────────────────────────────────────
const LEGAL_STATUTES_TEXT = `[민법 제750조 (불법행위의 내용)]
고의 또는 과실로 인한 위법행위로 타인에게 손해를 가한 자는 그 손해를 배상할 책임이 있다.
→ 누수 사고에서 점유자의 사용상 과실(수도꼭지 미잠금, 호스이탈 등) 적용 기본 조항.

[민법 제758조 (공작물 등의 점유자·소유자의 책임)]
① 공작물의 설치 또는 보존의 하자로 인하여 타인에게 손해를 가한 때에는 공작물점유자가 손해를 배상할 책임이 있다. 그러나 점유자가 손해의 방지에 필요한 주의를 해태하지 아니한 때에는 그 소유자가 손해를 배상할 책임이 있다.
③ 전2항의 경우에 점유자 또는 소유자는 그 손해의 원인에 대한 책임있는 자에 대하여 구상권을 행사할 수 있다.
→ 누수 사고에서 핵심 조항. 배관/방수층/보일러 등 공작물 하자 시 1차 점유자, 점유자 무과실 시 소유자.

[공동주택관리법 제63조 (관리주체의 업무 등)]
② 관리주체의 업무는 다음과 같다.
1. 공동주택의 공용부분의 유지·보수 및 안전관리
→ 공용부 사고 시 관리주체(관리사무소·입주자대표회의)에 책임.

[집합건물의 소유 및 관리에 관한 법률 제16조 (공용부분의 관리)]
② 공용부분의 관리에 소요되는 비용과 공용부분에서 생기는 이익은 각 공유자가 지분의 비율로 부담하거나 취득한다.
→ 공용부 사고 시 관리주체 책임 + 비용 부담 근거.`;

const EXCLUSIVE_COMMON_AREAS_TEXT = `[전유부분 정의]
구분소유권의 목적인 건물부분. 각 세대가 단독으로 소유·배타적으로 사용하는 공간.
- 세대 현관문 안쪽의 내부 공간
- 세대 내부의 급수관·온수관·난방배관·보일러·분배기
- 세대 내부의 방수층 (화장실·세탁실·베란다)
- 세대 전용 배관 (분기점 이후)

[공용부분 정의]
전유부분 외의 건물부분, 전유부분에 속하지 아니하는 건물의 부속물.
- 외벽·옥상·공용복도·계단·지하주차장
- 공용배관 (수직 공용 급수관, 우수관)
- 공용급수펌프·옥상 물탱크·소방시설
- 둘 이상의 세대에 공급되는 배관

[핵심 구분 기준]
- 특정 세대만을 위해 존재 → 전유부분
- 둘 이상의 세대 또는 건물 전체를 위해 존재 → 공용부분
- 수직 공용배관에서 분기하여 세대 내부로 연결되는 분기점(분기밸브) 이후부터는 전유부분

[책임 귀속]
- 전유부 사고 → 세대 소유자·점유자 (민법 제758조)
- 공용부 사고 → 관리주체 (민법 제758조 + 공동주택관리법 63조 + 집합건물법 16조)
- 시공불량으로 인한 전유부 사고 → 시공업체 하자담보책임 우선`;

// 약관 본문 — 약관 종류에 따라 분기 (구형/신형/일배책)
const TERMS_CONTENT = {
  family_daily_old: `[가족일상생활배상책임 (구형)]

【보상하는 손해】
회사는 피보험자가 이 특별약관의 보험기간 중에 아래에 열거한 사고로 타인의 신체장해 또는 재물 손해에 대한 법률상의 배상책임을 부담함으로써 입은 손해를 보상합니다.
1. 보험증권에 기재된 주택에 주거하는 피보험자가 주택의 소유·사용·관리에 기인한 우연한 사고
2. 피보험자의 일상생활(주택 이외 부동산의 소유·사용 및 관리 제외)에 기인하는 우연한 사고

【피보험자 범위】
1. 기명 피보험자
2. 기명 피보험자의 배우자
3. 생계를 같이 하고 보험증권 기재 주택의 주민등록상 동거 중인 동거 친족 (민법 제777조)
4. 기명 피보험자 또는 배우자와 생계를 같이 하는 별거중인 미혼 자녀

【보상하지 않는 손해 — 주요】
- 고의로 생긴 손해
- 보험증권에 기재된 주택을 제외한 부동산으로 인한 배상책임
- 피보험자와 세대를 같이하는 친족에 대한 배상책임
- 항공기·선박·차량·총기의 소유·사용·관리에 기인한 배상책임
- 폭력행위에 기인하는 배상책임

【핵심 한계】
구형 약관은 "소유주택 = 거주주택" 일치를 조건으로 함.
→ 임대인(소유했지만 비거주) 케이스는 보상 불가 (제1호 "주거하는 피보험자" 요건 불충족).
→ 제2호 "일상생활"도 "주택 이외 부동산 제외"이므로 적용 불가.`,

  family_daily_new: `[가족일상생활배상책임 (신형)]

【보상하는 손해】
회사는 피보험자가 이 특별약관의 보험기간 중에 아래에 열거한 사고로 타인의 신체장해 또는 재물 손해에 대한 법률상의 배상책임을 부담함으로써 입은 손해를 보상합니다.
1. 피보험자가 주거하고 있는 주택과 주택의 소유자인 피보험자가 임대 등을 통해 주거를 허락한 자가 살고 있는 주택 중 보험증권에 기재된 하나의 주택의 소유·사용·관리에 기인한 우연한 사고
2. 피보험자의 일상생활(주택 이외 부동산의 소유·사용 및 관리 제외)에 기인하는 우연한 사고

【피보험자 범위】
1. 기명 피보험자
2. 기명 피보험자의 배우자
3. 생계를 같이 하고 보험증권 기재 주택의 주민등록상 동거 중인 동거 친족
4. 기명 피보험자 또는 배우자와 생계를 같이 하는 별거중인 미혼 자녀

【보상하지 않는 손해 — 주요】
- 고의로 생긴 손해
- 보험증권에 기재된 주택을 제외한 부동산으로 인한 배상책임
- 피보험자와 세대를 같이하는 친족에 대한 배상책임
- 항공기·선박·차량·총기의 소유·사용·관리로 인한 배상책임
- 폭력행위로 인한 배상책임

【구형 대비 개선】
신형은 "소유자가 임대한 주택"도 보상 대상에 포함 (2020.04.01 개정).
→ 임대인(소유했지만 비거주) 케이스도 보상 가능 (단, 보험증권 기재 주택 1개에 한함).`,

  personal_daily: `[일상생활배상책임 (일배책)]

【보상하는 손해】
회사는 피보험자 및 그와 동거하는 배우자가 이 특별약관의 보험기간 중에 아래 사고로 타인의 신체장해 또는 재물 손해에 대한 법률상의 배상책임을 부담함으로써 입은 손해를 보상합니다.
1. 피보험자가 주거용으로 사용하는 보험증권에 기재된 주택의 소유·사용·관리에 인한 우연한 사고
2. 피보험자의 일상생활(주택 이외 부동산의 소유·사용 및 관리 제외)에 기인하는 우연한 사고

【피보험자 범위】
보험증권에 기재된 피보험자 및 그와 동거하는 배우자만 해당.
(가족일배책 대비 범위 좁음 — 자녀·동거친족 제외)

【보상하지 않는 손해 — 주요】
- 고의로 생긴 손해
- 보험증권에 기재된 주택을 제외한 부동산으로 인한 배상책임
- 피보험자와 세대를 같이하는 친족에 대한 배상책임
- 차량·항공기·선박의 소유·사용·관리에 기인한 배상책임
- 폭력행위에 기인하는 배상책임

【핵심 한계】
"주거용으로 사용하는" 조건 → 임대인은 보상 불가.
피보험자 범위가 본인+동거 배우자만 → 동거 자녀 등은 별도 자녀배상책임 필요.`,
};

// 피보험자 지위 4-value (표기 통일 — 백엔드 enum과 매칭)
const INSURED_STATUS_VALUES = [
  '소유자겸점유자',
  '임차인겸점유자',
  '임대인',
  '확인불가',
];

// 면·부책 3-value (v5 변경: 면책(판단유보) 폐지)
const COVERAGE_RESULT_VALUES = ['부책','면책','판단유보'];

// ─────────────────────────────────────────────
// 전역 상태
// ─────────────────────────────────────────────
let _insClaim    = null;
let _insCaseId   = null;
let _insField    = null;   // 파트너 수리 자료 (호환 유지: 첫 번째 또는 detection 우선)
let _insPartners = [];     // v6.1: 다중 파트너 배열 — [{id, purpose, work_status, repair_cost, ...}]
let _insImportedPartners = new Set();  // v6.1: 임포트 토글 상태 (assignment_id Set)
let _insCompany  = null;   // company_settings
let _insUploaded = {};     // { doc_code: { id, file_path, doc_name } }
let _insStep     = 1;
let _insResult   = {};     // Claude 추출 + 판단 결과 (STEP 2)
let _insDraft    = null;   // 저장된 초안
let _insAnalyzing = false;

// v6.2 STEP 2: 사실정보 후보 검토·수정
let _extractedCandidates = {};  // { field_key: [{value, source, type}, ...] } — 추출 4-Call 결과
let _userOverrides = {};         // { field_key: user_modified_value } — 사용자 직접 수정값
let _analyzingStep = 0;          // 9단계 분석 진행 상태 (0~9)
let _insVictims  = [];     // v5.4: 피해자 배열 [{id?, victim_order, victim_name, victim_address, ...}]
let _insPartnerAccident = null;  // v5.5: 파트너 현장 파악 사고일시 {accident_datetime_at_site, accident_datetime_source, accident_datetime_note}

// ─────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────
// v6.2.10: 보험자료 탭 진입/이탈 시 모든 사건 메모리 클리어 (이전 사건 데이터 섞임 방지)
function clearInsuranceState() {
  _insClaim = null;
  _insCaseId = null;
  _insField = null;
  _insPartners = [];
  _insImportedPartners = new Set();
  _insCompany = null;
  _insUploaded = {};
  _insStep = 1;
  _insResult = {};
  _insDraft = null;
  _insAnalyzing = false;
  _insVictims = [];
  try { _insHandler = null; } catch(e) {}  // 정의 위치 차이로 인한 안전장치
  // v6.2 신규 상태
  _extractedCandidates = {};
  _userOverrides = {};
  _analyzingStep = 0;
}
window.clearInsuranceState = clearInsuranceState;

async function openInsuranceTab(caseId, caseNo) {
  _insClaim = null; _insCaseId = caseId; _insField = null;
  _insPartners = []; _insImportedPartners = new Set();  // v6.1: 다중 파트너 초기화
  _insCompany = null; _insUploaded = {}; _insStep = 1;
  _insResult = {}; _insDraft = null; _insAnalyzing = false;
  _insVictims = [];
  _insHandler = null;
  // v6.2: STEP 2 상태도 초기화 (사건 전환 시 이전 사건의 추출 결과가 남는 버그 방지)
  _extractedCandidates = {};
  _userOverrides = {};
  _analyzingStep = 0;

  go('insurance');
  document.getElementById('insurancePageSub').textContent = `사건 ${caseNo || caseId.slice(0,8)}`;
  document.getElementById('insuranceTabBody').innerHTML =
    `<div class="loading"><span class="spinner"></span> 불러오는 중…</div>`;

  try {
    const [claim, field, partners, company, handler] = await Promise.all([
      insEnsureClaim(caseId),
      insFetchField(caseId),
      insFetchAllPartners(caseId),  // v6.1: 다중 파트너 로드
      insFetchCompany(),
      insFetchHandler(),  // v6.1.4: 본인(담당자) 정보
    ]);
    _insClaim = claim; _insField = field; _insCompany = company;
    _insPartners = partners;
    _insHandler = handler;

    // v6.1: 보고서 제출된 파트너는 기본적으로 임포트 ON, 미제출은 OFF
    _insPartners.forEach(p => {
      if (p.has_report) _insImportedPartners.add(p.id);
    });

    const uploads = await insFetchUploads(claim.id);
    uploads.forEach(u => { _insUploaded[u.doc_code] = u; });

    // v5.4: 피해자 배열 로드
    _insVictims = await insFetchVictims(claim.id);

    if (claim.current_draft_id) {
      const { data } = await sb.from('insurance_claim_drafts')
        .select('*').eq('claim_id', claim.id).eq('is_current', true).maybeSingle();
      if (data) {
        _insDraft = data;
        _insResult = data.sections_jsonb || {};
      }
    }

    // 상태별 단계 복원
    const s = claim.insurance_tab_status;
    _insStep = (s === 'pdf_submitted' || s === 'draft_generated') ? 3
             : (s === 'info_in_progress' || s === 'ready_for_draft') ? 2
             : 1;
    insRender();

    // v6.1.1: 신규 케이스 (약관 미선택) → 약관 선택 모달 자동 띄우기
    //   기존 케이스(약관 이미 선택됨)는 바로 STEP 1
    if (!claim.insurance_type && _insStep === 1) {
      setTimeout(() => insOpenPolicyModal(), 100);
    }
  } catch(e) {
    document.getElementById('insuranceTabBody').innerHTML =
      `<div class="card" style="color:var(--red)">오류: ${e.message}</div>`;
  }
}

// ─────────────────────────────────────────────
// v6.1.1: 모달 흐름 — 약관 선택 → 파트너 임포트 → STEP 1
// ─────────────────────────────────────────────

// 모달 1: 약관 선택 열기
function insOpenPolicyModal() {
  const modal = document.getElementById('insPolicyModal');
  if (!modal) { console.warn('[v6.1.1] insPolicyModal not found'); return; }
  // 현재 약관에 맞춰 selected 표시 동기화
  const cur = _insClaim?.insurance_type || 'family_daily_new';
  document.querySelectorAll('#insPolicyModal .ins-modal-opt').forEach(el => {
    const v = el.dataset.policy;
    el.classList.toggle('selected', v === cur);
    const r = el.querySelector('input[type=radio]');
    if (r) r.checked = (v === cur);
  });
  modal.classList.add('open');
}
function insClosePolicyModal() {
  document.getElementById('insPolicyModal')?.classList.remove('open');
}
function insSelectPolicy(el) {
  document.querySelectorAll('#insPolicyModal .ins-modal-opt').forEach(x => x.classList.remove('selected'));
  el.classList.add('selected');
  el.querySelector('input[type=radio]').checked = true;
}
async function insConfirmPolicy() {
  const sel = document.querySelector('#insPolicyModal .ins-modal-opt.selected');
  if (!sel) { toast('약관을 선택해주세요','w'); return; }
  const policyVal = sel.dataset.policy;
  // DB에 즉시 저장
  if (_insClaim?.id) {
    try {
      await sb.from('insurance_claims').update({ insurance_type: policyVal }).eq('id', _insClaim.id);
      _insClaim.insurance_type = policyVal;
    } catch (e) { console.warn('[v6.1.1] 약관 저장 실패:', e); }
  }
  insClosePolicyModal();
  // 곧바로 파트너 임포트 모달
  insOpenImportModal();
}

// 모달 2: 파트너 임포트
function insOpenImportModal() {
  const modal = document.getElementById('insImportModal');
  if (!modal) { console.warn('[v6.1.1] insImportModal not found'); return; }
  insRenderImportModal();
  modal.classList.add('open');
}
function insCloseImportModal() {
  document.getElementById('insImportModal')?.classList.remove('open');
}
function insBackToPolicyModal() {
  insCloseImportModal();
  insOpenPolicyModal();
}
function insRenderImportModal() {
  const list = document.getElementById('insImportModalList');
  if (!list) return;
  if (!_insPartners || _insPartners.length === 0) {
    list.innerHTML = `
      <div style="padding:20px;text-align:center;color:#8A8A8A;font-size:13px;background:#F4F2EE;border-radius:6px">
        ℹ 이 케이스에 배정된 파트너가 없습니다.<br>
        <span style="font-size:11px">아래 "외부 케이스" 옵션을 체크하고 진행하세요.</span>
      </div>`;
    return;
  }
  // 보고서 제출된 파트너 = 첫 임포트 후보
  const firstReady = _insPartners.find(p => p.has_report);
  list.innerHTML = _insPartners.map(p => {
    const purposeLabel = p.assignment_purpose === 'restore' ? '인테리어업체'
                       : p.assignment_purpose === 'detection' ? '누수업체'
                       : '파트너';
    const purposePillCls = p.assignment_purpose === 'restore' ? 'amber' : '';
    const isReady = p.has_report;
    const isSelected = isReady && p.id === firstReady?.id;
    const detail = (isReady && p.leak_cause) ? `· 누수원인: ${escapeHtml(p.leak_cause)}<br>` : '';
    const acc = (isReady && p.accident_occurred_at) ? `· 사고일시: ${fmtDate(p.accident_occurred_at)} (가해세대 진술)<br>` : '';
    const done = (isReady && p.work_done_at) ? fmtDate(p.work_done_at) + ' 작업완료' : '진행중';
    return `
      <label class="ins-modal-opt ${isSelected?'selected':''} ${isReady?'':'disabled'}" 
             data-partner-id="${p.id}" 
             onclick="${isReady?`insSelectImportPartner(this)`:'return false'}">
        <input type="radio" name="ins-partner" value="${p.id}" ${isSelected?'checked':''} ${isReady?'':'disabled'}>
        <div class="ins-modal-row1">
          <div class="ins-modal-radio"></div>
          <span class="ins-modal-name">${escapeHtml(p.partner_name)}</span>
          <span class="ins-modal-pill ${purposePillCls}">${purposeLabel}</span>
          <span class="ins-modal-meta">${done}</span>
        </div>
        <div class="ins-modal-desc">
          ${isReady ? `${detail}${acc}${p.repair_cost?`· 수리금액: ${Number(p.repair_cost).toLocaleString()}원`:''}` : '작업 완료 후 임포트 가능'}
        </div>
      </label>`;
  }).join('');
}
function insSelectImportPartner(el) {
  if (el.classList.contains('disabled')) return;
  // 외부 케이스 체크 해제
  const ext = document.getElementById('insExternalCase');
  if (ext) ext.checked = false;
  document.querySelectorAll('#insImportModal .ins-modal-opt').forEach(x => x.classList.remove('selected'));
  el.classList.add('selected');
  const r = el.querySelector('input[type=radio]');
  if (r) r.checked = true;
}
function insToggleExternal(checked) {
  if (checked) {
    document.querySelectorAll('#insImportModal .ins-modal-opt').forEach(x => {
      x.classList.remove('selected');
      const r = x.querySelector('input[type=radio]');
      if (r) r.checked = false;
    });
  }
}
async function insConfirmImport() {
  const ext = document.getElementById('insExternalCase')?.checked;
  if (ext) {
    // 외부 케이스 → 임포트 없이 진행
    _insImportedPartners = new Set();
    _insField = null;
  } else {
    const sel = document.querySelector('#insImportModal .ins-modal-opt.selected');
    if (!sel) {
      // 선택 안하고 외부도 체크 안함
      if (_insPartners.length > 0) {
        toast('파트너를 선택하거나 외부 케이스를 체크해주세요','w');
        return;
      }
      _insImportedPartners = new Set();
      _insField = null;
    } else {
      const partnerId = sel.dataset.partnerId;
      _insImportedPartners = new Set([partnerId]);
      _insField = _insPartners.find(p => p.id === partnerId) || null;
    }
  }
  insCloseImportModal();
  insRender();
}

async function loadInsuranceCaseSelector() {
  const sel = document.getElementById('insuranceCaseSelect');
  if (!sel) return;

  // v6.2.12: 진입 조건 (옵션 A — 가장 넓음)
  // 1. needs_insurance = true (사고접수 시 "보험처리만" 체크)
  // 2. insurance_status = 'active' (손해사정사 수동 활성화 — 카톡 등 외부 보고 케이스)
  // 3. 파트너 수리완료 (work_status IN ['repair_done','repair_completed'])
  //
  // 한 번의 쿼리로 처리하기 위해 intake_cases 기준으로 조회하고
  // 파트너 정보는 LEFT JOIN으로 가져옴

  // (a) needs_insurance OR insurance_status='active' 케이스
  const { data: directCases, error: e1 } = await sb.from('intake_cases')
    .select('id, case_no, customer_name, address_region, needs_insurance, insurance_status, created_at')
    .or('needs_insurance.eq.true,insurance_status.eq.active')
    .order('created_at', { ascending: false });
  if (e1) {
    console.error('[v6.2.12] directCases 조회 실패:', e1);
  }

  // (b) 파트너 수리완료 케이스
  const { data: partnerCases, error: e2 } = await sb.from('partner_assignments')
    .select('case_id, intake_cases(id, case_no, customer_name, address_region, created_at)')
    .in('work_status', ['repair_done','repair_completed'])
    .eq('assignment_status', 'accepted')
    .order('created_at', { ascending: false });
  if (e2) {
    console.error('[v6.2.12] partnerCases 조회 실패:', e2);
  }

  // 두 결과 병합 (중복 제거)
  const seenIds = new Set();
  const allCases = [];
  for (const c of (directCases || [])) {
    if (!seenIds.has(c.id)) {
      seenIds.add(c.id);
      allCases.push({
        id: c.id, case_no: c.case_no, customer_name: c.customer_name,
        source: c.needs_insurance ? '보험처리만' : (c.insurance_status === 'active' ? '수동 진입' : ''),
      });
    }
  }
  for (const a of (partnerCases || [])) {
    const c = a.intake_cases;
    if (c && !seenIds.has(c.id)) {
      seenIds.add(c.id);
      allCases.push({
        id: c.id, case_no: c.case_no, customer_name: c.customer_name,
        source: '수리완료',
      });
    }
  }

  // case_no DESC 정렬 (최근부터)
  allCases.sort((a, b) => (b.case_no || '').localeCompare(a.case_no || ''));

  sel.innerHTML = '<option value="">— 사건 선택 —</option>' +
    allCases.map(c =>
      `<option value="${c.id}">${c.case_no||'-'} · ${c.customer_name||'-'} ${c.source ? '['+c.source+']' : ''}</option>`
    ).join('');
}

async function onInsuranceCaseSelect(val) {
  if (!val) return;
  const sel = document.getElementById('insuranceCaseSelect');
  const caseNo = sel.options[sel.selectedIndex].text.split('·')[0].trim();
  await openInsuranceTab(val, caseNo);
}

// ─────────────────────────────────────────────
// API
// ─────────────────────────────────────────────
async function insEnsureClaim(caseId) {
  const { data: ex } = await sb.from('insurance_claims').select('*').eq('case_id', caseId).maybeSingle();
  if (ex) return ex;
  const { data, error } = await sb.from('insurance_claims')
    .insert({ case_id: caseId, insurance_tab_status: 'docs_pending' })
    .select('*').single();
  if (error) throw new Error('claim 생성 실패: ' + error.message);
  return data;
}
async function insFetchField(caseId) {
  const { data } = await sb.from('partner_assignments')
    .select('id,repair_cost,repair_opinion,work_done_at')
    .eq('case_id', caseId).in('work_status',['repair_done','repair_completed'])
    .order('work_done_at',{ascending:false}).limit(1).maybeSingle();
  return data;
}

// v6.1: 다중 파트너 로드 — 한 케이스의 모든 파트너 배정 (탐지/인테리어)
//   - 각 파트너의 보고서 상태(work_status)와 핵심 필드 모두 포함
//   - assignment_purpose로 detection/restore 구분
async function insFetchAllPartners(caseId) {
  const { data, error } = await sb.from('partner_assignments')
    .select(`
      id, case_id, partner_company_id, assignment_status, work_status, assignment_purpose,
      repair_cost, repair_opinion, work_done_at, work_started_at, visited_at, accident_occurred_at,
      attacker_unit, victim_unit, leak_area_type, leak_cause, leak_detail_part, detection_count,
      accident_datetime_at_site, accident_datetime_source, accident_datetime_note,
      partner_companies(company_name, owner_name, business_no, phone, service_areas, stamp_image_path)
    `)
    .eq('case_id', caseId)
    .neq('assignment_status', 'cancelled')
    .order('created_at', { ascending: true });
  if (error) { console.warn('[v6.1] 파트너 다중 로드 실패:', error); return []; }
  // 회사 정보 평탄화 (v6.1.4: 누수소견서 데이터 매핑 위해 사업자 상세 필드 포함)
  return (data || []).map(p => {
    const pc = p.partner_companies || {};
    return {
      ...p,
      partner_name: pc.company_name || '파트너',
      partner_owner: pc.owner_name || '',
      partner_business_no: pc.business_no || '',
      partner_phone: pc.phone || '',
      partner_address: pc.service_areas || '',  // 임시: service_areas → 주소 (전용 address 컬럼 없음)
      partner_stamp_path: pc.stamp_image_path || '',
      has_report: ['repair_done','repair_completed'].includes(p.work_status),
    };
  });
}
async function insFetchUploads(claimId) {
  const { data } = await sb.from('insurance_doc_uploads')
    .select('id,doc_code,doc_name,file_path,uploaded_at')
    .eq('claim_id', claimId).eq('is_latest', true);
  return data || [];
}
async function insFetchCompany() {
  // v6.1.4: company_settings(legacy) + companies(chief_officer 정보) 동시 로드
  const [{ data: cs }, { data: co }] = await Promise.all([
    sb.from('company_settings').select('*').eq('id', 1).maybeSingle(),
    sb.from('companies').select('id, company_name_ko, ceo_name, business_no, company_address, company_phone, company_email, chief_officer_name, chief_officer_license_no, chief_officer_stamp_path, company_stamp_path').limit(1).maybeSingle()
  ]);
  // 두 소스 머지 (companies 우선)
  return {
    ...(cs || {}),
    // 보고서 1페이지 발신부 4줄용
    chief_officer_name: co?.chief_officer_name || cs?.adjuster_name || '서재성',
    chief_officer_license_no: co?.chief_officer_license_no || cs?.adjuster_license_no || '',
    chief_officer_stamp_path: co?.chief_officer_stamp_path || '',
    company_name_ko: co?.company_name_ko || cs?.company_name || '누수패스손해사정(주)',
    ceo_name: co?.ceo_name || cs?.representative || '',
    company_address: co?.company_address || cs?.address || '',
    company_phone: co?.company_phone || cs?.phone || '',
    company_email: co?.company_email || cs?.email || '',
  };
}

// v6.1.4: 본인(현재 로그인 admin_users) 정보 로드 — 보고서 "담당자" 자리
async function insFetchHandler() {
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data } = await sb.from('admin_users')
      .select('id, name, email, phone, personal_email, position, license_no, signature_image_path')
      .eq('id', user.id)
      .maybeSingle();
    return data || null;
  } catch (e) {
    console.warn('[v6.1.4] 담당자 정보 로드 실패', e);
    return null;
  }
}

// v5.4: 피해자 배열 CRUD
async function insFetchVictims(claimId) {
  const { data, error } = await sb.from('insurance_victims')
    .select('*')
    .eq('claim_id', claimId)
    .order('victim_order', { ascending: true });
  if (error) { console.warn('[v5.4] insFetchVictims error:', error); return []; }
  return data || [];
}
async function insSaveVictim(victim) {
  const payload = {
    claim_id: _insClaim.id,
    victim_order: victim.victim_order,
    victim_name: victim.victim_name || null,
    victim_address: victim.victim_address || null,
    victim_owner_name: victim.victim_owner_name || null,
    victim_owner_transfer_date: victim.victim_owner_transfer_date || null,
    victim_phone: victim.victim_phone || null,
    victim_resident_no: victim.victim_resident_no || null,
    victim_damage: victim.victim_damage || null,
    victim_note: victim.victim_note || null,
    updated_at: new Date().toISOString(),
  };
  if (victim.id) {
    const { data, error } = await sb.from('insurance_victims')
      .update(payload).eq('id', victim.id).select().single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await sb.from('insurance_victims')
      .insert(payload).select().single();
    if (error) throw error;
    return data;
  }
}
async function insDeleteVictim(victimId) {
  const { error } = await sb.from('insurance_victims').delete().eq('id', victimId);
  if (error) throw error;
}

// v5.5 ★ 파트너 현장 파악 사고일시 로드
// STEP 2 진입 시 호출 — insurance_claims.accident_datetime이 비어있으면 파트너값 자동 복사 제안
async function loadPartnerAccidentData() {
  if (!_insCaseId) return;
  try {
    const { data: pa } = await sb.from('partner_assignments')
      .select('accident_datetime_at_site, accident_datetime_source, accident_datetime_note')
      .eq('case_id', _insCaseId)
      .in('work_status', ['repair_done','repair_completed'])
      .order('work_done_at', { ascending: false })
      .limit(1).maybeSingle();
    
    if (pa?.accident_datetime_at_site) {
      _insPartnerAccident = pa;  // 원본 참고용 전역
      
      // insurance_claims.accident_datetime 비어있으면 파트너값 자동 복사
      const hasExisting = _insResult.accident_datetime || _insClaim?.accident_datetime;
      if (!hasExisting) {
        _insResult.accident_datetime = pa.accident_datetime_at_site;
        console.log('[v5.5] 파트너 사고일시 자동 복사:', pa.accident_datetime_at_site);
      }
    } else {
      _insPartnerAccident = null;
    }
  } catch (e) { 
    console.warn('[v5.5] 파트너 사고일시 로드 실패:', e); 
    _insPartnerAccident = null;
  }
}

async function fetchBase64(filePath) {
  const { data } = await sb.storage.from('insurance-docs').download(filePath);
  if (!data) return null;
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(data);
  });
}
function docMediaType(filePath) {
  const ext = (filePath||'').split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  return 'image/jpeg';
}

// ─────────────────────────────────────────────
// 렌더링
// ─────────────────────────────────────────────
function insRender() {
  const body = document.getElementById('insuranceTabBody');
  if (!body) return;
  body.innerHTML = insStepBarHTML() + `<div id="insContent"></div>`;
  const c = document.getElementById('insContent');
  if      (_insStep === 1) c.innerHTML = insStep1HTML();
  else if (_insStep === 2) c.innerHTML = insStep2HTML();
  else if (_insStep === 3) c.innerHTML = insStep3HTML();
  if (_insStep === 1) insInitDropzones();
}

function insStepBarHTML() {
  const steps = [
    { n:1, label:'준비', sub:'기본정보 + 서류' },
    { n:2, label:'분석·판단', sub:'추출결과 + 책임' },
    { n:3, label:'보고서', sub:'양식 확인 + 출력' },
  ];
  return `<div class="ins-step-bar">${steps.map(s => {
    const cls = s.n < _insStep ? 'ins-step-done'
              : s.n === _insStep ? 'ins-step-active' : 'ins-step-locked';
    return `<div class="ins-step ${cls}" onclick="${s.n<=_insStep?`insGoStep(${s.n})`:''}">
      <div class="ins-step-dot"></div>
      <div class="ins-step-num">${s.n}단계</div>
      <div class="ins-step-label">${s.label}</div>
      <div class="ins-step-sub">${s.sub}</div>
    </div>`;
  }).join('')}</div>`;
}

async function insGoStep(n) { 
  _insStep = n; 
  
  // v5.4.3 ★ STEP 2 재진입 시 DB 강제 재로드 (화면-DB 동기화 안전망)
  // AI 재분석 직후 저장 없이 STEP 3 → STEP 2 돌아올 때 값이 DB 기준으로 복원되도록
  if (n === 2 && _insClaim?.id) {
    try {
      const { data: claim } = await sb.from('insurance_claims')
        .select('*').eq('id', _insClaim.id).maybeSingle();
      if (claim) {
        _insClaim = claim;
        // _insResult에 DB 최신 값 병합 (사용자가 화면에서 수정한 값은 유지되지 않음, 저장 후 reload 기준)
        _insResult = {
          ..._insResult,
          insured_name:                 claim.insured_name                 || _insResult.insured_name,
          insured_name_resolved:        claim.insured_name_resolved        || _insResult.insured_name_resolved,
          insured_status:               claim.insured_status               || _insResult.insured_status,
          insured_status_reason:        claim.insured_status_reason        || _insResult.insured_status_reason,
          insured_owner_name:           claim.insured_owner_name           || _insResult.insured_owner_name,
          insured_owners:               claim.insured_owners_json          || _insResult.insured_owners,
          household_head:               claim.insured_household_head       || _insResult.household_head,
          insured_cohabitants:          claim.insured_cohabitants          || _insResult.insured_cohabitants,
          liability_result:             claim.liability_result             || _insResult.liability_result,
          coverage_result:              claim.coverage_result              || _insResult.coverage_result,
          liability_reasoning:          claim.liability_reasoning          || _insResult.liability_reasoning,
          coverage_reasoning:           claim.coverage_reasoning           || _insResult.coverage_reasoning,
          fault_ratio:                  claim.fault_ratio                  || _insResult.fault_ratio,
          accident_datetime:            claim.accident_datetime            || _insResult.accident_datetime,
          address_match:                claim.address_match                || _insResult.address_match,
          address_match_note:           claim.address_match_note           || _insResult.address_match_note,
        };
      }
    } catch (e) { console.warn('[v5.4.3] STEP 2 재로드 실패:', e); }
    
    // v5.5 ★ 파트너 현장 사고일시 로드 (STEP 2 진입 시)
    try {
      await loadPartnerAccidentData();
    } catch (e) { console.warn('[v5.5] 파트너 사고일시 로드 실패:', e); }
  }
  
  insRender(); 
  // v5.4.2 Phase 3: STEP 3 진입 시 파트너 데이터·사진 비동기 로드
  if (n === 3) {
    s3LoadReportData().then(() => insRender()).catch(e => console.warn('[s3] 로드 실패:', e));
  }
}

// ─────────────────────────────────────────────
// v6 공통 헬퍼: 케이스 헤더 + 룰엔진 사이드바
//   STEP 1/2/3에서 일관되게 재사용
// ─────────────────────────────────────────────

// 케이스 헤더 (사건 요약 — 모든 STEP 상단)
function v6CaseHeaderHTML(opts = {}) {
  const cl = _insClaim || {};
  const fd = _insField;
  const today = new Date().toISOString().split('T')[0];
  const insType = cl.insurance_type || 'family_daily_old';
  const insTypeLabel = INS_TYPE_LABELS[insType] || '미선택';
  const caseName = cl.insured_name || (cl.case_id ? `케이스 ${String(cl.case_id).slice(0,8)}` : '— 사건 정보 —');
  const accLoc = (fd && fd.attacker_unit) || cl.victim_address || '';
  // STEP 1에서만 제출일자 입력 가능, 나머지는 readonly
  const dateInput = opts.editableDate
    ? `<input type="date" id="s1-date" value="${cl.submit_date||today}"/>`
    : `<b>${cl.submit_date ? fmtDate(cl.submit_date) : today}</b>`;
  return `
    <div class="v6-case-header">
      <div class="v6-case-header-info">
        <div class="v6-case-header-name">${escapeHtml(caseName)}</div>
        <div class="v6-case-header-sub">
          <span class="v6-case-tag">${escapeHtml(insTypeLabel)}</span>
          ${accLoc ? escapeHtml(accLoc) : '— 사고 장소 미확인 —'}
        </div>
        <div class="v6-meta-bar">
          <span>보고서 번호 <b>${cl.report_no || '— (저장 시 자동채번)'}</b></span>
          <span>제출일자 ${dateInput}</span>
        </div>
      </div>
    </div>`;
}

// 룰엔진 사이드바 (분석 결과를 실시간 반영)
//   step: 1 → 분석 대기, 2/3 → 분석 결과 반영
function v6EngineSidebarHTML(step) {
  const cl = _insClaim || {};
  const r = _insResult || {};
  const fd = _insField;
  const insType = cl.insurance_type || 'family_daily_old';
  const insTypeLabel = INS_TYPE_LABELS[insType] || '미선택';

  // STEP 1: 입력 진행 상태
  if (step === 1) {
    const reqDone = INS_DOCS.filter(d => d.required && _insUploaded[d.code]).length;
    const reqTotal = INS_DOCS.filter(d => d.required).length;
    const allReq = reqDone >= reqTotal;
    return `
    <div class="v6-engine-side">
      <div class="v6-engine-card">
        <div class="v6-engine-head">
          <div class="v6-engine-head-title">SABI v6 · 룰엔진</div>
          <div class="v6-engine-pulse"><span class="v6-pulse-dot"></span>실시간</div>
        </div>
        <div class="v6-engine-body">
          <div class="v6-engine-result gray">
            <div class="v6-engine-result-label">현재 입력 기준 예상</div>
            <div class="v6-engine-result-value">${allReq ? '분석 대기' : '서류 업로드 중'}</div>
          </div>
          <ul class="v6-engine-list">
            <li class="v6-engine-row"><span class="v6-engine-row-key">약관</span><span class="v6-engine-row-val">${escapeHtml(insTypeLabel)}</span></li>
            <li class="v6-engine-row"><span class="v6-engine-row-key">필수 서류</span><span class="v6-engine-row-val ${allReq?'green':'amber'}">${reqDone}/${reqTotal}</span></li>
            <li class="v6-engine-row"><span class="v6-engine-row-key">파트너 자료</span><span class="v6-engine-row-val ${fd?'green':'amber'}">${fd?'연동됨':'없음'}</span></li>
            <li class="v6-engine-row"><span class="v6-engine-row-key">사고원인 카테고리</span><span class="v6-engine-row-val">분석 후 확정</span></li>
            <li class="v6-engine-row"><span class="v6-engine-row-key">피보 지위</span><span class="v6-engine-row-val">분석 후 확정</span></li>
            <li class="v6-engine-row"><span class="v6-engine-row-key">법률상 책임</span><span class="v6-engine-row-val">분석 후 확정</span></li>
          </ul>
          <div class="v6-engine-explain"><b>안내</b> · 서류를 모두 업로드하고 약관을 선택한 후 <b>저장 후 분석·판단</b>을 클릭하면 Claude가 9단계 판단 로직으로 면·부책을 산출합니다.</div>
        </div>
      </div>
    </div>`;
  }

  // STEP 2/3: 분석 결과 반영
  const established  = r.liability_result || cl.liability_result || '';
  const coverage     = r.coverage_result || cl.coverage_result || '';
  const insuredStat  = r.insured_status || cl.insured_status || '';
  const causeCat     = r.rulebook_cat || cl.rulebook_cat || '';
  const faultRatio   = r.fault_ratio || cl.fault_ratio || '';
  const accCause     = (fd?.leak_cause) || cl.accident_cause_type || '';

  // 결과 색상
  let resultCls = 'gray', resultLabel = '분석 결과 없음', resultValue = '미산출';
  if (coverage === '부책')     { resultCls = '';      resultLabel = '면·부책 결과'; resultValue = '부책'; }
  else if (coverage === '면책') { resultCls = 'red';   resultLabel = '면·부책 결과'; resultValue = '면책'; }
  else if (coverage === '판단유보') { resultCls = 'amber'; resultLabel = '면·부책 결과'; resultValue = '판단유보'; }

  // 카테고리 매핑 라벨
  const catLabel = causeCat
    ? (INS_CAUSE_RULEBOOK_MAP?.[accCause]?.label || causeCat)
    : '확정 안됨';

  return `
    <div class="v6-engine-side">
      <div class="v6-engine-card">
        <div class="v6-engine-head">
          <div class="v6-engine-head-title">SABI v6 · 룰엔진</div>
          <div class="v6-engine-pulse"><span class="v6-pulse-dot"></span>실시간</div>
        </div>
        <div class="v6-engine-body">
          <div class="v6-engine-result ${resultCls}">
            <div class="v6-engine-result-label">${resultLabel}</div>
            <div class="v6-engine-result-value">${resultValue}</div>
          </div>
          <ul class="v6-engine-list">
            <li class="v6-engine-row"><span class="v6-engine-row-key">약관</span><span class="v6-engine-row-val">${escapeHtml(insTypeLabel)}</span></li>
            <li class="v6-engine-row"><span class="v6-engine-row-key">사고원인</span><span class="v6-engine-row-val">${escapeHtml(accCause || '미지정')}</span></li>
            <li class="v6-engine-row"><span class="v6-engine-row-key">카테고리</span><span class="v6-engine-row-val" title="${escapeHtml(catLabel)}">${escapeHtml(causeCat || '—')}</span></li>
            <li class="v6-engine-row"><span class="v6-engine-row-key">피보 지위</span><span class="v6-engine-row-val ${insuredStat?'green':''}">${escapeHtml(insuredStat || '—')}</span></li>
            <li class="v6-engine-row"><span class="v6-engine-row-key">법률상 책임</span><span class="v6-engine-row-val ${established==='yes'?'green':established==='no'?'red':''}">${established==='yes'?'성립':established==='no'?'불성립':'—'}</span></li>
            <li class="v6-engine-row"><span class="v6-engine-row-key">과실 비율</span><span class="v6-engine-row-val">${escapeHtml(faultRatio || '—')}</span></li>
          </ul>
          ${(r.liability_reasoning || cl.liability_reasoning) ? `<div class="v6-engine-explain"><b>판단 근거</b> · ${escapeHtml((r.liability_reasoning || cl.liability_reasoning).slice(0, 240))}${(r.liability_reasoning || cl.liability_reasoning).length > 240 ? '…' : ''}</div>` : ''}
        </div>
      </div>
    </div>`;
}

// 약관 선택 바 (STEP 1에서 사용, 분석 후엔 readonly)
function v6PolicyBarHTML(readonly) {
  const cl = _insClaim || {};
  if (readonly) {
    // STEP 2/3: 약관 정보 표시만
    const insTypeLabel = INS_TYPE_LABELS[cl.insurance_type] || '미선택';
    return `
      <div class="v6-policy-bar" style="display:flex;align-items:center;gap:14px;padding:10px 14px">
        <div style="font-size:12px;font-weight:700;color:var(--text);flex-shrink:0">📌 약관</div>
        <div style="flex:1;font-size:13px;color:var(--primary);font-weight:700">${escapeHtml(insTypeLabel)}</div>
        <button class="btn btn-ghost btn-sm" onclick="insGoStep(1)" style="font-size:11px">↩ STEP 1에서 변경</button>
      </div>`;
  }
  return `
    <div class="v6-policy-bar">
      <div class="v6-policy-bar-title">📌 약관 구분 선택</div>
      <div class="v6-policy-bar-sub">서류 분석 전에 선택하면 Claude가 해당 약관 기준으로 판단합니다</div>
      <div class="v6-policy-grid">
        ${[
          ['family_daily_old','가족일상생활 (구형)','가족 단위 · 제3자 배상','구형 — 임대인 케이스 면책'],
          ['family_daily_new','가족일상생활 (신형)','가족 단위 · 임대 주택 포함','신형 — 임대인 케이스 부책 가능'],
          ['personal_daily',  '일상생활 (일배책)',  '본인+배우자 한정','일배책 — 구형과 동일 로직, 범위만 축소'],
        ].map(([val, name, desc, note]) => {
          const sel = (cl.insurance_type||'family_daily_old') === val;
          return `<div class="ins-type-card ${sel?'ins-type-selected':''}" onclick="s1SelectType('${val}',this)">
            <input type="radio" name="ins-type" value="${val}" ${sel?'checked':''} style="display:none">
            <div style="font-size:13px;font-weight:700;margin-bottom:4px">${name}</div>
            <div style="font-size:12px;color:${sel?'var(--primary)':'var(--muted)'}">${desc}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:3px">${note}</div>
          </div>`;
        }).join('')}
      </div>
      <div style="margin-top:8px;padding:8px 12px;background:var(--bg);border-radius:6px;font-size:11px;color:var(--muted);border-left:3px solid var(--line)">
        💡 시설소유(관리)자배상책임 · 급배수누출손해는 추후 지원 예정입니다.
      </div>
    </div>`;
}

// ─────────────────────────────────────────────
// STEP 1: 준비 (v6 카드 구조)
//   - 좌: 케이스 헤더 + 약관 + 4카드 (파트너/계약/피보험자/피해세대)
//   - 우: 룰엔진 사이드바 (sticky)
// ─────────────────────────────────────────────
function insStep1HTML() {
  // v6.2 — 외부 시스템 패턴 (3.36.160.16:5026 디자인 차용)
  // 결정사항:
  //   - "1. 고객정보" 섹션 제거 (사고 기본정보는 AI 자동 추출)
  //   - 안내문 제거
  //   - 추가: 드래그앤드롭 / 통합 슬롯 / 약관 드롭다운(준비중 포함) / 누수소견서 모달
  const cl = _insClaim || {};
  const fd = _insField;

  // 그룹별 슬롯 필터링
  const groupADocs = INS_DOCS.filter(d => d.group === 'A_contract');
  const groupBDocs = INS_DOCS.filter(d => d.group === 'B_claim');
  const groupCInsuredDocs = INS_DOCS.filter(d => d.group === 'C_public_insured');
  const groupCVictimDocs = INS_DOCS.filter(d => d.group === 'C_public_victim');

  // 약관 종류 (기본 신형)
  const insType = cl.insurance_type || 'family_daily_new';

  // 약관 드롭다운 옵션
  const policyTypeOptions = INS_TYPE_OPTIONS.map(opt => {
    const selected = (opt.value === insType) ? 'selected' : '';
    const disabled = !opt.enabled ? 'disabled' : '';
    const labelText = opt.enabled ? opt.label : `${opt.label} (${opt.note})`;
    return `<option value="${opt.value}" ${selected} ${disabled}>${labelText}</option>`;
  }).join('');

  // ─── 파일 입력 슬롯 렌더 (단일 파일) ───
  const renderFileInput = (doc, requiredOverride) => {
    const up = _insUploaded[doc.code];
    const done = !!up;
    const fileName = done ? (up.doc_name || '업로드 완료') : '';
    const required = (requiredOverride !== undefined) ? requiredOverride : doc.required;
    const btnClass = required ? 'v62-file-btn-required' : 'v62-file-btn-optional';
    const inputClass = required ? 'required' : '';
    const doneClass = done ? 'done' : '';

    return `
      <div class="v62-file-input ${inputClass} ${doneClass}" id="ins-dz-${doc.code}"
           ondragover="event.preventDefault();this.classList.add('over')"
           ondragleave="this.classList.remove('over')"
           ondrop="insDrop(event,'${doc.code}','${escapeHtml(doc.name)}')">
        <button class="v62-file-btn ${btnClass}" onclick="insTrigger('${doc.code}','${escapeHtml(doc.name)}')">파일 선택</button>
        <span class="v62-file-status ${done?'has-file':''}">${done ? '✓ ' + escapeHtml(fileName) : '선택된 파일 없음'}</span>
        ${done ? `<button class="v62-file-remove" onclick="event.stopPropagation();insRemoveDoc('${doc.code}')" title="삭제">✕</button>` : ''}
      </div>`;
  };

  // ─── 누수소견서 슬롯 (모달 트리거) ───
  const renderLeakSlot = () => {
    const doc = groupBDocs.find(d => d.code === 'leak_opinion_external');
    if (!doc) return '';
    const up = _insUploaded[doc.code];
    const partnerImported = _insImportedPartners.size > 0;
    const done = !!up || partnerImported;
    const fileName = up ? (up.doc_name || '업로드 완료')
                    : partnerImported ? `파트너 임포트: ${escapeHtml((_insField?.partner_name) || '')}`
                    : '';

    return `
      <div class="v62-file-input ${done?'done':''}" id="ins-dz-${doc.code}">
        <button class="v62-file-btn v62-file-btn-action" onclick="insOpenLeakModal()">⚙️ 옵션 선택</button>
        <span class="v62-file-status ${done?'has-file':''}">${done ? '✓ ' + fileName : '파트너 임포트 또는 외부 PDF'}</span>
        ${done ? `<button class="v62-file-remove" onclick="event.stopPropagation();insClearLeak()" title="해제">✕</button>` : ''}
      </div>`;
  };

  // ─── 통합 슬롯 (한 슬롯에 파일 2개) ───
  // v6.2.14: _insUploaded에 family_doc과 family_doc_2가 별도 키로 저장됨
  // baseCode와 baseCode_2 (또는 baseCode 배열 형태) 모두 보고 합쳐서 표시
  const renderMultiSlot = (doc, requiredOverride) => {
    const baseCode = doc.code;
    const code2 = baseCode + '_2';
    let files = [null, null];

    // 케이스 A: baseCode가 배열 형태로 저장됨 (insUpload 직후 메모리)
    const baseVal = _insUploaded[baseCode];
    if (Array.isArray(baseVal)) {
      files[0] = baseVal[0] || null;
      files[1] = baseVal[1] || null;
    } else if (baseVal) {
      // 케이스 B: baseCode가 단일 객체 (사건 로드 직후 DB에서 가져온 상태)
      files[0] = baseVal;
    }
    // 추가: code_2 키로도 별도 저장되어 있으면 [1]에 채우기
    if (_insUploaded[code2] && !files[1]) {
      files[1] = _insUploaded[code2];
    }

    const required = (requiredOverride !== undefined) ? requiredOverride : doc.required;
    const btnClass = required ? 'v62-file-btn-required' : 'v62-file-btn-optional';
    const inputClass = required ? 'required' : '';

    const slot = (idx) => {
      const f = files[idx];
      const done = !!f;
      const doneClass = done ? 'done' : '';
      const isOptional = idx > 0;  // 두 번째 슬롯은 항상 선택
      const btn = (idx === 0 ? btnClass : 'v62-file-btn-optional');
      return `
        <div class="v62-file-input ${idx===0?inputClass:''} ${doneClass}"
             ondragover="event.preventDefault();this.classList.add('over')"
             ondragleave="this.classList.remove('over')"
             ondrop="insDrop(event,'${doc.code}','${escapeHtml(doc.name)}',${idx})">
          <button class="v62-file-btn ${btn}" onclick="insTrigger('${doc.code}','${escapeHtml(doc.name)}',${idx})">파일 선택</button>
          <span class="v62-file-status ${done?'has-file':''}">${done ? '✓ ' + escapeHtml(f.doc_name || '업로드 완료') : (idx === 0 ? '파일 1' : '파일 2 (선택)')}</span>
          ${done ? `<button class="v62-file-remove" onclick="event.stopPropagation();insRemoveDoc('${doc.code}',${idx})" title="삭제">✕</button>` : ''}
        </div>`;
    };
    return `<div class="v62-multi-files">${slot(0)}${slot(1)}</div>`;
  };

  // 보험증권 슬롯
  const policyDoc = groupADocs.find(d => d.code === 'insurance_policy');

  // 필수 입력 검증
  const insurancePolicyDone = !!_insUploaded.insurance_policy;
  const familyDocDone = !!_insUploaded.family_doc;
  const ownershipInsuredDone = !!_insUploaded.ownership_insured;
  const reqAllDone = insurancePolicyDone && familyDocDone && ownershipInsuredDone;

  return `
  ${v6CaseHeaderHTML({ editableDate: false })}

  <div class="v62-container">

    <!-- 1. 계약 관련 서류 (필수) -->
    <div class="v62-section v62-section-required">
      <div class="v62-section-title">1. 계약 관련 서류</div>
      <div class="v62-required-notice">* 필수 입력 항목입니다</div>

      <div class="v62-row">
        <div class="v62-field">
          <label class="v62-field-label">보험증권 <span class="req">*</span></label>
          ${policyDoc ? renderFileInput(policyDoc, true) : ''}
        </div>
        <div class="v62-field">
          <label class="v62-field-label">약관 종류 <span class="req">*</span></label>
          <select class="v62-select required" onchange="s1ChangePolicyType(this.value)">
            ${policyTypeOptions}
          </select>
        </div>
      </div>
    </div>

    <!-- 2. 보험 청구 서류 -->
    <div class="v62-section">
      <div class="v62-section-title">2. 보험 청구 서류</div>

      <div class="v62-row">
        <div class="v62-field">
          <label class="v62-field-label">보험청구서 또는 사고접수지</label>
          ${renderFileInput(groupBDocs.find(d => d.code === 'claim_form'), false)}
        </div>
        <div class="v62-field">
          <label class="v62-field-label">누수소견서</label>
          ${renderLeakSlot()}
        </div>
      </div>

      <div class="v62-row">
        <div class="v62-field">
          <label class="v62-field-label">경위서</label>
          ${renderFileInput(groupBDocs.find(d => d.code === 'incident_statement'), false)}
        </div>
        <div></div>
      </div>

      <!-- 피보험자(가해자) 공공서류 -->
      <div class="v62-subbox">
        <div class="v62-subbox-title">피보험자(가해자) 공공서류</div>

        <div class="v62-field" style="margin-bottom:12px">
          <label class="v62-field-label">주민등록등본 / 가족관계증명서 <span class="req">*</span></label>
          ${renderMultiSlot(groupCInsuredDocs.find(d => d.code === 'family_doc'), true)}
        </div>
        <div class="v62-field">
          <label class="v62-field-label">건축물대장 / 등기부등본 <span class="req">*</span></label>
          ${renderMultiSlot(groupCInsuredDocs.find(d => d.code === 'ownership_insured'), true)}
        </div>
      </div>

      <!-- 피해자 공공서류 -->
      <div class="v62-subbox">
        <div class="v62-victim-row">
          <div class="v62-subbox-title" style="margin:0">피해자 공공서류</div>
          <button class="v62-victim-add-btn" onclick="toast('다세대 동시 피해는 다음 업데이트에 추가 예정','i')">+ 피해자 추가</button>
        </div>

        <div class="v62-victim-block">
          <div class="v62-victim-block-header">
            <span class="v62-victim-block-title">피해자 1 관련 서류</span>
          </div>

          <div class="v62-field" style="margin-bottom:12px">
            <label class="v62-field-label">건축물대장 / 등기부등본</label>
            ${renderMultiSlot(groupCVictimDocs.find(d => d.code === 'ownership_doc_victim'), false)}
          </div>
          <div class="v62-field">
            <label class="v62-field-label">주민등록등본 / 가족관계증명서</label>
            ${renderMultiSlot(groupCVictimDocs.find(d => d.code === 'family_doc_victim'), false)}
          </div>
        </div>
      </div>

    </div>

    <!-- 다음 단계 버튼 -->
    <button class="v62-next-btn" onclick="s1Save()" ${reqAllDone?'':'disabled'}>
      사실정보 추출 (다음 단계)
    </button>

  </div>`;
}


// v6: s1InsurerChange/s1CauseChange는 STEP 1에서 보험사·사고원인 입력 제거되며 더 이상 사용되지 않음
function s1SelectType(val, el) {
  // (legacy v6.1 — 카드 라디오 방식, v6.2에선 사용 안 함)
  document.querySelectorAll('.ins-type-card').forEach(c => c.classList.remove('ins-type-selected'));
  el.classList.add('ins-type-selected');
  el.querySelector('input[type=radio]').checked = true;
  _insClaim = { ..._insClaim, insurance_type: val };
}

// v6.2: 약관 종류 드롭다운 변경
function s1ChangePolicyType(val) {
  _insClaim = { ..._insClaim, insurance_type: val };
  // 화면 재렌더 안 함 — select가 그대로 표시되므로
  // 단, 약관에 따라 가족관계증명서 슬롯 노출 여부 등 향후 분기 필요시 insRender() 호출
}
window.s1ChangePolicyType = s1ChangePolicyType;

// v6.2: 누수소견서 옵션 모달 (파트너 임포트 OR 외부업체 PDF)
function insOpenLeakModal() {
  // 사용 가능한 파트너 목록 (보고서 제출됨 + 누수탐지 목적)
  const detectionPartners = (_insPartners || []).filter(p => p.has_report && p.assignment_purpose === 'detection');
  const partnerOptionsHTML = detectionPartners.length > 0
    ? detectionPartners.map(p => `
        <label class="v62-modal-option">
          <input type="radio" name="leak-source" value="partner-${p.id}" ${_insImportedPartners.has(p.id)?'checked':''}>
          <div class="v62-modal-option-body">
            <div class="v62-modal-option-title">파트너 임포트 — ${escapeHtml(p.partner_name)}</div>
            <div class="v62-modal-option-meta">
              ${p.leak_cause ? `사고원인: ${escapeHtml(p.leak_cause)}` : '누수탐지 보고서 제출됨'}
              ${p.work_done_at ? ` · ${fmtDate(p.work_done_at)}` : ''}
            </div>
          </div>
        </label>
      `).join('')
    : `<div class="v62-modal-empty">⚠ 이 케이스에 누수탐지 파트너가 배정되어 있지 않습니다 — 외부업체 PDF를 업로드해주세요</div>`;

  const modalHTML = `
    <div class="v62-modal-backdrop" onclick="insCloseLeakModal()"></div>
    <div class="v62-modal" id="leak-modal">
      <div class="v62-modal-header">
        <h3>📄 누수소견서 추가</h3>
        <button class="v62-modal-close" onclick="insCloseLeakModal()">✕</button>
      </div>
      <div class="v62-modal-body">
        <div class="v62-modal-section-title">파트너 임포트</div>
        ${partnerOptionsHTML}

        <div class="v62-modal-divider"></div>

        <div class="v62-modal-section-title">또는 외부업체 PDF 업로드</div>
        <label class="v62-modal-option">
          <input type="radio" name="leak-source" value="external">
          <div class="v62-modal-option-body">
            <div class="v62-modal-option-title">외부업체 PDF 업로드</div>
            <div class="v62-modal-option-meta">파트너가 아닌 외부 누수업체에서 받은 PDF 누수소견서 업로드</div>
            <input type="file" id="leak-external-file" accept=".pdf" style="margin-top:8px;display:block">
          </div>
        </label>
      </div>
      <div class="v62-modal-footer">
        <button class="v62-modal-btn-secondary" onclick="insCloseLeakModal()">취소</button>
        <button class="v62-modal-btn-primary" onclick="insApplyLeakModal()">적용</button>
      </div>
    </div>`;

  let host = document.getElementById('leak-modal-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'leak-modal-host';
    document.body.appendChild(host);
  }
  host.innerHTML = modalHTML;
}
window.insOpenLeakModal = insOpenLeakModal;

function insCloseLeakModal() {
  const host = document.getElementById('leak-modal-host');
  if (host) host.innerHTML = '';
}
window.insCloseLeakModal = insCloseLeakModal;

async function insApplyLeakModal() {
  const selected = document.querySelector('input[name="leak-source"]:checked');
  if (!selected) { toast('파트너 임포트 또는 외부업체 PDF 중 하나를 선택해주세요','w'); return; }

  if (selected.value === 'external') {
    // 외부 PDF 업로드 — 기존 insTrigger 패턴 그대로
    const file = document.getElementById('leak-external-file').files[0];
    if (!file) { toast('PDF 파일을 선택해주세요','w'); return; }
    insCloseLeakModal();
    // 기존 업로드 함수 재사용
    if (typeof insUploadFile === 'function') {
      await insUploadFile(file, 'leak_opinion_external', '누수소견서');
    } else {
      // 폴백: 직접 처리 필요 — Phase 2에서 보강
      toast('외부 PDF 업로드는 백엔드 연결 작업 후 활성화됩니다 (Phase 2)','i');
    }
  } else if (selected.value.startsWith('partner-')) {
    // 파트너 임포트
    const partnerId = selected.value.replace('partner-', '');
    _insImportedPartners.clear();
    _insImportedPartners.add(partnerId);
    // _insField 갱신
    const partner = _insPartners.find(p => p.id === partnerId);
    if (partner) _insField = partner;
    insCloseLeakModal();
    toast(`${partner?.partner_name || ''} 누수소견서가 임포트되었습니다`,'s');
    insRender();
  }
}
window.insApplyLeakModal = insApplyLeakModal;

// v6.2: 누수소견서 해제 (외부 PDF 또는 파트너 임포트 모두)
function insClearLeak() {
  // 외부 PDF 업로드된 경우
  if (_insUploaded.leak_opinion_external) {
    insRemoveDoc('leak_opinion_external');
  }
  // 파트너 임포트된 경우
  if (_insImportedPartners.size > 0) {
    _insImportedPartners.clear();
    _insField = null;
  }
  insRender();
}
window.insClearLeak = insClearLeak;

// v6.1: 파트너 임포트 토글 (STEP 1 ②카드)
function s1TogglePartner(partnerId, checked) {
  if (checked) {
    _insImportedPartners.add(partnerId);
  } else {
    _insImportedPartners.delete(partnerId);
  }
  // 첫 임포트된 파트너를 _insField에 반영 (분석 시 우선 사용)
  // 우선순위: detection > restore > 첫 번째
  const importedDetection = _insPartners.find(p => p.has_report && _insImportedPartners.has(p.id) && p.assignment_purpose === 'detection');
  const importedRestore   = _insPartners.find(p => p.has_report && _insImportedPartners.has(p.id) && p.assignment_purpose === 'restore');
  const firstImported     = _insPartners.find(p => p.has_report && _insImportedPartners.has(p.id));
  _insField = importedDetection || importedRestore || firstImported || null;
  insRender();
}

async function s1Save() {
  // v6.2: 약관 종류는 select에서 (v6.1 라디오는 폴백)
  const insType = (_insClaim?.insurance_type) 
                  || document.querySelector('.v62-select')?.value 
                  || document.querySelector('input[name="ins-type"]:checked')?.value 
                  || 'family_daily_new';
  const submitDate = document.getElementById('s1-date')?.value || new Date().toISOString().split('T')[0];

  try {
    // RPC: 보고서번호 채번 + 제출일자 저장 (보험사 필드는 빈값 전달, 추후 보고서 본문에서 채움)
    const { data, error } = await sb.rpc('rpc_start_insurance_report', {
      p_claim_id:        _insClaim.id,
      p_insurer_name:    _insClaim.insurer_name || '',  // 기존값 유지 또는 빈값
      p_insurer_contact: _insClaim.insurer_contact || null,
      p_cause_type:      _insClaim.accident_cause_type || '미지정',  // AI 분석 후 보고서에서 확정
      p_investigator:    (_insCompany?.investigator_name || _insCompany?.adjuster_name || '서재성'),
      p_submit_date:     submitDate,
    });
    if (error) throw error;

    // 약관 구분 저장
    const { error: upErr } = await sb.from('insurance_claims')
      .update({ insurance_type: insType })
      .eq('id', _insClaim.id);
    if (upErr) throw new Error('약관 구분 저장 실패: ' + upErr.message);

    _insClaim = { ..._insClaim, report_no: data?.report_no,
      insurance_type: insType, insurance_tab_status: 'docs_pending',
      submit_date: submitDate };
    toast('저장 완료! 사실정보를 추출합니다.', 's');
    _insStep = 2; insRender();
    // v6.2: STEP 2 진입 후 추출 4-Call만 실행 (분석은 사용자가 [AI 분석 실행] 클릭 시)
    setTimeout(() => s2Extract(), 400);
  } catch(e) { toast('저장 실패: ' + e.message, 'e'); }
}

// ─────────────────────────────────────────────
// STEP 1: 드롭존 (v6.2 — 통합 슬롯 다중 파일 지원)
// ─────────────────────────────────────────────
function insInitDropzones() { /* HTML onclick으로 처리 */ }

// v6.2: 통합 슬롯의 fileIdx=1이면 doc_code에 _2 suffix 부여
function _insResolveCode(code, fileIdx) {
  if (!fileIdx || fileIdx === 0) return code;
  return `${code}_${fileIdx + 1}`;  // fileIdx=1 → _2
}

function insTrigger(code, name, fileIdx) {
  const resolvedCode = _insResolveCode(code, fileIdx);
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.pdf,.jpg,.jpeg,.png,.heic';
  inp.onchange = e => { if(e.target.files[0]) insUpload(e.target.files[0], resolvedCode, name, code, fileIdx); };
  inp.click();
}
function insDrop(e, code, name, fileIdx) {
  e.preventDefault();
  const dz = e.currentTarget;
  if (dz) dz.classList.remove('over');
  const resolvedCode = _insResolveCode(code, fileIdx);
  if(e.dataTransfer.files[0]) insUpload(e.dataTransfer.files[0], resolvedCode, name, code, fileIdx);
}

// v6.2: 업로드된 슬롯 ✕ 버튼 — Storage + DB 레코드 삭제 (다중 파일 지원)
async function insRemoveDoc(code, fileIdx) {
  if (!_insClaim?.id) return;
  const resolvedCode = _insResolveCode(code, fileIdx);
  // _insUploaded는 resolvedCode 기준 (v6.2 통합 슬롯 시 family_doc 또는 family_doc_2)
  // 단, 화면 렌더링은 baseCode 기준의 배열 형태로 처리하기 위해 양쪽 모두 확인
  let up = _insUploaded[resolvedCode];
  if (!up) {
    // 배열 형태로 저장된 경우
    const arr = _insUploaded[code];
    if (Array.isArray(arr) && arr[fileIdx]) up = arr[fileIdx];
  }
  if (!up) return;
  const docName = (INS_DOCS.find(d => d.code === code)?.name) || code;
  if (!confirm(`${docName}${fileIdx?' (파일 '+(fileIdx+1)+')':''} 파일을 삭제할까요?\n(되돌릴 수 없습니다)`)) return;

  try {
    // 1. Storage 파일 삭제
    if (up.file_path) {
      const { error: rmErr } = await sb.storage.from('insurance-docs').remove([up.file_path]);
      if (rmErr) console.warn('[v6] Storage 삭제 경고:', rmErr.message);
    }
    // 2. DB 레코드 삭제
    if (up.id) {
      const { error: delErr } = await sb.from('insurance_doc_uploads').delete().eq('id', up.id);
      if (delErr) throw new Error('DB 삭제 실패: ' + delErr.message);
    }
    // 3. 로컬 상태 정리
    delete _insUploaded[resolvedCode];
    // v6.2.14: baseCode와 baseCode_2 둘 다 정리 (DB로드 직후엔 단일 키, insUpload 후엔 배열 형태)
    // 케이스 A: baseCode가 단일 객체로 저장됨 (fileIdx=0 케이스)
    if (fileIdx === 0 && _insUploaded[code] && !Array.isArray(_insUploaded[code])) {
      delete _insUploaded[code];
    }
    // 케이스 B: baseCode가 배열 형태로 저장됨
    if (Array.isArray(_insUploaded[code])) {
      _insUploaded[code][fileIdx || 0] = null;
      // 빈 배열이면 키 제거
      if (_insUploaded[code].every(x => !x)) delete _insUploaded[code];
    }
    toast(`${docName} 삭제 완료`, 's');
    insRender();
  } catch (e) {
    toast('삭제 실패: ' + e.message, 'e');
  }
}

async function insUpload(file, code, name, baseCode, fileIdx) {
  // v6.2: code는 resolved (예: 'family_doc_2'), baseCode는 원본 (예: 'family_doc'), fileIdx는 0/1
  const allowed = ['application/pdf','image/jpeg','image/jpg','image/png','image/webp','image/heic'];
  if (!allowed.includes(file.type)) { toast('PDF 또는 이미지만 가능합니다.', 'e'); return; }
  if (file.size > 20*1024*1024) { toast('20MB 초과 파일입니다.', 'e'); return; }

  const zone = document.getElementById(`ins-dz-${code}`);
  const prog = document.getElementById(`ins-dp-${code}`);
  if (zone) zone.style.opacity = '0.6';
  if (prog) { prog.style.display='block'; prog.style.width='0%'; }
  let pct = 0;
  const t = setInterval(() => { pct=Math.min(pct+12,85); if(prog) prog.style.width=pct+'%'; }, 120);

  try {
    // v5.3.2 ★ 덮어쓰기 정책 (UNIQUE 제약과 호환)
    // 기존 정책(is_latest 플래그로 이력 보존)은 v5.3.1 UNIQUE (claim_id, doc_code) 제약과 충돌.
    // → 같은 doc_code로 재업로드 시 "교체" 의미로 간주:
    //    1) 기존 Storage 파일 삭제 (용량 절약)
    //    2) 기존 DB 레코드 삭제
    //    3) 새 파일 업로드 + 새 레코드 INSERT
    //
    // 1. 기존 레코드 조회 (삭제 대상 file_path 확보)
    const { data: existing, error: selErr } = await sb.from('insurance_doc_uploads')
      .select('id, file_path')
      .eq('claim_id', _insClaim.id)
      .eq('doc_code', code);
    if (selErr) throw new Error('기존 레코드 조회 실패: ' + selErr.message);

    // 2. 기존 Storage 파일 삭제 (있으면)
    if (existing && existing.length > 0) {
      const pathsToRemove = existing.map(r => r.file_path).filter(Boolean);
      if (pathsToRemove.length > 0) {
        const { error: rmErr } = await sb.storage.from('insurance-docs').remove(pathsToRemove);
        if (rmErr) console.warn('[v5.3.2] 기존 Storage 파일 삭제 경고 (무시 가능):', rmErr.message);
      }
      // 3. 기존 DB 레코드 삭제
      const ids = existing.map(r => r.id);
      const { error: delErr } = await sb.from('insurance_doc_uploads')
        .delete()
        .in('id', ids);
      if (delErr) throw new Error('기존 레코드 삭제 실패: ' + delErr.message);
    }

    // 4. 새 파일 Storage 업로드
    const ext = file.name.split('.').pop().toLowerCase();
    const safeExt = ['pdf','jpg','jpeg','png','webp','heic'].includes(ext)?ext:'pdf';
    const path = `${_insClaim.id}/${code}/${Date.now()}.${safeExt}`;

    const { error: upErr } = await sb.storage.from('insurance-docs')
      .upload(path, file, {cacheControl:'3600',upsert:true});
    if (upErr) throw new Error('Storage: '+upErr.message);

    // 5. 새 DB 레코드 INSERT
    // v6: doc_category는 INS_DOCS의 group 정보 활용
    //   group 'victim' → 'victim'
    //   그 외 (policy/insured) → 'insured'
    const docDef = INS_DOCS.find(d => d.code === code);
    const docCategory = (docDef?.group === 'victim') ? 'victim' : 'insured';

    const { data: row, error: dbErr } = await sb.from('insurance_doc_uploads').insert({
      claim_id: _insClaim.id, doc_code: code, doc_name: file.name,
      doc_category: docCategory, file_path: path, file_kind:'original',
      source_type:'admin', is_latest:true,
    }).select('id,doc_code,doc_name,file_path,uploaded_at').single();
    if (dbErr) throw new Error('DB: '+dbErr.message);

    _insUploaded[code] = row;
    // v6.2: 통합 슬롯이면 baseCode 배열에도 저장 (UI 렌더링용)
    // v6.2.14: 파일 2 업로드 시 파일 1 정보 손실 버그 수정
    if (baseCode && baseCode !== code) {
      // baseCode 자리에 이미 단일 객체가 있으면 [기존객체, null]로 변환 후 파일 2 추가
      const existing = _insUploaded[baseCode];
      if (!Array.isArray(existing)) {
        // 기존 단일 객체를 [0]에 보존 (파일 1)
        _insUploaded[baseCode] = existing ? [existing, null] : [null, null];
      }
      _insUploaded[baseCode][fileIdx || 0] = row;
    } else if (fileIdx === 0 || fileIdx === undefined) {
      // baseCode === code (fileIdx=0인 통합 슬롯 또는 일반 단일)
      const docDef2 = INS_DOCS.find(d => d.code === code);
      if (docDef2?.multipleFiles) {
        // 파일 2가 이미 있는 배열이면 [0]만 갱신, 아니면 새 배열
        if (Array.isArray(_insUploaded[code])) {
          _insUploaded[code][0] = row;
        } else {
          _insUploaded[code] = [row, null];
        }
      }
    }
    clearInterval(t);
    if (prog) { prog.style.width='100%'; setTimeout(()=>{prog.style.display='none';prog.style.width='0%';},400); }
    if (zone) zone.style.opacity='1';
    const isReplace = existing && existing.length > 0;
    toast(name + (isReplace ? ' 교체 완료' : ' 업로드 완료'), 's');
    _insStep=1; insRender();
  } catch(err) {
    clearInterval(t);
    if(prog){prog.style.display='none';prog.style.width='0%';}
    if(zone) zone.style.opacity='1';
    toast('업로드 실패: '+err.message,'e');
  }
}

// ─────────────────────────────────────────────
// STEP 2: 분석·판단 (추출 결과 + 책임 판단 한 화면)
// ─────────────────────────────────────────────
function insStep2HTML() {
  // v6.2 STEP 2 — 사실정보 후보 검토·수정 (외부 시스템 패턴)
  // 외부 시스템 3.36.160.16:5026/report/review 패턴 그대로 차용
  // 추가: 출처 표시, 다중 후보 칩, 자동 입력 모드 (단일 후보 시 자동 채움)
  const cl = _insClaim || {};
  const fd = _insField || {};

  // 사실정보 25개 필드 정의 (보고서_항목_정의서_완성_JS.xlsx 기준)
  // 출처 표시: extract_policy=보험증권, extract_insured=피보험자공공서류, extract_victim=피해자공공서류, judge_report=청구·소견·경위
  const FACT_FIELDS = [
    // 총괄표 (2)
    { section:'총괄표', name:'대물배상 보상한도액', key:'coverage_limit',          source:'보험증권', type:'text' },
    { section:'총괄표', name:'대물배상 자기부담금', key:'deductible',                source:'보험증권', type:'text' },

    // 보험계약사항 (10)
    { section:'보험계약사항', name:'보험종목',                                     key:'policy_product_name',   source:'보험증권', type:'text' },
    { section:'보험계약사항', name:'계약자',                                       key:'contractor_name',       source:'보험증권', type:'text' },
    { section:'보험계약사항', name:'피보험자',                                     key:'insured_name',          source:'보험증권', type:'text' },
    { section:'보험계약사항', name:'보험기간',                                     key:'insurance_period',      source:'보험증권', type:'text' },
    { section:'보험계약사항', name:'사고일이 보험기간 내에 속하는지 여부',         key:'insurance_period_match',source:'룰 기반 자동',  type:'text', auto:true },
    { section:'보험계약사항', name:'보상한도액',                                   key:'coverage_limit_full',    source:'보험증권', type:'text' },
    { section:'보험계약사항', name:'자기부담금',                                   key:'deductible_full',        source:'보험증권', type:'text' },
    { section:'보험계약사항', name:'특약조건',                                     key:'rider_condition',        source:'보험증권', type:'text' },
    { section:'보험계약사항', name:'소재지',                                       key:'policy_address',         source:'보험증권', type:'text' },
    { section:'보험계약사항', name:'사고 발생지가 보험목적지와 일치하는지 여부',   key:'accident_location_match',source:'룰 기반 자동',  type:'text', auto:true },

    // 일반사항 > 피보험자 개요 (7)
    { section:'일반사항 > 피보험자 개요', name:'성명',               key:'insured_full_name',      source:'주민등록등본', type:'text' },
    { section:'일반사항 > 피보험자 개요', name:'주민등록번호',       key:'insured_rrn',            source:'주민등록등본', type:'text' },
    { section:'일반사항 > 피보험자 개요', name:'연락처',              key:'insured_phone',          source:'주민등록등본/청구서', type:'text' },
    { section:'일반사항 > 피보험자 개요', name:'소재지',              key:'insured_registered_address', source:'주민등록등본', type:'text' },
    { section:'일반사항 > 피보험자 개요', name:'건물소유자 여부',    key:'insured_owner_name',     source:'건축물대장/등기부', type:'text' },
    { section:'일반사항 > 피보험자 개요', name:'동거인 여부',         key:'insured_cohabitants',    source:'주민등록등본', type:'textarea' },
    { section:'일반사항 > 피보험자 개요', name:'피보험자 지위 판단', key:'insured_status_hint',    source:'(분석 단계에서 결정)', type:'text', auto:true, readonly:true },

    // 사고사항 > 사고개요 (2)
    { section:'사고사항 > 사고개요', name:'사고일자',  key:'accident_date',     source:'누수소견서/경위서', type:'text' },
    { section:'사고사항 > 사고개요', name:'사고장소',  key:'accident_address',  source:'누수소견서/경위서', type:'text' },
  ];

  // 피해자 필드 정의 (피해자별 반복)
  const VICTIM_FACT_FIELDS = [
    { name:'성명',              key:'victim_name',            source:'주민등록등본', type:'text' },
    { name:'주민등록번호',      key:'victim_rrn',             source:'주민등록등본', type:'text' },
    { name:'소재지',            key:'victim_address',         source:'주민등록등본', type:'text' },
    { name:'건물소유자 여부',  key:'victim_owner_name',      source:'건축물대장/등기부', type:'text' },
  ];

  // 후보값 가져오기 — 추출 결과에서
  const getCandidate = (key) => {
    // _extractedData가 있다면 그곳에서, 없으면 _insClaim에서
    if (_extractedCandidates && _extractedCandidates[key]) {
      return _extractedCandidates[key];  // [{value, source, type}, ...] 형태
    }
    if (cl[key]) return [{ value: cl[key], source: '추출됨', type: 'extracted' }];
    return [];
  };

  // 현재 사용자가 수정한 값 가져오기
  const getUserValue = (key) => {
    return (_userOverrides && _userOverrides[key]) || '';
  };

  // 필드 렌더 헬퍼
  const renderField = (field, idx) => {
    const candidates = getCandidate(field.key);
    const userValue = getUserValue(field.key);
    // 단일 후보 자동 입력
    const autoFillValue = (candidates.length === 1 && !userValue) ? candidates[0].value : userValue;
    const isModified = userValue && candidates.length > 0 && userValue !== candidates[0]?.value;
    const inputClass = isModified ? 'user-modified' : '';
    const fieldId = `s2-field-${field.key}-${idx}`;

    // 입력박스 (text or textarea)
    const inputHTML = field.type === 'textarea'
      ? `<textarea class="v62-fact-field-textarea ${inputClass}" id="${fieldId}"
          ${field.readonly?'readonly':''}
          oninput="s2UpdateField('${field.key}', this.value)">${escapeHtml(autoFillValue || '')}</textarea>`
      : `<input type="text" class="v62-fact-field-input ${inputClass}" id="${fieldId}"
          ${field.readonly?'readonly':''}
          value="${escapeHtml(autoFillValue || '')}"
          oninput="s2UpdateField('${field.key}', this.value)">`;

    // 후보칩 영역
    let chipsHTML = '';
    if (candidates.length > 0) {
      chipsHTML = candidates.map(c => `
        <span class="v62-candidate-chip" onclick="s2ApplyCandidate('${field.key}', ${JSON.stringify(c.value).replace(/"/g, '&quot;')}, '${fieldId}')">
          <span class="v62-candidate-chip-label">[추출]</span>
          <span class="v62-candidate-chip-value" title="${escapeHtml(c.value)}">${escapeHtml(String(c.value).substring(0,50))}</span>
        </span>
      `).join('');
      chipsHTML += `<span class="v62-candidate-source">출처: ${escapeHtml(field.source)}</span>`;
    } else {
      chipsHTML = `<span class="v62-candidate-empty">후보 없음</span><span class="v62-candidate-source">예상 출처: ${escapeHtml(field.source)}</span>`;
    }

    return `
      <div class="v62-fact-field">
        <label class="v62-fact-field-label">${escapeHtml(field.name)}${field.auto?' <span style="color:#9ca3af;font-weight:400">(자동 판정)</span>':''}</label>
        ${inputHTML}
        <div class="v62-candidates">${chipsHTML}</div>
      </div>`;
  };

  // 섹션별 그룹핑
  const sections = {};
  for (const field of FACT_FIELDS) {
    if (!sections[field.section]) sections[field.section] = [];
    sections[field.section].push(field);
  }

  // 섹션 렌더링
  const sectionsHTML = Object.entries(sections).map(([sectionName, fields]) => `
    <div class="v62-fact-section">
      <div class="v62-fact-section-header">${escapeHtml(sectionName)}</div>
      ${fields.map((f, i) => renderField(f, i)).join('')}
    </div>
  `).join('');

  // 피해자 섹션 (1명 기본)
  const victims = (_insClaim?.victims && _insClaim.victims.length > 0) ? _insClaim.victims : [{ idx: 0 }];
  const victimsHTML = victims.map((v, vIdx) => `
    <div class="v62-fact-section">
      <div class="v62-fact-victim-header">
        <span class="v62-fact-victim-title">피해자 ${vIdx + 1}</span>
        <span class="v62-fact-victim-badge">피해자별 정보</span>
      </div>
      ${VICTIM_FACT_FIELDS.map((f, i) => renderField({...f, key: `${f.key}_v${vIdx}`}, i)).join('')}
    </div>
  `).join('');

  return `
  ${v6CaseHeaderHTML({ editableDate: false })}

  <div class="v62-step2-container">
    <div class="v62-step2-title">2단계: 사실정보 후보 검토·수정</div>
    <p class="v62-step2-subtitle">
      각 필드의 <strong>[추출] 후보 칩</strong>을 눌러 값을 채우거나 직접 수정한 뒤,<br>
      하단의 <strong>AI 분석 실행</strong>을 누르세요.
      <span style="display:block;margin-top:4px;color:#9ca3af">노란색 배경은 사용자가 수정한 필드입니다.</span>
    </p>

    ${sectionsHTML}
    ${victimsHTML}

    <div class="v62-step2-actions">
      <button class="v62-back-btn" onclick="s2GoBackToStep1()">← 업로드로 돌아가기</button>
      <button class="v62-analyze-btn" id="s2-analyze-btn" onclick="s2Analyze()">AI 분석 실행</button>
    </div>

    <!-- v6.2.26: 9단계 분석 진행률 UI -->
    <style>
      @keyframes v62-spin { to { transform: rotate(360deg); } }
      .s2-step-pill {
        padding: 6px 8px;
        text-align: center;
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        color: #94a3b8;
        font-weight: 500;
        transition: all 0.2s;
      }
      .s2-step-pill.active {
        background: #dbeafe;
        border-color: #3b82f6;
        color: #1e40af;
        font-weight: 700;
        box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
      }
      .s2-step-pill.done {
        background: #dcfce7;
        border-color: #22c55e;
        color: #15803d;
      }
      .s2-step-pill.done::before {
        content: "✓ ";
      }
    </style>
    <div id="s2-loading" style="display:none; margin-top:16px; padding:20px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px;">
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
        <div class="v62-spinner" style="width:18px; height:18px; border:3px solid #e2e8f0; border-top-color:#3b82f6; border-radius:50%; animation:v62-spin 0.8s linear infinite;"></div>
        <div id="s2-label" style="font-size:14px; font-weight:600; color:#1e293b;">분석 준비 중...</div>
        <div id="s2-pct" style="margin-left:auto; font-size:13px; font-weight:600; color:#3b82f6;">0%</div>
      </div>
      <div style="height:10px; background:#e2e8f0; border-radius:6px; overflow:hidden;">
        <div id="s2-fill" style="height:100%; width:0%; background:linear-gradient(90deg, #3b82f6, #2563eb); transition:width 0.4s ease;"></div>
      </div>
      <div id="s2-step-list" style="margin-top:14px; display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; font-size:11px;">
        <div data-step="1" class="s2-step-pill">1. 지위 판단</div>
        <div data-step="2" class="s2-step-pill">2. 사고원인</div>
        <div data-step="3" class="s2-step-pill">3. 사고경위</div>
        <div data-step="4" class="s2-step-pill">4. 보험기간</div>
        <div data-step="5" class="s2-step-pill">5. 사고장소</div>
        <div data-step="6" class="s2-step-pill">6. 피해사항</div>
        <div data-step="7" class="s2-step-pill">7. 조사의견</div>
        <div data-step="8" class="s2-step-pill">8. 손배책임</div>
        <div data-step="9" class="s2-step-pill">9. 보험금</div>
      </div>
    </div>
  </div>`;
}


function s2AddrChange() {
  const v = document.getElementById('ex-addr')?.value;
  document.getElementById('ex-addr-note-wrap').style.display = v!=='ok'?'block':'none';
}
function s2JudgeStyle(sel, kind) {
  const v = sel.value;
  if (kind === 'established') {
    sel.style.cssText = v==='yes'
      ? 'background:#dcfce7;color:#15803d;border-color:#15803d'
      : 'background:#fee2e2;color:#dc2626;border-color:#dc2626';
  } else if (kind === 'coverage') {
    sel.style.cssText = v==='부책'
      ? 'background:#dcfce7;color:#15803d;border-color:#15803d'
      : v==='면책'
      ? 'background:#fee2e2;color:#dc2626;border-color:#dc2626'
      : 'background:#fef3c7;color:#b45309;border-color:#b45309';
  }
}
function s2RecalcPay() {
  const rc  = _insField?.repair_cost || 0;
  const ded = parseInt(document.getElementById('j-ded')?.value)||0;
  const pay = Math.max(0, rc - ded);
  const el = document.getElementById('j-pay-display');
  if (el) el.textContent = pay.toLocaleString() + '원';
}

// v5.4.3 ★ AI 서술 vs 필드값 불일치 감지
// 예: insured_status_reason에 "소유자겸점유자"라고 썼는데 insured_status는 "임차인겸점유자"
function detectStatusMismatch(r) {
  const reasoning = r?.insured_status_reason || r?.liability_reasoning || '';
  const fieldStatus = r?.insured_status;
  if (!reasoning || !fieldStatus) return null;
  
  const TOKENS = ['소유자겸점유자', '임차인겸점유자', '임대인', '임차인', '확인불가'];
  // reasoning 안에 언급된 지위 토큰들 (순서 중요: 긴 것 먼저 — 임차인겸점유자가 임차인보다 먼저)
  const mentioned = TOKENS.filter(s => reasoning.includes(s));
  
  // 언급은 있는데 필드값이 거기 포함되지 않으면 불일치
  if (mentioned.length > 0 && !mentioned.includes(fieldStatus)) {
    return {
      mentionedStatus: mentioned[0],
      fieldStatus,
    };
  }
  return null;
}

// ─────────────────────────────────────────────
// v5.4: 피해자 배열 UI
// ─────────────────────────────────────────────
function renderVictimsList() {
  if (!_insVictims || _insVictims.length === 0) {
    return `<div class="empty" style="padding:20px">
      <div style="font-size:12px;color:var(--muted)">
        피해자가 아직 등록되지 않았습니다. "+ 피해자 추가" 버튼을 눌러 등록하세요.<br>
        피해세대 건축물대장/등기부등본을 업로드하면 분석 시 자동으로 첫 피해자가 채워집니다.
      </div>
    </div>`;
  }
  return _insVictims.map((v, idx) => {
    const num = v.victim_order || (idx + 1);
    const dbIdBadge = v.id 
      ? '<span class="badge" style="background:#dcfce7;color:#15803d;font-size:10px">저장됨</span>'
      : '<span class="badge" style="background:#fef3c7;color:#b45309;font-size:10px">미저장</span>';
    return `
    <div class="victim-item" data-idx="${idx}" style="border:1px solid var(--line);border-radius:8px;padding:14px;margin-bottom:10px;background:var(--bg)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:13px;font-weight:700;color:var(--primary)">
          피해자 ${num} ${dbIdBadge}
        </div>
        <button class="btn btn-ghost btn-sm" style="color:#dc2626;padding:4px 10px;font-size:11px" 
          onclick="victimRemove(${idx})">🗑 삭제</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-group" style="margin:0">
          <label class="form-label" style="font-size:11px">성명</label>
          <input class="form-control" style="font-size:12px" 
            value="${v.victim_name || ''}" 
            placeholder="예: 홍길동"
            onchange="victimUpdate(${idx}, 'victim_name', this.value)"/>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label" style="font-size:11px">주소 (소재지)</label>
          <input class="form-control" style="font-size:12px" 
            value="${v.victim_address || ''}" 
            placeholder="예: 101동 107호"
            onchange="victimUpdate(${idx}, 'victim_address', this.value)"/>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label" style="font-size:11px">건물소유자</label>
          <input class="form-control" style="font-size:12px" 
            value="${v.victim_owner_name || ''}" 
            placeholder="예: 김인수"
            onchange="victimUpdate(${idx}, 'victim_owner_name', this.value)"/>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label" style="font-size:11px">기타사항 (선택)</label>
          <input class="form-control" style="font-size:12px" 
            value="${v.victim_note || ''}" 
            placeholder="필요 시 메모"
            onchange="victimUpdate(${idx}, 'victim_note', this.value)"/>
        </div>
      </div>
      ${v.victim_damage ? `
      <div style="margin-top:10px;padding:8px 12px;background:white;border-radius:6px;font-size:11px;border-left:3px solid var(--primary)">
        <strong>피해사항:</strong> ${v.victim_damage}
      </div>` : ''}
    </div>`;
  }).join('');
}

function victimAdd() {
  const nextOrder = _insVictims.length > 0 
    ? Math.max(..._insVictims.map(v => v.victim_order || 0)) + 1 
    : 1;
  _insVictims.push({
    id: null,
    victim_order: nextOrder,
    victim_name: '',
    victim_address: '',
    victim_owner_name: '',
    victim_note: '',
    victim_damage: '',
  });
  refreshVictimsContainer();
}

async function victimRemove(idx) {
  const v = _insVictims[idx];
  if (!v) return;
  if (!confirm(`피해자 ${v.victim_order} (${v.victim_name || '미기입'})를 삭제하시겠습니까?`)) return;
  try {
    if (v.id) {
      await insDeleteVictim(v.id);
    }
    _insVictims.splice(idx, 1);
    // 순번 재정렬
    _insVictims.forEach((x, i) => { x.victim_order = i + 1; });
    refreshVictimsContainer();
    toast('피해자가 삭제되었습니다.', 's');
  } catch (err) {
    console.error('[v5.4] victimRemove 실패:', err);
    toast('삭제 실패: ' + (err.message || err), 'e');
  }
}

function victimUpdate(idx, field, value) {
  if (!_insVictims[idx]) return;
  _insVictims[idx][field] = value;
  // 저장은 s2Save()에서 일괄 처리 — 여기서는 메모리만 업데이트
}

function refreshVictimsContainer() {
  const el = document.getElementById('victims-container');
  if (el) el.innerHTML = renderVictimsList();
}

// ─────────────────────────────────────────────
// STEP 2: Claude 분석
// (1차) 보험증권 추출
// (2차) 건축물대장 + 주민등록등본 교차 → 피보험자 지위, 주소 일치
// (3차) 피해자 건축물대장 → 피해자 소재지
// (4차 ★ v5 신규) Sabi 8·9단계 종합 판단 — 약관별 분기
// ─────────────────────────────────────────────

// v6.2: STEP 2 사용자 입력 추적
function s2UpdateField(key, value) {
  _userOverrides[key] = value;
  // 입력박스 색상 (수정됨 표시)
  const candidates = _extractedCandidates[key] || [];
  const isModified = value && candidates.length > 0 && value !== candidates[0]?.value;
  // 입력박스 클래스 갱신 — DOM 직접 조작 (re-render 없이)
  const inputs = document.querySelectorAll(`[id^="s2-field-${key}-"]`);
  inputs.forEach(input => {
    if (isModified) input.classList.add('user-modified');
    else input.classList.remove('user-modified');
  });
}
window.s2UpdateField = s2UpdateField;

// v6.2: 후보칩 클릭 → 입력박스에 값 적용
function s2ApplyCandidate(key, value, fieldId) {
  _userOverrides[key] = value;
  const input = document.getElementById(fieldId);
  if (input) {
    input.value = value;
    input.classList.remove('user-modified');
    // 짧은 펄스 효과로 적용 시각화
    input.style.transition = 'background 0.3s';
    input.style.background = '#dcfce7';
    setTimeout(() => { input.style.background = ''; }, 400);
  }
}
window.s2ApplyCandidate = s2ApplyCandidate;

// v6.2: STEP 1로 돌아가기
function s2GoBackToStep1() {
  if (!confirm('업로드 화면으로 돌아가시겠어요?\\n수정 중인 내용은 저장됩니다.')) return;
  _insStep = 1;
  insRender();
}
window.s2GoBackToStep1 = s2GoBackToStep1;

// ─────────────────────────────────────────────
// v6.2: 룰 기반 자동 판정 헬퍼 (LLM 안 씀)
// ─────────────────────────────────────────────

// 보험기간 부합 여부 — 날짜 비교
// periodStr: "2012.06.22 ~ 2098.06.22" 또는 "2012-06-22 ~ 2098-06-22"
// accidentDateStr: "2025년 3월 3일 10시 00분", "2025.03.03", "2025-03-03" 등
function _calcInsurancePeriodMatch(periodStr, accidentDateStr) {
  try {
    // 보험기간 파싱
    const periodParts = periodStr.split(/[~–-]/).map(s => s.trim());
    if (periodParts.length < 2) return null;
    const parseDate = (s) => {
      // 다양한 형식 지원
      const cleaned = String(s)
        .replace(/년|월/g, '.')
        .replace(/일.*$/, '')
        .replace(/\s/g, '')
        .replace(/\./g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      // YYYY-MM-DD 형식으로 변환
      const m = cleaned.match(/(\d{4})-?(\d{1,2})-?(\d{1,2})/);
      if (!m) return null;
      const d = new Date(`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`);
      return isNaN(d.getTime()) ? null : d;
    };
    const start = parseDate(periodParts[0]);
    const end   = parseDate(periodParts[1]);
    const acc   = parseDate(accidentDateStr);
    if (!start || !end || !acc) return null;
    const accStr = `${acc.getFullYear()}.${String(acc.getMonth()+1).padStart(2,'0')}.${String(acc.getDate()).padStart(2,'0')}`;
    if (acc >= start && acc <= end) {
      return `일치 (사고일 ${accStr})`;
    } else {
      return `불일치 (사고일 ${accStr} — 보험기간 ${periodStr})`;
    }
  } catch (e) {
    console.warn('[v6.2] 보험기간 부합 계산 실패:', e);
    return null;
  }
}

// 사고 발생지 부합 여부 — 주소 비교 (시·구 단위 + fallback 키워드 매칭)
function _calcAccidentLocationMatch(policyAddr, accidentAddr) {
  try {
    // 시·도 + 구 추출
    const extractRegion = (addr) => {
      const s = String(addr).replace(/\s+/g, ' ').trim();
      // 시·도 (서울, 경기도, 인천시, 부산광역시 등)
      const sido = s.match(/(서울|경기|인천|부산|대구|광주|대전|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주)[가-힣]*?(?=\s|$|[가-힣]+(?:구|시|군))/);
      // 구·시·군 (강남구, 수지구, 동두천시, 양평군 등)
      // 단, 광역시·도 자체는 제외 (예: "서울특별시"는 안 됨)
      const EXCLUDE = ['서울특별시','부산광역시','대구광역시','인천광역시','광주광역시','대전광역시','울산광역시','세종특별자치시','경기도','강원도','강원특별자치도','충청북도','충청남도','전라북도','전북특별자치도','전라남도','경상북도','경상남도','제주특별자치도'];
      // v6.2.13: "구"를 "시/군"보다 우선 (예: "경기도 용인시 수지구" → "수지구" 선택)
      const allMatches = [];
      for (const m of s.matchAll(/([가-힣]+(?:구|시|군))/g)) {
        if (!EXCLUDE.includes(m[1])) allMatches.push(m[1]);
      }
      let guGun = '';
      // 우선순위: 구 > 군 > 시
      const gu = allMatches.find(m => m.endsWith('구'));
      const gun = allMatches.find(m => m.endsWith('군'));
      const si = allMatches.find(m => m.endsWith('시'));
      guGun = gu || gun || si || '';
      return {
        sido: sido?.[1] || '',
        guGun: guGun,
        full: s,
      };
    };

    // v6.2.13: fallback 키워드 추출 (아파트명·도로명·동호수)
    // 사고장소가 "수지삼성2차 205동 1602호"처럼 행정구역 없을 때 사용
    // 행정구역(시/구/군/도) 자체는 제외 — 너무 광범위해서 매칭 정확도 낮음
    const extractKeywords = (addr) => {
      const s = String(addr).replace(/\s+/g, ' ').trim();
      const kws = [];
      // 1. 동·호수 (예: "205동 1602호", "101동 107호") — 가장 확실한 매칭 키
      for (const m of s.matchAll(/(\d+동\s*\d+호)/g)) {
        kws.push(m[1].replace(/\s+/g, ' '));
      }
      // 2. 아파트/단지명 (예: "수지삼성2차", "삼성래미안", "롯데캐슬", "수지2차")
      //    "X차" 패턴: "수지2차"
      for (const m of s.matchAll(/([가-힣]+\d+차)/g)) {
        kws.push(m[1]);
      }
      //    "X아파트" 또는 알려진 단지명
      for (const m of s.matchAll(/([가-힣]{2,}(?:아파트|래미안|푸르지오|자이|롯데캐슬|힐스테이트|이편한세상|위브|sk뷰|아이파크|센트럴|타워|빌라))/g)) {
        kws.push(m[1]);
      }
      // 3. 도로명 + 번지 (예: "수풍로 38", "천호대로 89길 30")
      for (const m of s.matchAll(/([가-힣]+(?:로|길)\s*\d+(?:번길\s*\d+)?)/g)) {
        kws.push(m[0].trim());
      }
      // 4. 동 이름 (예: "풍덕천동", "장안동") — 행정동
      for (const m of s.matchAll(/([가-힣]+동)(?:\s|,|\)|$)/g)) {
        const w = m[1];
        // "1동", "2동" 같은 숫자 동 제외
        if (!w.match(/^\d/) && w.length >= 2 && !['아파트동','상가동'].includes(w)) {
          kws.push(w);
        }
      }
      // 5. v6.2.13: 일반 단어 — 위 패턴에 안 잡힌 단지명/약식명 (예: "수지삼성")
      //    행정구역 단어(시/도/구/군/특별시/광역시 등)와 공통 조사는 제외
      const EXCLUDE_GENERAL = new Set([
        '서울','경기','인천','부산','대구','광주','대전','울산','세종','강원','충북','충남','전북','전남','경북','경남','제주',
        '서울특별시','부산광역시','대구광역시','인천광역시','광주광역시','대전광역시','울산광역시','세종특별자치시',
        '경기도','강원도','강원특별자치도','충청북도','충청남도','전라북도','전북특별자치도','전라남도','경상북도','경상남도','제주특별자치도',
        '및','외','동호','호수','번지','지번','도로명',
      ]);
      // 공백/괄호/쉼표로 분리
      const tokens = s.split(/[\s\(\),]+/).filter(Boolean);
      for (const t of tokens) {
        // 순수 한글 2자 이상이고 구/시/군/동/로/길로 끝나지 않는 단어
        if (/^[가-힣]{2,}$/.test(t) && !t.match(/(구|시|군|도|동|로|길|특별자치도)$/)) {
          if (!EXCLUDE_GENERAL.has(t)) kws.push(t);
        }
      }
      return [...new Set(kws)];  // 중복 제거
    };

    const r1 = extractRegion(policyAddr);
    const r2 = extractRegion(accidentAddr);

    // 1차: 양쪽 모두 행정구역 있을 때
    if (r1.guGun && r2.guGun) {
      const sidoMatch = !r1.sido || !r2.sido || r1.sido === r2.sido;
      const guGunMatch = r1.guGun === r2.guGun;
      if (sidoMatch && guGunMatch) return `일치`;
      return `불일치 (증권 소재지: ${r1.guGun} / 사고장소: ${r2.guGun})`;
    }

    // 2차 fallback: 키워드 매칭 (한쪽이라도 행정구역 없을 때)
    // SMPL_02처럼 사고장소가 "수지삼성2차 205동 1602호"인 경우
    const kw1 = extractKeywords(policyAddr);
    const kw2 = extractKeywords(accidentAddr);
    if (kw1.length === 0 || kw2.length === 0) {
      // 양쪽 모두 키워드 없으면 판정 불가
      return null;
    }
    // 두 키워드 집합에 공통 요소가 있으면 일치
    const intersection = kw1.filter(k => kw2.some(k2 => k2.includes(k) || k.includes(k2)));
    if (intersection.length > 0) {
      return `일치 (공통 키워드: ${intersection.slice(0, 2).join(', ')})`;
    }
    // 공통 없으면 불일치
    return `불일치 (증권: ${kw1.slice(0,2).join(',')} / 사고장소: ${kw2.slice(0,2).join(',')})`;
  } catch (e) {
    console.warn('[v6.2] 사고 발생지 부합 계산 실패:', e);
    return null;
  }
}

// ─────────────────────────────────────────────
// v6.2: s2Extract — 추출 4-Call만 실행, 분석은 안 함
// (s1Save에서 호출됨. STEP 2 진입 후 후보값을 _extractedCandidates에 채움)
// ─────────────────────────────────────────────
async function s2Extract() {
  if (_insAnalyzing) return;
  _insAnalyzing = true;

  const insType = _insClaim.insurance_type || 'family_daily_new';
  const typeCtx = INS_TYPE_CONTEXT[insType] || INS_TYPE_CONTEXT['family_daily_new'];
  const SYS = `당신은 대한민국 독립손해사정사입니다. 누수사고 보험 서류를 분석합니다.
${typeCtx}
순수 JSON만 반환. 마크다운 코드블록 금지.`;

  // STEP 2 화면 위에 추출 진행 오버레이 표시
  const showExtracting = (text, pct) => {
    let overlay = document.getElementById('v62-extracting-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'v62-extracting-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,255,0.95);z-index:999;display:flex;align-items:center;justify-content:center;';
      overlay.innerHTML = `<div style="text-align:center">
        <div class="v62-extracting-spinner" style="display:inline-block;width:40px;height:40px;border:4px solid #e5e7eb;border-top-color:#3b82f6;border-radius:50%;animation:v62-spin 0.8s linear infinite;margin-bottom:14px"></div>
        <div id="v62-ex-text" style="font-size:14px;font-weight:600;color:#111827">${text}</div>
        <div id="v62-ex-pct" style="font-size:12px;color:#6b7280;margin-top:6px">${pct}%</div>
      </div>`;
      document.body.appendChild(overlay);
    } else {
      const t = document.getElementById('v62-ex-text'); if (t) t.textContent = text;
      const p = document.getElementById('v62-ex-pct'); if (p) p.textContent = pct + '%';
    }
  };
  const hideExtracting = () => {
    const overlay = document.getElementById('v62-extracting-overlay');
    if (overlay) overlay.remove();
  };

  try {
    _extractedCandidates = {};  // 초기화
    _userOverrides = {};         // v6.2.9: 재추출 시 사용자 수정값도 초기화
    const addCandidate = (key, value, source) => {
      if (!value || value === '' || value === '정보 없음' || value === '확인불가') return;
      if (!_extractedCandidates[key]) _extractedCandidates[key] = [];
      _extractedCandidates[key].push({ value: String(value), source, type: 'extracted' });
    };

    // ── Call 1: 보험증권 추출 ──
    if (_insUploaded['insurance_policy'] && _insUploaded['insurance_policy'].file_path) {
      showExtracting('보험증권 추출 중...', 10);
      const up = _insUploaded['insurance_policy'];
      const b64 = await fetchBase64(up.file_path);
      if (b64) {
        const mt = docMediaType(up.file_path);
        const r1 = await callClaudeDoc(b64, mt, '보험증권', SYS,
`보험증권에서 아래 JSON을 추출하세요. 정보 없으면 빈 문자열.
{
  "policy_product_name": "보험종목명 (전체 명칭)",
  "policy_no": "증권번호",
  "contractor_name": "계약자 성명",
  "insured_name": "피보험자 성명",
  "policy_start": "YYYY.MM.DD",
  "policy_end": "YYYY.MM.DD",
  "policy_address": "피보험자 소재지 원문 그대로 (보험증권상)",
  "coverage_limit": "보상한도액 (예: 100,000,000원)",
  "deductible": "자기부담금 (예: 200,000원)",
  "rider_condition": "특약조건 (예: 가족일상생활배상책임)"
}`);
        if (r1) {
          addCandidate('policy_product_name', r1.policy_product_name, '보험증권');
          addCandidate('contractor_name', r1.contractor_name, '보험증권');
          addCandidate('insured_name', r1.insured_name, '보험증권');
          if (r1.policy_start && r1.policy_end) {
            addCandidate('insurance_period', `${r1.policy_start} ~ ${r1.policy_end}`, '보험증권');
          }
          addCandidate('policy_address', r1.policy_address, '보험증권');
          addCandidate('coverage_limit', r1.coverage_limit, '보험증권');
          addCandidate('coverage_limit_full', r1.coverage_limit, '보험증권');
          addCandidate('deductible', r1.deductible, '보험증권');
          addCandidate('deductible_full', r1.deductible, '보험증권');
          addCandidate('rider_condition', r1.rider_condition, '보험증권');
        }
      }
    }

    // ── Call 2a: 피보험자 인적 정보 (등본 + 가족관계증명서) ──
    showExtracting('피보험자 인적 정보 추출 중...', 30);
    const insuredPersonalDocs = [];
    for (const code of ['family_doc', 'family_doc_2', 'resident_reg', 'family_cert']) {
      const up = _insUploaded[code];
      if (up && !Array.isArray(up) && up.file_path) {
        const b64 = await fetchBase64(up.file_path);
        if (b64) insuredPersonalDocs.push({ b64, mt: docMediaType(up.file_path), name: up.doc_name || code });
      }
    }
    // v6.2.13: 보험증권에서 추출한 피보험자명을 컨텍스트로 전달
    const policyInsuredName = _extractedCandidates['insured_name']?.[0]?.value || '';
    if (insuredPersonalDocs.length > 0) {
      const contentArr = insuredPersonalDocs.map(d => {
        const isPdf = d.mt === 'application/pdf';
        const item = { type: isPdf ? 'document' : 'image',
                       source: { type:'base64', media_type:d.mt, data:d.b64 } };
        if (isPdf) item.title = d.name;
        return item;
      });
      contentArr.push({ type:'text', text:
`보험증권의 피보험자 본인 성명은 "${policyInsuredName}"입니다.

첨부 서류(주민등록등본·가족관계증명서)에서 위 피보험자 본인 "${policyInsuredName}"의 정보를 추출하세요.

【중요 1】 등본에서 "${policyInsuredName}"는 세대주일 수도, 세대원(배우자/자녀)일 수도 있습니다.
세대주 이름이 다르더라도 세대원 목록에서 "${policyInsuredName}"을 찾아 그 사람의 정보를 추출하세요.
가족관계증명서에서도 본인이 "${policyInsuredName}"이 아닐 수 있습니다.

【중요 2 — 소재지】 주민등록등본 상단에 "현주소" 항목이 있습니다.
이 "현주소"는 그 세대(가족 전체)가 함께 살고 있는 곳입니다.
"${policyInsuredName}"이 세대원이든 세대주든, 이 사람도 그 주소에 같이 거주합니다.
따라서 등본의 "현주소" 값을 그대로 복사해서 insured_registered_address에 넣으세요.
예: 등본 현주소 = "경기도 용인시 수지구 수풍로 38, 205동 1602호 (풍덕천동,수지2차삼성아파트)"
    → insured_registered_address = "경기도 용인시 수지구 수풍로 38, 205동 1602호 (풍덕천동,수지2차삼성아파트)"

【중요 3 — 동거인】 등본의 세대원 목록(세대주, 배우자, 자녀 등) 중 "${policyInsuredName}" 본인을 제외한 모든 세대원을 추출하세요.
예시: 세대주가 정영윤이고 본인이 서재성(세대원)이면, 동거인은 "정영윤(배우자), 서은율(자녀), 서하율(자녀)"가 됩니다.

【주의】 한국 정부 문서의 "이하여백", "이하 여백", "공란", "==공란==", "이상" 같은 표시는 사람 이름이나 정보가 아닙니다. 단순히 표의 빈 칸을 의미하는 양식 표시이므로 무시하세요.

JSON 출력 (정보 없으면 빈 문자열):
{
  "insured_full_name": "${policyInsuredName} (등본·가족관계에 존재하면 그대로)",
  "insured_rrn": "${policyInsuredName}의 주민등록번호 (마스킹 포함)",
  "insured_phone": "연락처 (있으면)",
  "insured_registered_address": "등본의 '현주소' 항목 값 그대로 (도로명주소+동·호수+(아파트명) 전체 텍스트)",
  "insured_cohabitants": "동거인 목록 — '${policyInsuredName}' 본인을 제외한 모든 세대원 (성명+관계, 쉼표 구분. 예: 정영윤(배우자), 서은율(자녀), 서하율(자녀))",
  "family_relation_text": "가족관계증명서 기준 가족관계 (예: 서재성(본인) - 정영윤(배우자), 서은율(자녀))"
}`});
      const r2a = await callClaudeMulti(contentArr, SYS);
      if (r2a) {
        addCandidate('insured_full_name', r2a.insured_full_name, '주민등록등본');
        addCandidate('insured_rrn', r2a.insured_rrn, '주민등록등본');
        addCandidate('insured_phone', r2a.insured_phone, '주민등록등본');
        addCandidate('insured_registered_address', r2a.insured_registered_address, '주민등록등본');
        addCandidate('insured_cohabitants', r2a.insured_cohabitants, '주민등록등본');
        addCandidate('family_relation_text', r2a.family_relation_text, '가족관계증명서');
      }
    }

    // ── Call 2b: 피보험자 소유자 정보 (건축물대장 + 등기부등본) ──
    showExtracting('피보험자 소유자 정보 추출 중...', 45);
    const insuredOwnerDocs = [];
    for (const code of ['ownership_insured', 'ownership_insured_2', 'ownership_accident']) {
      const up = _insUploaded[code];
      if (up && !Array.isArray(up) && up.file_path) {
        const b64 = await fetchBase64(up.file_path);
        if (b64) insuredOwnerDocs.push({ b64, mt: docMediaType(up.file_path), name: up.doc_name || code });
      }
    }
    if (insuredOwnerDocs.length > 0) {
      const contentArr = insuredOwnerDocs.map(d => {
        const isPdf = d.mt === 'application/pdf';
        const item = { type: isPdf ? 'document' : 'image',
                       source: { type:'base64', media_type:d.mt, data:d.b64 } };
        if (isPdf) item.title = d.name;
        return item;
      });
      contentArr.push({ type:'text', text:
`보험증권의 피보험자 본인은 "${policyInsuredName}"입니다.

첨부 서류(건축물대장·등기부등본)를 분석하여 사고세대 건물 소유자 정보를 추출하세요.

【공동소유 처리】 소유자가 1명이면 그 이름을, 2명 이상 공동소유면 모든 소유자를 지분과 함께 표기.
예시:
  - 단독소유: "서재성 (소유권이전 2013.06.28)"
  - 공동소유: "서재성 1/2, 정영윤 1/2 (소유권이전 2023.08.17)"

【주의】 한국 정부 문서의 "이하여백", "- 이하여백 -", "이하 여백", "공란", "이상" 같은 표시는
사람 이름이나 정보가 아닙니다. 단순히 표의 빈 칸 표시이므로 무시하세요.

JSON 출력 (정보 없으면 빈 문자열):
{
  "insured_owner_name": "사고세대 건물 소유자 (공동소유면 모든 소유자 지분 포함)"
}`});
      const r2b = await callClaudeMulti(contentArr, SYS);
      if (r2b) {
        addCandidate('insured_owner_name', r2b.insured_owner_name, '건축물대장/등기부');
      }
    }

    // ── Call 3a: 피해자 건축물대장 + 등기부 (1차, 90% 케이스 — 직하층 청구권자=건물소유자) ──
    showExtracting('피해자 건축물대장·등기부 추출 중...', 60);
    const victimOwnerDocs = [];
    for (const code of ['ownership_doc_victim', 'ownership_doc_victim_2', 'ownership_victim']) {
      const up = _insUploaded[code];
      if (up && !Array.isArray(up) && up.file_path) {
        const b64 = await fetchBase64(up.file_path);
        if (b64) victimOwnerDocs.push({ b64, mt: docMediaType(up.file_path), name: up.doc_name || code });
      }
    }
    if (victimOwnerDocs.length > 0) {
      const contentArr = victimOwnerDocs.map(d => {
        const isPdf = d.mt === 'application/pdf';
        const item = { type: isPdf ? 'document' : 'image',
                       source: { type:'base64', media_type:d.mt, data:d.b64 } };
        if (isPdf) item.title = d.name;
        return item;
      });
      contentArr.push({ type:'text', text:
`첨부 서류(피해자 건축물대장·등기부등본)를 분석하여 아래 JSON 추출하세요.
누수 사고에서 직하층 청구권자는 대부분 건물 소유자이므로, 소유자가 청구권자(피해자)일 가능성이 높습니다.

【중요 1 — 건축물대장의 두 종류 주소 구분】
건축물대장에는 두 가지 주소가 나옵니다. 반드시 구분해야 합니다.
  (A) "사고세대 주소" = 건축물대장 상단의 "도로명주소" 또는 "호명칭" 또는 "위치"
      이게 우리가 찾는 피해세대 건물의 진짜 주소입니다.
      예: "경기도 용인시 수지구 수풍로 38 (풍덕천동)" + "205동 1502호"
  (B) "소유자 등록 주소" = 소유자 정보 칸에 있는 소유자 본인의 주소
      이건 소유자가 등본 등록 시점에 살던 곳일 뿐, 사고세대 주소와 다를 수 있습니다.
      소유자가 이사 오기 전 옛 주소이거나 별도 거주지일 수 있습니다.
      이 주소는 사고세대 주소가 아니므로 victim_building_address로 추출하면 안 됩니다.

→ victim_building_address는 반드시 (A) 사고세대 주소를 추출하세요.

【중요 2 — 이하여백 무시】
한국 정부 문서의 "이하여백", "- 이하여백 -", "이하 여백", "공란", "==공란==", "이상", "이하" 같은 표시는
사람 이름이나 정보가 아닙니다. 단순히 표의 빈 칸을 의미하는 양식 표시이므로 무시하세요.

【중요 3 — 공동소유 처리】
소유자가 1명이면 그 이름, 2명 이상이면 모든 소유자를 지분과 함께 표기.
예: "권혜주 (소유권이전 2020.07.23)" 또는 "서재성 1/2, 정영윤 1/2 (소유권이전 2023.08.17)"

JSON 출력 (정보 없으면 빈 문자열):
{
  "victim_owner_name": "피해세대 건물 소유자 (공동소유면 모든 소유자 지분 포함. 소유권 이전일 함께)",
  "victim_owner_name_only": "건물 소유자 성명만 (괄호 없이. 공동소유면 ', '로 구분. 예: 권혜주 또는 서재성, 정영윤)",
  "victim_building_address": "사고세대 주소 — 건축물대장 상단의 도로명주소 + 동·호수 (예: 경기도 용인시 수지구 수풍로 38 205동 1502호). 소유자 본인의 주소가 아님!"
}`});
      const r3a = await callClaudeMulti(contentArr, SYS);
      if (r3a) {
        addCandidate('victim_owner_name_v0', r3a.victim_owner_name, '건축물대장/등기부');
        // 1차로 피해자 성명·주소 채움 (소유자=피해자 가정 — Call 3b의 등본이 있으면 덮어씀)
        if (r3a.victim_owner_name_only) {
          addCandidate('victim_name_v0', r3a.victim_owner_name_only, '건축물대장/등기부 (소유자)');
        }
        if (r3a.victim_building_address) {
          addCandidate('victim_address_v0', r3a.victim_building_address, '건축물대장/등기부');
        }
      }
    }

    // ── Call 3b: 피해자 등본·가족관계 (2차 보완, 임차인 청구 케이스 — 10%) ──
    showExtracting('피해자 등본·가족관계 추출 중...', 75);
    const victimPersonalDocs = [];
    for (const code of ['family_doc_victim', 'family_doc_victim_2']) {
      const up = _insUploaded[code];
      if (up && !Array.isArray(up) && up.file_path) {
        const b64 = await fetchBase64(up.file_path);
        if (b64) victimPersonalDocs.push({ b64, mt: docMediaType(up.file_path), name: up.doc_name || code });
      }
    }
    if (victimPersonalDocs.length > 0) {
      const contentArr = victimPersonalDocs.map(d => {
        const isPdf = d.mt === 'application/pdf';
        const item = { type: isPdf ? 'document' : 'image',
                       source: { type:'base64', media_type:d.mt, data:d.b64 } };
        if (isPdf) item.title = d.name;
        return item;
      });
      contentArr.push({ type:'text', text:
`첨부 서류(피해자 주민등록등본·가족관계증명서)를 분석하여 아래 JSON 추출.
정보 없으면 빈 문자열.
{
  "victim_name": "피해자 본인 성명 (등본상 청구권자)",
  "victim_rrn": "주민등록번호 (마스킹 포함)",
  "victim_address": "피해자 실거주지 (등본상 주소)"
}`});
      const r3b = await callClaudeMulti(contentArr, SYS);
      if (r3b) {
        // 등본 있으면 우선 적용 (1차 건축물대장 결과를 덮어씀)
        addCandidate('victim_name_v0', r3b.victim_name, '주민등록등본');
        addCandidate('victim_rrn_v0', r3b.victim_rrn, '주민등록등본');
        addCandidate('victim_address_v0', r3b.victim_address, '주민등록등본');
      }
    }

    // ── Call 4a: 누수소견서 (단독, 가장 중요한 문서) ──
    showExtracting('누수소견서 추출 중...', 85);
    const leakDoc = _insUploaded['leak_opinion_external'];
    if (leakDoc && !Array.isArray(leakDoc) && leakDoc.file_path) {
      const b64 = await fetchBase64(leakDoc.file_path);
      if (b64) {
        const mt = docMediaType(leakDoc.file_path);
        const r4a = await callClaudeDoc(b64, mt, '누수소견서', SYS,
`누수소견서에서 아래 JSON 추출. 정보 없으면 빈 문자열.
{
  "accident_date": "사고일자 (예: 2025년 3월 3일 또는 YYYY.MM.DD)",
  "accident_address": "사고장소 (사고 발생 주소 전체)",
  "leak_report_text": "누수 위치·원인·수리소견 요약 (1~2문장)"
}`);
        if (r4a) {
          addCandidate('accident_date', r4a.accident_date, '누수소견서');
          addCandidate('accident_address', r4a.accident_address, '누수소견서');
          _insClaim = { ..._insClaim, leak_report_text: r4a.leak_report_text };
        }
      }
    }

    // ── Call 4b: 청구서 + 경위서 + 파트너 보고서 ──
    showExtracting('청구·경위 자료 추출 중...', 90);
    const claimDocs = [];
    for (const code of ['claim_form', 'incident_statement']) {
      const up = _insUploaded[code];
      if (up && !Array.isArray(up) && up.file_path) {
        const b64 = await fetchBase64(up.file_path);
        if (b64) claimDocs.push({ b64, mt: docMediaType(up.file_path), name: up.doc_name || code });
      }
    }
    // 파트너 임포트가 있으면 그것도 활용 (텍스트로 첨부)
    let partnerText = '';
    if (_insImportedPartners.size > 0) {
      const importedList = _insPartners.filter(p => _insImportedPartners.has(p.id) && p.has_report);
      for (const p of importedList) {
        partnerText += `\n[파트너 ${p.partner_name} 보고서]\n`;
        if (p.accident_occurred_at) partnerText += `사고일자: ${p.accident_occurred_at}\n`;
        if (p.leak_cause) partnerText += `사고원인: ${p.leak_cause}\n`;
        if (p.attacker_unit) partnerText += `가해세대: ${p.attacker_unit}\n`;
        if (p.victim_unit) partnerText += `피해세대: ${p.victim_unit}\n`;
        if (p.repair_opinion) partnerText += `수리소견: ${p.repair_opinion}\n`;
      }
    }
    if (claimDocs.length > 0 || partnerText) {
      const contentArr = claimDocs.map(d => {
        const isPdf = d.mt === 'application/pdf';
        const item = { type: isPdf ? 'document' : 'image',
                       source: { type:'base64', media_type:d.mt, data:d.b64 } };
        if (isPdf) item.title = d.name;
        return item;
      });
      contentArr.push({ type:'text', text:
`첨부 서류(보험청구서·경위서)${partnerText?' + 파트너 보고서':''}를 종합 분석하여 아래 JSON 추출.
${partnerText ? '\n[파트너 보고서 내용]' + partnerText + '\n' : ''}
정보 없으면 빈 문자열.
${!_insUploaded['leak_opinion_external'] ? '※ 누수소견서가 없으므로 accident_date/accident_address도 함께 추출하세요.\n' : ''}

추출 규칙 (중요):
1. 보험청구서 양식의 "사고경위" 칸에 적힌 텍스트는 그대로 accident_summary에 추출하세요. 누락 금지.
   예: 청구서에 "자택 화장실 방수층 노후화로 하부층 2세대 수침"이라고 적혀있으면 그 문장을 그대로 사용.
2. 별도의 경위서 문서가 있으면 그 내용은 incident_report_text에 요약. 청구서의 사고경위 칸과는 다른 출처임.
3. accident_cause_text는 사고경위 또는 경위서에서 사고의 직접 원인만 짧게 추출 (예: "방수층 노후화", "세탁기 호스 이탈"). 사고 발생 위치/피해 내용은 제외.
4. 정보가 정말 없을 때만 빈 문자열. 청구서 양식 칸이 비어있어도 자유서술란이나 메모란이 있는지 한 번 더 확인.

{
  ${!_insUploaded['leak_opinion_external'] ? '"accident_date": "사고일자",\n  "accident_address": "사고장소 (주소 전체)",\n  ' : ''}
  "incident_report_text": "경위서 문서가 별도로 있을 때만 요약 (없으면 빈 문자열)",
  "accident_summary": "보험청구서의 사고경위 칸 원문 또는 경위서 요약",
  "accident_cause_text": "사고의 직접 원인만 짧게 (위치·피해 제외)"
}`});
      const r4b = await callClaudeMulti(contentArr, SYS);
      if (r4b) {
        // 누수소견서가 없을 때만 청구서/경위서에서 사고일자·장소 추출
        if (!_insUploaded['leak_opinion_external']) {
          addCandidate('accident_date', r4b.accident_date, '청구서/경위서');
          addCandidate('accident_address', r4b.accident_address, '청구서/경위서');
        }
        _insClaim = { ..._insClaim,
          incident_report_text: r4b.incident_report_text,
          accident_summary_text: r4b.accident_summary,  // v6.2.28: _text suffix로 키 통일
          accident_cause_text: r4b.accident_cause_text,  // v6.2.28: 사고의 직접 원인만 별도 추출
        };
        // v6.2.28: addCandidate로도 노출하여 _extractedCandidates에서도 접근 가능
        addCandidate('accident_summary', r4b.accident_summary, '청구서/경위서');
        addCandidate('incident_report', r4b.incident_report_text, '청구서/경위서');
        addCandidate('accident_cause_detail', r4b.accident_cause_text, '청구서/경위서');
      }
    }

    // ── 룰 기반 자동 판정 (LLM 안 씀) ──
    // 1. 보험기간 부합 여부: [보험기간] vs [사고일자]
    showExtracting('자동 판정 중...', 95);
    const periodVal = _extractedCandidates['insurance_period']?.[0]?.value;
    const accidentDateVal = _extractedCandidates['accident_date']?.[0]?.value;
    if (periodVal && accidentDateVal) {
      const periodMatch = _calcInsurancePeriodMatch(periodVal, accidentDateVal);
      if (periodMatch) addCandidate('insurance_period_match', periodMatch, '룰 기반 자동');
    }

    // 2. 사고 발생지 부합 여부: [보험증권 소재지] vs [사고장소]
    const policyAddr = _extractedCandidates['policy_address']?.[0]?.value;
    const accAddr = _extractedCandidates['accident_address']?.[0]?.value;
    if (policyAddr && accAddr) {
      const locMatch = _calcAccidentLocationMatch(policyAddr, accAddr);
      if (locMatch) addCandidate('accident_location_match', locMatch, '룰 기반 자동');
    }

    showExtracting('완료', 100);
    setTimeout(() => {
      hideExtracting();
      _insAnalyzing = false;
      insRender();  // STEP 2 다시 그리기 (후보칩 표시됨)
      toast('사실정보 추출 완료. 후보값을 검토해주세요.', 's');
    }, 400);

  } catch (err) {
    hideExtracting();
    _insAnalyzing = false;
    toast('추출 실패: ' + (err.message || err), 'e');
    console.error('[v6.2 s2Extract]', err);
  }
}
window.s2Extract = s2Extract;

// v6.2.25: 옛 4-Call 통합 분석 함수 — 9-Call로 대체됨. 롤백용으로 보존만 함.
// 호출되는 곳 없음. 추후 검증 끝나면 안전하게 제거 가능.
async function s2AnalyzeLegacy() {
  if (_insAnalyzing) return;
  _insAnalyzing = true;

  const fill  = document.getElementById('s2-fill');
  const label = document.getElementById('s2-label');
  const load  = document.getElementById('s2-loading');
  const btn   = document.getElementById('s2-analyze-btn');
  if (load) load.style.display = 'block';
  if (btn)  btn.disabled = true;

  const insType    = _insClaim.insurance_type || 'family_daily_old';
  const typeCtx    = INS_TYPE_CONTEXT[insType] || INS_TYPE_CONTEXT['family_daily_old'];
  const SYS = `당신은 대한민국 독립손해사정사입니다. 누수사고 보험 서류를 분석합니다.
${typeCtx}
적용 법령: ${INS_LEGAL}
순수 JSON만 반환. 마크다운 코드블록 금지.`;

  const progress = (pct, msg) => {
    if (fill)  fill.style.width  = pct + '%';
    if (label) label.textContent = msg;
  };

  try {
    const result = { ..._insResult };

    // ── 1차: 보험증권 ──
    if (_insUploaded['insurance_policy']) {
      progress(15, '보험증권 분석 중…');
      const b64 = await fetchBase64(_insUploaded['insurance_policy'].file_path);
      if (b64) {
        const mt = docMediaType(_insUploaded['insurance_policy'].file_path);
        const r1 = await callClaudeDoc(b64, mt, '보험증권', SYS,
`보험증권에서 아래 JSON을 추출하세요.
{
  "policy_product": "보험종목명",
  "policy_no": "증권번호",
  "policy_start": "YYYY.MM.DD",
  "policy_end": "YYYY.MM.DD",
  "insured_name": "피보험자 성명",
  "policy_address_raw": "피보험자 소재지 원문 그대로",
  "coverage_limit": 숫자,
  "deductible": 숫자
}`);
        Object.assign(result, r1);
      }
    }

    // ── 2차: 피보험자 소유자료 + 주민등록등본 교차 분석 ──
    progress(35, '피보험자 지위 판단 중…');
    const contentArr = [];
    for (const code of ['ownership_accident','resident_reg']) {
      const up = _insUploaded[code];
      if (!up) continue;
      const b64 = await fetchBase64(up.file_path);
      if (!b64) continue;
      const mt = docMediaType(up.file_path);
      const isPdf = mt === 'application/pdf';
      contentArr.push({
        type: isPdf ? 'document' : 'image',
        source: { type:'base64', media_type: mt, data: b64 },
        ...(isPdf ? { title: code==='ownership_accident'?'사고발생장소 소유자료(등기부 또는 건축물대장)':'피보험자 주민등록등본' } : {}),
      });
    }
    if (contentArr.length > 0) {
      const policyAddr = result.policy_address_raw || '(보험증권 주소 미추출)';
      const insuredNameHint = result.insured_name || '(보험증권에서 미추출)';
      contentArr.push({ type:'text', text:
`위 2개 서류를 교차 분석하여 아래 JSON을 반환하세요.
서류 식별:
  • 첫 번째 = 사고발생장소 소유자료 (등기부등본 또는 건축물대장)
  • 두 번째 = 피보험자 주민등록등본

═══════════════════════════════════════════
【 v5.3 판정 로직 — 정확히 이 순서로 따르세요 】
═══════════════════════════════════════════

입력 5개 축:
  A = 보험증권 소재지 (이미 추출됨): "${policyAddr}"
  B = 사고발생장소 주소 — 첫 번째 서류(등기부/건축물대장)의 소재지
  C = 피보험자 실거주지 — 두 번째 서류(주민등록등본)의 세대 주소
  D = 사고발생장소 소유자 성명 — 첫 번째 서류의 소유자 란
  E = 피보험자 성명 (이미 추출됨): "${insuredNameHint}"

※ 주의: 피보험자(E)는 사고발생장소에 살 수도, 안 살 수도 있음 (임대인 케이스 존재).
        사고발생장소 주소(B)를 피보험자 실거주지(C)라고 가정하지 마세요.

─────────────────────────────────────────
STEP 1: 피보험자 지위 판정 (insured_status)  ★ v5.4 가족 범위 포함
─────────────────────────────────────────
「가족일상생활배상책임」 보험은 가족 단위 피보험자 개념이 적용됩니다.
따라서 소유자(D)가 피보험자 본인이 아니더라도, 피보험자의 **배우자 또는 동거 가족**이면 "소유자 측"으로 간주합니다.

STEP 1-A: 소유자가 피보험자 가족 범위에 포함되는가?
  · D(소유자) == E(피보험자 본인) → "가족 범위 포함"
  · D == 피보험자의 배우자 (주민등록등본 동거인 또는 가족관계증명서 확인) → "가족 범위 포함"
  · D == 피보험자의 동거 가족 (주민등록등본 세대 구성원) → "가족 범위 포함"
  · 그 외 → "가족 범위 밖 (남이 소유)"

STEP 1-B: B(사고발생장소)와 C(피보험자 실거주지) 비교
  · 동일 건물·동·호수면 일치로 간주
  · 도로명↔지번 차이, 아파트명 표기 차이는 동일 장소로 판단

【 4가지 조합 】
  가족 범위 포함 AND C==B → "소유자겸점유자" (피보험자 또는 가족이 소유·거주)
  가족 범위 밖   AND C==B → "임차인겸점유자" (남이 소유, 피보험자가 임차 거주)
  가족 범위 포함 AND C!=B → "임대인" (피보험자 또는 가족이 소유, 다른 곳 거주)
  가족 범위 밖   AND C!=B → "임차인" (남이 소유, 피보험자는 다른 곳 거주 — 관련성 없음 확인불가 가능)

★ 중요: 소유 판단 근거의 법적 우선순위 = 등기부등본 > 건축물대장
        둘 다 있으면 등기부, 불일치 시 등기부 우선

─────────────────────────────────────────
STEP 2: 담보 범위 판정 (address_match)
─────────────────────────────────────────
A (보험증권 소재지) vs B (사고발생장소) 비교:
  · 완전 일치 또는 도로명↔지번 동일건물 표기차이 → "ok"
  · 동일 건물 추정되나 표기 차이 큼 → "warn"
  · 구·동·호수 불일치 → "error"
    (※ 이 경우 사고장소가 약관상 담보 범위 밖 — 기본 면책 대상)

─────────────────────────────────────────
STEP 3: 동거인 요약 (주민등록등본에서)
─────────────────────────────────────────
세대주 외 동거 구성원 성명+관계 (예: "김세연(배우자), 백지훈(부)")

─────────────────────────────────────────
반환 JSON (필드명 정확히, 다른 설명 없이 JSON만)
─────────────────────────────────────────

★★ v5.4.3 소유자 성명 추출 규칙 (매우 중요):
- 건축물대장·등기부등본에 "서재성 (900222-1******)" 형식으로 나오더라도
  name 필드에는 **"서재성"만** 반환 (주민번호·괄호·지분 표기 모두 제외)
- 건축물대장의 "이하여백", "이 하 여 백", "- 이하여백 -" 문구는 빈 공간 표시이며
  실제 소유자 이름이 아님 → 해당 행은 **배열에서 제외**
- 공동소유인 경우 모든 소유자를 배열에 포함 (예: 서재성 1/2 + 정영윤 1/2)
- OCR 흐린 글자는 '서제성', '서재성' 등으로 다르게 보일 수 있음 →
  주민등록등본·보험증권의 전체 이름과 교차검증하여 가장 가까운 이름으로 수정

★★ v5.4.3 피보험자명 언마스킹 규칙:
- 보험증권이 '서재*' 처럼 마스킹된 경우
  insured_name에는 원문 그대로 '서재*' 저장
  insured_name_resolved 필드에 주민등록등본의 전체 이름 저장
- 매칭 기준: 주민등록등본에 등재된 가족 중 주민번호 앞 6자리가
  증권의 마스킹 주민번호 (예: 9002**-1******) 와 일치하는 인물
- 매칭되는 인물 없으면 insured_name_resolved는 null

★★ v5.4.3 세대주 추출:
- 주민등록등본 상단 '세대주 성명' 필드에서 추출
- 가족 범위 판정에 사용됨 (피보험자의 가족으로 인정되는 범위 확대)

{
  "insured_status": "소유자겸점유자 | 임차인겸점유자 | 임대인 | 임차인 | 확인불가",
  "insured_status_reason": "D=[소유자명], E=[피보험자명], B=[사고발생장소], C=[실거주지] 를 교차 비교한 결과를 1-2문장으로. 가족 범위 포함 여부도 명시 (예: '소유자(김영희)는 피보험자(홍길동)의 배우자로 가족 범위에 포함됨'). '피보험자(성명)는 사고발생장소의 [소유자/비소유자]이며, 해당 장소에 [거주/비거주]하므로 [지위]에 해당함' 형태 권장",
  "insured_residence": "C값 (주민등록상 실거주지 전체 주소)",
  "accident_location_from_doc": "B값 (첫 번째 서류에서 읽은 사고발생장소 주소)",
  "insured_owner_name": "D값 — 하위호환용 단일 문자열 (공동소유면 첫 번째 소유자 성명만, 순수 한글 이름만)",
  "insured_owners": [
    { "name": "소유자 성명 (순수 한글 이름만, 주민번호·괄호·지번·'이하여백' 등 모두 제외)", "share": "1/2 또는 1/1 등 지분 표기 (확인 불가 시 null)" }
  ],
  "insured_owner_transfer_date": "소유권 이전일 YYYY-MM-DD 또는 null",
  "insured_name_resolved": "마스킹된 경우 주민등록등본·가족관계증명서로 교차검증하여 확인한 전체 이름. 매칭 근거는 주민번호 앞 6자리. 예: 증권 '서재*(9002**-1******)' + 등본 '서재성(900222-1508711)' → '서재성'. 매칭 불가 시 null. 마스킹 없으면 insured_name과 동일 값 또는 null",
  "household_head": "주민등록등본의 세대주 성명 (예: '정영윤'). 세대주 표기 없으면 null",
  "insured_cohabitants": "동거인 요약 (예: '김세연(배우자), 백지훈(부)' — 없거나 미확인 시 null)",
  "insured_spouse": "피보험자의 배우자 성명 (동거인 목록에서 배우자로 표시된 사람 또는 가족관계증명서에서 확인. 없으면 null)",
  "address_match": "ok | warn | error",
  "address_match_note": "A와 B의 차이 설명 (ok면 null)"
}` });

      const resp = await fetch('/api/claude', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ model: INS_MODEL, max_tokens: 1200, system: SYS,
          messages: [{ role:'user', content: contentArr }] }),
      });
      if (!resp.ok) throw new Error('API 오류 ' + resp.status);
      const res = await resp.json();
      const r2 = parseClaudeJson(res.content?.[0]?.text, '피보험자 지위 분석');
      
      // v5.4.3 ★ insured_owners 배열 sanitize — 주민번호·괄호·이하여백 제거
      // AI가 배열로 반환하지 않은 경우 단일 owner_name으로 폴백
      if (Array.isArray(r2.insured_owners) && r2.insured_owners.length > 0) {
        r2.insured_owners = r2.insured_owners
          .map(o => ({
            name: sanitizeOwnerName(o?.name || o),
            share: o?.share || null,
          }))
          .filter(o => o.name);
      } else if (r2.insured_owner_name) {
        // 하위호환: 단일 문자열 → 1-원소 배열로 변환
        const cleaned = sanitizeOwnerName(r2.insured_owner_name);
        r2.insured_owners = cleaned ? [{ name: cleaned, share: null }] : [];
      } else {
        r2.insured_owners = [];
      }
      // insured_owner_name 호환 유지 (첫 번째 소유자)
      if (r2.insured_owners.length > 0 && !r2.insured_owner_name) {
        r2.insured_owner_name = r2.insured_owners[0].name;
      } else if (r2.insured_owner_name) {
        // 기존 값도 sanitize
        const cleaned = sanitizeOwnerName(r2.insured_owner_name);
        if (cleaned) r2.insured_owner_name = cleaned;
      }
      
      // v5.3.1 + v5.4 + v5.4.3 ★ 결정론적 지위 판정 후처리 (공동소유·마스킹·세대주)
      // AI가 필드-텍스트 불일치로 반환하는 경우 JS 룰 엔진이 교정
      const derived = {
        ...computeInsuredStatus({
          A_policy:            result.policy_address_raw,
          B_accident:          r2.accident_location_from_doc,
          C_residence:         r2.insured_residence,
          D_owners:            r2.insured_owners,          // v5.4.3: 배열
          D_owner:             r2.insured_owner_name,      // 하위호환
          E_insured:           result.insured_name,
          E_insured_resolved:  r2.insured_name_resolved,   // v5.4.3: 마스킹 언마스킹된 이름
          E_spouse:            r2.insured_spouse,
          E_cohabitants:       r2.insured_cohabitants,
          E_household_head:    r2.household_head,          // v5.4.3: 세대주 성명
        }),
        addressMatch: computeAddressMatch(
          result.policy_address_raw,
          r2.accident_location_from_doc
        ),
      };
      const r2Reconciled = reconcileInsuredStatus(r2, derived);
      
      // 디버깅용 입력 5축 보존 (필요 시 화면/DB에 노출 가능)
      result._axes = {
        A: result.policy_address_raw,
        B: r2.accident_location_from_doc,
        C: r2.insured_residence,
        D: r2.insured_owner_name,
        E: result.insured_name,
        derived_status: derived.status,
        derived_addr_match: derived.addressMatch,
      };
      
      Object.assign(result, r2Reconciled);
    }

    // ── 3차: 피해세대 소유자료 ──
    if (_insUploaded['ownership_victim']) {
      progress(55, '피해세대 정보 추출 중…');
      const b64 = await fetchBase64(_insUploaded['ownership_victim'].file_path);
      if (b64) {
        const mt = docMediaType(_insUploaded['ownership_victim'].file_path);
        const r3 = await callClaudeDoc(b64, mt, '피해세대 소유자료', SYS,
`피해세대 소유자료(등기부등본 또는 건축물대장)에서 아래 JSON을 추출하세요.
등기부등본이면 소유자 란, 건축물대장이면 소유자 란을 참조하세요.
※ 피해세대 = 물이 떨어진 아랫집 (피보험자의 가해 세대가 아닌 제3자 세대)

{
  "victim_address": "피해자 세대 주소 (예: 101동 1204호)",
  "victim_name": "피해자(소유자) 성명",
  "victim_owner_name": "소유자 성명 (피해자와 다를 수 있음, 보통 동일)",
  "victim_owner_transfer_date": "YYYY-MM-DD 또는 null"
}`);
        if (r3.victim_address) result.victim_address = r3.victim_address;
        if (r3.victim_name) result.victim_name = r3.victim_name;
        if (r3.victim_owner_name) result.victim_owner_name = r3.victim_owner_name;
        if (r3.victim_owner_transfer_date) result.victim_owner_transfer_date = r3.victim_owner_transfer_date;
        
        // v5.4 ★ 첫 피해자 자동 채움 (비어있으면 신규 생성, 이미 있으면 빈 필드만 보강)
        if (r3.victim_address || r3.victim_name || r3.victim_owner_name) {
          if (_insVictims.length === 0) {
            _insVictims.push({
              id: null,
              victim_order: 1,
              victim_name: r3.victim_name || '',
              victim_address: r3.victim_address || '',
              victim_owner_name: r3.victim_owner_name || '',
              victim_owner_transfer_date: r3.victim_owner_transfer_date || null,
              victim_note: '',
              victim_damage: '',
            });
            console.log('[v5.4] 피해자 서류에서 첫 피해자 자동 생성됨');
          } else {
            // 첫 피해자의 빈 필드만 보강 (사용자가 이미 입력한 값은 유지)
            const v0 = _insVictims[0];
            if (!v0.victim_name        && r3.victim_name)        v0.victim_name = r3.victim_name;
            if (!v0.victim_address     && r3.victim_address)     v0.victim_address = r3.victim_address;
            if (!v0.victim_owner_name  && r3.victim_owner_name)  v0.victim_owner_name = r3.victim_owner_name;
            if (!v0.victim_owner_transfer_date && r3.victim_owner_transfer_date) {
              v0.victim_owner_transfer_date = r3.victim_owner_transfer_date;
            }
          }
        }
      }
    }

    // ── 4차 ★ v5.2 Sabi 8·9단계 종합 판단 (룰북 + 약관별 분기) ──
    progress(75, '책임 성립/면·부책 판단 중…');
    // v5.2.1 ★ 기본값 변경: '배관'으로 임의 추정하면 모델이 주택관리로 분류해 잘못 부책 판정
    //                      → '미지정'으로 명시하고 프롬프트에서 판단유보 경로 타도록 처리
    const cause = _insClaim.accident_cause_type || '미지정';
    const causeMap = INS_CAUSE_RULEBOOK_MAP[cause] || { cat: '?', label: '사전 매핑 없음 — 수리소견으로 판단' };
    const repairOpinion = _insField?.repair_opinion || '';
    // v5.3 ★ 사고발생장소 주소는 accident_location_from_doc(신) 또는 victim_address(구) 사용
    //        피해자 소재지와 사고발생장소는 서로 다름(윗집 vs 아랫집) — 분리 전달
    const judgePrompt = buildJudgmentPrompt(insType, {
      insured_status:         result.insured_status         || '확인불가',
      insured_status_reason:  result.insured_status_reason  || '',
      insurance_location:     result.policy_address_raw     || '확인불가',
      accident_location:      result.accident_location_from_doc || '확인불가',  // ★ v5.3: 사고발생장소 (가해세대)
      victim_location:        result.victim_address         || '확인불가',      // ★ v5.3: 피해세대 주소 (추가)
      insurance_period:       (result.policy_start && result.policy_end)
                               ? `${result.policy_start} ~ ${result.policy_end}` : '확인불가',
      accident_location_match: result.address_match         || 'ok',
      accident_cause:         cause,
      accident_cause_category: causeMap.cat,    // v5.2.1: 룰북 사전 매핑
      accident_cause_label:    causeMap.label,  // v5.2.1: 사람 친화 설명
      repair_opinion:         repairOpinion,
      insured_owner_name:     result.insured_owner_name     || '',
      victim_owner_name:      result.victim_owner_name      || '',
      insured_name:           result.insured_name           || '',  // v5.3: 피보험자 본인 성명 (소유자 동일여부 판정용)
    });

    const judgeResp = await fetch('/api/claude', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ model: INS_MODEL, max_tokens: 900, system: SYS,
        messages: [{ role:'user', content: [{ type:'text', text: judgePrompt }] }] }),
    });
    if (!judgeResp.ok) throw new Error('판단 API 오류 ' + judgeResp.status);
    const judgeRes = await judgeResp.json();
    const r4 = parseClaudeJson(judgeRes.content?.[0]?.text, 'Sabi 책임/면부책 판단');
    
    // v5.3.1 ★ Sabi 룰 엔진 일관성 검증 (AI 4차 응답 후처리)
    // 확정된 지위/담보범위/사고원인 카테고리와 AI 판정이 일치하는지 검증,
    // 어긋나면 결정론적 값으로 교정하고 콘솔 경고.
    const reconciled = enforceSabiRuleEngine(r4, {
      insured_status:  result.insured_status,      // 2차에서 JS 교정 끝난 값
      address_match:   result.address_match,        // 2차에서 JS 교정 끝난 값
      accident_cause:  cause,
      rulebook_cat:    causeMap.cat,
      insurance_type:  insType,
    });
    Object.assign(result, reconciled);

    progress(100, '✓ 분석 완료!');
    setTimeout(() => { if(load) load.style.display='none'; }, 600);

    _insResult = result;

    // 화면 필드 반영
    const set = (id, val) => {
      if (val === null || val === undefined || val === '') return;
      const el = document.getElementById(id);
      if (!el) return;
      if (el.tagName==='SELECT') { for(const o of el.options) if(o.value===val){o.selected=true;break;} }
      else el.value = val;
    };
    set('ex-product',    result.policy_product);
    set('ex-no',         result.policy_no);
    if (result.policy_start && result.policy_end)
      set('ex-period',   result.policy_start + ' ~ ' + result.policy_end);
    set('ex-insured',    result.insured_name);
    set('ex-status',     result.insured_status);
    if (result.coverage_limit) set('ex-coverage',  String(result.coverage_limit));
    if (result.deductible)     set('ex-deductible', String(result.deductible));
    set('ex-victim',     result.victim_address);
    if (result.address_match) {
      set('ex-addr', result.address_match);
      s2AddrChange();
    }
    if (result.address_match_note) set('ex-addr-note', result.address_match_note);
    set('j-opinion',     result.investigator_opinion);

    // 책임 판단 — v5: liability_result + coverage_result
    if (result.liability_result) {
      set('j-established', result.liability_result);
      const jEl = document.getElementById('j-established');
      if (jEl) s2JudgeStyle(jEl, 'established');
    }
    if (result.coverage_result) {
      set('j-coverage', result.coverage_result);
      const jEl = document.getElementById('j-coverage');
      if (jEl) s2JudgeStyle(jEl, 'coverage');
    }

    // 화면 재렌더 (accident_type, shared_liability 표시 위해)
    insRender();

    toast('분석 완료! 내용을 확인하고 수정하세요.', 's');
  } catch(e) {
    if (load) load.style.display = 'none';
    toast('분석 실패: ' + e.message, 'e');
  } finally {
    _insAnalyzing = false;
    if (btn) { btn.disabled=false; btn.textContent='↺ 재분석'; }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// v6.2.25: Phase F — 9-Call 순차 분석 함수 (신규)
// ═══════════════════════════════════════════════════════════════════════════
// 추출(s2Extract) 결과인 _extractedCandidates + _userOverrides를 입력으로 받아
// DB의 prompt_templates(analyze_step_1..9 + variant 3)을 순차 호출.
// 결과는 claim_analyses 테이블에 단계별로 저장.
// ═══════════════════════════════════════════════════════════════════════════

async function s2Analyze() {
  if (_insAnalyzing) return;
  _insAnalyzing = true;

  const fill  = document.getElementById('s2-fill');
  const label = document.getElementById('s2-label');
  const pctEl = document.getElementById('s2-pct');
  const load  = document.getElementById('s2-loading');
  const btn   = document.getElementById('s2-analyze-btn');
  if (load) load.style.display = 'block';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ 분석 진행 중...';
  }

  // v6.2.26: 진행률 + 현재 단계 칩 업데이트
  const progress = (pct, msg, currentStep) => {
    if (fill)  fill.style.width  = pct + '%';
    if (label) label.textContent = msg;
    if (pctEl) pctEl.textContent = pct + '%';
    if (typeof currentStep === 'number') {
      // step pill 상태 업데이트
      for (let s = 1; s <= 9; s++) {
        const pill = document.querySelector(`.s2-step-pill[data-step="${s}"]`);
        if (!pill) continue;
        pill.classList.remove('active', 'done');
        if (s < currentStep) pill.classList.add('done');
        else if (s === currentStep) pill.classList.add('active');
      }
    }
    console.log(`[v6.2.26 Analyze] ${pct}% — ${msg}`);
  };

  const startTime = Date.now();
  let analysisId = null;

  try {
    // ── 사전 검증 ──
    if (!_insClaim || !_insClaim.case_id) {
      throw new Error('사건 정보가 없습니다. STEP 1부터 다시 진행해주세요.');
    }
    if (!_extractedCandidates || Object.keys(_extractedCandidates).length === 0) {
      throw new Error('추출 결과가 없습니다. 먼저 STEP 1 추출을 실행해주세요.');
    }

    // policy_type 결정 — STEP 1에서 사용자가 선택한 약관
    const policyMap = {
      'family_daily_old':  'family_daily_old',
      'family_daily_new':  'family_daily_new',
      'personal_daily':    'personal_daily',
    };
    const policyType = policyMap[_insClaim.insurance_type] || 'family_daily_new';
    console.log('[v6.2.25 Analyze] policy_type:', policyType, '/ case_id:', _insClaim.case_id);

    // ── 입력값 머지: _userOverrides 우선, 없으면 _extractedCandidates[0] ──
    const inputs = buildAnalysisInputs();
    console.log('[v6.2.25 Analyze] 입력값 머지 완료:', Object.keys(inputs).length, '개');

    // ── claim_analyses row 생성 ──
    progress(2, '분석 세션 생성 중…');
    const { data: anaRow, error: anaErr } = await sb.from('claim_analyses').insert({
      case_id: _insClaim.case_id,
      extracted_inputs: inputs,
      policy_type: policyType,
      status: 'running',
      current_step: 0,
    }).select().single();
    if (anaErr) throw new Error('분석 row 생성 실패: ' + anaErr.message);
    analysisId = anaRow.id;
    console.log('[v6.2.25 Analyze] analysis_id:', analysisId);

    // v6.2.29: insurance_claims에 분석 시작 표시
    if (_insClaim.id) {
      await sb.from('insurance_claims').update({
        analysis_status: 'running',
        analysis_started_at: new Date().toISOString(),
        analysis_error: null,
      }).eq('id', _insClaim.id);
    }

    // ── 9개 프롬프트 DB 로드 ──
    progress(5, '프롬프트 로드 중…');
    const stepKeys = [
      'analyze_step_1_insured_status',
      'analyze_step_2_accident_cause',
      'analyze_step_3_accident_description',
      'analyze_step_4_period_match',
      'analyze_step_5_location_match',
      'analyze_step_6_victim_damages',
      'analyze_step_7_investigator_opinion',
      'analyze_step_8_liability',
      `analyze_step_9_coverage_${policyType}`,
    ];
    const { data: prompts, error: pErr } = await sb.from('prompt_templates')
      .select('prompt_key, system_prompt, user_prompt_template, output_format, ai_model, max_tokens, temperature')
      .in('prompt_key', stepKeys);
    if (pErr) throw new Error('프롬프트 로드 실패: ' + pErr.message);

    const promptMap = {};
    prompts.forEach(p => { promptMap[p.prompt_key] = p; });
    for (const k of stepKeys) {
      if (!promptMap[k]) throw new Error(`프롬프트 누락: ${k}`);
    }

    // ── 9단계 순차 호출 ──
    const stepResults = {};       // 각 단계 결과를 다음 단계 입력으로 전달
    let totalTokensIn = 0, totalTokensOut = 0;

    const stepProgressMap = {
      1: { pct: 12, msg: '1단계 — 피보험자 지위 판단 중…' },
      2: { pct: 22, msg: '2단계 — 사고원인 추출 중…' },
      3: { pct: 32, msg: '3단계 — 사고경위 작성 중…' },
      4: { pct: 42, msg: '4단계 — 보험기간 부합 검토 중…' },
      5: { pct: 52, msg: '5단계 — 사고장소 부합 검토 중…' },
      6: { pct: 62, msg: '6단계 — 피해사항 정리 중…' },
      7: { pct: 72, msg: '7단계 — 조사자의견 작성 중…' },
      8: { pct: 82, msg: '8단계 — 손해배상책임 검토 중…' },
      9: { pct: 92, msg: '9단계 — 보험금 지급책임 판단 중…' },
    };

    for (let step = 1; step <= 9; step++) {
      const prog = stepProgressMap[step];
      progress(prog.pct, prog.msg, step);

      const promptKey = stepKeys[step - 1];
      const tpl = promptMap[promptKey];

      // 이전 단계 결과를 inputs에 합쳐서 변수 치환에 활용
      const stepInputs = { ...inputs, ...flattenPrevSteps(stepResults) };

      // user_prompt 치환
      const userPrompt = renderTemplate(tpl.user_prompt_template, stepInputs);

      // claim_analyses.current_step 업데이트
      await sb.from('claim_analyses').update({ current_step: step }).eq('id', analysisId);

      // Claude 호출 (텍스트 전용 — _callMultiRaw 재사용)
      const t0 = Date.now();
      const contentArr = [{ type: 'text', text: userPrompt }];
      let stepJson;
      try {
        stepJson = await _callAnalyzeStep(contentArr, tpl.system_prompt, tpl.max_tokens || 1500);
      } catch (callErr) {
        throw new Error(`${step}단계 호출 실패: ${callErr.message}`);
      }
      const dt = Date.now() - t0;
      console.log(`[v6.2.25 Step ${step}] (${dt}ms)`, stepJson);

      // 결과 저장
      stepResults[step] = stepJson;
      const colName = `step_${step}_result`;
      await sb.from('claim_analyses').update({ [colName]: stepJson }).eq('id', analysisId);
    }

    // ── 완료 처리 ──
    const duration = Date.now() - startTime;
    await sb.from('claim_analyses').update({
      status: 'completed',
      current_step: 9,
      duration_ms: duration,
    }).eq('id', analysisId);

    // ── v6.2.29: insurance_claims에도 평탄화하여 동기화 (보고서·목록 조회용) ──
    // claim_analyses는 raw 보관, insurance_claims는 화면 렌더링·통계용
    try {
      const r1 = stepResults[1] || {};
      const r2 = stepResults[2] || {};
      const r3 = stepResults[3] || {};
      const r4 = stepResults[4] || {};
      const r5 = stepResults[5] || {};
      const r6 = stepResults[6] || {};
      const r7 = stepResults[7] || {};
      const r8 = stepResults[8] || {};
      const r9 = stepResults[9] || {};

      // accident_type 매핑: '주택관리'/'일상생활'/'확인불가' 그대로 사용
      // ⓓ 공용부, ⓒ 시공불량 케이스는 8단계에서 accident_category='주택관리'로 오지만
      // 의미상 '공용부'/'시공불량'으로 세분화 가능 — accident_cause_category로 구분
      let accidentTypeVal = r8.accident_category || null;
      if (r8.accident_cause_category === 'ⓓ') accidentTypeVal = '공용부';
      else if (r8.accident_cause_category === 'ⓒ') accidentTypeVal = '시공불량';

      const claimUpdates = {
        // 1단계
        insured_status: r1.insured_status || null,
        // 2단계
        accident_cause_detail: r2.accident_cause || null,
        // 3단계
        accident_description: r3.accident_description || null,
        // 4단계 → 별도 컬럼 없음 (보험기간 매칭은 RPC validate_accident_in_policy_period로 별도 확인)
        // 5단계
        address_match: r5.accident_location_match || null,
        // 6단계: victim_damages 배열을 jsonb로 저장
        victim_damages: r6.victim_damages || null,
        // 8단계
        liability_result: r8.liability_result || null,
        accident_type: accidentTypeVal,
        shared_liability: !!r8.shared_liability,
        liability_reasoning: r8.liability_reasoning || null,
        // 9단계
        coverage_result: r9.coverage_result || null,
        coverage_reasoning: r9.coverage_reasoning || null,
        // v6.2.32: LLM이 "제1조 제1호 본문 (일상생활배상)" 처럼 살을 붙여 출력할 수 있어
        // CHECK 제약(제1조 제1호|제1조 제2호|해당없음)에 맞게 정규화
        insurance_clause: (() => {
          const raw = (r9.policy_clause_applied || '').trim();
          if (!raw) return null;
          if (raw.includes('제1조 제1호') || raw.includes('제1조제1호')) return '제1조 제1호';
          if (raw.includes('제1조 제2호') || raw.includes('제1조제2호')) return '제1조 제2호';
          if (raw.includes('해당없음') || raw.includes('해당 없음') || raw === '없음') return '해당없음';
          // 알 수 없는 값은 null로 (CHECK 위반 회피)
          console.warn('[v6.2.32] insurance_clause 정규화 불가:', raw);
          return null;
        })(),
        // 메타: 분석 상태
        analysis_status: 'done',
        analysis_done_at: new Date().toISOString(),
        analysis_error: null,
        analysis_progress: {
          step_1: { status: 'done', at: new Date().toISOString() },
          step_2: { status: 'done' },
          step_3: { status: 'done' },
          step_4: { status: 'done' },
          step_5: { status: 'done' },
          step_6: { status: 'done' },
          step_7: { status: 'done' },
          step_8: { status: 'done' },
          step_9: { status: 'done' },
        },
        updated_at: new Date().toISOString(),
      };
      const { error: syncErr } = await sb.from('insurance_claims')
        .update(claimUpdates)
        .eq('id', _insClaim.id);
      if (syncErr) {
        console.error('[v6.2.29 insurance_claims sync 실패]', syncErr);
        // 동기화 실패해도 분석 결과는 claim_analyses에 있으므로 toast로만 알림
        toast('분석은 완료됐으나 보고서 데이터 저장에 일부 실패: ' + syncErr.message, 'w');
      } else {
        console.log('[v6.2.29] insurance_claims 동기화 완료');
        // 로컬 _insClaim도 최신값 반영
        _insClaim = { ..._insClaim, ...claimUpdates };
      }
    } catch (syncE) {
      console.error('[v6.2.29 insurance_claims sync 예외]', syncE);
    }

    // v6.2.26: 9개 칩 모두 done으로 마무리
    for (let s = 1; s <= 9; s++) {
      const pill = document.querySelector(`.s2-step-pill[data-step="${s}"]`);
      if (pill) {
        pill.classList.remove('active');
        pill.classList.add('done');
      }
    }
    progress(100, `✓ 분석 완료! (${(duration/1000).toFixed(1)}초)`);
    console.log(`[v6.2.31 Analyze] 완료 — ${(duration/1000).toFixed(1)}초 / analysis_id: ${analysisId}`);

    // 결과를 화면에 표시 (기존 보고서 탭으로 이동)
    _insResult = aggregateResults(stepResults, inputs);

    // 결과 미리보기 — 콘솔에 정리해서 출력 (검증 편의)
    console.group('[v6.2.31 분석 결과 요약]');
    console.log('1. 피보험자 지위:', stepResults[1]?.insured_status, '(', stepResults[1]?.ownership_type, '/', stepResults[1]?.residence_match, ')');
    console.log('2. 사고원인:', stepResults[2]?.accident_cause);
    console.log('3. 사고경위:', stepResults[3]?.accident_description);
    console.log('4. 보험기간 부합:', stepResults[4]?.insurance_period_match);
    console.log('5. 사고장소 부합:', stepResults[5]?.accident_location_match);
    console.log('6. 피해사항:', stepResults[6]?.victim_damages);
    console.log('7. 조사자의견:', stepResults[7]?.investigator_opinion, '[분기:', stepResults[7]?.branch_selected, ']');
    console.log('8. 손해배상책임:', stepResults[8]?.liability_result, '/', stepResults[8]?.accident_category, '/', stepResults[8]?.accident_cause_category);
    console.log('   →', stepResults[8]?.liability_reasoning);
    console.log('9. 보험금 지급:', stepResults[9]?.coverage_result, '[', stepResults[9]?.policy_clause_applied, ']');
    console.log('   →', stepResults[9]?.coverage_reasoning);
    console.groupEnd();

    // v6.2.31: STEP 3 보고서 화면으로 자동 이동
    // 1.5초 정도 완료 화면 보여주고 → 토스트 → STEP 3 이동
    toast('분석 완료! 보고서로 이동합니다.', 's');
    setTimeout(() => {
      _insClaim = { ..._insClaim, insurance_tab_status: 'ready_for_draft' };
      _insStep = 3;
      insRender();
      // s3LoadReportData는 insGoto 패턴(_insStep=3 후 자동 호출)에 없으므로 명시적으로 호출
      if (typeof s3LoadReportData === 'function') {
        s3LoadReportData().then(() => insRender()).catch(e => console.warn('[s3] 로드 실패:', e));
      }
    }, 1500);

  } catch (e) {
    console.error('[v6.2.25 Analyze] 실패:', e);
    if (analysisId) {
      await sb.from('claim_analyses').update({
        status: 'failed',
        error_message: e.message,
      }).eq('id', analysisId);
    }
    // v6.2.29: insurance_claims에도 실패 기록
    if (_insClaim && _insClaim.id) {
      try {
        await sb.from('insurance_claims').update({
          analysis_status: 'failed',
          analysis_error: e.message,
        }).eq('id', _insClaim.id);
      } catch (_) {}
    }
    if (load) load.style.display = 'none';
    toast('분석 실패: ' + e.message, 'e');
  } finally {
    _insAnalyzing = false;
    if (btn) { btn.disabled = false; btn.textContent = '↺ 재분석'; }
  }
}

// ─── 보조 헬퍼들 ────────────────────────────────────────────────────────────

// 추출 결과(_extractedCandidates + _userOverrides)를 분석 입력값 단일 객체로 머지
function buildAnalysisInputs() {
  const inputs = {};
  // _userOverrides가 있으면 우선, 없으면 _extractedCandidates[0].value
  // v6.2.29: 우선순위 — _userOverrides > _extractedCandidates[0] > _insClaim > '정보 없음'
  const allKeys = new Set([
    ...Object.keys(_extractedCandidates || {}),
    ...Object.keys(_userOverrides || {}),
  ]);
  for (const k of allKeys) {
    if (_userOverrides && _userOverrides[k] != null && _userOverrides[k] !== '') {
      inputs[k] = _userOverrides[k];
    } else if (_extractedCandidates[k] && _extractedCandidates[k][0]) {
      inputs[k] = _extractedCandidates[k][0].value;
    } else {
      inputs[k] = '정보 없음';
    }
  }

  // 추가 컨텍스트 자료 — 약관 본문, 법률 조문, 전유·공용 구분 기준은 코드에 상수로 두고 주입
  inputs.terms_content = inputs.terms_content || (typeof INS_TERMS_TEXT === 'string' ? INS_TERMS_TEXT : '정보 없음');
  inputs.legal_statutes = inputs.legal_statutes || (typeof INS_LEGAL === 'string' ? INS_LEGAL : '정보 없음');
  inputs.exclusive_common_areas = inputs.exclusive_common_areas || (typeof INS_AREAS_GUIDE === 'string' ? INS_AREAS_GUIDE : '정보 없음');

  // v6.2.29: 6단계 보조 자료 — 현재 추출 단계에 들어가지 않으므로 명시적 빈 값으로 안전 처리
  // (TODO v6.3: 문답서·민원일지 추출 추가 시 _extractedCandidates에서 가져오도록 변경)
  inputs.interview_record = inputs.interview_record || '정보 없음';
  inputs.complaint_log = inputs.complaint_log || '정보 없음';

  // 변수 alias — 프롬프트가 받기로 한 이름들이 추출 키와 다를 수 있어 매핑
  // 예: 추출은 insured_owner_name, 프롬프트는 building_owner
  if (!inputs.building_owner && inputs.insured_owner_name) {
    inputs.building_owner = inputs.insured_owner_name;
  }
  if (!inputs.cohabitants && inputs.insured_cohabitants) {
    inputs.cohabitants = inputs.insured_cohabitants;
  }
  if (!inputs.family_relation && inputs.insured_family_relations) {
    inputs.family_relation = inputs.insured_family_relations;
  } else if (!inputs.family_relation && inputs.family_relation_text) {
    inputs.family_relation = inputs.family_relation_text;
  }
  if (!inputs.family_relation_text && inputs.family_relation) {
    inputs.family_relation_text = inputs.family_relation;
  }
  if (!inputs.accident_location && inputs.accident_address) {
    inputs.accident_location = inputs.accident_address;
  }
  if (!inputs.accident_address && inputs.accident_location) {
    inputs.accident_address = inputs.accident_location;
  }
  if (!inputs.insurance_location && inputs.policy_address) {
    inputs.insurance_location = inputs.policy_address;
  }
  if (!inputs.insurance_period && (inputs.policy_period_start || inputs.policy_period_end)) {
    inputs.insurance_period = `${inputs.policy_period_start || ''} ~ ${inputs.policy_period_end || ''}`;
  }
  if (!inputs.victims_info && inputs.victim_address) {
    inputs.victims_info = inputs.victim_address;
  }
  // v6.2.25: 피해자 키는 추출 시 _v0 suffix가 붙음 (다중 피해자 인덱스). 우선 첫 번째만 묶어 victims_info에 넣음.
  if (!inputs.victims_info) {
    const v0Name = inputs.victim_name_v0 || '';
    const v0Addr = inputs.victim_address_v0 || '';
    const v0Owner = inputs.victim_owner_name_v0 || '';
    if (v0Name || v0Addr) {
      inputs.victims_info = `성명: ${v0Name || '정보 없음'} / 소재지: ${v0Addr || '정보 없음'}${v0Owner ? ' / 소유자: ' + v0Owner : ''}`;
    }
  }
  if (!inputs.leak_report && inputs.leak_cause) {
    inputs.leak_report = inputs.leak_cause;
  }
  // v6.2.26: Call 4a/4b가 _insClaim에 저장하는 leak_report_text/incident_report_text도 흡수
  // (_extractedCandidates에는 안 들어가므로 _insClaim에서 직접 가져옴)
  if (!inputs.leak_report && typeof _insClaim === 'object' && _insClaim) {
    if (_insClaim.leak_report_text) inputs.leak_report = _insClaim.leak_report_text;
    else if (_insClaim.leak_cause) inputs.leak_report = _insClaim.leak_cause;
  }
  if (!inputs.incident_report && typeof _insClaim === 'object' && _insClaim) {
    if (_insClaim.incident_report_text) inputs.incident_report = _insClaim.incident_report_text;
  }
  if (!inputs.accident_summary && typeof _insClaim === 'object' && _insClaim) {
    if (_insClaim.accident_summary_text) inputs.accident_summary = _insClaim.accident_summary_text;
  }
  // 사고일자도 _insClaim에서 fallback
  if (!inputs.accident_date && typeof _insClaim === 'object' && _insClaim) {
    if (_insClaim.accident_occurred_at) inputs.accident_date = _insClaim.accident_occurred_at;
  }
  console.log('[v6.2.26 buildAnalysisInputs] 핵심 입력값:',
    'leak_report=', (inputs.leak_report || '').slice(0, 60),
    '| incident_report=', (inputs.incident_report || '').slice(0, 60),
    '| accident_date=', inputs.accident_date,
    '| insured_status_inputs=', !!inputs.insured_name);

  return inputs;
}

// 이전 단계 결과를 다음 단계 입력으로 평탄화 — 예: step 1의 insured_status 값을 inputs.insured_status로
function flattenPrevSteps(stepResults) {
  const out = {};
  for (const step of Object.keys(stepResults)) {
    const r = stepResults[step] || {};
    Object.assign(out, r);
  }
  // victim_damage_text — 6단계 결과를 7단계가 텍스트로 받을 수 있도록
  if (stepResults[6]?.victim_damages) {
    out.victim_damage_text = stepResults[6].victim_damages
      .map(v => `${v.victim_name}: ${v.damage_text}`)
      .join(' / ');
  }
  return out;
}

// 템플릿 변수 치환: {var_name} → inputs[var_name]
function renderTemplate(tpl, inputs) {
  if (!tpl) return '';
  return tpl.replace(/\{([a-z_][a-z0-9_]*)\}/gi, (_, key) => {
    const v = inputs[key];
    if (v == null || v === '') return '정보 없음';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  });
}

// 단계 호출 — 텍스트 전용. _callMultiRaw 재사용해서 body 한도 자동 처리.
async function _callAnalyzeStep(contentArr, systemPrompt, maxTokens) {
  const resp = await fetch('/api/claude', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: INS_MODEL,
      max_tokens: maxTokens || 1500,
      system: systemPrompt || '',
      messages: [{ role: 'user', content: contentArr }],
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${detail.slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = (data.content || []).map(c => c.text || '').join('');
  // JSON 파싱 — 마크다운 펜스가 섞여 있어도 추출
  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // JSON 파싱 실패 시 텍스트 그대로 반환 (디버깅용)
    console.error('[v6.2.25 JSON 파싱 실패]', text);
    throw new Error(`JSON 파싱 실패: ${e.message} / raw: ${text.slice(0, 200)}`);
  }
}

// 9단계 결과를 _insResult 호환 객체로 집계 — 기존 보고서 렌더링과 연결
function aggregateResults(stepResults, inputs) {
  const r1 = stepResults[1] || {};
  const r2 = stepResults[2] || {};
  const r3 = stepResults[3] || {};
  const r4 = stepResults[4] || {};
  const r5 = stepResults[5] || {};
  const r6 = stepResults[6] || {};
  const r7 = stepResults[7] || {};
  const r8 = stepResults[8] || {};
  const r9 = stepResults[9] || {};

  return {
    // 입력 스냅샷
    ...inputs,
    // 단계별 핵심 결과
    insured_status: r1.insured_status,
    ownership_type: r1.ownership_type,
    residence_match: r1.residence_match,
    accident_cause: r2.accident_cause,
    accident_description: r3.accident_description,
    insurance_period_match: r4.insurance_period_match,
    accident_location_match: r5.accident_location_match,
    victim_damages: r6.victim_damages,
    investigator_opinion: r7.investigator_opinion,
    branch_selected: r7.branch_selected,
    liability_result: r8.liability_result,
    accident_category: r8.accident_category,
    accident_cause_category: r8.accident_cause_category,
    shared_liability: r8.shared_liability,
    applicable_law: r8.applicable_law,
    liability_reasoning: r8.liability_reasoning,
    coverage_result: r9.coverage_result,
    coverage_reasoning: r9.coverage_reasoning,
    policy_clause_applied: r9.policy_clause_applied,
    // 원본 단계별 결과 (보고서 디버깅용)
    _stepResults: stepResults,
  };
}

window.s2Analyze = s2Analyze;

// ─────────────────────────────────────────────
// v5 ★ Sabi 8·9단계 판단 프롬프트 빌더 (약관별 분기)
// ─────────────────────────────────────────────
function buildJudgmentPrompt(insType, ctx) {
  const typeLabel = INS_TYPE_LABELS[insType];

  // 9단계 약관별 분기 로직
  let step9Logic = '';
  if (insType === 'family_daily_old') {
    step9Logic = `
STEP C: [사고 유형]에 따른 분기 (가족일상생활 구형)

  ■ "일상생활" → 가족일상생활(구형) 약관 제2호 적용
    → 소재지 무관 보상 → STEP D로
    ※ 피보험자 범위: 기명 피보험자 + 배우자 + 동거친족 + 별거 미혼자녀

  ■ "주택관리" → 가족일상생활(구형) 약관 제1호 적용
    "보험증권에 기재된 주택에 주거하는 피보험자가 주택의 소유·사용·관리에 기인하는 사고"

    · [피보험자 지위] = "임대인":
      → "주거하는" 조건 불충족 (구형 약관 범위 외) → coverage_result = "면책"

    · [피보험자 지위] ≠ "임대인":
      → [사고장소 부합 여부] 확인:
        · "error" (불일치) → coverage_result = "면책"
        · "warn" 또는 "확인불가" → coverage_result = "판단유보"
        · "ok" → STEP D로

  ■ "공용부" / "시공불량" → STEP A에서 면책 처리됨
`;
  } else if (insType === 'family_daily_new') {
    step9Logic = `
STEP C: [사고 유형]에 따른 분기 (가족일상생활 신형)

  ■ "일상생활" → 가족일상생활(신형) 약관 제2호 적용
    → 소재지 무관 보상 → STEP D로
    ※ 피보험자 범위: 기명 피보험자 + 배우자 + 동거친족 + 별거 미혼자녀

  ■ "주택관리" → 가족일상생활(신형) 약관 제1호 적용 (범위 확대)
    "피보험자가 주거하고 있는 주택 AND 소유자인 피보험자가 임대 등을 통해 주거를 허락한 자가 살고 있는 주택"

    · [피보험자 지위] = "임대인":
      → 신형 제1호 확대로 임대 주택도 담보 범위 포함 → STEP D로 (부책 가능)
      ※ coverage_reasoning에 "신형약관에서는 소유자인 피보험자가 임대한 주택도 보상 대상에 포함되므로" 명시

    · [피보험자 지위] ≠ "임대인":
      → [사고장소 부합 여부] 확인:
        · "error" (불일치) → coverage_result = "면책"
        · "warn" 또는 "확인불가" → coverage_result = "판단유보"
        · "ok" → STEP D로

  ■ "공용부" / "시공불량" → STEP A에서 면책 처리됨
`;
  } else if (insType === 'personal_daily') {
    step9Logic = `
STEP C: [사고 유형]에 따른 분기 (일상생활 일배책)

  ■ "일상생활" → 일배책 약관 제2호 적용
    "피보험자의 일상생활에 기인하는 우연한 사고"
    → 소재지 무관 보상 → STEP D로
    ※ 피보험자 범위: 기명 피보험자 + 그와 동거하는 배우자 한정 (가족 특약보다 좁음)

  ■ "주택관리" → 일배책 약관 제1호 적용
    "피보험자가 주거용으로 사용하는 보험증권에 기재된 주택의 소유·사용·관리에 기인하는 우연한 사고"

    · [피보험자 지위] = "임대인":
      → "주거용으로 사용하는" 조건 불충족 → coverage_result = "면책"
      ※ 구형과 동일 로직 — 거주 조건 불충족으로 면책 확정

    · [피보험자 지위] ≠ "임대인":
      → [사고장소 부합 여부] 확인:
        · "error" (불일치) → coverage_result = "면책"
        · "warn" 또는 "확인불가" → coverage_result = "판단유보"
        · "ok" → STEP D로

  ■ "공용부" / "시공불량" → STEP A에서 면책 처리됨
`;
  }

  return `아래 자료를 종합하여 피보험자의 손해배상책임 성립 여부(Sabi 8단계)와 보험금 지급 면·부책(Sabi 9단계)을 검토하세요.

=== 적용 약관 ===
${typeLabel}

=== 사고 기본 정보 ===
[피보험자] ${ctx.insured_name || '(미추출)'}
[피보험자 지위] ${ctx.insured_status}
[피보험자 지위 근거] ${ctx.insured_status_reason || '(미추출)'}
[보험증권 소재지 (A)] ${ctx.insurance_location}
[사고발생장소 — 가해 세대 주소 (B)] ${ctx.accident_location}
[피해세대 주소 — 물이 떨어진 아랫집] ${ctx.victim_location || '확인불가'}
[보험기간] ${ctx.insurance_period}
[담보범위 부합 여부 (A vs B)] ${ctx.accident_location_match}
[사고원인 분류 (관리자 선택)] ${ctx.accident_cause}
[★ 룰북 사전 매핑] ${ctx.accident_cause_category || '?'} — ${ctx.accident_cause_label || '(매핑 없음)'}
[수리 소견 (파트너 작성)] ${ctx.repair_opinion || '없음'}
[사고발생장소 소유자 (D)] ${ctx.insured_owner_name || '확인불가'}
[피해세대 소유자] ${ctx.victim_owner_name || '확인불가'}

★★ v5.3 핵심 개념 (혼동 금지):
  · "사고발생장소" = 가해 세대 (배관이 터진 윗집) — [B] 주소
  · "피해세대"     = 아랫집 (물이 떨어진 세대)  — 위에 별도 표시
  · 보통 피보험자(가입자)는 가해 세대와 관련된 사람 (소유자겸점유자/임차인/임대인 중 하나)
  · 피해세대는 제3자 (배상받을 대상)

⚠ 절대 규칙 (위반 시 응답 전체 무효):
1. [피보험자 지위]는 사전 교차분석으로 확정된 값입니다.
   당신이 임의로 재판단하거나 liability_reasoning/investigator_opinion 안에서
   다른 지위로 바꿔 서술하면 안 됩니다.

2. 출력 JSON의 필드값과 reasoning 텍스트는 반드시 일치해야 합니다:
   · liability_reasoning에 "임차인겸점유자"라고 썼으면 — 입력된 [피보험자 지위]도 반드시 "임차인겸점유자"여야 함
   · 근거 문장과 판단 필드가 어긋나면 안 됨 (예: 근거는 "임차인"인데 status는 "소유자겸점유자" 금지)

3. 사고원인 미지정 처리:
   · [사고원인 분류]가 "미지정" 또는 "원인미상 (누수탐지 필요)"이면 → accident_type 추정 금지
     → accident_type = "미지정"
     → liability_result = "no"
     → coverage_result = "판단유보"
     → coverage_reasoning: "사고원인 미확정으로 책임 주체 판단 불가. 누수탐지 결과 또는 수리 소견 확인 후 재검토 필요."
     → (STEP 8·9 나머지 단계는 건너뜀)

4. ★ 룰북 사전 매핑 우선 (v5.2.1 신설):
   · [★ 룰북 사전 매핑]이 ⓐ·ⓑ·ⓒ·ⓓ·ⓔ 중 하나로 명시되었다면 그 값을 그대로 따르세요.
     - ⓐ → accident_type = "주택관리" (758조 단서, 소유자 책임)
     - ⓑ → accident_type = "주택관리" (758조 본문, 점유자 책임)
     - ⓒ → accident_type = "일상생활" (750조, 점유자 책임)
     - ⓓ → accident_type = "공용부" (관리단 책임)
     - ⓔ → accident_type = "시공불량" (시공사 책임)
   · 사전 매핑값에 "?" 또는 "추정"이 포함되면(레거시 값) — 수리소견과 아래 5번 규칙으로 재판정
   · 사전 매핑이 없는데 [수리소견]에도 명확한 힌트가 없으면 → 5번 규칙 적용

5. ★ 임차인 ⓐ/ⓑ 분류 디폴트 규칙 (v5.2.1 신설, 가장 중요):
   [피보험자 지위] = "임차인겸점유자" AND 사전 매핑이 ⓐ? 또는 ? (불명확)인 경우에만 적용.
   
   · [수리소견]에 아래 키워드 중 하나가 명시적으로 있으면 → ⓑ (관리과실)
     키워드: "동파방지 미실시", "청소 미실시", "정기점검 태만", "관리태만", 
            "장기 방치", "수개월 방치", "누수를 인지하고도", "점유자 과실",
            "사용 부주의", "과도 사용"
   
   · 위 키워드가 하나도 없으면 → ⓐ (설비하자) 디폴트 ★★
     근거: 민법 제758조 제1항 단서 적용. 점유자(임차인)의 관리상 주의의무 해태가
          적극적으로 입증되지 않는 한 소유자 책임으로 귀속.
          이는 판례의 주류 입장이며 임차인의 무과실 추정에 해당.
     → accident_type = "주택관리"
     → liability_result = "no"
     → coverage_result = "면책" (9단계 STEP A에서 자동 처리)
   
   ※ 수리소견이 "테스트", "없음", 한두 단어 등 정보 부족 상태면 → 반드시 ⓐ 디폴트 적용.
   ※ 임차인이 과실을 자백하거나 명백한 외부 증거가 없는 상태에서 ⓑ로 분류하면 안 됨.

═══════════════════════════════════════════
【 Sabi 누수원인 룰북 (v5.2) — 먼저 학습하세요 】
═══════════════════════════════════════════

5대 책임주체 × 대표 케이스 + 키워드:

ⓐ 전유부 설비 하자 (민법 제758조 제1항 단서, 소유자 책임)
   키워드: "노후", "파손", "결함", "자연 하자"
   예시: 배관 자연 노후 / 방수층 노후 파손 / 분배기 고장 방치
   → accident_type = "주택관리"

ⓑ 전유부 관리 과실 (민법 제758조 제1항 본문, 점유자 책임)
   키워드: "동파방지 미실시", "청소 미실시", "정기점검 태만"
   예시: 동파방지 조치 미실시 / 배수관 청소 미실시
   → accident_type = "주택관리"

ⓒ 행위 과실 (민법 제750조, 점유자 책임)
   키워드: "잠금", "이탈", "막힘", "과도 사용", "잘못 사용"
   예시: 세탁기 호스 이탈 / 수도꼭지 잠금 불량 / 변기 오버플로우
   → accident_type = "일상생활"

ⓓ 공용부 하자 (민법 제758조 + 공동주택관리법 제63조 + 집합건물법 제16조, 관리단 책임)
   키워드: "공용", "옥상", "지하", "소방", "엘리베이터", "물탱크"
   예시: 공용배관 동파 / 옥상 물탱크 오버플로우 / 공용 급수펌프 고장
   → accident_type = "공용부"

ⓔ 시공불량 (민법 제750조, 시공사 책임)
   키워드: "시공 10년 이내", "접합부 불량", "부적합 자재"
   예시: 배관 접합부 불량 시공 / 방수층 시공 불량
   → accident_type = "시공불량"

판단 플로우:
  공용부분인가? → YES: ⓓ (공용부)
       │
      NO
       ↓
  시공 10년 이내 & 시공 하자 명백? → YES: ⓔ (시공불량)
       │
      NO
       ↓
  설비 관련 사고? (배관/보일러/방수층 등)
       ├─ YES → 점유자 관리 과실 있음?
       │         ├─ YES → ⓑ (관리 과실, 758조 본문)
       │         └─ NO  → ⓐ (설비 하자, 758조 단서)
       └─ NO  → ⓒ (행위 과실, 750조)

═══════════════════════════════════════════
【 Sabi 8단계 — 손해배상책임 성립 검토 】
═══════════════════════════════════════════

STEP 8-0: 사고원인 입력 검증 (★ v5.2.1 최우선)
   · [사고원인 분류] = "미지정" 또는 "원인미상 (누수탐지 필요)"이면 즉시 아래 값으로 확정하고 STEP 8-1 ~ 8-4, 9-A ~ 9-D 모두 건너뜀:
     - accident_type: "미지정"
     - accident_cause_detail: "사고원인 미확인"
     - liability_result: "no"
     - liability_reasoning: "사고원인 분류가 미지정 상태로 책임주체(소유자/점유자/관리단/시공자) 판단이 불가함. 피보험자의 손해배상책임 성립 여부는 판단 보류함."
     - coverage_result: "판단유보"
     - coverage_reasoning: "사고원인 미확정으로 약관 적용 조항 결정 불가. 누수탐지 결과 또는 수리 소견 확인 후 재검토 필요."
     - fault_ratio: "피보험자 100%"  (형식상 기본값)
     - shared_liability: false
     - investigator_opinion: "사고원인이 확인되지 아니하여 본건 보험금 지급 여부에 대한 판단은 보류함. 누수탐지 및 수리 소견 확인 후 재검토 필요함."

STEP 8-1: accident_type 결정 (위 룰북 기준)

STEP 8-2: accident_cause_detail 결정
   · [사고원인 분류]와 [수리 소견]을 종합하여 구체 원인 1줄로 서술
   · 예: "세탁실 전용배관 노후화", "세탁기 호스 이탈", "공용 우수관 파손"

STEP 8-3: liability_result 판정

  ■ accident_type = "공용부" (ⓓ) → liability_result = "no"
    · liability_reasoning 필수 요소: "공동주택관리법 제63조 및 집합건물법 제16조에 따라 관리주체(입주자대표회의)에게 관리 책임이 귀속됨"
    · 반드시 결론: "피보험자의 손해배상책임은 불성립함."

  ■ accident_type = "시공불량" (ⓔ) → liability_result = "no"
    · liability_reasoning 필수 요소: "민법 제667조에 따라 시공업체의 하자담보책임 범위"
    · 반드시 결론: "피보험자의 손해배상책임은 불성립함."

  ■ accident_type = "일상생활" (ⓒ) → liability_result = "yes"
    · liability_reasoning 필수 요소: "민법 제750조에 따라 피보험자의 행위 과실로 인한 불법행위 책임"
    · 반드시 결론: "피보험자의 손해배상책임은 성립함."

  ■ accident_type = "주택관리" (ⓐ 또는 ⓑ) → 피보험자 지위별 분기:

    · [피보험자 지위] = "소유자겸점유자"
      → liability_result = "yes"
      → 설비 하자(ⓐ)이든 관리 과실(ⓑ)이든 소유자 겸 점유자는 양쪽 모두 책임
      → 근거 조문: 민법 제758조 제1항 (본문 또는 단서, 상황에 맞게 인용)
      → 템플릿: "피보험자는 보험증권 기재 주택의 소유자겸점유자로서 민법 제758조 제1항에 따라 공작물 점유자(겸 소유자)의 설치·보존 하자 책임을 부담함. 피보험자의 손해배상책임은 성립함."

    · [피보험자 지위] = "임대인"
      → liability_result = "yes"
      → 758조 제1항 단서 (점유자인 임차인 무과실 시 소유자 귀속)
      → 템플릿: "피보험자는 보험증권 기재 주택의 임대인(소유자)으로서, 점유자인 임차인의 과실이 입증되지 않는 한 민법 제758조 제1항 단서에 따라 공작물 소유자 책임을 부담함. 피보험자의 손해배상책임은 성립함."

    · [피보험자 지위] = "임차인겸점유자" (★ 핵심 분기)
      → 룰북 ⓐ vs ⓑ 구분:
        ▸ ⓑ 관리 과실 (점유자의 관리상 주의의무 위반 입증)
           → liability_result = "yes"
           → 758조 제1항 본문
           → 템플릿: "피보험자는 보험증권 기재 주택의 임차인겸점유자이며, [구체 과실 내용]으로 인한 관리상 주의의무 위반이 확인됨. 민법 제758조 제1항 본문에 따라 공작물 점유자의 관리 책임을 부담함. 피보험자의 손해배상책임은 성립함."
        ▸ ⓐ 설비 하자 (설비 자체 노후·파손, 점유자 과실 불명확)
           → liability_result = "no" ★
           → 758조 제1항 단서 (소유자 귀속)
           → 템플릿: "피보험자는 보험증권 기재 주택의 임차인겸점유자이며, 손해의 원인인 [구체 설비 하자]에 대해 점유자의 관리상 주의의무 해태가 확인되지 않음. 민법 제758조 제1항 단서에 따라 최종 책임은 소유자에게 귀속됨. 피보험자의 손해배상책임은 불성립함."

    · [피보험자 지위] = "확인불가"
      → liability_result = "no"
      → liability_reasoning: "피보험자 지위 미확정으로 법률상 배상책임 성립 여부 판단 보류. 추가 자료 확인 후 재검토 필요."
      → (9단계 STEP A에서 coverage_result = "판단유보"로 특례 처리)

STEP 8-4: shared_liability (과실 분담 가능성)
   · 피해자측 관리 과실·방조 가능성 있으면 true (예: 피해자가 누수 신고 장기 미룸)
   · 없으면 false

═══════════════════════════════════════════
【 Sabi 9단계 — 보험금 지급 면·부책 검토 】
═══════════════════════════════════════════

STEP 9-A: liability_result = "no"?
  · [피보험자 지위] = "확인불가"로 인한 "no" → coverage_result = "판단유보"
    coverage_reasoning: "피보험자 지위 미확정으로 부책/면책 판단 보류. 소유자료·주민등록등본 재확인 후 전환 가능."
  · 그 외 "no" (공용부/시공불량/임차인 무과실) → coverage_result = "면책"
    coverage_reasoning: "피보험자의 법률상 배상책임이 성립하지 않는 사고로 보험금 지급 검토 대상 아님."

STEP 9-B: 보험기간 검토
  · "확인불가" → coverage_result = "판단유보"
    coverage_reasoning: "보험증권상 보험기간 확인 불가. 추후 보험증권 재확인 후 재검토 필요."
  · 사고일이 보험기간 밖 → coverage_result = "면책"
  · 일치 → STEP 9-B2

STEP 9-B2: 담보범위 불일치 최우선 가드 (★ v5.3 강화)
  · [담보범위 부합 여부]를 먼저 확인 — 아래 3개 약관 분기(STEP C)보다 선행
  · "error" (보험증권 소재지 A ≠ 사고발생장소 B) → coverage_result = "면책"
    coverage_reasoning: "보험증권 기재 소재지(A: ${ctx.insurance_location})와 사고발생장소(B: ${ctx.accident_location})가 구·동·호수 모두 불일치하여 약관상 담보 범위를 벗어남. 보험금 지급 책임이 성립하지 않음. ※ 피보험자가 주소 변경·이사 등으로 보험증권 배서(주소 변경) 누락 가능성 있음 — 배서 이력 확인 시 재검토 필요."
    investigator_opinion에 자동 권고 문구 포함: "본건은 보험증권 기재 소재지와 사고발생장소가 상이하여 현 증권 기준으로는 담보 범위에 해당하지 아니하는 것으로 판단됨. 다만 피보험자가 보험계약 후 주소 이전을 통해 배서(주소 변경) 처리한 이력이 있는 경우 담보 범위가 확장될 수 있으므로, 증권 배서 내역 확인 후 재검토를 권고함."
    ※ 구형·신형·일배책 모든 약관 공통 적용.
    ※ [피보험자 지위]가 "임대인"이든 "소유자겸점유자"든 무관하게 면책.
  · "warn" → coverage_result = "판단유보"
    coverage_reasoning: "보험증권 소재지와 사고발생장소의 표기가 상이하여 동일 부동산 여부 확인 필요. 추가 확인 후 재검토."
  · "ok" 또는 "확인불가" → STEP C로 진행
${step9Logic}
STEP 9-D: 약관상 "보상하지 않는 손해" 해당?
  · 주요 누수 관련 면책 사유:
    - 고의 사고, 천재지변(지진/홍수/해일)
    - 주택의 수리·개조·신축·철거공사로 생긴 손해 (통상 유지·보수는 보상)
    - 세대를 같이하는 친족에 대한 배상책임
    - 핵연료·방사선·전자파·공해물질 관련
    - 벌과금 및 징벌적 손해
  · 해당 → coverage_result = "면책"
  · 비해당 → coverage_result = "부책"
    coverage_reasoning: "${typeLabel} 약관상 [주택의 소유·사용·관리 / 일상생활] 중 발생한 대물사고에 해당하며, 약관상 면책 사유에 해당하지 않으므로 보험금 지급 책임이 있는 것으로 판단됨."

═══════════════════════════════════════════

다음 JSON을 반환하세요 (v5.2 확장: 25개 항목):
{
  "accident_type": "일상생활 | 주택관리 | 공용부 | 시공불량 | 미지정",
  "accident_cause_detail": "구체 사고원인 1줄 (예: 세탁실 전용배관 노후화)",
  "accident_description": "사고경위 재구성 1-2문장 (예: 2025.03.03 10:00경 101동 206호 세탁실 내부 전용배관 노후화로 인해 균열이 발생하여 직하층 107호 거실 천장에 수침피해를 입힌 사고임.)",
  "victim_damages": "피해사항 서술 1문장 (예: 107호 거실 천장 수침피해 발생)",
  "shared_liability": true | false,
  "liability_result": "yes | no",
  "liability_reasoning": "위 8-3 템플릿 기반 2문장. [피보험자 지위]·법조문 정확히 인용·피보험자 책임 성립/불성립 결론 반드시 명시",
  "coverage_result": "부책 | 면책 | 판단유보",
  "coverage_reasoning": "1-3문장. 부책/면책/판단유보별 표준 문구 적용 (위 STEP 9 가이드 참조)",
  "fault_ratio": "피보험자 100% | 피보험자 70% / 피해자 30% | 피보험자 50% / 피해자 50%",
  "fault_reason": "과실 비율 판단 근거 1문장 (shared_liability=true일 때만 의미)",
  "investigator_opinion": "2-3문장, ~됨·~판단됨 간결체. accident_type·accident_cause_detail·coverage_result 반영. [피보험자 지위] 정확히 인용"
}

⚠ 필수 준수 사항 (위반 시 재생성):
1. [피보험자 지위]가 "임차인겸점유자"인데 liability_reasoning에 "소유자겸점유자" 또는 "소유 겸 점유자"라고 쓰면 안 됨 (원 지위대로 인용)
2. liability_reasoning 마지막 문장은 반드시 "피보험자의 손해배상책임은 [성립/불성립]함." 형태로 명시 결론
3. liability_result = "no"이면 coverage_result는 "면책" 또는 "판단유보" (절대 "부책" 아님)
4. liability_result는 "yes" 또는 "no" 두 값만 (성립/불성립 금지)
5. coverage_result는 정확히 "부책" / "면책" / "판단유보" 세 값 중 하나 ("면책(판단유보)" 같은 복합 표기 금지)
6. 조문 인용 시 정확한 조문번호 사용 (제750조, 제758조 제1항 본문, 제758조 제1항 단서 구분 필수)
7. 약관 정보 불충분 시 추정 금지, 판단유보 권장
8. shared_liability = true면 coverage_reasoning에 "과실 비율에 따른 보험금 산정이 필요할 수 있음" 포함
9. (★ v5.2.1) [사고장소 부합 여부] = "error"이면 — 다른 조건과 무관하게 coverage_result = "면책". 주택관리·일상생활 구분 무관, 피보험자 지위 무관.
10. (★ v5.2.1) [사고원인 분류] = "미지정"이면 — STEP 8-0 규칙에 따라 모든 판단 필드를 판단유보 값으로 채움. 누수탐지 결과가 없는 상태에서 "배관 노후" 등으로 임의 추정 금지.`;
}

// ─────────────────────────────────────────────
// v5.3.1 ★ 결정론적 지위 판정기 (Deterministic insured_status resolver)
//
// 배경: AI가 필드값(insured_status)과 근거 텍스트를 불일치로 반환하는 경우
//       (근거는 "임차인"으로 쓰고 필드는 "임대인"으로 반환 등) 빈번히 발생.
// 해결: AI는 5개 축(A, B, C, D, E)의 "원시값"만 추출하게 하고,
//       최종 insured_status 라벨은 JS 룰 엔진이 결정론적으로 계산.
//
// 5축:
//   A = 보험증권 소재지 (policy_address_raw)
//   B = 사고발생장소 주소 (accident_location_from_doc)
//   C = 피보험자 실거주지 (insured_residence)
//   D = 사고발생장소 소유자 성명 (insured_owner_name)
//   E = 피보험자 성명 (insured_name)
// ─────────────────────────────────────────────

// 한글/공백/특수문자/괄호 제거 → 비교용 정규화 (주소)
function normalizeAddr(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .replace(/\s+/g, '')
    .replace(/[(),\-_.~·・●]/g, '')
    .replace(/특별시|광역시|특별자치시|특별자치도|자치구|자치시|자치도/g, '')
    .replace(/로길|로|길|동|번지/g, '')  // 주소 구분자 일부 제거 (표기 차이 완화)
    .toLowerCase();
}

// 성명 정규화 (공백 제거만)
function normalizeName(s) {
  if (!s || typeof s !== 'string') return '';
  return s.replace(/\s+/g, '').toLowerCase();
}

// 주소 비교: 핵심 토큰(구·동·호수)이 겹치는지 확인
// 완전 일치 / 부분 겹침(동·호수 일치) / 불일치 3단계
function compareAddresses(addr1, addr2) {
  const a = normalizeAddr(addr1);
  const b = normalizeAddr(addr2);
  if (!a || !b) return 'unknown';
  if (a === b) return 'match';
  
  // 동(棟) + 호수 토큰 추출 (예: "101동", "206호")
  const extractUnitTokens = (s) => {
    const raw = s.replace(/\s+/g, '');
    // 숫자+"동" / 숫자+"호" 패턴
    const matches = raw.match(/\d+[동호]/g) || [];
    return matches;
  };
  const tokensA = extractUnitTokens(addr1 || '');
  const tokensB = extractUnitTokens(addr2 || '');
  
  if (tokensA.length > 0 && tokensB.length > 0) {
    const setA = new Set(tokensA);
    const overlap = tokensB.filter(t => setA.has(t));
    if (overlap.length === tokensA.length && overlap.length === tokensB.length) return 'match';
    if (overlap.length > 0) return 'partial';
  }
  return 'mismatch';
}

// v5.4.3 ★ 소유자 이름 정화 (주민번호·괄호·이하여백 제거)
// 예: "서재성 (900222-1******)" → "서재성"
//    "- 이하여백 -" → null (배열에서 제외)
//    "정영윤 1/2" → "정영윤"
function sanitizeOwnerName(name) {
  if (!name) return null;
  let cleaned = String(name)
    .replace(/\([^)]*\)/g, '')              // 괄호 내용 제거
    .replace(/\d{6}-?\d?\*+/g, '')           // 주민번호 마스킹 제거
    .replace(/\d{6}-?\d{7}/g, '')            // 전체 주민번호 제거
    .replace(/[-\s]*이\s*하\s*여\s*백[-\s]*/g, '')  // 이하여백 제거
    .replace(/\d+\s*\/\s*\d+/g, '')          // 지분 표기 (1/2) 제거
    .replace(/\s+/g, '')
    .trim();
  if (!cleaned || /^[\-\s]*$/.test(cleaned)) return null;
  return cleaned;
}

// v5.4.3 ★ 마스킹 이름 매칭 (서재* ↔ 서재성)
// a, b 중 하나만 '*' 포함이면 prefix 일치 확인
function namesMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  
  // 별표 마스킹 처리
  const maskedA = na.includes('*');
  const maskedB = nb.includes('*');
  
  if (maskedA && !maskedB) {
    const prefix = na.replace(/\*+$/, '').replace(/\*/g, '');
    return prefix.length >= 2 && nb.startsWith(prefix);
  }
  if (!maskedA && maskedB) {
    const prefix = nb.replace(/\*+$/, '').replace(/\*/g, '');
    return prefix.length >= 2 && na.startsWith(prefix);
  }
  return false;
}

// v5.4.3 ★ 동거인 문자열 파싱 (괄호 관계 제거하여 이름만 배열로)
function parseCohabitants(str) {
  if (!str) return [];
  return String(str)
    .split(/[,，、]/)
    .map(s => s.replace(/\([^)]*\)/g, '').trim())
    .map(normalizeName)
    .filter(Boolean);
}

// 결정론적 지위 판정 (v5.4.3: 공동소유·마스킹·세대주 지원)
// 입력:
//   D_owners: 배열 [{name, share}, ...]  (v5.4.3 신규, 우선)
//   D_owner:  단일 문자열 (하위호환)
//   E_insured_resolved: 마스킹 언마스킹된 피보험자 이름 (v5.4.3 신규)
//   E_household_head:   세대주 성명 (v5.4.3 신규)
//   E_spouse: 배우자 성명 (v5.4)
//   E_cohabitants: 동거인 문자열 (v5.4)
function computeInsuredStatus({ 
  A_policy, B_accident, C_residence, 
  D_owners, D_owner,
  E_insured, E_insured_resolved,
  E_spouse, E_cohabitants, E_household_head,
}) {
  // 입력 정규화: D_owners를 소유자 이름 배열로 변환
  let ownerNames = [];
  if (Array.isArray(D_owners) && D_owners.length > 0) {
    ownerNames = D_owners
      .map(o => {
        const raw = o?.name || o;
        return sanitizeOwnerName(raw);
      })
      .filter(Boolean)
      .map(normalizeName);
  } else if (D_owner) {
    const cleaned = sanitizeOwnerName(D_owner);
    if (cleaned) ownerNames = [normalizeName(cleaned)];
  }
  
  // 입력 불충분 체크
  if (ownerNames.length === 0 || !E_insured || !B_accident || !C_residence) {
    return { status: '확인불가', reason: 'insufficient_input' };
  }
  
  // v5.4.3 ★ 피보험자 이름 풀 (원본 + 언마스킹된 이름)
  const En = normalizeName(E_insured);
  const Enr = E_insured_resolved ? normalizeName(E_insured_resolved) : '';
  const insuredPool = [En, Enr].filter(Boolean);
  
  // v5.4.3 ★ 가족 풀 구성: 피보험자 + 배우자 + 세대주 + 동거인
  const familyPool = new Set([
    ...insuredPool,
    E_spouse ? normalizeName(E_spouse) : '',
    E_household_head ? normalizeName(E_household_head) : '',
    ...parseCohabitants(E_cohabitants),
  ].filter(Boolean));
  
  // 소유자 중 피보험자 본인이 있는지 (마스킹 매칭 포함)
  const isOwnerSelfAny = ownerNames.some(on => 
    insuredPool.some(ip => namesMatch(on, ip))
  );
  
  // 소유자 중 가족 범위 내 인물 있는지 (마스킹 매칭 포함)
  const ownerInFamily = ownerNames.some(on => {
    for (const fn of familyPool) {
      if (namesMatch(on, fn)) return true;
    }
    return false;
  });
  
  const addrCmp = compareAddresses(B_accident, C_residence);
  const sameAddr = addrCmp === 'match';
  
  // 4분기 (v5.4.3: 공동소유 반영)
  if (!ownerInFamily) {
    // 공동소유자 모두 피보험자 가족 범위 밖 → "임차인"
    return { 
      status: sameAddr ? '임차인겸점유자' : '임차인', 
      reason: `Owners(${ownerNames.join(', ')}) all outside family of E(${E_insured})${sameAddr ? ', C==B' : ', C!=B'}` 
    };
  }
  
  // 소유자 중 최소 1명이 가족 범위 안에 있음 — 거주 여부로 세분
  if (sameAddr) {
    const hint = isOwnerSelfAny ? 'self-included' : 'family-only';
    return { 
      status: '소유자겸점유자', 
      reason: `Owners(${ownerNames.join(', ')}) include family (${hint}) AND C==B` 
    };
  }
  return { 
    status: '임대인', 
    reason: `Owners(${ownerNames.join(', ')}) include family AND C!=B` 
  };
}

// 담보범위 판정 (address_match: A vs B)
function computeAddressMatch(A_policy, B_accident) {
  if (!A_policy || !B_accident) return 'warn';
  const cmp = compareAddresses(A_policy, B_accident);
  if (cmp === 'match') return 'ok';
  if (cmp === 'partial') return 'warn';
  return 'error';
}

// AI 반환값 vs JS 계산값 검증 및 교정
// 불일치 발견 시 콘솔 경고 + JS 값으로 교정 (JS가 항상 이긴다)
function reconcileInsuredStatus(aiResult, derived) {
  const out = { ...aiResult };
  const aiStatus = aiResult.insured_status;
  const jsStatus = derived.status;
  const aiMatch  = aiResult.address_match;
  const jsMatch  = derived.addressMatch;
  
  if (aiStatus && aiStatus !== jsStatus) {
    console.warn(`[v5.3.1] insured_status 교정: AI="${aiStatus}" → JS="${jsStatus}" (${derived.reason})`);
    out.insured_status = jsStatus;
    out._status_corrected = true;
  } else if (!aiStatus) {
    out.insured_status = jsStatus;
  }
  
  if (aiMatch && aiMatch !== jsMatch) {
    console.warn(`[v5.3.1] address_match 교정: AI="${aiMatch}" → JS="${jsMatch}"`);
    out.address_match = jsMatch;
    out._address_match_corrected = true;
  } else if (!aiMatch) {
    out.address_match = jsMatch;
  }
  
  return out;
}

// v5.3.1 ★ Sabi 룰 엔진 일관성 검증 (4차 판단 후처리)
// AI가 반환한 liability_result / coverage_result / accident_type 이 
// 확정된 축(지위·담보범위·룰북 카테고리)과 논리적으로 일치하는지 검증.
// 어긋나면 결정론적으로 교정.
function enforceSabiRuleEngine(r4, ctx) {
  const out = { ...r4 };
  const warnings = [];
  
  // 규칙 1: 담보범위 error → 무조건 coverage_result='면책'
  if (ctx.address_match === 'error') {
    if (out.coverage_result !== '면책') {
      warnings.push(`address_match=error → coverage_result "${out.coverage_result}" → "면책" 교정`);
      out.coverage_result = '면책';
      out._coverage_corrected = true;
    }
  }
  
  // 규칙 2: insured_status="확인불가" → liability_result="no", coverage_result="판단유보"
  if (ctx.insured_status === '확인불가') {
    if (out.liability_result !== 'no') {
      warnings.push(`insured_status=확인불가 → liability_result "${out.liability_result}" → "no" 교정`);
      out.liability_result = 'no';
      out._liability_corrected = true;
    }
    // 판단유보는 담보범위 error 교정이 우선이므로 error가 아닐 때만
    if (ctx.address_match !== 'error' && out.coverage_result !== '판단유보') {
      warnings.push(`insured_status=확인불가 → coverage_result "${out.coverage_result}" → "판단유보" 교정`);
      out.coverage_result = '판단유보';
      out._coverage_corrected = true;
    }
  }
  
  // 규칙 3: 사고원인 미지정/원인미상 → 판단유보
  if (ctx.accident_cause === '미지정' || ctx.accident_cause === '원인미상 (누수탐지 필요)') {
    if (out.liability_result !== 'no') {
      warnings.push(`accident_cause=미지정 → liability_result "${out.liability_result}" → "no" 교정`);
      out.liability_result = 'no';
      out._liability_corrected = true;
    }
    if (out.coverage_result !== '판단유보' && ctx.address_match !== 'error') {
      warnings.push(`accident_cause=미지정 → coverage_result "${out.coverage_result}" → "판단유보" 교정`);
      out.coverage_result = '판단유보';
      out._coverage_corrected = true;
    }
    if (!out.accident_type || out.accident_type === '주택관리') {
      out.accident_type = '미지정';
    }
  }
  
  // 규칙 4: liability_result="no"이면 coverage_result는 절대 "부책" 불가
  if (out.liability_result === 'no' && out.coverage_result === '부책') {
    warnings.push(`liability="no"인데 coverage="부책" 모순 → "면책" 교정`);
    out.coverage_result = '면책';
    out._coverage_corrected = true;
  }
  
  // 규칙 5: 룰북 카테고리 ⓐ + 임차인/임차인겸점유자 + 관리과실 키워드 없음 → liability="no"
  //         (v5.2.1 절대규칙 5번의 JS 재확인)
  //         v5.4: '임차인' 단독도 포함 (가족 범위 밖 + 거주無)
  if (ctx.rulebook_cat === 'ⓐ' && 
      (ctx.insured_status === '임차인겸점유자' || ctx.insured_status === '임차인')) {
    if (out.liability_result !== 'no') {
      warnings.push(`${ctx.insured_status}+ⓐ(설비하자) → liability "${out.liability_result}" → "no" 교정 (758조 단서)`);
      out.liability_result = 'no';
      out._liability_corrected = true;
      if (ctx.address_match !== 'error') {
        out.coverage_result = '면책';
      }
    }
  }
  
  // 규칙 6: 룰북 ⓓ(공용부) / ⓔ(시공불량) → 무조건 liability="no", coverage="면책"
  if (ctx.rulebook_cat === 'ⓓ' || ctx.rulebook_cat === 'ⓔ') {
    if (out.liability_result !== 'no') {
      out.liability_result = 'no';
      out._liability_corrected = true;
      warnings.push(`${ctx.rulebook_cat} → liability="no" 강제`);
    }
    if (out.coverage_result !== '면책') {
      out.coverage_result = '면책';
      out._coverage_corrected = true;
    }
  }
  
  if (warnings.length > 0) {
    console.warn('[v5.3.1 Sabi 룰엔진 교정]', warnings);
  }
  
  // ─────────────────────────────────────────────
  // v5.4.1 ★ reasoning 안전망 — AI가 빈 문자열 반환해도 JS가 룰 기반으로 자동 생성
  // (보고서 품질 보장을 위해 liability_reasoning / coverage_reasoning 절대 공백 금지)
  // ─────────────────────────────────────────────
  if (!out.liability_reasoning || out.liability_reasoning.trim().length < 10) {
    if (out.liability_result === 'no') {
      if (ctx.rulebook_cat === 'ⓐ' && (ctx.insured_status === '임차인겸점유자' || ctx.insured_status === '임차인')) {
        out.liability_reasoning = `피보험자는 ${ctx.insured_status} 지위이며, 사고 원인이 전유부 공작물(${ctx.accident_cause || '설비'})의 하자에 해당함. 민법 제758조에 따라 공작물 하자 책임은 원칙적으로 소유자에게 귀속되며, 점유자가 주의의무를 다한 것으로 판단되는 경우 임차인인 피보험자의 법률상 배상책임은 성립하지 않는 것으로 판단됨.`;
      } else if (ctx.rulebook_cat === 'ⓓ') {
        out.liability_reasoning = `사고 원인이 공용부분(공용배관·우수관·외벽 등)에 기인한 것으로 판단됨. 공동주택관리법 제63조 및 집합건물법 제16조에 따라 관리주체(입주자대표회의)에게 관리 책임이 귀속되므로 피보험자의 법률상 배상책임은 성립하지 않음.`;
      } else if (ctx.rulebook_cat === 'ⓔ') {
        out.liability_reasoning = `사고 원인이 시공업체의 시공 불량에 기인한 것으로 판단됨. 민법 제667조에 따라 시공업체의 하자담보책임이 우선 검토되어야 하므로 피보험자의 법률상 배상책임은 성립하지 않음.`;
      } else if (ctx.insured_status === '확인불가' || ctx.accident_cause === '미지정') {
        out.liability_reasoning = `피보험자 지위 또는 사고원인이 미확정 상태로 법률상 배상책임 성립 여부 판단 보류함. 추가 자료(소유자료·주민등록등본·누수탐지 결과) 확인 후 재검토 필요.`;
      } else {
        out.liability_reasoning = `현재 제출된 자료 및 Sabi 룰엔진 판정 결과 피보험자의 법률상 배상책임은 성립하지 않는 것으로 판단됨.`;
      }
    } else {
      // liability_result === 'yes'
      const statusStr = ctx.insured_status || '피보험자';
      out.liability_reasoning = `피보험자는 ${statusStr} 지위이며, 사고 원인(${ctx.accident_cause || '누수사고'})에 대해 ${ctx.rulebook_cat === 'ⓒ' ? '민법 제750조 불법행위 책임' : '민법 제758조 공작물 점유자·소유자 책임'}이 성립함. 따라서 피보험자에게 법률상 손해배상책임이 성립하는 것으로 판단됨.`;
    }
    out._liability_reasoning_autogen = true;
  }
  
  if (!out.coverage_reasoning || out.coverage_reasoning.trim().length < 10) {
    if (out.coverage_result === '면책') {
      if (ctx.address_match === 'error') {
        out.coverage_reasoning = `보험증권 기재 소재지와 사고발생장소가 구·동·호수 모두 불일치하여 약관상 담보 범위를 벗어남. 보험금 지급 책임이 성립하지 않음. ※ 피보험자가 주소 이전을 통한 배서(주소 변경) 처리 이력이 있는 경우 담보 범위 확장 가능하므로 배서 내역 확인 후 재검토 권고.`;
      } else if (out.liability_result === 'no') {
        out.coverage_reasoning = `선행 분석 결과 피보험자의 법률상 손해배상책임이 성립하지 않는 사고이므로 보험금 지급 검토 대상이 아님.`;
      } else {
        out.coverage_reasoning = `약관상 면책 사유에 해당하여 보험금 지급 대상이 아닌 것으로 판단됨.`;
      }
    } else if (out.coverage_result === '판단유보') {
      if (ctx.address_match === 'warn') {
        out.coverage_reasoning = `보험증권 소재지와 사고발생장소의 표기가 상이하여 동일 부동산 여부 확인 필요. 추가 확인 후 면·부책 판단 재검토.`;
      } else if (ctx.insured_status === '확인불가') {
        out.coverage_reasoning = `피보험자 지위 미확정으로 면·부책 판단 보류함. 소유자료·주민등록등본 재확인 후 전환 가능.`;
      } else if (ctx.accident_cause === '미지정') {
        out.coverage_reasoning = `사고원인 미확정으로 약관 적용 조항 결정 불가. 누수탐지 결과 또는 수리 소견 확인 후 재검토 필요.`;
      } else {
        out.coverage_reasoning = `보험증권 상 주요 정보 확인 필요로 면·부책 판단을 유보함.`;
      }
    } else {
      // 부책
      const typeStr = ctx.insurance_type === 'family_daily_old' ? '가족일상생활배상책임(구형)'
                    : ctx.insurance_type === 'family_daily_new' ? '가족일상생활배상책임(신형)'
                    : ctx.insurance_type === 'personal_daily'   ? '일상생활배상책임(일배책)'
                    : '배상책임';
      out.coverage_reasoning = `${typeStr} 약관상 [주택의 소유·사용·관리 / 일상생활] 중 발생한 대물사고에 해당하며, 약관상 면책 사유에 해당하지 않으므로 보험금 지급 책임이 있는 것으로 판단됨.`;
    }
    out._coverage_reasoning_autogen = true;
  }
  
  return out;
}

// ─────────────────────────────────────────────
// Claude 응답 JSON 견고 파서 (v5.2.1)
// 원인: 모델이 JSON 뒤에 코멘트/개행/설명을 덧붙이면 JSON.parse 실패
//       → 코드펜스 제거 + 중첩 괄호 카운팅으로 첫 JSON 객체만 추출
// ─────────────────────────────────────────────
function parseClaudeJson(rawText, label) {
  const raw = (rawText || '').trim();
  if (!raw) return {};

  // 1) 코드펜스 제거 (```json ... ``` / ``` ... ```)
  let text = raw
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim();

  // 2) 첫 { 부터 매칭되는 } 까지만 추출 (중첩 대응, 문자열 내부 { } 무시)
  const start = text.indexOf('{');
  if (start === -1) {
    console.warn(`[${label}] JSON 시작({) 없음. 원본:`, raw.slice(0, 200));
    return {};
  }

  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }

  if (end === -1) {
    console.warn(`[${label}] JSON 종료(}) 미발견 (응답 잘림 가능). 원본 앞부분:`, raw.slice(0, 300));
    return {};
  }

  const jsonStr = text.slice(start, end + 1);
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error(`[${label}] JSON.parse 실패:`, e.message);
    console.error(`[${label}] 추출된 JSON:`, jsonStr.slice(0, 500));
    throw new Error(`${label} 응답 파싱 실패: ${e.message}`);
  }
}

async function callClaudeDoc(b64, mediaType, title, system, prompt) {
  const isPdf = mediaType === 'application/pdf';

  // v6.2.10: body 크기 사전 체크
  const dataLen = (b64 || '').length;
  const sizeMB = dataLen / 1024 / 1024;
  if (sizeMB > 3.5) {
    console.warn(`[${title}] base64 크기 ${sizeMB.toFixed(2)}MB — Vercel 한도(4.5MB) 근접/초과 가능`);
  }

  const resp = await fetch('/api/claude', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      model: INS_MODEL, max_tokens: 600, system,
      messages: [{ role:'user', content: [
        { type: isPdf?'document':'image',
          source: { type:'base64', media_type: mediaType, data: b64 },
          ...(isPdf ? { title } : {}) },
        { type:'text', text: prompt },
      ]}],
    }),
  });
  if (!resp.ok) {
    // v6.2.10: 상세 에러 로깅
    let detail = '';
    try { detail = await resp.text(); } catch(e) {}
    console.error(`[${title} API 오류]`, resp.status, resp.statusText, detail);
    console.error(`[${title} 호출 정보]`, {
      mediaType,
      isPdf,
      base64Length: dataLen,
      base64SizeMB: sizeMB.toFixed(2),
      titleLen: (title || '').length,
      promptLen: (prompt || '').length,
    });
    // Anthropic의 흔한 400 사유 — 너무 크거나, 페이지수 초과, 손상된 PDF
    if (resp.status === 400) {
      throw new Error(`${title} API 400 — PDF 손상/페이지수 초과/형식 오류 의심 (${sizeMB.toFixed(2)}MB). 상세: ${detail.substring(0, 200)}`);
    }
    if (resp.status === 413) {
      throw new Error(`${title} API 413 — PDF 크기(${sizeMB.toFixed(2)}MB)가 Vercel 한도 초과`);
    }
    throw new Error(`${title} API 오류 ${resp.status} — ${detail.substring(0, 200)}`);
  }
  const res = await resp.json();
  const raw = res.content?.[0]?.text || '{}';
  return parseClaudeJson(raw, title);
}

// v6.2: 여러 문서 + 텍스트를 한 번의 호출로 보냄 (교차 분석용)
async function callClaudeMulti(contentArr, system) {
  // contentArr는 이미 { type:'document'|'image'|'text', source/text, ... } 형태

  // v6.2.7: body 크기 사전 체크 (Vercel Hobby 한도 4.5MB 우회)
  // 합계 base64 데이터가 3MB 넘으면 미리 경고하고 자동 분할 시도
  const totalDataLen = contentArr.reduce((sum, c) => sum + (c.source?.data?.length || 0), 0);
  const VERCEL_HOBBY_LIMIT = 3.5 * 1024 * 1024;  // 안전 마진 (4.5MB 한도 — JSON overhead)

  if (totalDataLen > VERCEL_HOBBY_LIMIT) {
    // 자동 분할: PDF/이미지 항목을 N개씩 쪼개 호출 후 결과 병합
    console.warn(`[Multi API] body 크기 ${(totalDataLen/1024/1024).toFixed(2)}MB가 한도(${(VERCEL_HOBBY_LIMIT/1024/1024).toFixed(2)}MB) 초과. 자동 분할 호출.`);
    const docItems = contentArr.filter(c => c.type === 'document' || c.type === 'image');
    const textItem = contentArr.find(c => c.type === 'text');
    if (docItems.length <= 1) {
      // 분할 불가 (단일 PDF가 너무 큼) — 그대로 시도
      console.warn('[Multi API] 단일 PDF가 크기 한도 초과. 그대로 시도.');
    } else {
      // 각 PDF/이미지를 단독 호출 후 결과 merge
      const results = {};
      for (let i = 0; i < docItems.length; i++) {
        const item = docItems[i];
        const subContent = [item];
        if (textItem) subContent.push(textItem);
        try {
          const subResult = await _callMultiRaw(subContent, system);
          Object.assign(results, subResult);
        } catch (subErr) {
          console.warn(`[Multi API] 분할 호출 ${i+1}/${docItems.length} 실패:`, subErr.message);
        }
      }
      return results;
    }
  }

  return _callMultiRaw(contentArr, system);
}

// v6.2.7: 실제 API 호출 (분리해서 callClaudeMulti가 재사용 가능)
async function _callMultiRaw(contentArr, system) {
  const resp = await fetch('/api/claude', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      model: INS_MODEL, max_tokens: 1500, system,
      messages: [{ role:'user', content: contentArr }],
    }),
  });
  if (!resp.ok) {
    let detail = '';
    try { detail = await resp.text(); } catch(e) {}
    console.error('[Multi API 오류]', resp.status, resp.statusText, detail);
    console.error('[Multi API contentArr]', contentArr.map(c => ({
      type: c.type,
      mediaType: c.source?.media_type,
      hasData: !!c.source?.data,
      dataLen: c.source?.data?.length || 0,
      textLen: c.text?.length || 0,
    })));
    // 413이면 안내 메시지 명확하게
    if (resp.status === 413) {
      throw new Error(`Multi API 413 — PDF 크기가 Vercel 한도 초과 (총 ${(contentArr.reduce((s,c) => s+(c.source?.data?.length||0), 0)/1024/1024).toFixed(2)}MB). Vercel Pro 업그레이드 필요.`);
    }
    throw new Error(`Multi API 오류 ${resp.status} — ${detail.substring(0, 200)}`);
  }
  const res = await resp.json();
  const raw = res.content?.[0]?.text || '{}';
  return parseClaudeJson(raw, 'multi');
}

async function s2Save() {
  const period = (document.getElementById('ex-period')?.value||'').split('~').map(s=>s.trim());
  const ded    = parseInt(document.getElementById('j-ded')?.value)||0;
  const rc     = _insField?.repair_cost||0;
  const coverage = document.getElementById('j-coverage')?.value || '부책';
  const pay    = coverage === '부책' ? Math.max(0, rc - ded) : 0;

  // v5.4: 첫 피해자 주소를 legacy victim_address 필드에도 백업 저장 (보고서 호환)
  const firstVictim = _insVictims[0] || null;
  const legacyVictimAddr = firstVictim?.victim_address || _insResult.victim_address || null;

  // _insResult 업데이트
  _insResult = {
    ..._insResult,
    policy_product:  document.getElementById('ex-product')?.value,
    policy_no:       document.getElementById('ex-no')?.value,
    policy_start:    period[0]||null,
    policy_end:      period[1]||null,
    insured_name:    document.getElementById('ex-insured')?.value,
    insured_status:  document.getElementById('ex-status')?.value,
    coverage_limit:  parseInt(document.getElementById('ex-coverage')?.value)||null,
    deductible:      ded,
    victim_address:  legacyVictimAddr,  // v5.4: 첫 피해자로부터
    address_match:   document.getElementById('ex-addr')?.value,
    address_match_note: document.getElementById('ex-addr-note')?.value||null,
    liability_result: document.getElementById('j-established')?.value,
    coverage_result: coverage,
    fault_ratio:     document.getElementById('j-fault')?.value,
    // v5.4.1 ★ 판단근거 textarea 수정값 반영 (없으면 기존 _insResult 값 유지)
    liability_reasoning: document.getElementById('j-liab-reason')?.value?.trim() || _insResult.liability_reasoning || null,
    coverage_reasoning:  document.getElementById('j-cov-reason')?.value?.trim()  || _insResult.coverage_reasoning || null,
    investigator_opinion: document.getElementById('j-opinion')?.value,
    // v5.4.1 ★ 사고일시 (datetime-local input 값)
    accident_datetime: document.getElementById('ex-accident-dt')?.value || _insResult.accident_datetime || null,
    payout_amount:   pay,
  };

  try {
    // Supabase 저장 (기존 RPC — 변경 없음)
    await sb.rpc('rpc_save_extraction', {
      p_claim_id:           _insClaim.id,
      p_policy_no:          _insResult.policy_no||null,
      p_policy_product:     _insResult.policy_product||null,
      p_policy_type:        _insClaim.insurance_type||null,
      p_policy_start:       _insResult.policy_start||null,
      p_policy_end:         _insResult.policy_end||null,
      p_insured_name:       _insResult.insured_name||null,
      p_insured_status:     _insResult.insured_status||null,
      p_address_match:      _insResult.address_match||'ok',
      p_address_match_note: _insResult.address_match_note||null,
      p_victim_address:     _insResult.victim_address||null,
      p_coverage_limit:     _insResult.coverage_limit||null,
      p_deductible:         ded||null,
    });
    await sb.rpc('rpc_save_judgment', {
      p_claim_id:              _insClaim.id,
      p_liability_established: _insResult.liability_result||'yes',
      p_liability_pay:         coverage==='부책'?'pay':(coverage==='면책'?'exempt':'pending'),
      p_fault_ratio:           _insResult.fault_ratio||'피보험자 100%',
      p_liability_memo:        _insResult.coverage_reasoning||null,
      p_damage_amount:         rc||null,
      p_payout_amount:         pay||null,
      // v5.2.1 신규: 신 컬럼도 RPC 내부에서 함께 저장됨
      p_liability_result:      _insResult.liability_result||null,
      p_coverage_result:       coverage,
      p_liability_reasoning:   _insResult.liability_reasoning||null,
      p_coverage_reasoning:    _insResult.coverage_reasoning||null,
      p_accident_type:         _insResult.accident_type||null,
      p_accident_cause_detail: _insResult.accident_cause_detail||null,
      p_shared_liability:      _insResult.shared_liability===true,
    });

    // v5.2 신규: RPC가 커버 못하는 "추출 확장 컬럼"만 직접 UPDATE
    // v5.4.3 추가: insured_name_resolved, insured_owners_json, insured_household_head
    const { error: updErr } = await sb.from('insurance_claims').update({
      insured_status_reason:       _insResult.insured_status_reason       || null,
      insured_owner_name:          _insResult.insured_owner_name          || null,
      insured_owner_transfer_date: _insResult.insured_owner_transfer_date || null,
      insured_cohabitants:         _insResult.insured_cohabitants         || null,
      victim_name:                 _insResult.victim_name                 || null,
      victim_owner_name:           _insResult.victim_owner_name           || null,
      victim_owner_transfer_date:  _insResult.victim_owner_transfer_date  || null,
      victim_damages:              _insResult.victim_damages              || null,
      accident_datetime:           _insResult.accident_datetime           || null,
      accident_description:        _insResult.accident_description        || null,
      // v5.4.3 신규
      insured_name_resolved:       _insResult.insured_name_resolved       || null,
      insured_owners_json:         _insResult.insured_owners              || null,
      insured_household_head:      _insResult.household_head              || null,
    }).eq('id', _insClaim.id);
    if (updErr) {
      console.warn('[v5.2/v5.4.3] 신규 컬럼 UPDATE 일부 실패:', updErr.message);
    }

    // v5.4 ★ 피해자 배열 저장 (insurance_victims 테이블)
    try {
      const savedVictims = [];
      for (let i = 0; i < _insVictims.length; i++) {
        const v = _insVictims[i];
        v.victim_order = i + 1;  // 순서 재정렬 (혹시 모를 중복 방지)
        // 빈 레코드는 건너뜀 (성명·주소·소유자 모두 비어있으면)
        if (!v.victim_name && !v.victim_address && !v.victim_owner_name) continue;
        const saved = await insSaveVictim(v);
        savedVictims.push(saved);
      }
      _insVictims = savedVictims;
      console.log(`[v5.4] 피해자 ${savedVictims.length}명 저장됨`);
    } catch (vErr) {
      console.warn('[v5.4] 피해자 저장 일부 실패:', vErr.message);
      toast('피해자 저장 일부 실패: ' + vErr.message, 'e');
    }

    _insClaim = { ..._insClaim, insurance_tab_status: 'ready_for_draft',
      deductible: ded, payout_amount: pay };
    toast('저장 완료!', 's');
    _insStep = 3; insRender();
  } catch(e) { toast('저장 실패: ' + e.message, 'e'); }
}

// ═══════════════════════════════════════════════════════════════
// STEP 3: 손해사정보고서 (시안 기반 10섹션 완전 구현 + PDF 출력)
// v5.4.2 Phase 3
// ═══════════════════════════════════════════════════════════════

// 보고서용 부가 상태
let _insPartnerReport = null;   // 파트너 수리완료 보고 (assignment 레코드 일부)
let _insRepairPhotos  = { before: [], during: [], after: [] };  // signed URLs
let _insLatestAnalysis = null;  // v6.2.30: 가장 최근 완료된 claim_analyses row
let _insHandler       = null;   // v6.1.4: 본인(담당자) 정보 — admin_users row

// v6.1.4: 보고서 양식(report-template-v2.html iframe)에 주입할 데이터
let _insCurrentReportData = null;
let _reportRecipient = '';   // 수신 (보험사명)
let _reportDept = '';         // 참조 (손해사정팀 등)
let _currentReportTab = 'report';  // v6.1.5: 출력 탭 추적 ('report' | 'leak')

// 유틸: 날짜·시간 포맷
function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return `${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,'0')}.${String(dt.getDate()).padStart(2,'0')}`;
}
function fmtDateTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  const day = `${dt.getFullYear()}년 ${dt.getMonth()+1}월 ${dt.getDate()}일`;
  const hm = `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
  return `${day} ${hm}경`;
}
function money(n) { return (n||0).toLocaleString() + '원'; }

// 파트너 수리 데이터 + 사진 signed URL 로드
async function s3LoadReportData() {
  console.log('[s3] 보고서 데이터 로드 시작 case_id=', _insCaseId);

  // 1) 파트너 assignment 최신 수리완료 건 (신 컬럼 포함)
  //    v6.1.1: 임포트된 파트너 우선 (사용자가 모달에서 선택한 것)
  try {
    const importedIds = Array.from(_insImportedPartners || []);
    let pa = null;
    if (importedIds.length > 0) {
      const { data: imp } = await sb.from('partner_assignments')
        .select('id, repair_cost, repair_opinion, work_done_at, visited_at, accident_occurred_at, attacker_unit, victim_unit, leak_area_type, leak_cause, assignment_purpose, partner_company_id')
        .in('id', importedIds)
        .order('work_done_at', { ascending: false })
        .limit(1).maybeSingle();
      pa = imp;
    }
    // 임포트가 비어있으면 case_id 기준으로 fallback
    if (!pa) {
      const { data: any } = await sb.from('partner_assignments')
        .select('id, repair_cost, repair_opinion, work_done_at, visited_at, accident_occurred_at, attacker_unit, victim_unit, leak_area_type, leak_cause, assignment_purpose, partner_company_id')
        .eq('case_id', _insCaseId)
        .in('work_status', ['repair_done','repair_completed'])
        .order('work_done_at', { ascending: false })
        .limit(1).maybeSingle();
      pa = any;
    }
    _insPartnerReport = pa || null;
    console.log('[s3] 파트너 보고 로드:', pa ? `assignment_id=${pa.id}` : 'NONE');
  } catch (e) { console.warn('[s3] partner_assignments 로드 실패:', e); _insPartnerReport = null; }

  // 2) case_documents 사진 3단계별 signed URL
  //    v6.1.1: 임포트된 assignment_id 모두에서 사진 가져오기 (한라+두리 둘 다 임포트한 경우)
  _insRepairPhotos = { before: [], during: [], after: [] };
  try {
    const importedIds = Array.from(_insImportedPartners || []);
    let docsQuery = sb.from('case_documents')
      .select('id, document_type, file_url, file_name, created_at, assignment_id')
      .eq('case_id', _insCaseId)
      .in('document_type', ['repair_photo_before','repair_photo_during','repair_photo_after'])
      .order('created_at', { ascending: true });

    // 임포트한 파트너가 있으면 그 assignment_id의 사진만
    if (importedIds.length > 0) {
      docsQuery = docsQuery.in('assignment_id', importedIds);
    }

    const { data: docs, error: docErr } = await docsQuery;
    if (docErr) { console.warn('[s3] case_documents 쿼리 에러:', docErr); }
    console.log('[s3] case_documents 로드:', docs?.length || 0, '건 (필터:',
      importedIds.length > 0 ? `assignment_id IN (${importedIds.length}건)` : 'case_id 전체', ')');

    let signedSuccess = 0, signedFail = 0;
    for (const d of (docs || [])) {
      const stage = d.document_type.replace('repair_photo_', '');  // before/during/after
      try {
        const { data: s, error: signErr } = await sb.storage.from('partner-work').createSignedUrl(d.file_url, 3600);
        if (signErr) { console.warn(`[s3] signed URL 에러 (${d.file_url}):`, signErr); signedFail++; continue; }
        if (s?.signedUrl) {
          _insRepairPhotos[stage].push({ url: s.signedUrl, name: d.file_name || stage });
          signedSuccess++;
        } else {
          signedFail++;
        }
      } catch (err) {
        console.warn(`[s3] signed URL 예외 (${d.file_url}):`, err);
        signedFail++;
      }
    }
    console.log(`[s3] 사진 signed URL 결과: 성공 ${signedSuccess} / 실패 ${signedFail}`);
    console.log(`[s3] 사진 분류: before=${_insRepairPhotos.before.length} / during=${_insRepairPhotos.during.length} / after=${_insRepairPhotos.after.length}`);
  } catch (e) { console.warn('[s3] case_documents 로드 실패:', e); }

  // v6.2.30: 가장 최근 분석 결과(claim_analyses)를 로드하여 _insClaim에 머지
  // - extracted_inputs: 추출 단계의 모든 입력값 (policy_no, insured_name, insured_address 등)
  // - step_N_result: 9-Call 결과 (insurance_claims에도 동기화되지만 raw도 머지해서 안전망)
  try {
    if (_insCaseId) {
      const { data: ana, error: anaErr } = await sb.from('claim_analyses')
        .select('id, extracted_inputs, step_1_result, step_2_result, step_3_result, step_4_result, step_5_result, step_6_result, step_7_result, step_8_result, step_9_result, policy_type, status, duration_ms, created_at')
        .eq('case_id', _insCaseId)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!anaErr && ana) {
        console.log('[s3] 최신 분석 로드:', ana.id, '| policy_type=', ana.policy_type);
        _insLatestAnalysis = ana;

        // extracted_inputs를 _insClaim에 머지 — 보고서가 r.policy_no, r.policy_address 등을 읽을 수 있게
        // 우선순위: _insClaim 기존 값 > extracted_inputs (DB 컬럼에 직접 저장된 값이 더 신뢰도 높음)
        const ei = ana.extracted_inputs || {};
        const reportFields = [
          // 보험증권 출처
          'policy_no', 'policy_product', 'policy_product_name', 'policy_period',
          'policy_start', 'policy_end', 'policy_address', 'coverage_limit', 'deductible',
          'rider_condition', 'contractor_name',
          // 피보험자 (등본 출처)
          'insured_name', 'insured_full_name', 'insured_rrn', 'insured_phone',
          'insured_registered_address', 'insured_cohabitants', 'insured_owner_name',
          'family_relation_text',
          // 사고 (누수소견서/경위서/청구서 출처)
          'accident_date', 'accident_address', 'accident_summary', 'accident_cause_detail',
          'incident_report', 'leak_report',
          // 피해자
          'victim_name_v0', 'victim_address_v0', 'victim_owner_name_v0', 'victim_rrn_v0',
        ];
        for (const f of reportFields) {
          if (ei[f] != null && ei[f] !== '' && ei[f] !== '정보 없음') {
            // _insClaim에 해당 키가 없거나 비어있으면 ei 값 사용
            if (_insClaim[f] == null || _insClaim[f] === '' || _insClaim[f] === '-') {
              _insClaim[f] = ei[f];
            }
          }
        }

        // 보고서 호환 alias 추가 — buildReportData가 읽는 키들
        _insClaim.policy_no = _insClaim.policy_no || ei.policy_no || '';
        _insClaim.policy_product = _insClaim.policy_product || ei.policy_product_name || ei.policy_product || '';
        _insClaim.policy_address = _insClaim.policy_address || ei.policy_address || '';
        _insClaim.policy_address_raw = _insClaim.policy_address_raw || ei.policy_address || '';
        _insClaim.policy_period = _insClaim.policy_period || ei.insurance_period || (ei.policy_start && ei.policy_end ? `${ei.policy_start} ~ ${ei.policy_end}` : '');
        _insClaim.accident_address = _insClaim.accident_address || ei.accident_address || ei.accident_location || '';
        _insClaim.insured_address = _insClaim.insured_address || ei.insured_registered_address || '';
        _insClaim.insured_residence = _insClaim.insured_residence || ei.insured_registered_address || '';
        _insClaim.insured_jumin = _insClaim.insured_jumin || ei.insured_rrn || '';
        _insClaim.insured_phone = _insClaim.insured_phone || ei.insured_phone || '';
        _insClaim.building_owner = _insClaim.building_owner || ei.insured_owner_name || '';
        _insClaim.cohabitants = _insClaim.cohabitants || ei.insured_cohabitants || '';
        _insClaim.leak_cause = _insClaim.leak_cause || ei.leak_report || ei.accident_summary || '';

        // 9-Call 단계 결과도 alias로 (insurance_claims에 저장 안 된 필드 대비)
        const r7 = ana.step_7_result || {};
        _insClaim.investigator_opinion = _insClaim.investigator_opinion || r7.investigator_opinion || '';

        console.log('[v6.2.30] _insClaim 분석 결과 머지 완료. 보고서에 사용될 핵심 필드:',
          'policy_no=', _insClaim.policy_no?.slice(0, 20),
          '| insured_name=', _insClaim.insured_name,
          '| accident_address=', _insClaim.accident_address?.slice(0, 30),
          '| coverage_result=', _insClaim.coverage_result);
      } else if (anaErr) {
        console.warn('[s3] claim_analyses 로드 실패:', anaErr.message);
      } else {
        console.log('[s3] 완료된 분석 없음 — 추출 결과만으로 보고서 표시');
      }
    }
  } catch (e) {
    console.warn('[s3] 분석 결과 머지 실패:', e);
  }
}

// STEP 3 진입 시 자동 데이터 로드
async function s3Enter() {
  await s3LoadReportData();
  insRender();
}

function insStep3HTML() {
  const cl = _insClaim || {};
  const r  = _insResult || {};
  const co = _insCompany || {};
  const fd = _insField;
  const pa = _insPartnerReport || {};
  const photos = _insRepairPhotos || { before:[], during:[], after:[] };
  const victims = _insVictims || [];
  
  const rc  = fd?.repair_cost || pa.repair_cost || 0;
  const ded = r.deductible || cl.deductible || 200000;
  const pay = (r.coverage_result === '부책' || cl.coverage_result === '부책') ? Math.max(0, rc - ded) : 0;
  const prevCost = cl.damage_prevention_cost || 0;

  // v6.1.4: 보고서 양식(iframe)에 주입할 데이터 빌드
  _reportRecipient = cl.report_recipient || cl.insurer_name || 'DB손해보험';
  _reportDept = cl.report_cc || '손해사정팀';
  _insCurrentReportData = buildReportData(cl, r, co, _insPartners, victims, photos, _insHandler);

  // 헤더 상태 배지
  const covVal = r.coverage_result || cl.coverage_result;
  const coverageBadge = covVal === '부책'
    ? '<span class="badge" style="background:#dcfce7;color:#15803d;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600">부책</span>'
    : covVal === '면책'
    ? '<span class="badge" style="background:#fee2e2;color:#dc2626;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600">면책</span>'
    : '<span class="badge" style="background:#fef3c7;color:#b45309;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600">판단유보</span>';

  // v6.1.1: 우측 액션 사이드 (자주 쓰는 문구 5개 + 작업 정보)
  const reportNo = cl.report_no || '— 미채번 —';
  const insTypeLabel = INS_TYPE_LABELS[cl.insurance_type] || '미선택';

  return `
  <div class="no-print">
    ${v6CaseHeaderHTML()}
  </div>

  <!-- 출력 화면 헤더: 수신/참조/제목 인라인 -->
  <div class="v6-output-header no-print">
    <label>
      <span>수신</span>
      <input type="text" id="rep-recipient" 
        value="${escapeHtml(cl.report_recipient || cl.insurer_name || 'DB손해보험')}" 
        placeholder="보험사명"
        oninput="s3UpdateReportField('recipient', this.value)">
    </label>
    <label>
      <span>참조</span>
      <input type="text" id="rep-cc" 
        value="${escapeHtml(cl.report_cc || '손해사정팀')}" 
        placeholder="부서명 / 담당자" style="width:200px"
        oninput="s3UpdateReportField('dept', this.value)">
    </label>
    <label>
      <span>제목</span>
      <input type="text" id="rep-title" 
        value="${escapeHtml(cl.report_title || '누수사고 손해사정서')}" 
        placeholder="보고서 제목" style="width:240px"
        oninput="s3UpdateReportField('title', this.value)">
    </label>
    <span style="margin-left:auto;font-size:11px;color:var(--ins-ink-3)">→ 변경 시 양식에 즉시 반영</span>
  </div>

  <!-- 좌(보고서 페이지들) + 우(액션 사이드) -->
  <div class="v6-output-grid">
    <!-- 좌측: 손해사정서/누수소견서 탭 + 페이지 카드 -->
    <div>
      <div class="card no-print" style="margin-bottom:14px;display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:14px;font-weight:700">📄 손해사정 보고서 ${coverageBadge}</div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="insGoStep(2)">← 이전</button>
          <button class="btn btn-ghost btn-sm" onclick="s3LoadReportData().then(()=>insRender())">↻ 새로고침</button>
        </div>
      </div>

      <!-- v6.1.1: 탭 — 손해사정서 / 누수소견서 -->
      <div class="v6-output-tabs no-print">
        <button class="v6-output-tab active" id="tab-btn-report" onclick="s3SwitchTab('report')">
          손해사정서 (보험사 제출)
        </button>
        <button class="v6-output-tab" id="tab-btn-leak" onclick="s3SwitchTab('leak')">
          누수소견서 (파트너 명의)
        </button>
      </div>

      <!-- 탭 컨텐츠 1: 손해사정서 (report-template-v2.html iframe 임베드 — v6.1.4) -->
      <div id="tab-content-report" style="display:block">
        <iframe
          id="reportFrame"
          src="./report-template-v2.html?embed=1&case=${encodeURIComponent(cl.case_no || 'SMPL_01_백석균')}&recipient=${encodeURIComponent(_reportRecipient || (r.report_cc || '보험사'))}&dept=${encodeURIComponent(_reportDept || '손해사정팀')}&title=${encodeURIComponent(r.report_title || '누수사고 손해사정서')}"
          style="width:100%;height:1400px;border:1px solid var(--ins-line);border-radius:6px;background:white;display:block;"
          title="손해사정서 양식 (SMPL_01 기반 v6.1.4)"
          onload="s3InjectReportData()"
        ></iframe>
        <div style="margin-top:8px;font-size:11px;color:var(--ins-muted);text-align:center">
          ⓘ 양식: SMPL_01 백석균 양식 정본 7페이지 · 우측 PDF 다운로드 버튼으로 인쇄
        </div>
      </div>

      <!-- 탭 컨텐츠 2: 누수소견서 (파트너 명의) -->
      <div id="tab-content-leak" style="display:none">
        <div class="v6-output-pages">
          <div class="v6-page-card">
            ${renderLeakOpinion(cl, r, pa, photos, _insPartners)}
          </div>
        </div>
      </div>
    </div>

    <!-- 우측: 액션 사이드 -->
    <div class="v6-action-side no-print">
      <div class="v6-action-card">
        <div class="v6-action-card-title">📤 제출</div>
        <button class="v6-action-btn primary" onclick="s3ExportPdf()">🖨 PDF 다운로드</button>
        <button class="v6-action-btn" onclick="toast('보험사 송부 기능은 추후 업데이트 예정','i')">📧 보험사 송부</button>
        <button class="v6-action-btn" onclick="s3SaveReport()">💾 임시저장</button>
      </div>

      <div class="v6-action-card">
        <div class="v6-action-card-title">💡 자주 쓰는 문구</div>
        <ul class="v6-snippet-list">
          <li class="v6-snippet-item" onclick="s3InsertSnippet('전유부 공작물의 보존상 하자로 인한 누수사고로 판단됨')" title="전유부 공작물 보존상 하자">전유부 공작물 보존상 하자...</li>
          <li class="v6-snippet-item" onclick="s3InsertSnippet('피보험자의 법률상 손해배상책임이 성립하는 사고로 판단됨')" title="법률상 배상책임 성립함">법률상 배상책임 성립함...</li>
          <li class="v6-snippet-item" onclick="s3InsertSnippet('약관상 보장 범위에 해당하여 부책으로 판단됨')" title="약관상 보장 범위에 해당">약관상 보장 범위에 해당...</li>
          <li class="v6-snippet-item" onclick="s3InsertSnippet('본 사고는 민법 제758조 본문에 따라 공작물 점유자/소유자의 무과실책임에 해당함')" title="본 사고는 758조 본문에">본 사고는 758조 본문에...</li>
          <li class="v6-snippet-item" onclick="s3InsertSnippet('현장 조사 결과를 종합하여 검토한 바')" title="현장 조사 결과를 종합하여">현장 조사 결과를 종합하여...</li>
        </ul>
      </div>

      <div class="v6-action-card">
        <div class="v6-action-card-title">📌 작업 정보</div>
        <div class="v6-job-info">
          <div>보고서 번호 · ${escapeHtml(reportNo)}</div>
          <div>약관 · ${escapeHtml(insTypeLabel)}</div>
          <div>판단 결과 · ${covVal || '미산출'}</div>
          <div>버전 · v6.1.1</div>
        </div>
      </div>
    </div>
  </div>`;
}

// v6.1.1: 자주 쓰는 문구 클릭 → 클립보드 복사 (간단)
function s3InsertSnippet(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      toast('문구가 클립보드에 복사되었습니다','s');
    }).catch(() => {
      toast('복사 실패 — 직접 입력해주세요','w');
    });
  } else {
    toast('클립보드 미지원 브라우저','w');
  }
}

// v6.1.2: STEP 3 탭 전환 (손해사정서 / 누수소견서)
function s3SwitchTab(tabName) {
  // v6.1.6: 현재 활성 탭 추적 + 디버깅 로그
  _currentReportTab = tabName;
  console.log('[v6.1.6 탭 전환] _currentReportTab =', tabName);
  // 탭 버튼 active 토글
  document.querySelectorAll('.v6-output-tab').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-btn-${tabName}`)?.classList.add('active');
  // 탭 컨텐츠 표시 토글
  document.getElementById('tab-content-report').style.display = (tabName === 'report') ? 'block' : 'none';
  document.getElementById('tab-content-leak').style.display   = (tabName === 'leak')   ? 'block' : 'none';

  // v6.1.4: 누수소견서 탭 전환 시 도장 signed URL 로드
  if (tabName === 'leak') {
    s3LoadStampImages();
  }
}

// v6.1.4: 누수소견서 안의 도장 이미지(.leak-stamp-img)를 partner-stamps Storage에서 signed URL로 로드
async function s3LoadStampImages() {
  const imgs = document.querySelectorAll('.leak-stamp-img[data-stamp-path]');
  for (const img of imgs) {
    const path = img.getAttribute('data-stamp-path');
    if (!path || img.src) continue;
    try {
      const { data, error } = await sb.storage.from('partner-stamps').createSignedUrl(path, 3600);
      if (!error && data?.signedUrl) {
        img.src = data.signedUrl;
      } else {
        // 도장 로드 실패 시 텍스트 (인) 으로 폴백
        const fallback = document.createElement('span');
        fallback.className = 'leak-stamp';
        fallback.textContent = '(인)';
        img.replaceWith(fallback);
      }
    } catch (e) {
      console.warn('[v6.1.4] 도장 signed URL 실패:', e);
    }
  }
}
window.s3LoadStampImages = s3LoadStampImages;

// v6.1.2: 누수소견서 렌더 (파트너 명의)
//   - 파트너 사업자 정보 (partner_companies 조회)
//   - 사고/진단/수리 정보 (partner_assignment + claim 조합)
//   - 직인 영역 (간이)
function renderLeakOpinion(cl, r, pa, photos, partners) {
  // 임포트한 첫 파트너 → 명의자
  const importedIds = Array.from(_insImportedPartners || []);
  const namedPartner = (partners || []).find(p => importedIds.includes(p.id) && p.assignment_purpose === 'detection')
    || (partners || []).find(p => importedIds.includes(p.id))
    || (partners || [])[0]
    || null;

  // 발행번호
  const issueDate = pa.work_done_at ? new Date(pa.work_done_at) : new Date();
  const issueNo = `NS-${issueDate.getFullYear()}${String(issueDate.getMonth()+1).padStart(2,'0')}${String(issueDate.getDate()).padStart(2,'0')}-001`;

  // v6.1.4: partner_companies 사업자 상세 매핑
  const partnerName = namedPartner?.partner_name || '— 파트너 미선택 —';
  const partnerOwner = namedPartner?.partner_owner || '—';
  const partnerBusinessNo = namedPartner?.partner_business_no || '—';
  const partnerAddress = namedPartner?.partner_address || '—';
  const partnerPhone = namedPartner?.partner_phone || '—';
  const partnerStampPath = namedPartner?.partner_stamp_path || '';

  // 사고/수리 정보 — accident_datetime_at_site 우선 (v5.4.3 신규 컬럼)
  const accDtRaw = namedPartner?.accident_datetime_at_site || pa.accident_datetime_at_site || pa.accident_occurred_at || cl.accident_date;
  const accDt = accDtRaw ? fmtDate(accDtRaw) : '—';
  const accDtSource = namedPartner?.accident_datetime_source || pa.accident_datetime_source || '';
  const accDtSourceLabel = ({
    victim_statement: '피해세대 진술',
    complaint_log: '관리소 민원',
    insured_statement: '피보험자 진술',
    partner_estimate: '현장 관찰 추정',
    unknown: '특정 불가'
  })[accDtSource] || (accDtSource ? '진술 기준' : '');

  const accLoc = r.accident_location_from_doc || cl.accident_address || cl.address_full || '—';
  const attackerUnit = (namedPartner?.attacker_unit || pa.attacker_unit) || '—';
  const victimUnit = (namedPartner?.victim_unit || pa.victim_unit) || '—';
  const leakCauseRaw = (namedPartner?.leak_cause || pa.leak_cause) || '';
  const leakCause = leakCauseRaw || '—';
  const leakAreaRaw = (namedPartner?.leak_area_type || pa.leak_area_type) || '';
  const leakAreaLabel = ({
    living: '거실', kitchen: '주방', main_room: '안방',
    sub_room_1: '작은방1', sub_room_2: '작은방2', sub_room_3: '작은방3',
    bathroom: '화장실', boiler_room: '보일러실', utility_room: '다용도실',
    veranda: '베란다', other: '기타'
  })[leakAreaRaw] || (leakAreaRaw || '—');
  const leakDetailPart = (namedPartner?.leak_detail_part || pa.leak_detail_part) || '';
  const leakAreaFull = leakDetailPart ? `${leakAreaLabel} (${leakDetailPart})` : leakAreaLabel;
  const detectionCount = namedPartner?.detection_count || pa.detection_count || 1;

  const repairDateRaw = namedPartner?.work_done_at || pa.work_done_at;
  const repairDate = repairDateRaw ? fmtDate(repairDateRaw) : '—';
  const repairCostRaw = namedPartner?.repair_cost || pa.repair_cost;
  const repairCost = repairCostRaw ? Number(repairCostRaw).toLocaleString()+'원' : '—';
  const repairOpinion = (namedPartner?.repair_opinion || pa.repair_opinion) || '—';

  return `
  <div class="leak-doc">
    <div class="leak-header">
      <div class="leak-title-ko">누 수 소 견 서</div>
      <div class="leak-title-num">발행번호 ${escapeHtml(issueNo)}</div>
    </div>

    <div class="doc-section">
      <div class="leak-section-title">사업자 정보</div>
      <table class="leak-table">
        <tr><td class="lbl">상호</td><td>${escapeHtml(partnerName)}</td></tr>
        <tr><td class="lbl">대표</td><td>${escapeHtml(partnerOwner)}</td></tr>
        <tr><td class="lbl">사업자번호</td><td>${escapeHtml(partnerBusinessNo)}</td></tr>
        <tr><td class="lbl">주소</td><td>${escapeHtml(partnerAddress)}</td></tr>
        <tr><td class="lbl">연락처</td><td>${escapeHtml(partnerPhone)}</td></tr>
      </table>
    </div>

    <div class="doc-section">
      <div class="leak-section-title">사고 정보</div>
      <table class="leak-table">
        <tr><td class="lbl">사고일자</td><td>${escapeHtml(accDt)}${accDtSourceLabel ? ` (${escapeHtml(accDtSourceLabel)})` : ''}</td></tr>
        <tr><td class="lbl">사고장소</td><td>${escapeHtml(accLoc)}</td></tr>
        <tr><td class="lbl">가해세대</td><td>${escapeHtml(attackerUnit)}</td></tr>
        <tr><td class="lbl">피해세대</td><td>${escapeHtml(victimUnit)}</td></tr>
      </table>
    </div>

    <div class="doc-section">
      <div class="leak-section-title">누수 진단 결과</div>
      <table class="leak-table">
        <tr><td class="lbl">누수원인</td><td>${escapeHtml(leakCause)}</td></tr>
        <tr><td class="lbl">누수부위</td><td>${escapeHtml(leakAreaFull)}</td></tr>
        <tr><td class="lbl">탐지 횟수</td><td>${detectionCount}회</td></tr>
      </table>
    </div>

    <div class="doc-section">
      <div class="leak-section-title">수리 내역</div>
      <table class="leak-table">
        <tr><td class="lbl">수리일자</td><td>${escapeHtml(repairDate)}</td></tr>
        <tr><td class="lbl">수리금액</td><td>${escapeHtml(repairCost)}</td></tr>
        <tr><td class="lbl">수리내용</td>
          <td style="white-space:pre-wrap">${escapeHtml(repairOpinion)}</td>
        </tr>
      </table>
    </div>

    ${photos && (photos.before.length || photos.during.length || photos.after.length) ? `
    <div class="doc-section">
      <div class="leak-section-title">현장 사진</div>
      ${photos.before.length ? `
        <div style="font-size:11px;font-weight:600;color:var(--ins-ink-2);margin:8px 0 4px">① 수리 전 (${photos.before.length}장)</div>
        <div class="report-photo-grid">
          ${photos.before.slice(0,3).map(p => `<img src="${p.url}" class="report-photo" alt="">`).join('')}
        </div>` : ''}
      ${photos.during.length ? `
        <div style="font-size:11px;font-weight:600;color:var(--ins-ink-2);margin:8px 0 4px">② 수리 중 (${photos.during.length}장)</div>
        <div class="report-photo-grid">
          ${photos.during.slice(0,3).map(p => `<img src="${p.url}" class="report-photo" alt="">`).join('')}
        </div>` : ''}
      ${photos.after.length ? `
        <div style="font-size:11px;font-weight:600;color:var(--ins-ink-2);margin:8px 0 4px">③ 수리 후 (${photos.after.length}장)</div>
        <div class="report-photo-grid">
          ${photos.after.slice(0,3).map(p => `<img src="${p.url}" class="report-photo" alt="">`).join('')}
        </div>` : ''}
    </div>` : ''}

    <p style="margin-top:24px;font-size:11px;color:var(--ins-ink-2);line-height:1.7">
      본 소견서는 위 사고에 대해 현장조사 및 수리를 진행한 결과를 기재한 것임을 확인합니다.
    </p>

    <div class="leak-stamp-area">
      <div class="leak-stamp-line">${escapeHtml(repairDate)}</div>
      <div class="leak-stamp-line">${escapeHtml(partnerName)}${partnerOwner !== '—' ? ` 대표 ${escapeHtml(partnerOwner)}` : ''}</div>
      ${partnerStampPath
        ? `<img class="leak-stamp-img" src="" data-stamp-path="${escapeHtml(partnerStampPath)}" alt="(인)" style="width:60px;height:60px;object-fit:contain;margin-left:12px;vertical-align:middle"/>`
        : `<div class="leak-stamp">(인)</div>`
      }
    </div>
  </div>`;
}

// ─── 표지 (시안 1페이지) ────────────────────────────────────
function renderReportCover(cl, co, victims) {
  const today = new Date();
  const submitDate = cl.submit_date 
    ? fmtDate(cl.submit_date)
    : `${today.getFullYear()}년 ${String(today.getMonth()+1).padStart(2,'0')}월 ${String(today.getDate()).padStart(2,'0')}일`;
  const accDate = cl.accident_datetime 
    ? fmtDateTime(cl.accident_datetime)
    : (cl.accident_date ? fmtDate(cl.accident_date) : '');
  const accLoc = _insResult?.accident_location_from_doc || victims[0]?.victim_address || cl.victim_address || '';
  const typeLabel = INS_TYPE_LABELS[cl.insurance_type] || '배상책임보험';
  const insuredName = _insResult?.insured_name || cl.insured_name || '';
  const policyNo = _insResult?.policy_no || cl.policy_no || '';
  const stampImg = co.stamp_image_url
    ? `<img src="${co.stamp_image_url}" alt="직인" class="report-stamp-img">`
    : '';

  return `
  <div class="report-section report-cover page-break-after">
    <!-- 회사 헤더 -->
    <div class="report-company-header">
      <div class="report-company-name">${co.company_name || '누수패스손해사정'}</div>
      <div class="report-company-sub">
        ${co.address || ''}
        ${co.phone ? ` / Tel : ${co.phone}` : ''}
        ${co.fax ? ` / FAX : ${co.fax}` : ''}
      </div>
      ${co.company_name_en ? `<div class="report-company-en">${co.company_name_en}</div>` : ''}
    </div>

    <!-- 보고서 메타 -->
    <div class="report-meta-line">
      <div>보고서 번호 : <b>${cl.report_no || '— (저장 시 자동 채번)'}</b></div>
      <div>제출일자 : <b>${submitDate}</b></div>
    </div>

    <!-- v6.1.1: 수신/참조/제목 — 출력 헤더에서 입력, 여기는 readonly 표시만 -->
    <!-- (이전 rep-insurer/rep-insurer-contact ID는 출력 헤더의 rep-recipient/rep-cc로 통합) -->
    <table class="report-meta-table">
      <tr><td class="lbl">수  신</td><td><b id="cover-recipient">${escapeHtml(cl.report_recipient || cl.insurer_name || '—')}</b></td></tr>
      <tr><td class="lbl">참  조</td><td><b id="cover-cc">${escapeHtml(cl.report_cc || cl.insurer_contact || '—')}</b></td></tr>
      <tr><td class="lbl">제  목</td><td><b id="cover-title">${escapeHtml(cl.report_title || `${typeLabel} ${insuredName} 보고서`)}</b></td></tr>
    </table>

    <!-- 본문 인사말 -->
    <div class="report-intro">
      <div>귀사 피보험자 요청에 의거 ${accDate}경 ${escapeHtml(accLoc)}에서 발생한 누수 증권번호 <b>제 ${escapeHtml(policyNo)} 호</b>에 대한 사고조사를 실시하고 그 현장조사 결과를 다음과 같이 제출합니다.</div>
    </div>

    <!-- 손해사정사·조사자 서명 -->
    <div class="report-signatures">
      <div>손해사정사 : <b>${escapeHtml(co.adjuster_name || '')}</b>${stampImg} / 손해사정사 (등록번호 : ${escapeHtml(co.adjuster_license_no || '—')})</div>
      <div style="margin-top:6px">조&nbsp;사&nbsp;자&nbsp;: <b>${escapeHtml(co.investigator_name || '')}</b> / 보조인 (등록번호 : ${escapeHtml(co.investigator_reg_no || '—')})</div>
      ${co.phone ? `<div style="margin-top:4px;font-size:11px">H.P : ${co.phone}</div>` : ''}
    </div>

    <!-- 대표이사 직인 (시안 우하단) -->
    <div class="report-ceo-stamp">
      <div style="font-weight:900">${co.company_name || ''}</div>
      <div>대표이사&nbsp;&nbsp;<b>${escapeHtml(co.representative || '')}</b>${stampImg}</div>
    </div>
  </div>`;
}

// ─── 1. 총괄표 ──────────────────────────────────────────────
function renderReportSection1_Summary(cl, r, fd, pa, rc, ded, pay, prevCost) {
  const typeLabel = INS_TYPE_LABELS[cl.insurance_type] || '배상책임보험';
  const accDate = cl.accident_datetime 
    ? fmtDateTime(cl.accident_datetime)
    : (cl.accident_date ? fmtDate(cl.accident_date) : '');
  const insuredName = r.insured_name || cl.insured_name || '';
  const period = (r.policy_start && r.policy_end)
    ? `${fmtDate(r.policy_start)} ~ ${fmtDate(r.policy_end)}`
    : '';
  const accLoc = r.accident_location_from_doc || pa.attacker_unit || cl.victim_address || '';
  const accCause = pa.leak_cause || cl.accident_cause_type || r.accident_cause_detail || '';
  // v6: 사고원인 select 옵션 (현재값이 표준 13개에 없으면 "(현재) ___" 항목 추가)
  const causeStandardList = (typeof INS_CAUSES !== 'undefined') ? INS_CAUSES : [];
  const isStandardCause = causeStandardList.includes(accCause);
  const causeSelectHTML = `
    <select class="report-editable-input" id="rep-cause" style="width:100%;font-family:inherit;font-size:inherit;">
      ${!accCause ? `<option value="" selected>— 사고원인 선택 —</option>` : ''}
      ${!isStandardCause && accCause ? `<option value="${escapeHtml(accCause)}" selected>(현장 입력) ${escapeHtml(accCause)}</option>` : ''}
      ${causeStandardList.map(c => `<option value="${escapeHtml(c)}" ${c===accCause?'selected':''}>${escapeHtml(c)}</option>`).join('')}
    </select>`;
  const victimRows = (_insVictims || []).length > 0 
    ? (_insVictims || []).map((v, i) => `피해자${i+1}: ${v.victim_name || '-'}`).join(' / ')
    : '';

  return `
  <div class="report-section page-break-after">
    <div class="report-section-title">1. 총괄표</div>
    <table class="report-kv-table">
      <tr><td class="lbl">가. 보 험 종 목</td><td>${typeLabel}</td></tr>
      <tr><td class="lbl">나. 계 약 자</td><td>${escapeHtml(insuredName)}</td></tr>
      <tr><td class="lbl">다. 피 보 험 자</td><td>${escapeHtml(insuredName)}</td></tr>
      <tr><td class="lbl">라. 보 험 기 간</td><td>${period}</td></tr>
      <tr><td class="lbl">마. 보 상 한 도 액</td><td>${r.coverage_limit ? Number(r.coverage_limit).toLocaleString()+'원' : '—'}</td></tr>
      <tr><td class="lbl">바. 자 기 부 담 금</td><td>${money(ded)} / 대물 ${money(ded)}, 대인 없음</td></tr>
      <tr><td class="lbl">사. 사 고 일 시</td><td>${accDate}</td></tr>
      <tr><td class="lbl">아. 사 고 장 소</td><td>${escapeHtml(accLoc)}</td></tr>
      <tr><td class="lbl">자. 사 고 원 인</td><td>${causeSelectHTML}</td></tr>
      <tr><td class="lbl">차. 보 험 조 건</td><td>${typeLabel}</td></tr>
      ${victimRows ? `<tr><td class="lbl">카. 피 해 자</td><td>${escapeHtml(victimRows)}</td></tr>` : ''}
    </table>

    <div class="report-unit-label">(단위 : 원)</div>
    <table class="report-num-table">
      <tr>
        <th>구분</th><th>보상한도액</th><th>손해액</th><th>법률상<br>배상책임액</th><th>자기부담금</th><th>지급보험금</th>
      </tr>
      <tr>
        <td class="lbl">손해방지비용</td>
        <td>${r.coverage_limit ? Number(r.coverage_limit).toLocaleString() : '-'}</td>
        <td>${prevCost ? prevCost.toLocaleString() : '-'}</td>
        <td>${prevCost ? prevCost.toLocaleString() : '-'}</td>
        <td>-</td>
        <td>${prevCost ? prevCost.toLocaleString() : '-'}</td>
      </tr>
      <tr>
        <td class="lbl">대물배상</td>
        <td>${r.coverage_limit ? Number(r.coverage_limit).toLocaleString()+'원' : '-'}</td>
        <td>${rc ? rc.toLocaleString()+'원' : '-'}</td>
        <td>${rc ? rc.toLocaleString()+'원' : '-'}</td>
        <td>${money(ded)}</td>
        <td>${pay ? pay.toLocaleString()+'원' : '-'}</td>
      </tr>
      <tr class="total-row">
        <td class="lbl"><b>합계</b></td>
        <td><b>${r.coverage_limit ? Number(r.coverage_limit).toLocaleString()+'원' : '-'}</b></td>
        <td><b>${(rc+prevCost) ? (rc+prevCost).toLocaleString()+'원' : '-'}</b></td>
        <td><b>${(rc+prevCost) ? (rc+prevCost).toLocaleString()+'원' : '-'}</b></td>
        <td><b>${money(ded)}</b></td>
        <td><b>${(pay+prevCost) ? (pay+prevCost).toLocaleString()+'원' : '-'}</b></td>
      </tr>
    </table>
  </div>`;
}

// ─── 2. 보험계약사항 ────────────────────────────────────────
function renderReportSection2_Contract(cl, r) {
  const typeLabel = INS_TYPE_LABELS[cl.insurance_type] || '배상책임보험';
  const period = (r.policy_start && r.policy_end) ? `${fmtDate(r.policy_start)} ~ ${fmtDate(r.policy_end)}` : '';
  const accDt = cl.accident_datetime ? fmtDateTime(cl.accident_datetime) : (cl.accident_date ? fmtDate(cl.accident_date) : '');
  const insuredName = r.insured_name || cl.insured_name || '';
  const policyNo = r.policy_no || cl.policy_no || '';
  const policyAddr = r.policy_address_raw || '';
  const am = cl.address_match || r.address_match || 'ok';
  const amNote = am === 'ok' ? '일치' : (am === 'warn' ? '확인 필요' : '불일치');

  return `
  <div class="report-section page-break-after">
    <div class="report-section-title">2. 보험계약사항</div>
    <table class="report-three-col-table">
      <tr><th class="lbl">항목</th><th>계약사항</th><th>비고</th></tr>
      <tr><td class="lbl">보험종목</td><td>${typeLabel}</td><td></td></tr>
      <tr><td class="lbl">증권번호</td><td>${escapeHtml(policyNo)}</td><td></td></tr>
      <tr><td class="lbl">피보험자</td><td>${escapeHtml(insuredName)}</td><td></td></tr>
      <tr><td class="lbl">보험기간</td><td>${period}</td><td>${accDt && period ? '일치' : '확인'}</td></tr>
      <tr><td class="lbl">소재지</td><td>${escapeHtml(policyAddr)}</td><td>${amNote}</td></tr>
      <tr><td class="lbl">보상한도</td><td>${r.coverage_limit ? Number(r.coverage_limit).toLocaleString()+'원' : '-'}</td><td></td></tr>
      <tr><td class="lbl">자기부담금</td><td>${money(r.deductible || cl.deductible || 200000)}</td><td></td></tr>
      <tr><td class="lbl">특약조건</td><td>${typeLabel}</td><td></td></tr>
      <tr><td class="lbl">사고일자</td><td>${accDt}</td><td></td></tr>
      <tr><td class="lbl">기타사항</td><td></td><td></td></tr>
      <tr><td class="lbl">중복보험</td><td></td><td></td></tr>
    </table>
  </div>`;
}

// ─── 3. 일반사항 (가. 피보험자 개요 / 나. 피해자 개요) ──────
function renderReportSection3_General(r, cl, victims) {
  const insuredName = r.insured_name || cl.insured_name || '';
  const insuredResidence = r.insured_residence || r.policy_address_raw || '';
  const insuredOwner = r.insured_owner_name || '';
  const insuredCohab = r.insured_cohabitants || '';

  const victimBlocks = (victims || []).map((v, idx) => `
    <div class="report-subsection">
      <div class="report-subsection-title">나-${idx+1}. 피해자 개요 (피해자 ${idx+1})</div>
      <table class="report-kv-table">
        <tr><td class="lbl">성명</td><td>${escapeHtml(v.victim_name || '')}</td></tr>
        <tr><td class="lbl">소재지</td><td>${escapeHtml(v.victim_address || '')}</td></tr>
        <tr><td class="lbl">건물소유자</td><td>${escapeHtml(v.victim_owner_name || '')}</td></tr>
        <tr><td class="lbl">기타사항</td><td>${escapeHtml(v.victim_note || '')}</td></tr>
      </table>
    </div>`).join('');

  const victimSection = victimBlocks || `
    <div class="report-subsection">
      <div class="report-subsection-title">나. 피해자 개요</div>
      <div style="font-size:12px;color:var(--muted);padding:14px;text-align:center;border:1px dashed var(--line);border-radius:6px">
        피해자 정보가 등록되지 않았습니다. STEP 2 피해자 배열에서 추가해 주세요.
      </div>
    </div>`;

  return `
  <div class="report-section page-break-after">
    <div class="report-section-title">3. 일반사항</div>
    
    <div class="report-subsection">
      <div class="report-subsection-title">가. 피보험자 개요</div>
      <table class="report-kv-table">
        <tr><td class="lbl">성명</td><td>${escapeHtml(insuredName)}</td></tr>
        <tr><td class="lbl">소재지</td><td>${escapeHtml(insuredResidence)}</td></tr>
        <tr><td class="lbl">건물소유자</td><td>${escapeHtml(insuredOwner)}</td></tr>
        <tr><td class="lbl">동거인</td><td>${escapeHtml(insuredCohab)}</td></tr>
        <tr><td class="lbl">기타사항</td><td></td></tr>
      </table>
    </div>

    ${victimSection}
  </div>`;
}

// ─── 4. 사고사항 (+ 현장 사진 3단계) ────────────────────────
function renderReportSection4_Accident(cl, r, pa, photos) {
  const accDt = cl.accident_datetime ? fmtDateTime(cl.accident_datetime) : (cl.accident_date ? fmtDate(cl.accident_date) : '');
  const accLoc = r.accident_location_from_doc || pa.attacker_unit || cl.victim_address || '';
  const accCause = pa.leak_cause || cl.accident_cause_type || r.accident_cause_detail || '';
  const accDesc = r.accident_description || '';
  const leakArea = pa.leak_area_type ? `(${pa.leak_area_type})` : '';
  
  const partnerSummary = [];
  if (pa.attacker_unit)   partnerSummary.push(`가해세대: ${pa.attacker_unit}`);
  if (pa.victim_unit)     partnerSummary.push(`피해세대: ${pa.victim_unit}`);
  if (pa.leak_area_type)  partnerSummary.push(`누수부위: ${pa.leak_area_type}`);
  
  const investigatorOpinion = r.investigator_opinion || cl.liability_memo || '';

  const renderPhotoGroup = (label, arr) => {
    if (!arr || arr.length === 0) {
      return `<div class="report-photo-group">
        <div class="report-photo-label">${label}</div>
        <div class="report-photo-empty">사진 없음</div>
      </div>`;
    }
    return `<div class="report-photo-group">
      <div class="report-photo-label">${label} (${arr.length}장)</div>
      <div class="report-photo-grid">
        ${arr.map(p => `<img src="${p.url}" alt="${escapeHtml(p.name)}" class="report-photo">`).join('')}
      </div>
    </div>`;
  };

  return `
  <div class="report-section page-break-after">
    <div class="report-section-title">4. 사고사항</div>
    <table class="report-kv-table">
      <tr><td class="lbl">사고일시</td><td>${accDt}</td></tr>
      <tr><td class="lbl">사고장소</td><td>${escapeHtml(accLoc)}</td></tr>
      <tr><td class="lbl">사고원인</td><td>${escapeHtml(accCause)} ${leakArea}</td></tr>
      <tr><td class="lbl">사고경위</td><td>${escapeHtml(accDesc)}</td></tr>
      ${partnerSummary.length > 0 ? `<tr><td class="lbl">파트너 현장확인</td><td>${escapeHtml(partnerSummary.join(' / '))}</td></tr>` : ''}
      <tr><td class="lbl">조사자의견</td><td>${escapeHtml(investigatorOpinion)}</td></tr>
    </table>

    <div class="report-subsection" style="margin-top:16px">
      <div class="report-subsection-title">현장 사진 (수리 단계별)</div>
      ${renderPhotoGroup('① 수리 전', photos.before)}
      ${renderPhotoGroup('② 수리 중', photos.during)}
      ${renderPhotoGroup('③ 수리 후', photos.after)}
    </div>
  </div>`;
}

// ─── 5. 법률상 손해배상책임 검토 ────────────────────────────
function renderReportSection5_Liability(cl, r) {
  const est = r.liability_result || cl.liability_result || '';
  const estLabel = est === 'yes' ? '성립' : (est === 'no' ? '불성립' : '—');
  const cov = r.coverage_result || cl.coverage_result || '';
  const faultRatio = r.fault_ratio || cl.fault_ratio || '피보험자 100%';
  const liabReason = r.liability_reasoning || cl.liability_reasoning || '';
  const covReason  = r.coverage_reasoning  || cl.coverage_reasoning  || '';
  const applicableLaw = 
    liabReason.includes('758조') ? '민법 제758조' :
    liabReason.includes('750조') ? '민법 제750조' :
    liabReason.includes('667조') ? '민법 제667조' :
    liabReason.includes('공동주택관리법') ? '공동주택관리법 제63조' :
    '민법 제758조';

  return `
  <div class="report-section page-break-after">
    <div class="report-section-title">5. 법률상 손해배상책임 검토</div>

    <div class="report-subsection">
      <div class="report-subsection-title">가. 피보험자의 손해배상책임 검토</div>
      <table class="report-kv-table">
        <tr><td class="lbl">성립/불성립</td><td><b>${estLabel}</b></td></tr>
        <tr><td class="lbl">관련법규</td><td>${applicableLaw}</td></tr>
        <tr><td class="lbl">판단근거</td>
          <td><textarea class="report-editable report-editable-multi" id="rep-liab-reason" rows="4" 
            placeholder="법률상 배상책임 성립 여부의 근거">${escapeHtml(liabReason)}</textarea></td>
        </tr>
      </table>
    </div>

    <div class="report-subsection">
      <div class="report-subsection-title">나. 피보험자의 보험금 지급 책임 여부 검토</div>
      <table class="report-kv-table">
        <tr><td class="lbl">면/부책</td><td><b>${cov || '—'}</b></td></tr>
        <tr><td class="lbl">판단근거</td>
          <td><textarea class="report-editable report-editable-multi" id="rep-cov-reason" rows="4"
            placeholder="면·부책 판단근거">${escapeHtml(covReason)}</textarea></td>
        </tr>
      </table>
    </div>

    <div class="report-subsection">
      <div class="report-subsection-title">다. 피보험자 책임제한 / 피해자 과실</div>
      <table class="report-kv-table">
        <tr><td class="lbl">과실비율</td>
          <td><input class="report-editable-input" id="rep-fault" value="${escapeHtml(faultRatio)}" placeholder="예: 피보험자 책임 100% / 피해자 무과실"></td>
        </tr>
        <tr><td class="lbl">검토사항</td>
          <td><textarea class="report-editable report-editable-multi" id="rep-fault-note" rows="4"
            placeholder="과실비율 검토 사항">${escapeHtml(cl.fault_ratio_note || (cov === '부책' ? '금번 사고의 제반정황, 당사 현장조사 등을 종합적으로 검토한 바, 피보험자 세대에서 발생한 누수사고에 대하여 피해세대의 과실을 인정할만한 사유가 없으며, 사전에 예측하고 대비하기는 어려웠을 것으로 여겨지므로 피해자 측의 과실을 묻기는 어려울 것으로 사료됨.' : '면책 사유에 해당되어 검토하지 않음'))}</textarea></td>
        </tr>
      </table>
    </div>

    <div class="report-subsection">
      <div class="report-subsection-title">라. 손해방지비용 검토</div>
      <table class="report-kv-table">
        <tr><td class="lbl">담보여부</td><td><b>${cov === '부책' ? '검토 대상' : '면책'}</b></td></tr>
        <tr><td class="lbl">검토사항</td>
          <td><textarea class="report-editable report-editable-multi" id="rep-prev-memo" rows="4"
            placeholder="손해방지비용 검토">${escapeHtml(cl.prevention_cost_memo || (cov === '부책' ? '상법 제680조 제1항에 따라 규정한 손해방지비용 및 대법원 판례 및 금융분쟁조정위원회 의견에 의거 손해확대 또는 방지를 위해 필요 또는 유익한 비용에 해당하는 누수탐지 및 손해방지를 위해 노력한 공사 비용을 지급처리하는 것이 타당할 것으로 판단됨.' : '면책 사유에 해당되어 검토하지 않음'))}</textarea></td>
        </tr>
      </table>
    </div>
  </div>`;
}

// ─── 6. 손해액평가 (v6.0.2: 양식 표준 6컬럼 표) ─────────────
//   컬럼: 구분 | 보상한도액 | 손해액 | 법률상 배상책임액 | 자기부담금 | 지급보험금
//   행: 손해방지비용 / 대물배상 / 합계
function renderReportSection6_Damage(rc, ded, pay) {
  const cl = _insClaim || {};
  const r  = _insResult || {};
  const prevCost = cl.damage_prevention_cost || 0;
  const damageAmt = cl.damage_amount || rc;
  const limit = r.coverage_limit || cl.coverage_limit || 0;

  // 부책 시 법률상 배상책임액 = 손해액, 면책 시 0
  const covYes = (r.coverage_result || cl.coverage_result) === '부책';
  const liabAmt = covYes ? damageAmt : 0;

  // 합계
  const totalDamage = (prevCost || 0) + (damageAmt || 0);
  const totalLiab   = covYes ? totalDamage : 0;
  const totalPay    = (prevCost || 0) + (covYes ? Math.max(0, damageAmt - ded) : 0);

  const cell = (v) => v && v > 0 ? Number(v).toLocaleString() : '-';

  return `
  <div class="report-section page-break-after">
    <div class="report-section-title">6. 손해액평가</div>
    <div class="report-unit-label">(단위: 원)</div>
    <table class="report-num-table">
      <thead>
        <tr>
          <th style="width:18%">구분</th>
          <th>보상한도액</th>
          <th>손해액</th>
          <th>법률상<br>배상책임액</th>
          <th>자기부담금</th>
          <th>지급보험금</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="lbl">손해방지비용</td>
          <td>${cell(limit)}</td>
          <td><input class="report-editable-input" id="rep-prev-cost" value="${prevCost || ''}" placeholder="-" style="text-align:right"></td>
          <td>${cell(prevCost)}</td>
          <td>-</td>
          <td>${cell(prevCost)}</td>
        </tr>
        <tr>
          <td class="lbl">대물배상</td>
          <td>${cell(limit)}</td>
          <td><input class="report-editable-input" id="rep-damage-amt" value="${damageAmt || ''}" placeholder="-" style="text-align:right"></td>
          <td>${cell(liabAmt)}</td>
          <td>${cell(ded)}</td>
          <td>${cell(covYes ? Math.max(0, damageAmt - ded) : 0)}</td>
        </tr>
        <tr style="font-weight:700;background:#fafaf7">
          <td class="lbl">합계</td>
          <td>${cell(limit)}</td>
          <td>${cell(totalDamage)}</td>
          <td>${cell(totalLiab)}</td>
          <td>${cell(ded)}</td>
          <td>${cell(totalPay)}</td>
        </tr>
      </tbody>
    </table>
    ${cl.damage_memo ? `
      <div style="margin-top:8px;font-size:11px;color:#555;padding:8px 10px;background:#fafaf7;border-left:2px solid var(--line);border-radius:0 3px 3px 0">
        ${escapeHtml(cl.damage_memo)}
      </div>` : ''}
  </div>`;
}

// ─── 7. 첨부자료 목록 (v6.0.2: 잔존물/구상/검토요청 섹션 제거됨) ─────
//
// 양식 기본값 7개를 항상 표시하고, 실제 업로드된 파일이 있으면 추가로 나열
// 양식대로 "보험증권, 보험청구서, 누수소견서, 가/피해자 자료, 위임장, 선임권동의서" 7항목 고정
function renderReportSection7_Attachments() {
  // 양식 기본 7개 항목
  const defaultRows = [
    '보험증권',
    '보험청구서',
    '누수소견서',
    '가/피해자 자료 일체',
    '위임장',
    '선임권동의서',
    '..',
  ];

  // 실제 업로드된 파일 (참고용 — 양식 아래 별도 섹션으로 노출하거나 양식에 매핑)
  const uploadedDocs = Object.values(_insUploaded || {})
    .filter(u => u?.doc_code
      && u.doc_code !== 'repair_photo_before'
      && u.doc_code !== 'repair_photo_during'
      && u.doc_code !== 'repair_photo_after')
    .sort((a, b) => (a.uploaded_at || '').localeCompare(b.uploaded_at || ''));

  const rows = defaultRows.map((label, i) => `
    <tr>
      <td style="text-align:center;width:80px">${i+1}</td>
      <td>${escapeHtml(label)}</td>
    </tr>`).join('');

  return `
  <div class="report-section">
    <div class="report-section-title">7. 첨부자료 목록</div>
    <table class="report-three-col-table">
      <thead>
        <tr><th style="width:80px">순번</th><th>첨부자료</th></tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    ${uploadedDocs.length > 0 ? `
      <div style="margin-top:8px;font-size:10px;color:var(--muted);padding:6px 8px;background:var(--bg);border-radius:3px">
        * 실제 업로드된 파일: ${uploadedDocs.length}건 (${uploadedDocs.map(d => escapeHtml(d.doc_name || d.doc_code)).join(', ')})
      </div>` : ''}
  </div>`;
}

// ─── 푸터 ─────────────────────────────────────────────────
function renderReportFooter(co) {
  return `
  <div class="report-footer">
    <p style="text-align:center;font-size:11px;line-height:1.8;margin-top:24px;padding:14px;border-top:1px solid var(--line);color:#555">
      ※ 본 손해사정서는 당사의 양식과 최선의 노력으로 어느 일방에도 편견 없이<br>
      작성하였음을 명백히 합니다. <b style="font-size:12px;color:#1a1a1a">- 끝 -</b>
    </p>
  </div>`;
}

// ════════════════════════════════════════════════════════════════
// v6.1.4: 보고서 데이터 빌더
// 운영 데이터를 report-template-v2.html의 D 객체 스키마로 변환
// (cl=claim, r=result, co=company, partners, victims, photos)
// ════════════════════════════════════════════════════════════════
function buildReportData(cl, r, co, partners, victims, photos, handler) {
  cl = cl || {};
  r = r || {};
  co = co || {};
  partners = partners || [];
  victims = victims || [];
  photos = photos || { before: [], during: [], after: [] };
  handler = handler || {};

  // 마무리 시점 데이터
  const todayStr = new Date().toISOString().slice(0,10).replace(/-/g,'.');
  const accDate = (r.accident_datetime || cl.accident_at || '').slice(0,10).replace(/-/g,'.');
  const accDateLong = accDate ? accDate.replace(/(\d{4})\.(\d{2})\.(\d{2})/, '$1년 $2월 $3일') : '';

  // 증권번호 마스킹 (앞 5자리 + **** + 뒤 3자리)
  const policyNoMasked = (() => {
    const p = r.policy_no || '';
    if (!p) return '';
    if (p.length < 8) return p;
    return p.slice(0,5) + '****' + p.slice(-3);
  })();

  // 동거인 (배열 → 표시 문자열)
  const cohabsRaw = r.cohabitants || r.insured_cohabitants || [];
  const cohabsStr = Array.isArray(cohabsRaw)
    ? cohabsRaw.map(c => typeof c === 'string' ? c : (c.name + (c.relation ? `(${c.relation})` : ''))).join(', ')
    : (cohabsRaw || '-');

  // 첨부자료 기본값
  const defaultAttachments = ['보험증권', '보험청구서', '누수소견서', '가/피해자 자료 일체', '위임장', '선임권동의서', '..'];

  return {
    coverNo: r.report_no || `NP-${(cl.case_no || '0000000').replace(/[^0-9]/g,'').slice(-7) || '0000000'}`,
    coverDate: todayStr.replace(/(\d{4})\.(\d{2})\.(\d{2})/, '$1년 $2월 $3일'),
    insuredName: r.insured_name || cl.insured_name || '-',
    accDate: accDateLong || '-',
    accAddr: r.accident_address || cl.accident_address || '-',
    policyNoMasked: policyNoMasked,
    // v6.1.4: 손해사정사 (회사 정보 — companies.chief_officer_*) — 모든 보고서 고정
    chiefOfficer: co.chief_officer_name || co.adjuster_name || 'OOO',
    chiefOfficerCert: co.chief_officer_license_no || co.adjuster_license_no || '000000000',
    chiefOfficerStampPath: co.chief_officer_stamp_path || '',
    // v6.1.4: 담당자 (본인 정보 — admin_users 현재 로그인) — 보고서마다 다름
    handlerName: handler.name || co.investigator_name || '서재성',
    handlerHp: handler.phone || co.phone || '010-0000-0000',
    handlerEmail: handler.personal_email || handler.email || co.company_email || co.email || 'nusupass.cs@gmail.com',
    handlerPosition: handler.position || '',
    company: co.company_name_ko || co.company_name || '누수패스손해사정㈜',
    ceo: co.ceo_name || co.representative || 'OOO',
    summary: {
      limitProperty: (r.coverage_limit || r.limit_property || 0).toLocaleString(),
      damage: '-', liable: '-', deduct: '-', payout: '-'
    },
    payment: {
      lossAmt: '0,000,000',
      agreeAmt: '0,000,000',
      deductAmt: '0,000,000',
      finalAmt: '0,000,000',
      bank: '00', acct: '', holder: 'OOO',
      jumin: '000000-0******', deductFee: '₩', relation: '피해자'
    },
    contract: [
      { label: '보험종목',   value: r.policy_product || '-', note: '' },
      { label: '증권번호',   value: policyNoMasked || (r.policy_no || '-'), note: '' },
      { label: '피보험자',   value: r.insured_name || '-', note: '' },
      { label: '보험기간',   value: r.policy_period || '-', note: '' },
      { label: '소재지',     value: r.policy_address || '-', note: r.policy_address && r.accident_address && r.policy_address !== r.accident_address ? '사고장소와 불일치' : '' },
      { label: '사고장소',   value: r.accident_address || '-', note: r.policy_address && r.accident_address && r.policy_address !== r.accident_address ? '증권주소지와 불일치' : '' },
      { label: '보상한도',   value: r.coverage_limit ? `₩${Number(r.coverage_limit).toLocaleString()}` : '-', note: '' },
      { label: '자기부담금', value: r.deductible ? `₩${Number(r.deductible).toLocaleString()}` : '-', note: '대물사고시' },
      { label: '특약조건',   value: r.policy_type === 'GUHYUNG' ? '가족일상생활배상책임(구형)' : r.policy_type === 'SHINHYUNG' ? '가족일상생활배상책임(신형)' : r.policy_type === 'ILBAECHEK' ? '일상생활배상책임' : '-', note: '' },
      { label: '사고일자',   value: accDate || '-', note: '' },
      { label: '중복보험',   value: r.duplicate_check || '확인필요', note: '' },
    ],
    insuredInfo: [
      { label: '성명',             value: r.insured_name || '-' },
      { label: '주민번호',         value: r.insured_jumin || '-' },
      { label: '연락처',           value: r.insured_phone || '-' },
      { label: '주민등록등본\n소재지', value: r.insured_address || '-' },
      { label: '동거인',           value: cohabsStr || '-' },
      { label: '건물소유자',       value: r.building_owner || '-' },
      { label: '피보험자지위',     value: r.insured_status || '-' },
    ],
    victims: (victims.length ? victims : [{ victim_name:'', victim_jumin:'', victim_phone:'', victim_address:'', victim_owner:'', victim_note:'' }]).map(v => ({
      info: [
        { label: '성명',       value: v.victim_name || '-' },
        { label: '주민번호',   value: v.victim_jumin || '-' },
        { label: '연락처',     value: v.victim_phone || '-' },
        { label: '소재지',     value: v.victim_address || '-' },
        { label: '건물소유자', value: v.victim_owner || '-' },
        { label: '기타사항',   value: v.victim_note || v.damage_status || '-' },
      ]
    })),
    accident: {
      date: accDate || '-',
      addr: r.accident_address || cl.accident_address || '-',
      cause: r.leak_cause || '-',
      desc: r.accident_summary || r.investigator_opinion || '-',
      photos: {
        before: (photos.before || []).slice(0, 2).map(p => ({ url: p.url || '' })),
        during: (photos.during || []).slice(0, 2).map(p => ({ url: p.url || '' })),
        after:  (photos.after  || []).slice(0, 2).map(p => ({ url: p.url || '' })),
      }
    },
    liability: {
      establish: r.liability_decision || '-',
      lawCite: r.law_cite || '민법 제750조 (일반 불법행위 책임) 및 제758조 (공작물 책임)',
      lawReason: r.liability_reason || '-',
      coverDecision: r.cover_decision || '-',
      coverReason: r.cover_reason || '-',
      faultRatio: r.fault_ratio || '0%',
      faultReview: r.fault_review || '-',
      mitigation: r.mitigation_decision || '-',
      mitigationReview: r.mitigation_review || '-'
    },
    attachments: r.attachments && r.attachments.length ? r.attachments : defaultAttachments
  };
}
window.buildReportData = buildReportData;

// ─── HTML escape (XSS 방지) ────────────────────────────────
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── 편집 저장 ─────────────────────────────────────────────
async function s3SaveReport() {
  const g = (id) => document.getElementById(id)?.value?.trim() || null;
  try {
    // report_no 없으면 채번
    let reportNo = _insClaim.report_no;
    if (!reportNo) {
      const { data: no, error: rpcErr } = await sb.rpc('rpc_next_report_no');
      if (!rpcErr && no) reportNo = no;
    }
    
    // v6.0.2: 검토요청사항/향후진행방안 섹션 제거됨 — 해당 필드 업데이트 안 함
    //         (DB 컬럼은 유지되므로 기존 값은 보존됨)
    // v6.0.2: Section 6 손해액평가에서 손해방지비용/손해액 입력 추가
    const repPrevCost = parseInt((g('rep-prev-cost')||'').replace(/[^0-9]/g,'')) || null;
    const repDamageAmt = parseInt((g('rep-damage-amt')||'').replace(/[^0-9]/g,'')) || null;

    const updates = {
      // v6.1.1: 보험사명/담당자 입력은 출력 헤더의 rep-recipient/rep-cc로 통합됨 — DB 컬럼은 호환 유지
      insurer_name:         g('rep-recipient') || _insClaim.insurer_name,    // 호환: 보험사명 = 수신자
      insurer_contact:      g('rep-cc')        || _insClaim.insurer_contact, // 호환: 담당자 = 참조
      report_recipient:     g('rep-recipient'),
      report_cc:            g('rep-cc'),       // v6.1.1
      report_title:         g('rep-title'),    // v6.1.1
      accident_cause_type:  g('rep-cause'),  // v6: 사고원인은 보고서 본문 select에서 입력
      report_no:            reportNo,
      submit_date:          new Date().toISOString().split('T')[0],
      liability_reasoning:  g('rep-liab-reason'),
      coverage_reasoning:   g('rep-cov-reason'),
      fault_ratio:          g('rep-fault'),
      fault_ratio_note:     g('rep-fault-note'),
      prevention_cost_memo: g('rep-prev-memo'),
      damage_prevention_cost: repPrevCost,
      damage_amount:        repDamageAmt,
      updated_at:           new Date().toISOString(),
    };
    const { error } = await sb.from('insurance_claims').update(updates).eq('id', _insClaim.id);
    if (error) throw error;
    
    _insClaim = { ..._insClaim, ...updates };
    _insResult.liability_reasoning = updates.liability_reasoning;
    _insResult.coverage_reasoning  = updates.coverage_reasoning;
    _insResult.fault_ratio         = updates.fault_ratio;
    
    toast('보고서가 저장되었습니다.' + (reportNo ? ` (No: ${reportNo})` : ''), 's');
    insRender();
  } catch (err) {
    console.error('[s3] 저장 실패:', err);
    toast('저장 실패: ' + (err.message || err), 'e');
  }
}

// ─── PDF 인쇄 (window.print + @media print) ───────────────
async function s3ExportPdf() {
  // v6.1.6: 디버깅용 콘솔 로그 — 어떤 분기를 타는지 즉시 확인 가능
  console.log('[v6.1.6 PDF 다운로드] _currentReportTab =', _currentReportTab);

  if (_currentReportTab === 'leak') {
    // 누수소견서 탭 → window.print() + body 클래스로 누수소견서만 인쇄되게
    console.log('[v6.1.6 PDF 다운로드] → 누수소견서 인쇄 분기 (printing-leak)');
    document.body.classList.add('printing-leak');
    try {
      window.print();
    } finally {
      setTimeout(() => document.body.classList.remove('printing-leak'), 500);
    }
    return;
  }

  // 손해사정서 탭 → iframe 안 보고서 인쇄
  console.log('[v6.1.6 PDF 다운로드] → 손해사정서 iframe 인쇄 분기');
  const iframe = document.getElementById('reportFrame');
  if (!iframe) {
    // 폴백: 기존 방식 (iframe 없는 환경)
    console.warn('[v6.1.6 PDF 다운로드] iframe 없음, 폴백 모드');
    document.body.classList.add('printing-report');
    try { window.print(); }
    finally { setTimeout(() => document.body.classList.remove('printing-report'), 500); }
    return;
  }
  try {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
  } catch (e) {
    console.warn('iframe print failed, fallback to window.print()', e);
    window.print();
  }
}

// v6.1.4: 현재 케이스의 데이터를 iframe(report-template-v2.html)에 주입
function s3InjectReportData() {
  const iframe = document.getElementById('reportFrame');
  if (!iframe || !iframe.contentWindow) return;
  // 현재 보고서 데이터를 _insCurrentReportData에 모아두면 iframe에 postMessage
  if (typeof _insCurrentReportData !== 'undefined' && _insCurrentReportData) {
    try {
      iframe.contentWindow.postMessage({
        type: 'setCase',
        data: _insCurrentReportData
      }, '*');
    } catch (e) {
      console.warn('s3InjectReportData postMessage failed', e);
    }
  }
}

// v6.1.4: 수신/참조/제목 변경 시 iframe URL 갱신 (양식에 즉시 반영)
function s3UpdateReportField(field, value) {
  const iframe = document.getElementById('reportFrame');
  if (!iframe) return;
  if (field === 'recipient') _reportRecipient = value || '';
  if (field === 'dept') _reportDept = value || '';
  // URL 파라미터 갱신해서 iframe 재로딩 (postMessage로도 가능하나 URL이 양식과 단방향 결합되어 있어 URL 갱신이 가장 확실)
  try {
    const url = new URL(iframe.src, location.href);
    if (field === 'recipient') url.searchParams.set('recipient', value || '');
    if (field === 'dept') url.searchParams.set('dept', value || '');
    if (field === 'title') url.searchParams.set('title', value || '');
    // src를 변경하지 않고도 postMessage로 빠른 갱신
    if (iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        type: 'setHeader',
        data: { recipient: _reportRecipient, dept: _reportDept, title: field === 'title' ? value : undefined }
      }, '*');
    }
  } catch (e) {
    console.warn('s3UpdateReportField failed', e);
  }
}
window.s3ExportPdf = s3ExportPdf;
window.s3SwitchTab = s3SwitchTab;
window.s3InjectReportData = s3InjectReportData;
window.s3UpdateReportField = s3UpdateReportField;
