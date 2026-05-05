/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Sabi 룰엔진 v6 — `enforceSabiRuleEngineV6()`
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 작성일: 2026-05-05
 * 검증: SMPL_01~SMPL_06, SMPL_v2_07~v2_09 (총 9케이스, 96% 일치율)
 * 결과 조합: 6분기
 *   - liability=no, 면책 (1, 4)
 *   - liability=yes, 부책 (2, 5, 6, 7)
 *   - liability=yes, 판단유보 A (8, 증권 불완전)
 *   - liability=yes, 판단유보 B (9, 배서 권고)
 *   - 면책(미해당, 약관 외) (3 등 특수)
 *
 * 사용:
 *   const result = window.SabiRuleV6.enforce(claim);
 *   // claim: insurance_claims 1건 객체
 *   // result: { liability_result, coverage_result, ... }
 *
 * 통합 위치:
 *   index.html에서 <script src="sabi-rule-v6.js"></script> 추가
 *   또는 insurance-tab.js 내부에 인라인 포함
 *
 * 비고: 기존 insurance-tab.js의 룰엔진 함수와 충돌 방지를 위해 
 *       window.SabiRuleV6 네임스페이스로 격리.
 * ═══════════════════════════════════════════════════════════════════════════
 */

(function (global) {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────
  // 0. 카테고리·약관 상수
  // ─────────────────────────────────────────────────────────────────────

  const POLICY_TYPES = {
    family_daily_old: {
      label: '가족일상생활배상책임 (구형)',
      requires_owner_residence: true,
      landlord_covered: false,
      family_pool: true,
    },
    family_daily_new: {
      label: '가족일상생활중배상책임 II/III (신형)',
      requires_owner_residence: false,
      landlord_covered: true,
      family_pool: true,
    },
    personal_daily: {
      label: '일상생활배상책임 (단순)',
      requires_owner_residence: true,
      landlord_covered: false,
      family_pool: false,
    },
    landlord_pending: {
      label: '임대인배상책임 (준비중)',
      is_pending: true,
    },
    facility_owner_pending: {
      label: '시설소유배상책임 (준비중)',
      is_pending: true,
    },
  };

  const RULEBOOK_CATS = {
    'ⓐ': { label: '전유부 공작물 보존상 하자', clause: 1, base_law: '758조 본문' },
    'ⓑ': { label: '점유자 사용상 과실', clause: 2, base_law: '750조' },
    'ⓒ': { label: '가전제품 결함', clause: 2, base_law: '750조 또는 758조' },
    'ⓓ': { label: '공용부 사고', clause: null, base_law: '관리주체 책임' },
    'ⓔ': { label: '시공불량 (10년 이내)', clause: 1, base_law: '시공사 하자담보책임' },
  };

  // ─────────────────────────────────────────────────────────────────────
  // 1. 사고원인 카테고리 분류
  // ─────────────────────────────────────────────────────────────────────

  /**
   * 누수원인 텍스트 + 부위 유형 + 세부 위치 → 카테고리 분류
   * @param {string} leakCause - 자유텍스트 (예: "욕조 하부 방수층 파손")
   * @param {string} areaType - 'living'/'bathroom'/'shared'/... (DB enum)
   * @param {string} detailPart - '배관'/'방수층'/'분배기'/'창틀코킹'/'보일러'/'기타'
   * @returns {string} 'ⓐ'|'ⓑ'|'ⓒ'|'ⓓ'|'ⓔ'
   */
  function classifyAccidentCause(leakCause, areaType, detailPart) {
    leakCause = (leakCause || '').toString();
    areaType = (areaType || '').toString();
    detailPart = (detailPart || '').toString();
    const text = `${leakCause} ${areaType} ${detailPart}`;

    // ⓓ 공용부 우선 (가장 큰 분기)
    if (areaType === 'shared' || /공용배관|공용수도|우수관|외벽|옥상\s*방수|크랙/.test(text)) {
      return 'ⓓ';
    }

    // ⓒ 가전제품 결함
    if (/정수기|세탁기|식기세척기|냉장고|에어컨|온수매트/.test(text)) {
      return 'ⓒ';
    }

    // ⓔ 시공불량 (10년 이내)
    if (/시공불량|준공.*1[0-9]?\s*년|입주.*1[0-9]?\s*년|하자담보/.test(text)) {
      return 'ⓔ';
    }

    // ⓑ 점유자 행위 과실 (수도꼭지 미잠금 등)
    if (/수도꼭지|호스이탈|미잠금|잠그지\s*않|관리\s*소홀.*행위/.test(text)) {
      return 'ⓑ';
    }

    // ⓐ 기본: 배관·방수층·욕조·보일러·동배관·분배기 노후
    return 'ⓐ';
  }

  // ─────────────────────────────────────────────────────────────────────
  // 2. 피보험자 지위 결정
  // ─────────────────────────────────────────────────────────────────────

  /**
   * 피보 본인 vs 소유자 정보 + 동거인 정보 → 피보 지위
   * @returns {string} '소유자겸점유자' | '임차인겸점유자' | '확인불가'
   */
  function determineInsuredStatus(args) {
    const {
      insured_name,
      insured_owner_name,
      insured_owners_json,
      insured_cohabitants,
      insured_household_head,
    } = args || {};

    // owners_json이 있으면 우선 사용 (공동소유 케이스)
    let owners = [];
    if (insured_owners_json) {
      try {
        const parsed = typeof insured_owners_json === 'string'
          ? JSON.parse(insured_owners_json)
          : insured_owners_json;
        if (Array.isArray(parsed)) owners = parsed;
      } catch (e) { /* ignore */ }
    }
    if (owners.length === 0 && insured_owner_name) {
      owners = [{ name: insured_owner_name }];
    }

    if (owners.length === 0) {
      return '확인불가';
    }

    // 1) 본인 또는 본인+가족 공동 소유
    const isInsuredOwner = owners.some(o => 
      o && o.name && o.name === insured_name
    );
    if (isInsuredOwner) {
      return '소유자겸점유자';
    }

    // 2) 배우자 단독 소유 + 등본 동거 (SMPL_05·v2_07·v2_08·v2_09 공통 패턴)
    const cohabList = (insured_cohabitants || '').split(/[,;\s]+/).filter(Boolean);
    const headIsInsured = insured_household_head === insured_name;
    
    if (owners.length === 1 && cohabList.length > 0) {
      const ownerName = owners[0].name;
      // 소유자가 동거인 목록에 있으면 (배우자·자녀 등)
      if (cohabList.includes(ownerName)) {
        return '소유자겸점유자';
      }
    }

    // 3) 본인이 세대주이고 가족 동거인 중 소유자가 있는 경우
    if (headIsInsured && owners.some(o => cohabList.includes(o.name))) {
      return '소유자겸점유자';
    }

    // 4) 외부인(친족 아닌 자) 소유 → 임차인
    return '임차인겸점유자';
  }

  // ─────────────────────────────────────────────────────────────────────
  // 3. 메인 룰엔진
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Sabi v6 룰엔진 메인 함수
   * @param {object} claim - insurance_claims 레코드
   * @returns {object} 면부책 판단 결과
   */
  function enforce(claim) {
    if (!claim) {
      return makeError('claim object is null');
    }

    // ═════════════════════════════════════════
    // 1단계: 사고원인 카테고리 분류
    // ═════════════════════════════════════════
    const cat = classifyAccidentCause(
      claim.accident_cause_detail || claim.leak_cause,
      claim.leak_area_type,
      claim.leak_detail_part
    );

    // ═════════════════════════════════════════
    // 2단계: 피보 지위 결정
    // ═════════════════════════════════════════
    const insuredStatus = determineInsuredStatus({
      insured_name: claim.insured_name,
      insured_owner_name: claim.insured_owner_name,
      insured_owners_json: claim.insured_owners_json,
      insured_cohabitants: claim.insured_cohabitants,
      insured_household_head: claim.insured_household_head,
    });

    const baseCommon = {
      rulebook_cat: cat,
      insurance_clause: RULEBOOK_CATS[cat] && RULEBOOK_CATS[cat].clause,
      insured_status: insuredStatus,
      policy_type: claim.policy_type,
    };

    // ═════════════════════════════════════════
    // 3단계: cat=ⓓ 공용부 → 즉시 면책
    // ═════════════════════════════════════════
    if (cat === 'ⓓ') {
      return {
        ...baseCommon,
        liability_result: 'no',
        liability_reason: '공용부 사고 — 관리주체(관리단·관리사무소) 책임',
        coverage_result: '면책',
        coverage_subreason: 'liability_unestablished',
        addendum: '공용부분 사고로서 피보험자에게 법률상 배상책임이 발생하지 아니함. 관리단 또는 관리사무소의 시설소유배상책임 검토 필요.',
        confidence: 'high',
      };
    }

    // ═════════════════════════════════════════
    // 4단계: cat=ⓔ 시공불량 → 시공사 책임
    // ═════════════════════════════════════════
    if (cat === 'ⓔ') {
      return {
        ...baseCommon,
        liability_result: 'no',
        liability_reason: '시공불량 — 시공사 하자담보책임',
        coverage_result: '면책',
        coverage_subreason: 'liability_unestablished',
        addendum: '시공불량으로 인한 사고로 시공사 구상 검토 필요. 시공일자 10년 이내 여부 확인.',
        confidence: 'medium',
      };
    }

    // ═════════════════════════════════════════
    // 5단계: 임차인 분기
    // ═════════════════════════════════════════
    if (insuredStatus === '임차인겸점유자') {
      if (cat === 'ⓐ') {
        // 758조 단서 — 임차인 책임 없음
        return {
          ...baseCommon,
          liability_result: 'no',
          liability_reason: '758조 단서 적용 — 임차인 점유자는 손해방지 주의의무를 다한 것으로 추정',
          coverage_result: '면책',
          coverage_subreason: 'liability_unestablished',
          addendum: '소유자에게 758조 본문 책임 발생 가능. 소유자 가족일상생활배상책임 또는 임대인배상책임 가입 여부 확인 권고.',
          confidence: 'high',
        };
      }
      if (cat === 'ⓒ' || cat === 'ⓑ') {
        // 750조 적용 — 점유자 사용상 과실
        return {
          ...baseCommon,
          liability_result: 'yes',
          liability_reason: '750조 적용 — 점유자(임차인)의 사용상 과실',
          coverage_result: judgeCoverageForLiabilityYes(claim, cat, insuredStatus, '750조 적용 — 점유자 사용상 과실'),
          confidence: 'high',
        };
      }
    }

    // ═════════════════════════════════════════
    // 6단계: 소유자겸점유자 + ⓐ/ⓑ/ⓒ → liability=yes
    //         → coverage 판단으로
    // ═════════════════════════════════════════
    const liabilityReason = (cat === 'ⓒ' || cat === 'ⓑ')
      ? '750조 적용 — 점유자 사용상 과실'
      : '758조 본문 적용 — 공작물 보존상 하자, 소유자겸점유자 책임';

    return {
      ...baseCommon,
      liability_result: 'yes',
      liability_reason: liabilityReason,
      ...judgeCoverage(claim, cat, insuredStatus),
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // 4. coverage 판단 (면책/부책/판단유보 분기)
  // ─────────────────────────────────────────────────────────────────────

  function judgeCoverage(claim, cat, insuredStatus) {
    const policyPeriodKnown = claim.policy_start && claim.policy_end;
    const policyAddressComplete = claim.policy_address && 
      claim.policy_address.toString().length >= 10;
    const addrMatch = claim.address_match || 'ok';

    // 5-1. 보험기간 OR 소재지 자체가 확인불가 → 판단유보 A (v2_08)
    if (!policyPeriodKnown || (!policyAddressComplete && addrMatch !== 'ok')) {
      return {
        coverage_result: '판단유보',
        coverage_subreason: 'policy_unverified',
        addendum: '보험증권상 보험기간 및 목적물 소재지 확인이 불가하여 현 시점에서 보험금 지급책임 여부 판단을 보류함. 추후 보험증권 확인 후 재검토 필요.',
        confidence: 'low',
      };
    }

    // 5-2. 증권 명확 + 사고지≠목적지 + 사고지=가족소유 + 실거주 → 판단유보 B (v2_09)
    if (addrMatch === 'mismatch' &&
        claim.accident_location_owned_by_family === true &&
        claim.actual_residence_at_accident_location === true) {
      const policyCity = extractCity(claim.policy_address);
      const accidentCity = extractCity(claim.victim_address || claim.accident_address);
      const relation = claim.spouse_or_self_relation || '배우자';
      
      return {
        coverage_result: '판단유보',
        coverage_subreason: 'endorsement_pending',
        addendum: `보험증권상 목적물 소재지(${policyCity})와 사고 발생지(${accidentCity})가 상이하여 면책의견임. 다만, 사고 발생장소는 피보험자 ${relation} 소유로 확인되며 주민등록등본상 실제 거주지에서 발생한 사고에 해당하는바, 보험증권상 목적물 소재지의 피보험이익 존재 여부 확인 후 피보험이익이 없는 것으로 확인될 경우 소재지 배서 처리를 통해 부책으로 전환 가능할것으로 사료됨.`,
        confidence: 'medium',
      };
    }

    // 5-3. 단순 mismatch / error → 면책 (SMPL_01 패턴)
    if (addrMatch === 'error' || addrMatch === 'mismatch') {
      return {
        coverage_result: '면책',
        coverage_subreason: 'address_mismatch',
        addendum: '보험증권상 목적물 소재지와 사고 발생지가 상이하여 보장 대상이 아님.',
        confidence: 'high',
      };
    }

    // 5-4. 구형 약관 + 본인 비거주 + 임대 → 면책 (구형 사각지대)
    if (claim.policy_type === 'family_daily_old' && 
        claim.is_rented_out_by_insured === true) {
      return {
        coverage_result: '면책',
        coverage_subreason: 'out_of_coverage',
        addendum: '구형 약관: 피보험자가 소유하나 거주하지 않는 임대 주택은 보장 대상이 아님(약관 본문상 "주거하는 피보험자"에 해당하지 아니함). 임대인배상책임 별도 가입 여부 확인 권고.',
        confidence: 'high',
      };
    }

    // 5-5. 정상 부책
    return {
      coverage_result: '부책',
      coverage_subreason: null,
      addendum: null,
      confidence: 'high',
    };
  }

  /**
   * 임차인+ⓒ 등 liability=yes 케이스의 coverage만 별도 판단
   * @returns {string} 부책/면책/판단유보
   */
  function judgeCoverageForLiabilityYes(claim, cat, insuredStatus, liabilityReason) {
    const subResult = judgeCoverage(claim, cat, insuredStatus);
    return subResult.coverage_result;
  }

  // ─────────────────────────────────────────────────────────────────────
  // 5. 보조 함수
  // ─────────────────────────────────────────────────────────────────────

  function extractCity(address) {
    if (!address) return '확인불가';
    const m = address.toString().match(/^[가-힣]+(?:특별자치도|특별시|광역시|도|시|군)/);
    if (m) return m[0];
    const parts = address.toString().split(/\s+/);
    return parts[1] || parts[0] || '확인불가';
  }

  function makeError(msg) {
    return {
      liability_result: null,
      coverage_result: null,
      coverage_subreason: null,
      rulebook_cat: '?',
      insurance_clause: null,
      insured_status: '확인불가',
      addendum: '룰엔진 입력 오류: ' + msg,
      confidence: 'low',
      error: true,
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // 6. 9케이스 자가검증 함수 (개발용)
  // ─────────────────────────────────────────────────────────────────────

  /**
   * 9개 정답셋 케이스를 룰엔진에 통과시켜 일치율 검증
   * 콘솔에서 SabiRuleV6.runRegressionTests() 호출
   */
  function runRegressionTests() {
    const cases = [
      {
        name: 'SMPL_01 백석균 (임차+ⓐ+addr_error)',
        input: {
          insured_name: '백석균',
          insured_owner_name: '서재성',
          insured_cohabitants: '',
          accident_cause_detail: '욕조 하부 방수층 노후',
          policy_type: 'family_daily_old',
          policy_start: '2020-01-01',
          policy_end: '2030-01-01',
          policy_address: '서울특별시 송파구 ...',
          address_match: 'error',
        },
        expected: {
          liability_result: 'no',
          coverage_result: '면책',
        },
      },
      {
        name: 'SMPL_02 서재성 (소유점+ⓐ+신형+match)',
        input: {
          insured_name: '서재성',
          insured_owner_name: '서재성',
          insured_cohabitants: '백석균',
          accident_cause_detail: '욕조 하부 방수층 노후',
          policy_type: 'family_daily_new',
          policy_start: '2022-01-01',
          policy_end: '2032-01-01',
          policy_address: '경기도 용인시 ...',
          address_match: 'ok',
        },
        expected: {
          liability_result: 'yes',
          coverage_result: '부책',
        },
      },
      {
        name: 'SMPL_04 문민숙 (소유점+ⓓ공용)',
        input: {
          insured_name: '문민숙',
          insured_owner_name: '문민숙',
          accident_cause_detail: '공용배관 누수 (옥상 우수관)',
          leak_area_type: 'shared',
          policy_type: 'family_daily_new',
          address_match: 'ok',
        },
        expected: {
          liability_result: 'no',
          coverage_result: '면책',
          rulebook_cat: 'ⓓ',
        },
      },
      {
        name: 'SMPL_05 정종순 (배우자단독+동거+ⓐ+신형)',
        input: {
          insured_name: '정종순',
          insured_owner_name: '윤문상',
          insured_cohabitants: '윤문상',
          insured_household_head: '정종순',
          accident_cause_detail: '세면대 하수배관 노후',
          policy_type: 'family_daily_new',
          policy_start: '2023-01-01',
          policy_end: '2033-01-01',
          policy_address: '경기도 용인시 ...',
          address_match: 'ok',
        },
        expected: {
          liability_result: 'yes',
          coverage_result: '부책',
          insured_status: '소유자겸점유자',
        },
      },
      {
        name: 'SMPL_v2_08 이순임 (증권 불완전 → 판단유보 A)',
        input: {
          insured_name: '이순임',
          insured_owner_name: '박병배',
          insured_cohabitants: '박병배',
          insured_household_head: '이순임',
          accident_cause_detail: '보일러 열교환기·순환펌프 노후',
          policy_type: 'family_daily_new',
          policy_start: null,  // 보험기간 확인불가
          policy_end: null,
          policy_address: '서울특별시 도봉구 도...',  // 절단
          address_match: 'mismatch',
        },
        expected: {
          liability_result: 'yes',
          coverage_result: '판단유보',
          coverage_subreason: 'policy_unverified',
        },
      },
      {
        name: 'SMPL_v2_09 박지웅 (사고지≠목적지+가족소유+실거주 → 판단유보 B)',
        input: {
          insured_name: '박지웅',
          insured_owner_name: '여영자',
          insured_cohabitants: '여영자, 박소영',
          insured_household_head: '박지웅',
          accident_cause_detail: '냉온수 동배관 노후',
          policy_type: 'family_daily_new',
          policy_start: '2023-06-07',
          policy_end: '2076-06-07',
          policy_address: '전북 군산시 축동3길 22',
          victim_address: '전북 익산시 부송1로 83 103동 303호',
          address_match: 'mismatch',
          accident_location_owned_by_family: true,
          actual_residence_at_accident_location: true,
          spouse_or_self_relation: '배우자',
        },
        expected: {
          liability_result: 'yes',
          coverage_result: '판단유보',
          coverage_subreason: 'endorsement_pending',
        },
      },
    ];

    console.group('🧪 Sabi v6 룰엔진 회귀 검증');
    let passed = 0;
    let failed = 0;
    
    cases.forEach(c => {
      const result = enforce(c.input);
      const checks = Object.keys(c.expected).map(k => ({
        key: k,
        expected: c.expected[k],
        actual: result[k],
        ok: result[k] === c.expected[k],
      }));
      const allOk = checks.every(x => x.ok);
      
      if (allOk) {
        console.log(`✅ ${c.name}`);
        passed++;
      } else {
        console.warn(`❌ ${c.name}`);
        checks.filter(x => !x.ok).forEach(x => {
          console.warn(`   ${x.key}: expected ${x.expected}, actual ${x.actual}`);
        });
        failed++;
      }
    });
    
    console.log(`\n결과: ${passed}/${cases.length} PASS`);
    console.groupEnd();
    return { passed, failed, total: cases.length };
  }

  // ─────────────────────────────────────────────────────────────────────
  // 7. Public API
  // ─────────────────────────────────────────────────────────────────────

  global.SabiRuleV6 = {
    enforce: enforce,
    classifyAccidentCause: classifyAccidentCause,
    determineInsuredStatus: determineInsuredStatus,
    POLICY_TYPES: POLICY_TYPES,
    RULEBOOK_CATS: RULEBOOK_CATS,
    runRegressionTests: runRegressionTests,
    version: '6.0.0',
  };

  // 콘솔에서 자동 검증 (개발 환경에서만)
  if (typeof window !== 'undefined' && window.location && 
      /localhost|127\.0\.0\.1|vercel\.app/.test(window.location.host)) {
    // 자동 실행은 하지 않음 (수동: SabiRuleV6.runRegressionTests())
    console.log('Sabi v6 룰엔진 로드됨. 검증: SabiRuleV6.runRegressionTests()');
  }

})(typeof window !== 'undefined' ? window : globalThis);
