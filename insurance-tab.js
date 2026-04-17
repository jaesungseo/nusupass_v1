// v2026-04-17-v5.3.1 — 결정론적 지위 판정기 + Sabi 룰 엔진 후처리
/**
 * insurance-tab.js  v5.3.1
 * 누수패스 보험자료 탭
 *
 * 의존성: sb, toast(), curUser (index.html)
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
const INS_PROMPT_VER = 'v5.3.1';
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

const INS_DOCS = [
  { code:'insurance_policy',   name:'보험증권',                                               type:'pdf', required:true  },
  { code:'resident_reg',       name:'피보험자 주민등록등본',                                  type:'pdf', required:true  },
  { code:'ownership_accident', name:'사고발생장소 소유자료 (등기부등본 또는 건축물대장)',     type:'pdf', required:true  },
  { code:'ownership_victim',   name:'피해세대 소유자료 (등기부등본 또는 건축물대장)',         type:'pdf', required:true  },
  { code:'family_cert',        name:'가족관계증명서',                                         type:'pdf', required:false },
  { code:'claim_form',         name:'보험청구서',                                             type:'pdf', required:false },
];

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
let _insField    = null;   // 파트너 수리 자료
let _insCompany  = null;   // company_settings
let _insUploaded = {};     // { doc_code: { id, file_path, doc_name } }
let _insStep     = 1;
let _insResult   = {};     // Claude 추출 + 판단 결과 (STEP 2)
let _insDraft    = null;   // 저장된 초안
let _insAnalyzing = false;

// ─────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────
async function openInsuranceTab(caseId, caseNo) {
  _insClaim = null; _insCaseId = caseId; _insField = null;
  _insCompany = null; _insUploaded = {}; _insStep = 1;
  _insResult = {}; _insDraft = null; _insAnalyzing = false;

  go('insurance');
  document.getElementById('insurancePageSub').textContent = `사건 ${caseNo || caseId.slice(0,8)}`;
  document.getElementById('insuranceTabBody').innerHTML =
    `<div class="loading"><span class="spinner"></span> 불러오는 중…</div>`;

  try {
    const [claim, field, company] = await Promise.all([
      insEnsureClaim(caseId),
      insFetchField(caseId),
      insFetchCompany(),
    ]);
    _insClaim = claim; _insField = field; _insCompany = company;

    const uploads = await insFetchUploads(claim.id);
    uploads.forEach(u => { _insUploaded[u.doc_code] = u; });

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
  } catch(e) {
    document.getElementById('insuranceTabBody').innerHTML =
      `<div class="card" style="color:var(--red)">오류: ${e.message}</div>`;
  }
}

async function loadInsuranceCaseSelector() {
  const sel = document.getElementById('insuranceCaseSelect');
  if (!sel) return;
  const { data } = await sb.from('partner_assignments')
    .select('case_id, intake_cases(case_no, customer_name)')
    .in('work_status', ['repair_done','repair_completed'])
    .eq('assignment_status', 'accepted')
    .order('created_at', { ascending: false });
  sel.innerHTML = '<option value="">— 사건 선택 —</option>' +
    (data||[]).map(a =>
      `<option value="${a.case_id}">${a.intake_cases?.case_no||'-'} · ${a.intake_cases?.customer_name||'-'}</option>`
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
async function insFetchUploads(claimId) {
  const { data } = await sb.from('insurance_doc_uploads')
    .select('id,doc_code,doc_name,file_path,uploaded_at')
    .eq('claim_id', claimId).eq('is_latest', true);
  return data || [];
}
async function insFetchCompany() {
  const { data } = await sb.from('company_settings').select('*').eq('id',1).maybeSingle();
  return data;
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

function insGoStep(n) { _insStep = n; insRender(); }

// ─────────────────────────────────────────────
// STEP 1: 준비 (기본정보 + 약관구분 + 서류업로드)
// ─────────────────────────────────────────────
function insStep1HTML() {
  const cl = _insClaim || {};
  const co = _insCompany || {};
  const fd = _insField;
  const today = new Date().toISOString().split('T')[0];
  const reqDone = INS_DOCS.filter(d => d.required && _insUploaded[d.code]).length;
  const reqTotal = INS_DOCS.filter(d => d.required).length;
  const allReq = reqDone >= reqTotal;

  const insurerOpts = INS_INSURERS
    .map(n => `<option ${cl.insurer_name===n?'selected':''}>${n}</option>`)
    .join('') + `<option value="기타">기타 (직접 입력)</option>`;

  const causeOpts = INS_CAUSES
    .map(c => `<option value="${c}" ${(cl.accident_cause_type||'')===c?'selected':''}>${c}</option>`)
    .join('');

  const docsHTML = INS_DOCS.map(doc => {
    const up = _insUploaded[doc.code];
    const done = !!up;
    return `
    <div class="ins-dz ${done?'ins-dz-done':''}" id="ins-dz-${doc.code}"
         ondragover="event.preventDefault();this.classList.add('ins-dz-over')"
         ondragleave="this.classList.remove('ins-dz-over')"
         ondrop="insDrop(event,'${doc.code}','${doc.name}')"
         onclick="insTrigger('${doc.code}','${doc.name}')">
      <div class="ins-dz-progress" id="ins-dp-${doc.code}"></div>
      <div class="ins-dz-icon">${done?'✅':(doc.type==='pdf'?'📄':'🖼')}</div>
      <div class="ins-dz-name">${doc.name}</div>
      <div class="ins-dz-sub">${done?(up.doc_name||'완료'):'클릭 또는 드래그'}</div>
      <div class="ins-dz-badge ${doc.required?'ins-badge-req':'ins-badge-opt'}">${done?'완료':(doc.required?'필수':'선택')}</div>
    </div>`;
  }).join('');

  const fieldHTML = fd
    ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
        <div class="detail-item"><label>수리금액</label><span>${fd.repair_cost?Number(fd.repair_cost).toLocaleString()+'원':'—'}</span></div>
        <div class="detail-item"><label>수리완료일</label><span>${(fd.work_done_at||'').slice(0,10)||'—'}</span></div>
        <div class="detail-item" style="grid-column:1/-1"><label>수리소견</label><span>${fd.repair_opinion||'—'}</span></div>
       </div>`
    : `<div class="empty" style="padding:12px"><div class="empty-text">파트너가 수리완료 보고서를 아직 제출하지 않았습니다</div></div>`;

  return `
  <!-- ── 섹션 A: 기본 정보 ── -->
  <div class="card">
    <div style="font-size:14px;font-weight:900;margin-bottom:14px">📋 보고서 기본 정보</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label class="form-label">보고서 번호</label>
        <input class="form-control" id="s1-no" value="${cl.report_no||''}" placeholder="저장 시 자동채번" readonly
          style="background:var(--bg);color:var(--muted)"/>
      </div>
      <div class="form-group">
        <label class="form-label">제출일자 *</label>
        <input class="form-control" type="date" id="s1-date" value="${cl.submit_date||today}"/>
      </div>
      <div class="form-group">
        <label class="form-label">수신 보험사 *</label>
        <select class="form-control" id="s1-insurer" onchange="s1InsurerChange(this.value)">
          <option value="">— 선택 —</option>${insurerOpts}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">참조 (담당팀/담당자)</label>
        <input class="form-control" id="s1-contact" value="${cl.insurer_contact||''}" placeholder="예: 일반보험팀 OOO 과장"/>
      </div>
    </div>
    <div id="s1-insurer-custom-wrap" style="display:none;margin-top:-6px;margin-bottom:12px">
      <label class="form-label">보험사명 직접 입력</label>
      <input class="form-control" id="s1-insurer-custom" placeholder="보험사명 입력"/>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label class="form-label">사고원인 분류 *</label>
        <select class="form-control" id="s1-cause" onchange="s1CauseChange(this.value)">
          ${causeOpts}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">조사자</label>
        <input class="form-control" id="s1-investigator" value="${co.investigator_name||co.adjuster_name||'서재성'}"/>
      </div>
    </div>
    <div id="s1-cause-custom-wrap" style="display:none;margin-top:-6px">
      <label class="form-label">사고원인 직접 입력</label>
      <input class="form-control" id="s1-cause-custom" placeholder="사고원인 입력"/>
    </div>
  </div>

  <!-- ── 섹션 B: 약관 구분 선택 (3종 — 핵심!) ── -->
  <div class="card">
    <div style="font-size:14px;font-weight:900;margin-bottom:6px">📌 약관 구분 선택</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px">
      서류 분석 전에 선택하면 Claude가 해당 약관 기준으로 판단합니다
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      ${[
        ['family_daily_old','가족일상생활 (구형)','가족 단위 · 제3자 배상','구형 — 임대인 케이스 면책'],
        ['family_daily_new','가족일상생활 (신형)','가족 단위 · 임대 주택 포함','신형 — 임대인 케이스 부책 가능'],
        ['personal_daily',  '일상생활 (일배책)',  '본인+배우자 한정','일배책 — 구형과 동일 로직, 범위만 축소'],
      ].map(([val, name, desc, note]) => {
        const sel = (cl.insurance_type||'family_daily_old') === val;
        return `<div class="ins-type-card ${sel?'ins-type-selected':''}" onclick="s1SelectType('${val}',this)">
          <input type="radio" name="ins-type" value="${val}" ${sel?'checked':''} style="display:none">
          <div style="font-size:13px;font-weight:700;margin-bottom:4px">${name}</div>
          <div style="font-size:12px;color:${sel?'#1d4ed8':'var(--muted)'}">${desc}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:3px">${note}</div>
        </div>`;
      }).join('')}
    </div>
    <div style="margin-top:10px;padding:8px 12px;background:var(--bg);border-radius:6px;font-size:11px;color:var(--muted);border-left:3px solid var(--line)">
      💡 시설소유(관리)자배상책임 · 급배수누출손해는 추후 지원 예정입니다.
    </div>
  </div>

  <!-- ── 섹션 C: 서류 업로드 ── -->
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-size:14px;font-weight:900">📎 서류 업로드</div>
      <div style="font-size:12px;color:var(--muted)">${reqDone}/${reqTotal} 필수 완료</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px" id="ins-doc-grid">
      ${docsHTML}
    </div>
    ${allReq
      ? `<div class="ins-banner ins-banner-success" style="margin-top:12px">✓ 필수 서류 ${reqTotal}건 모두 업로드 완료</div>`
      : `<div class="ins-banner ins-banner-warn" style="margin-top:12px">⚠ 필수 서류 ${reqTotal-reqDone}건 미업로드 — 분석 전에 모두 업로드해 주세요</div>`}
  </div>

  <!-- ── 섹션 D: 파트너 수리 자료 ── -->
  <div class="card">
    <div style="font-size:14px;font-weight:900;margin-bottom:4px">🔧 파트너 수리 자료 (자동 연동)</div>
    ${fieldHTML}
  </div>

  <div class="ins-action-bar">
    <span></span>
    <button class="btn btn-primary" onclick="s1Save()">
      저장 후 분석·판단 →
    </button>
  </div>`;
}

function s1InsurerChange(v) {
  document.getElementById('s1-insurer-custom-wrap').style.display = v==='기타'?'block':'none';
}
function s1CauseChange(v) {
  document.getElementById('s1-cause-custom-wrap').style.display = v==='기타(직접입력)'?'block':'none';
}
function s1SelectType(val, el) {
  document.querySelectorAll('.ins-type-card').forEach(c => c.classList.remove('ins-type-selected'));
  el.classList.add('ins-type-selected');
  el.querySelector('input[type=radio]').checked = true;
  _insClaim = { ..._insClaim, insurance_type: val };
}

async function s1Save() {
  let insurer = document.getElementById('s1-insurer').value;
  if (insurer === '기타') insurer = document.getElementById('s1-insurer-custom')?.value?.trim()||'';
  if (!insurer) { toast('보험사를 선택해 주세요.', 'e'); return; }

  const insType = document.querySelector('input[name="ins-type"]:checked')?.value || 'family_daily_old';
  let cause = document.getElementById('s1-cause').value;
  if (cause === '기타(직접입력)') cause = document.getElementById('s1-cause-custom')?.value?.trim()||'기타';

  try {
    const { data, error } = await sb.rpc('rpc_start_insurance_report', {
      p_claim_id:        _insClaim.id,
      p_insurer_name:    insurer,
      p_insurer_contact: document.getElementById('s1-contact').value||null,
      p_cause_type:      cause,
      p_investigator:    document.getElementById('s1-investigator').value,
      p_submit_date:     document.getElementById('s1-date').value,
    });
    if (error) throw error;

    // 약관 구분 저장
    const { error: upErr } = await sb.from('insurance_claims')
      .update({ insurance_type: insType })
      .eq('id', _insClaim.id);
    if (upErr) throw new Error('약관 구분 저장 실패: ' + upErr.message);

    _insClaim = { ..._insClaim, report_no: data?.report_no, insurer_name: insurer,
      insurance_type: insType, insurance_tab_status: 'docs_pending' };
    toast('저장 완료! 서류 분석을 시작합니다.', 's');
    _insStep = 2; insRender();
    // 저장 직후 자동으로 Claude 분석 시작
    setTimeout(() => s2Analyze(), 400);
  } catch(e) { toast('저장 실패: ' + e.message, 'e'); }
}

// ─────────────────────────────────────────────
// STEP 1: 드롭존
// ─────────────────────────────────────────────
function insInitDropzones() { /* HTML onclick으로 처리 */ }

function insTrigger(code, name) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.pdf,.jpg,.jpeg,.png,.heic';
  inp.onchange = e => { if(e.target.files[0]) insUpload(e.target.files[0], code, name); };
  inp.click();
}
function insDrop(e, code, name) {
  e.preventDefault();
  document.getElementById(`ins-dz-${code}`)?.classList.remove('ins-dz-over');
  if(e.dataTransfer.files[0]) insUpload(e.dataTransfer.files[0], code, name);
}

async function insUpload(file, code, name) {
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
    // v5 수정: update 에러 체크 추가
    const { error: updErr } = await sb.from('insurance_doc_uploads')
      .update({is_latest:false})
      .eq('claim_id',_insClaim.id).eq('doc_code',code).eq('is_latest',true);
    if (updErr) throw new Error('기존 파일 상태 업데이트 실패: ' + updErr.message);

    const ext = file.name.split('.').pop().toLowerCase();
    const safeExt = ['pdf','jpg','jpeg','png','webp','heic'].includes(ext)?ext:'pdf';
    const path = `${_insClaim.id}/${code}/${Date.now()}.${safeExt}`;

    const { error: upErr } = await sb.storage.from('insurance-docs')
      .upload(path, file, {cacheControl:'3600',upsert:true});
    if (upErr) throw new Error('Storage: '+upErr.message);

    // v5.2 수정: 피해자 서류는 doc_category='victim' (ownership_victim 반영)
    const docCategory = code === 'ownership_victim' ? 'victim' : 'insured';

    const { data: row, error: dbErr } = await sb.from('insurance_doc_uploads').insert({
      claim_id: _insClaim.id, doc_code: code, doc_name: file.name,
      doc_category: docCategory, file_path: path, file_kind:'original',
      source_type:'admin', is_latest:true,
    }).select('id,doc_code,doc_name,file_path,uploaded_at').single();
    if (dbErr) throw new Error('DB: '+dbErr.message);

    _insUploaded[code] = row;
    clearInterval(t);
    if (prog) { prog.style.width='100%'; setTimeout(()=>{prog.style.display='none';prog.style.width='0%';},400); }
    if (zone) zone.style.opacity='1';
    toast(name+' 업로드 완료', 's');
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
  const cl = _insClaim || {};
  const fd = _insField;
  const r  = _insResult;
  const rc  = fd?.repair_cost || 0;
  const ded = r.deductible || cl.deductible || 200000;
  const pay = Math.max(0, rc - ded);

  const addrMatch = r.address_match || 'ok';
  const addrColor = addrMatch==='ok'?'var(--green)':addrMatch==='warn'?'var(--amber)':'var(--red)';
  const addrBg    = addrMatch==='ok'?'var(--green-soft)':addrMatch==='warn'?'var(--amber-soft)':'var(--red-soft)';

  const established = r.liability_result || 'yes';      // yes | no (성립/불성립)
  const coverage    = r.coverage_result || '부책';       // 부책 | 면책 | 판단유보

  const estStyle = established==='yes'
    ? 'background:#dcfce7;color:#15803d;border-color:#15803d'
    : 'background:#fee2e2;color:#dc2626;border-color:#dc2626';
  const covStyle = coverage==='부책'
    ? 'background:#dcfce7;color:#15803d;border-color:#15803d'
    : coverage==='면책'
    ? 'background:#fee2e2;color:#dc2626;border-color:#dc2626'
    : 'background:#fef3c7;color:#b45309;border-color:#b45309';

  const hasResult = !!(r.policy_product || r.insured_name);

  return `
  <!-- 분석 버튼 + 진행바 -->
  <div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:${hasResult?'0':'4px'}">
      <div>
        <div style="font-size:14px;font-weight:900">🔍 서류 분석 + 책임 판단</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">
          약관: <strong>${INS_TYPE_LABELS[cl.insurance_type]||'미선택'}</strong> 기준으로 분석합니다
        </div>
      </div>
      <button class="btn ${hasResult?'btn-ghost':'btn-primary'} btn-sm" onclick="s2Analyze()" id="s2-analyze-btn">
        ${hasResult ? '↺ 재분석' : '▶ 분석 시작'}
      </button>
    </div>

    <div id="s2-loading" style="display:none;margin-top:14px;padding:12px;background:var(--primary-soft);border-radius:8px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span class="spinner"></span>
        <span id="s2-label" style="font-size:13px;color:var(--primary)">보험증권 분석 중…</span>
      </div>
      <div style="height:5px;background:var(--line);border-radius:3px;overflow:hidden">
        <div id="s2-fill" style="height:100%;background:var(--primary);border-radius:3px;transition:width .4s;width:0%"></div>
      </div>
    </div>
  </div>

  <!-- 추출 결과 (수정 가능) -->
  <div class="card">
    <div style="font-size:14px;font-weight:900;margin-bottom:14px">
      📋 추출 정보
      <span style="font-size:11px;font-weight:400;color:var(--muted);margin-left:8px">틀린 값은 직접 수정하세요</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group">
        <label class="form-label">보험종목</label>
        <input class="form-control" id="ex-product" value="${r.policy_product||''}" placeholder="보험증권에서 추출"/>
      </div>
      <div class="form-group">
        <label class="form-label">증권번호</label>
        <input class="form-control" id="ex-no" value="${r.policy_no||cl.policy_no||''}" placeholder="보험증권에서 추출"/>
      </div>
      <div class="form-group">
        <label class="form-label">보험기간</label>
        <input class="form-control" id="ex-period"
          value="${r.policy_start&&r.policy_end?r.policy_start+' ~ '+r.policy_end:''}" placeholder="YYYY.MM.DD ~ YYYY.MM.DD"/>
      </div>
      <div class="form-group">
        <label class="form-label">피보험자</label>
        <input class="form-control" id="ex-insured" value="${r.insured_name||cl.insured_name||''}" placeholder="성명"/>
      </div>
      <div class="form-group">
        <label class="form-label">
          피보험자 지위
          <span style="font-size:10px;color:var(--muted);font-weight:400"> 건축물대장 기반 판단</span>
        </label>
        <select class="form-control" id="ex-status">
          ${INSURED_STATUS_VALUES.map(v =>
            `<option value="${v}" ${(r.insured_status||cl.insured_status||'임차인겸점유자')===v?'selected':''}>${v}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">보상한도액</label>
        <input class="form-control" id="ex-coverage" type="number"
          value="${r.coverage_limit||cl.coverage_limit||''}" placeholder="보험증권에서 추출"/>
      </div>
      <div class="form-group">
        <label class="form-label">자기부담금</label>
        <input class="form-control" id="ex-deductible" type="number"
          value="${r.deductible||cl.deductible||''}" placeholder="보험증권에서 추출"/>
      </div>
      <div class="form-group">
        <label class="form-label">피해자 소재지 <span style="font-size:10px;color:var(--muted);font-weight:400">피해자 건축물대장</span></label>
        <input class="form-control" id="ex-victim" value="${r.victim_address||cl.victim_address||''}" placeholder="예: 101동 1204호"/>
      </div>
    </div>

    <!-- 주소 일치 판단 -->
    <div style="margin-top:12px;padding:12px;background:${addrBg};border-radius:8px;border-left:3px solid ${addrColor}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:${addrMatch!=='ok'?'8':'0'}px">
        <strong style="font-size:13px;color:${addrColor}">주소 일치 (보험증권 ↔ 건축물대장)</strong>
        <select class="form-control" id="ex-addr" style="width:auto;font-size:12px" onchange="s2AddrChange()">
          <option value="ok"    ${addrMatch==='ok'   ?'selected':''}>✓ 일치</option>
          <option value="warn"  ${addrMatch==='warn' ?'selected':''}>⚠ 추정 일치</option>
          <option value="error" ${addrMatch==='error'?'selected':''}>✕ 불일치</option>
        </select>
      </div>
      <div id="ex-addr-note-wrap" style="display:${addrMatch!=='ok'?'block':'none'}">
        <input class="form-control" id="ex-addr-note" value="${r.address_match_note||''}"
          placeholder="예: 보험증권 도로명 ↔ 건축물대장 지번 — 동일 건물 추정" style="font-size:12px;margin-top:6px"/>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">
          ※ 보험증권 주소와 실거주지가 다른 경우(구/동 불일치) → 불일치(error) 처리
        </div>
      </div>
      ${r.policy_address_raw ? `<div style="font-size:11px;color:var(--muted);margin-top:6px">보험증권 소재지: ${r.policy_address_raw}</div>` : ''}
    </div>

    ${r.insured_status_reason ? `
    <div style="margin-top:10px;padding:10px 12px;background:var(--primary-soft);border-radius:6px;font-size:12px;color:var(--primary)">
      🤖 지위 판단 근거: ${r.insured_status_reason}
    </div>` : ''}

    ${r.accident_type ? `
    <div style="margin-top:10px;padding:10px 12px;background:var(--bg);border-radius:6px;font-size:12px;border-left:3px solid var(--primary)">
      <strong>사고 유형 분류:</strong> ${r.accident_type}
      ${r.shared_liability ? ' <span class="badge badge-amber" style="margin-left:6px">과실 분담 가능성</span>' : ''}
    </div>` : ''}
  </div>

  <!-- 책임 판단 (Sabi 8·9단계) -->
  <div class="card">
    <div style="font-size:14px;font-weight:900;margin-bottom:14px">
      ⚖️ 법률상 손해배상책임 판단
      <span style="font-size:11px;font-weight:400;color:var(--muted);margin-left:8px">드롭다운으로 직접 수정 가능</span>
    </div>

    <div class="ins-judge-box">
      <div class="ins-judge-head">
        <div class="ins-judge-label">가. 피보험자 손해배상책임 성립 여부 <span style="font-size:10px;color:var(--muted);font-weight:400">(Sabi 8단계)</span></div>
        <select class="ins-judge-sel" id="j-established" style="${estStyle}" onchange="s2JudgeStyle(this, 'established')">
          <option value="yes" ${established==='yes'?'selected':''}>성립</option>
          <option value="no"  ${established==='no' ?'selected':''}>불성립</option>
        </select>
      </div>
      <div class="ins-judge-body">
        ${r.liability_reasoning || '분석 후 자동으로 채워집니다.'}
        <br><span class="badge badge-blue" style="margin-top:6px;display:inline-block">민법 제750조</span>
        <span class="badge badge-blue" style="margin-top:6px">민법 제758조</span>
      </div>
    </div>

    <div class="ins-judge-box">
      <div class="ins-judge-head">
        <div class="ins-judge-label">나. 보험금 지급 (면·부책) <span style="font-size:10px;color:var(--muted);font-weight:400">(Sabi 9단계 · 약관별 분기)</span></div>
        <select class="ins-judge-sel" id="j-coverage" style="${covStyle}" onchange="s2JudgeStyle(this, 'coverage')">
          ${COVERAGE_RESULT_VALUES.map(v =>
            `<option value="${v}" ${coverage===v?'selected':''}>${v}</option>`
          ).join('')}
        </select>
      </div>
      <div class="ins-judge-body">
        ${r.coverage_reasoning || '보험기간, 소재지 일치 여부, 사고 유형별 약관 조항 검토 후 자동으로 채워집니다.'}
        <br><span class="badge badge-blue" style="margin-top:6px;display:inline-block">${INS_TYPE_LABELS[cl.insurance_type]||'약관'}</span>
        <span class="badge badge-blue" style="margin-top:6px">상법 제680조</span>
      </div>
    </div>

    <div class="ins-judge-box">
      <div class="ins-judge-head">
        <div class="ins-judge-label">다. 과실 비율</div>
        <select class="ins-judge-sel" id="j-fault" style="background:#dcfce7;color:#15803d;border-color:#15803d">
          <option ${(r.fault_ratio||'')===''||r.fault_ratio==='피보험자 100%'?'selected':''}>피보험자 100%</option>
          <option ${r.fault_ratio==='피보험자 70% / 피해자 30%'?'selected':''}>피보험자 70% / 피해자 30%</option>
          <option ${r.fault_ratio==='피보험자 50% / 피해자 50%'?'selected':''}>피보험자 50% / 피해자 50%</option>
        </select>
      </div>
      <div class="ins-judge-body">${r.fault_reason || '분석 후 자동으로 채워집니다.'}</div>
    </div>

    <!-- 지급보험금 계산 -->
    <div style="margin-top:12px;padding:14px;background:var(--green-soft);border-radius:8px;border-left:3px solid var(--green)">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <strong style="font-size:13px">라. 지급보험금 산정</strong>
        <strong style="font-size:18px;color:var(--green)">${coverage==='부책'?pay.toLocaleString()+'원':'—'}</strong>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:6px">
        수리금액 ${rc.toLocaleString()}원 − 자기부담금 <input type="number" id="j-ded" value="${ded}"
          style="width:100px;padding:2px 6px;border:1px solid var(--line);border-radius:4px;font-size:12px"
          onchange="s2RecalcPay()"/> 원 = <strong id="j-pay-display" style="color:var(--green)">${pay.toLocaleString()}원</strong>
        <span class="badge badge-blue" style="margin-left:8px">상법 제680조</span>
        ${coverage!=='부책'?'<div style="margin-top:4px;color:var(--red);font-size:11px">※ 면책·판단유보 시 지급보험금 산정 대상 아님</div>':''}
      </div>
    </div>

    <!-- 조사자의견 -->
    <div class="form-group" style="margin-top:14px">
      <label class="form-label">조사자의견 (보고서 4섹션 반영)</label>
      <textarea class="form-control" id="j-opinion" rows="3"
        placeholder="분석 후 자동으로 채워집니다. 직접 수정 가능합니다.">${r.investigator_opinion||''}</textarea>
    </div>
  </div>

  <div class="ins-action-bar">
    <button class="btn btn-ghost" onclick="insGoStep(1)">← 이전</button>
    <button class="btn btn-primary" onclick="s2Save()">저장 후 보고서 작성 →</button>
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

// ─────────────────────────────────────────────
// STEP 2: Claude 분석
// (1차) 보험증권 추출
// (2차) 건축물대장 + 주민등록등본 교차 → 피보험자 지위, 주소 일치
// (3차) 피해자 건축물대장 → 피해자 소재지
// (4차 ★ v5 신규) Sabi 8·9단계 종합 판단 — 약관별 분기
// ─────────────────────────────────────────────
async function s2Analyze() {
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
STEP 1: 피보험자 지위 판정 (insured_status)
─────────────────────────────────────────
D와 E 비교: 사고발생장소 소유자(D) == 피보험자(E)?
B와 C 비교: 사고발생장소(B) == 피보험자 실거주지(C)?
  · 동일 건물·동·호수면 일치로 간주

4가지 조합:
  D==E (피보험자 본인 소유) AND C==B (피보험자가 거기 거주) → "소유자겸점유자"
  D!=E (남이 소유)           AND C==B (피보험자가 거기 거주) → "임차인겸점유자"
  D==E (피보험자 본인 소유) AND C!=B (피보험자는 다른 곳 거주) → "임대인"
  D!=E                      AND C!=B                          → "확인불가"

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
{
  "insured_status": "소유자겸점유자 | 임차인겸점유자 | 임대인 | 확인불가",
  "insured_status_reason": "D=[소유자명], E=[피보험자명], B=[사고발생장소], C=[실거주지] 를 교차 비교한 결과를 1-2문장으로. '피보험자(성명)는 사고발생장소의 [소유자/비소유자]이며, 해당 장소에 [거주/비거주]하므로 [지위]에 해당함' 형태 권장",
  "insured_residence": "C값 (주민등록상 실거주지 전체 주소)",
  "accident_location_from_doc": "B값 (첫 번째 서류에서 읽은 사고발생장소 주소)",
  "insured_owner_name": "D값 (사고발생장소 소유자 성명)",
  "insured_owner_transfer_date": "소유권 이전일 YYYY-MM-DD 또는 null",
  "insured_cohabitants": "동거인 요약 (없거나 미확인 시 null)",
  "address_match": "ok | warn | error",
  "address_match_note": "A와 B의 차이 설명 (ok면 null)"
}` });

      const resp = await fetch('/api/claude', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ model: INS_MODEL, max_tokens: 800, system: SYS,
          messages: [{ role:'user', content: contentArr }] }),
      });
      if (!resp.ok) throw new Error('API 오류 ' + resp.status);
      const res = await resp.json();
      const r2 = parseClaudeJson(res.content?.[0]?.text, '피보험자 지위 분석');
      
      // v5.3.1 ★ 결정론적 지위 판정 후처리
      // AI가 필드-텍스트 불일치로 반환하는 경우 JS 룰 엔진이 교정
      const derived = {
        ...computeInsuredStatus({
          A_policy:    result.policy_address_raw,
          B_accident:  r2.accident_location_from_doc,
          C_residence: r2.insured_residence,
          D_owner:     r2.insured_owner_name,
          E_insured:   result.insured_name,
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

// 결정론적 지위 판정
function computeInsuredStatus({ A_policy, B_accident, C_residence, D_owner, E_insured }) {
  // 입력 불충분 체크
  if (!D_owner || !E_insured || !B_accident || !C_residence) {
    return { status: '확인불가', reason: 'insufficient_input' };
  }
  const sameOwner = normalizeName(D_owner) === normalizeName(E_insured);
  const addrCmp   = compareAddresses(B_accident, C_residence);
  const sameAddr  = addrCmp === 'match';
  
  // 4분기
  if (sameOwner && sameAddr)   return { status: '소유자겸점유자', reason: 'D==E AND C==B' };
  if (!sameOwner && sameAddr)  return { status: '임차인겸점유자', reason: 'D!=E AND C==B' };
  if (sameOwner && !sameAddr)  return { status: '임대인',         reason: 'D==E AND C!=B' };
  return { status: '확인불가', reason: 'D!=E AND C!=B' };
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
  
  // 규칙 5: 룰북 카테고리 ⓐ + 임차인 + 관리과실 키워드 없음 → liability="no"
  //         (v5.2.1 절대규칙 5번의 JS 재확인)
  if (ctx.rulebook_cat === 'ⓐ' && ctx.insured_status === '임차인겸점유자') {
    if (out.liability_result !== 'no') {
      warnings.push(`임차인+ⓐ(설비하자) → liability "${out.liability_result}" → "no" 교정 (758조 단서)`);
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
  if (!resp.ok) throw new Error(`${title} API 오류 ${resp.status}`);
  const res = await resp.json();
  const raw = res.content?.[0]?.text || '{}';
  return parseClaudeJson(raw, title);
}

async function s2Save() {
  const period = (document.getElementById('ex-period')?.value||'').split('~').map(s=>s.trim());
  const ded    = parseInt(document.getElementById('j-ded')?.value)||0;
  const rc     = _insField?.repair_cost||0;
  const coverage = document.getElementById('j-coverage')?.value || '부책';
  const pay    = coverage === '부책' ? Math.max(0, rc - ded) : 0;

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
    victim_address:  document.getElementById('ex-victim')?.value,
    address_match:   document.getElementById('ex-addr')?.value,
    address_match_note: document.getElementById('ex-addr-note')?.value||null,
    liability_result: document.getElementById('j-established')?.value,
    coverage_result: coverage,
    fault_ratio:     document.getElementById('j-fault')?.value,
    investigator_opinion: document.getElementById('j-opinion')?.value,
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
    //           (판단 관련은 rpc_save_judgment가 이제 모두 커버함)
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
    }).eq('id', _insClaim.id);
    if (updErr) {
      console.warn('[v5.2] 신규 컬럼 UPDATE 일부 실패:', updErr.message);
      // 치명적이지 않음 — RPC 저장은 성공했으므로 기존 데이터는 보존
    }

    _insClaim = { ..._insClaim, insurance_tab_status: 'ready_for_draft',
      deductible: ded, payout_amount: pay };
    toast('저장 완료!', 's');
    _insStep = 3; insRender();
  } catch(e) { toast('저장 실패: ' + e.message, 'e'); }
}

// ─────────────────────────────────────────────
// STEP 3: 보고서 (손해사정서 양식 + 수정 + PDF)
// ─────────────────────────────────────────────
function insStep3HTML() {
  const cl = _insClaim || {};
  const r  = _insResult || {};
  const co = _insCompany || {};
  const fd = _insField;
  const today = new Date().toISOString().split('T')[0];
  const rc  = fd?.repair_cost || 0;
  const ded = r.deductible || 200000;
  const pay = r.coverage_result === '부책' ? Math.max(0, rc - ded) : 0;

  const rows = [
    ['수신', 'r-to', cl.insurer_name || '—'],
    ['참조', 'r-cc', cl.insurer_contact || '—'],
    ['제출일자', 'r-date', cl.submit_date || today],
    ['보고서 번호', 'r-no', cl.report_no || '—'],
    ['보험종목', 'r-product', r.policy_product || '—'],
    ['증권번호', 'r-policy-no', r.policy_no || '—'],
    ['보험기간', 'r-period', r.policy_start && r.policy_end ? `${r.policy_start} ~ ${r.policy_end}` : '—'],
    ['피보험자', 'r-insured', r.insured_name || '—'],
    ['피보험자 지위', 'r-status', r.insured_status || '—'],
    ['특약조건', 'r-special', INS_TYPE_LABELS[cl.insurance_type] || '—'],
    ['보상한도액', 'r-coverage', r.coverage_limit ? Number(r.coverage_limit).toLocaleString()+'원' : '—'],
    ['자기부담금', 'r-ded', ded.toLocaleString() + '원'],
    ['사고원인', 'r-cause', cl.accident_cause_type || '—'],
    ['사고 유형 분류', 'r-acctype', r.accident_type || '—'],
    ['피해자 소재지', 'r-victim', r.victim_address || '—'],
    ['손해배상책임 성립', 'r-liab', r.liability_result === 'yes' ? '성립' : r.liability_result === 'no' ? '불성립' : '—'],
    ['면·부책', 'r-coverage-result', r.coverage_result || '—'],
    ['과실 비율', 'r-fault', r.fault_ratio || '—'],
    ['손해액(수리금액)', 'r-damage', rc.toLocaleString() + '원'],
    ['지급보험금', 'r-pay', pay.toLocaleString() + '원'],
  ];

  const coverageBadge = r.coverage_result === '부책'
    ? '<span class="badge" style="background:#dcfce7;color:#15803d">부책</span>'
    : r.coverage_result === '면책'
    ? '<span class="badge" style="background:#fee2e2;color:#dc2626">면책</span>'
    : '<span class="badge" style="background:#fef3c7;color:#b45309">판단유보</span>';

  return `
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-size:14px;font-weight:900">📄 손해사정서 미리보기</div>
      ${coverageBadge}
    </div>

    <div style="border:1px solid var(--line);border-radius:8px;padding:20px;background:white">
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:20px;font-weight:900;margin-bottom:6px">손해사정보고서</div>
        <div style="font-size:12px;color:var(--muted)">${co.company_name || '누수패스'}</div>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:12px">
        ${rows.map(([label, id, val]) => `
          <tr>
            <td style="padding:8px 12px;background:var(--bg);font-weight:700;width:30%;border:1px solid var(--line)">${label}</td>
            <td style="padding:8px 12px;border:1px solid var(--line)" id="${id}">${val}</td>
          </tr>`).join('')}
      </table>

      <div style="margin-top:20px;padding:14px;background:var(--bg);border-radius:6px">
        <div style="font-size:13px;font-weight:700;margin-bottom:8px">조사자 의견</div>
        <div style="font-size:12px;line-height:1.6">${r.investigator_opinion || '—'}</div>
      </div>

      ${r.coverage_reasoning ? `
      <div style="margin-top:12px;padding:14px;background:var(--primary-soft);border-radius:6px">
        <div style="font-size:13px;font-weight:700;margin-bottom:8px;color:var(--primary)">면·부책 판단 근거 (Sabi 9단계)</div>
        <div style="font-size:12px;line-height:1.6">${r.coverage_reasoning}</div>
      </div>` : ''}
    </div>
  </div>

  <div class="ins-action-bar">
    <button class="btn btn-ghost" onclick="insGoStep(2)">← 이전</button>
    <button class="btn btn-primary" onclick="s3ExportPdf()">📥 PDF 출력</button>
  </div>`;
}

async function s3ExportPdf() {
  toast('PDF 출력 기능은 추후 연결 예정입니다.', 'i');
}
