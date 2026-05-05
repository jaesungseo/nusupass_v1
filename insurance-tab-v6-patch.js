/**
 * ═══════════════════════════════════════════════════════════════════════════
 * insurance-tab v6 패치 모듈 — `insurance-tab-v6-patch.js`
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 작성일: 2026-05-05
 * 적용 대상: 누수패스 v5.7.2 → v6
 * 의존성: sabi-rule-v6.js, supabase-js, 기존 insurance-tab.js
 *
 * 본 패치는 기존 insurance-tab.js를 대체하지 않고, 
 * 추가 기능(약관선택 모달, 파트너 임포트, 룰엔진 연동)만 모듈화한다.
 *
 * 통합 방법:
 *   1. index.html의 <script src="insurance-tab.js"></script> 직후에 추가:
 *      <script src="sabi-rule-v6.js"></script>
 *      <script src="insurance-tab-v6-patch.js"></script>
 *
 *   2. 보고서 작성 진입점에서 InsuranceTabV6.openPolicySelectModal() 호출:
 *      const reportBtn = document.querySelector('#btn-create-report');
 *      reportBtn.addEventListener('click', () => {
 *        InsuranceTabV6.openPolicySelectModal({ caseId: currentCaseId });
 *      });
 *
 * 네임스페이스: window.InsuranceTabV6
 * ═══════════════════════════════════════════════════════════════════════════
 */

(function (global) {
  'use strict';

  if (typeof global.SabiRuleV6 === 'undefined') {
    console.error('[InsuranceTabV6] sabi-rule-v6.js를 먼저 로드해야 합니다.');
    return;
  }

  const { POLICY_TYPES } = global.SabiRuleV6;

  // ─────────────────────────────────────────────────────────────────────
  // 1. 약관선택 모달
  // ─────────────────────────────────────────────────────────────────────

  /**
   * 보고서 작성 진입 시 약관 선택 모달을 띄움
   * @param {object} opts - { caseId, onConfirm(policyType), onCancel() }
   */
  function openPolicySelectModal(opts) {
    opts = opts || {};
    const onConfirm = opts.onConfirm || (() => {});
    const onCancel = opts.onCancel || (() => {});

    // 기존 모달 제거
    const existing = document.getElementById('v6-policy-select-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'v6-policy-select-modal';
    modal.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    `;

    modal.innerHTML = `
      <div style="background: white; border-radius: 12px; padding: 32px;
                  max-width: 540px; width: 90%; max-height: 90vh; overflow-y: auto;
                  box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
        <h2 style="margin: 0 0 8px 0; font-size: 22px; color: #1B4F72;">
          약관 종류 선택
        </h2>
        <p style="margin: 0 0 24px 0; color: #666; font-size: 14px;">
          보고서에 적용할 약관을 선택하세요. 선택값에 따라 입력 항목이 달라집니다.
        </p>

        <div id="v6-policy-options" style="display: flex; flex-direction: column; gap: 12px;">
          ${renderPolicyOption('family_daily_new', '가족일상생활중배상책임 II/III', 
            '신형 (2020.04 이후)', '소유 또는 거주 둘 중 하나만 충족하면 보장. 임대인 보장 통합.', 
            true)}
          ${renderPolicyOption('family_daily_old', '가족일상생활배상책임', 
            '구형 (2020.04 이전)', '소유 + 거주 동시 충족 필요. 임대 시 면책.', 
            false)}
          ${renderPolicyOption('personal_daily', '일상생활배상책임', 
            '단순 일배책', '본인 + 동거 배우자만 보장. 가족 풀 없음.', 
            false)}
        </div>

        <div style="margin: 16px 0 0 0; padding: 12px; background: #F8F9FA;
                    border-radius: 8px; color: #95A5A6; font-size: 13px;">
          <div style="font-weight: 600; margin-bottom: 6px;">⊘ 준비중 (v2 지원 예정)</div>
          <div style="margin-bottom: 4px;">
            <input type="radio" name="v6-policy" disabled>
            <span style="margin-left: 8px;">임대인배상책임</span>
          </div>
          <div>
            <input type="radio" name="v6-policy" disabled>
            <span style="margin-left: 8px;">시설소유배상책임 (관리주체)</span>
          </div>
        </div>

        <div style="margin-top: 24px; display: flex; justify-content: flex-end; gap: 8px;">
          <button id="v6-policy-cancel" style="padding: 10px 20px; border: 1px solid #ddd;
                  background: white; border-radius: 6px; cursor: pointer; font-size: 14px;">
            취소
          </button>
          <button id="v6-policy-confirm" style="padding: 10px 20px; border: none;
                  background: #1B4F72; color: white; border-radius: 6px;
                  cursor: pointer; font-size: 14px; font-weight: 600;">
            다음 →
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // 이벤트 바인딩
    modal.querySelector('#v6-policy-cancel').addEventListener('click', () => {
      modal.remove();
      onCancel();
    });

    modal.querySelector('#v6-policy-confirm').addEventListener('click', () => {
      const selected = modal.querySelector('input[name="v6-policy"]:checked');
      if (!selected) {
        alert('약관 종류를 선택해 주세요.');
        return;
      }
      modal.remove();
      onConfirm(selected.value);
    });

    // 옵션 클릭 시 라디오 자동 체크
    modal.querySelectorAll('.v6-policy-option').forEach(el => {
      el.addEventListener('click', (e) => {
        const radio = el.querySelector('input[type="radio"]');
        if (radio && !radio.disabled) {
          radio.checked = true;
        }
      });
    });
  }

  function renderPolicyOption(value, title, badge, desc, defaultChecked) {
    return `
      <label class="v6-policy-option" style="display: block; padding: 14px;
             border: 2px solid #e0e0e0; border-radius: 8px; cursor: pointer;
             transition: all 0.15s;">
        <div style="display: flex; align-items: flex-start; gap: 12px;">
          <input type="radio" name="v6-policy" value="${value}" 
                 ${defaultChecked ? 'checked' : ''}
                 style="margin-top: 4px;">
          <div style="flex: 1;">
            <div style="font-weight: 600; font-size: 15px; color: #2C3E50;">
              ${title}
              <span style="margin-left: 8px; font-size: 12px; padding: 2px 8px;
                           background: #EBF5FB; color: #1B4F72; border-radius: 4px;">
                ${badge}
              </span>
            </div>
            <div style="margin-top: 4px; color: #7F8C8D; font-size: 13px;">
              ${desc}
            </div>
          </div>
        </div>
      </label>
    `;
  }

  // ─────────────────────────────────────────────────────────────────────
  // 2. 파트너 보고서 임포트 UI
  // ─────────────────────────────────────────────────────────────────────

  /**
   * 케이스의 파트너 보고서 목록을 조회 후 임포트 모달 표시
   * @param {object} opts - { caseId, claimId, supabase, onConfirm(assignmentId), onSkip() }
   */
  async function openPartnerImportModal(opts) {
    opts = opts || {};
    const { caseId, claimId, supabase } = opts;
    const onConfirm = opts.onConfirm || (() => {});
    const onSkip = opts.onSkip || (() => {});

    if (!supabase || !caseId) {
      console.warn('[InsuranceTabV6] caseId 또는 supabase 미제공, 임포트 건너뜀');
      onSkip();
      return;
    }

    // partner_assignments 조회 (work_status = 'repair_done' 만)
    let assignments = [];
    try {
      const { data, error } = await supabase
        .from('partner_assignments')
        .select(`
          id, assignment_purpose, work_status, work_done_at,
          accident_datetime_at_site, accident_datetime_source,
          attacker_unit, victim_unit,
          leak_cause, leak_area_type, leak_detail_part,
          repair_cost, repair_opinion, partner_note,
          detection_count, worker_count,
          construction_start_date, construction_end_date,
          partner_company_id,
          partner_companies ( company_name, owner_name, business_no )
        `)
        .eq('case_id', caseId)
        .eq('work_status', 'repair_done')
        .order('work_done_at', { ascending: false });
      
      if (error) throw error;
      assignments = data || [];
    } catch (err) {
      console.error('[InsuranceTabV6] partner_assignments 조회 실패:', err);
    }

    // 모달 생성
    const existing = document.getElementById('v6-import-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'v6-import-modal';
    modal.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    `;

    let cardsHtml = '';
    if (assignments.length === 0) {
      cardsHtml = `
        <div style="padding: 24px; text-align: center; color: #95A5A6;
                    background: #F8F9FA; border-radius: 8px;">
          이 케이스에 작업완료된 파트너 보고서가 없습니다.<br>
          <small style="color: #BDC3C7;">파트너가 작업완료를 보고한 후 다시 시도하세요.</small>
        </div>
      `;
    } else {
      cardsHtml = assignments.map(a => renderAssignmentCard(a)).join('');
    }

    modal.innerHTML = `
      <div style="background: white; border-radius: 12px; padding: 32px;
                  max-width: 720px; width: 90%; max-height: 90vh; overflow-y: auto;
                  box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
        <h2 style="margin: 0 0 8px 0; font-size: 22px; color: #1B4F72;">
          파트너 보고서 임포트
        </h2>
        <p style="margin: 0 0 20px 0; color: #666; font-size: 14px;">
          이 케이스의 파트너 작업 보고서를 자동으로 가져와 보고서 작성을 빠르게 진행합니다.
          <br>임포트 시 사고일자·원인·장소가 자동 채워집니다.
        </p>

        <div id="v6-import-cards" style="display: flex; flex-direction: column; gap: 12px;">
          ${cardsHtml}
        </div>

        <label style="display: flex; align-items: center; gap: 8px; margin-top: 16px;
                      padding: 12px; background: #F8F9FA; border-radius: 6px;
                      font-size: 14px; cursor: pointer;">
          <input type="checkbox" id="v6-skip-import">
          외부 케이스 (파트너 보고서 없이 보험증권만 첨부하여 진행)
        </label>

        <div style="margin-top: 20px; display: flex; justify-content: space-between;">
          <button id="v6-import-back" style="padding: 10px 20px; border: 1px solid #ddd;
                  background: white; border-radius: 6px; cursor: pointer; font-size: 14px;">
            ← 이전
          </button>
          <button id="v6-import-next" style="padding: 10px 20px; border: none;
                  background: #1B4F72; color: white; border-radius: 6px;
                  cursor: pointer; font-size: 14px; font-weight: 600;">
            임포트 후 다음 →
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#v6-import-back').addEventListener('click', () => {
      modal.remove();
      onSkip();
    });

    modal.querySelector('#v6-import-next').addEventListener('click', async () => {
      const skip = modal.querySelector('#v6-skip-import').checked;
      const selectedCb = modal.querySelector('input[name="v6-assignment"]:checked');
      
      if (skip) {
        modal.remove();
        onSkip();
        return;
      }
      
      if (!selectedCb && assignments.length > 0) {
        alert('임포트할 보고서를 선택하거나, "외부 케이스"를 체크해 주세요.');
        return;
      }

      if (selectedCb && claimId) {
        // 실제 임포트 (RPC 호출 또는 직접 UPDATE)
        try {
          await importPartnerAssignment(supabase, claimId, selectedCb.value, assignments);
          modal.remove();
          onConfirm(selectedCb.value);
        } catch (err) {
          alert('임포트 중 오류 발생: ' + err.message);
        }
      } else {
        modal.remove();
        onSkip();
      }
    });
  }

  function renderAssignmentCard(a) {
    const company = a.partner_companies || {};
    const purposeLabel = a.assignment_purpose === 'detection' ? '누수업체' : '인테리어업체';
    const dateStr = a.accident_datetime_at_site 
      ? new Date(a.accident_datetime_at_site).toLocaleDateString('ko-KR')
      : '미입력';
    const sourceLabel = {
      'attacker_statement': '가해세대 진술',
      'victim_statement': '피해세대 진술',
      'estimated': '추정',
    }[a.accident_datetime_source] || '';

    return `
      <label style="display: block; padding: 16px; border: 2px solid #e0e0e0;
             border-radius: 8px; cursor: pointer; transition: all 0.15s;">
        <div style="display: flex; gap: 12px;">
          <input type="radio" name="v6-assignment" value="${a.id}" style="margin-top: 4px;">
          <div style="flex: 1;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <div style="font-weight: 600; font-size: 15px; color: #2C3E50;">
                ${escapeHtml(company.company_name || '파트너')} 
                <span style="margin-left: 8px; font-size: 12px; padding: 2px 8px;
                             background: ${a.assignment_purpose === 'detection' ? '#EBF5FB' : '#FEF5E7'};
                             color: ${a.assignment_purpose === 'detection' ? '#1B4F72' : '#A04000'};
                             border-radius: 4px;">${purposeLabel}</span>
              </div>
              <div style="font-size: 12px; color: #95A5A6;">
                ${a.work_done_at ? new Date(a.work_done_at).toLocaleDateString('ko-KR') : ''}
              </div>
            </div>
            <div style="font-size: 13px; color: #555; line-height: 1.6;">
              <div>· 누수원인: ${escapeHtml(a.leak_cause || '미입력')}</div>
              <div>· 사고일시: ${dateStr} ${sourceLabel ? `(${sourceLabel})` : ''}</div>
              <div>· 가해세대: ${escapeHtml(a.attacker_unit || '미입력')} / 피해세대: ${escapeHtml(a.victim_unit || '미입력')}</div>
              ${a.detection_count ? `<div>· 탐지 횟수: ${a.detection_count}회</div>` : ''}
              ${a.worker_count ? `<div>· 투입 인원: ${a.worker_count}명</div>` : ''}
            </div>
          </div>
        </div>
      </label>
    `;
  }

  /**
   * partner_assignments → insurance_claims 임포트
   */
  async function importPartnerAssignment(supabase, claimId, assignmentId, assignments) {
    const a = assignments.find(x => x.id === assignmentId);
    if (!a) throw new Error('Assignment not found in list');

    // accident_type 매핑 (DB CHECK 제약 enum)
    const accidentTypeMap = {
      'living': '일상생활', 'kitchen': '일상생활', 'main_room': '일상생활',
      'sub_room_1': '일상생활', 'sub_room_2': '일상생활', 'sub_room_3': '일상생활',
      'bathroom': '주택관리', 'boiler_room': '주택관리', 'utility_room': '주택관리',
      'veranda': '주택관리', 'shared': '공용부', 'other': '미지정',
    };
    const accidentType = accidentTypeMap[a.leak_area_type] || '미지정';

    const updates = {
      accident_datetime: a.accident_datetime_at_site,
      accident_cause_detail: a.leak_cause,
      accident_type: accidentType,
      victim_address: a.victim_unit,
      imported_from_assignment_id: assignmentId,
      imported_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('insurance_claims')
      .update(updates)
      .eq('id', claimId);
    
    if (error) throw error;

    console.log('[InsuranceTabV6] 임포트 완료:', assignmentId);
    return updates;
  }

  // ─────────────────────────────────────────────────────────────────────
  // 3. 룰엔진 결과 미리보기 UI
  // ─────────────────────────────────────────────────────────────────────

  /**
   * 룰엔진 v6 자동 판단 결과를 카드 형태로 표시
   * @param {object} claim - insurance_claims 레코드
   * @returns {HTMLElement} 결과 카드 DOM
   */
  function renderRuleEngineResult(claim) {
    const result = global.SabiRuleV6.enforce(claim);
    
    const liabilityColor = result.liability_result === 'yes' ? '#27AE60' : '#E74C3C';
    const liabilityLabel = result.liability_result === 'yes' ? '성립' : '불성립';
    
    let coverageColor = '#27AE60';
    let coverageBg = '#D4EFDF';
    if (result.coverage_result === '면책') {
      coverageColor = '#E74C3C';
      coverageBg = '#FADBD8';
    } else if (result.coverage_result === '판단유보') {
      coverageColor = '#F39C12';
      coverageBg = '#FDEBD0';
    }
    
    const confidenceLabel = {
      'high': '높음',
      'medium': '중간 (검토 권장)',
      'low': '낮음 (반드시 검토)',
    }[result.confidence] || '';

    const card = document.createElement('div');
    card.style.cssText = `
      background: white; border: 2px solid #e0e0e0; border-radius: 12px;
      padding: 24px; margin: 16px 0; font-family: -apple-system, sans-serif;
    `;

    card.innerHTML = `
      <h3 style="margin: 0 0 16px 0; color: #1B4F72; font-size: 18px;">
        면부책 판단 결과 (자동)
        <span style="margin-left: 8px; font-size: 11px; padding: 2px 8px;
                     background: ${result.confidence === 'high' ? '#D4EFDF' : '#FDEBD0'};
                     color: ${result.confidence === 'high' ? '#1E8449' : '#A04000'};
                     border-radius: 4px;">
          신뢰도: ${confidenceLabel}
        </span>
      </h3>

      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr>
          <td style="padding: 8px 0; color: #666; width: 140px;">사고원인 카테고리</td>
          <td style="padding: 8px 0; font-weight: 600;">
            ${result.rulebook_cat} (${global.SabiRuleV6.RULEBOOK_CATS[result.rulebook_cat]?.label || ''})
          </td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">약관 코드</td>
          <td style="padding: 8px 0; font-weight: 600;">
            ${result.policy_type} (${POLICY_TYPES[result.policy_type]?.label || '미선택'})
          </td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">적용 호</td>
          <td style="padding: 8px 0;">${result.insurance_clause ? result.insurance_clause + '호' : '-'}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">피보험자 지위</td>
          <td style="padding: 8px 0;">${result.insured_status || '확인불가'}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">법률상 책임</td>
          <td style="padding: 8px 0;">
            <span style="color: ${liabilityColor}; font-weight: 600;">${liabilityLabel}</span>
            <span style="margin-left: 8px; color: #95A5A6; font-size: 13px;">
              ${escapeHtml(result.liability_reason || '')}
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">보험금 지급</td>
          <td style="padding: 8px 0;">
            <span style="padding: 4px 12px; background: ${coverageBg}; color: ${coverageColor};
                         font-weight: 700; border-radius: 4px;">
              ${result.coverage_result || '-'}
            </span>
            ${result.coverage_subreason ? 
              `<span style="margin-left: 8px; color: #95A5A6; font-size: 12px;">(${result.coverage_subreason})</span>` 
              : ''}
          </td>
        </tr>
      </table>

      ${result.addendum ? `
        <div style="margin-top: 16px; padding: 12px; background: #FFF9E6;
                    border-left: 4px solid #F39C12; border-radius: 4px;
                    font-size: 13px; color: #555; line-height: 1.6;">
          <div style="font-weight: 600; margin-bottom: 4px; color: #A04000;">
            ▶ 후속조치 권고
          </div>
          ${escapeHtml(result.addendum)}
        </div>
      ` : ''}
    `;

    return card;
  }

  // ─────────────────────────────────────────────────────────────────────
  // 4. 보조 함수
  // ─────────────────────────────────────────────────────────────────────

  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ─────────────────────────────────────────────────────────────────────
  // 5. 통합 흐름 — 보고서 작성 진입점
  // ─────────────────────────────────────────────────────────────────────

  /**
   * 보고서 작성 전체 흐름:
   * 1. 약관 선택 모달
   * 2. 파트너 임포트 모달
   * 3. 기존 insurance-tab.js 흐름으로 진입
   * 
   * @param {object} opts - { caseId, claimId, supabase, onComplete(state) }
   */
  async function startReportFlow(opts) {
    opts = opts || {};
    const { caseId, claimId, supabase } = opts;
    const onComplete = opts.onComplete || (() => {});

    const state = {
      caseId,
      claimId,
      policyType: null,
      importedAssignmentId: null,
    };

    // 1단계: 약관 선택
    openPolicySelectModal({
      caseId,
      onConfirm: async (policyType) => {
        state.policyType = policyType;
        
        // claim에 policy_type 저장
        if (claimId && supabase) {
          try {
            await supabase
              .from('insurance_claims')
              .update({ policy_type: policyType, updated_at: new Date().toISOString() })
              .eq('id', claimId);
          } catch (err) {
            console.error('[InsuranceTabV6] policy_type 저장 실패:', err);
          }
        }
        
        // 2단계: 파트너 임포트
        await openPartnerImportModal({
          caseId,
          claimId,
          supabase,
          onConfirm: (assignmentId) => {
            state.importedAssignmentId = assignmentId;
            onComplete(state);
          },
          onSkip: () => {
            onComplete(state);
          },
        });
      },
      onCancel: () => {
        // 사용자 취소
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // 6. Public API
  // ─────────────────────────────────────────────────────────────────────

  global.InsuranceTabV6 = {
    openPolicySelectModal: openPolicySelectModal,
    openPartnerImportModal: openPartnerImportModal,
    renderRuleEngineResult: renderRuleEngineResult,
    importPartnerAssignment: importPartnerAssignment,
    startReportFlow: startReportFlow,
    version: '6.0.0',
  };

  console.log('[InsuranceTabV6] v6.0.0 로드됨');

})(typeof window !== 'undefined' ? window : globalThis);
