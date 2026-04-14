// v2026-04-13-03 — fixed: insSaveInfoClick + insOnTypeChange restored
/**
 * insurance-tab.js
 * 누수패스 보험자료 탭 — Vanilla JS 완성본 (Phase 2 + Phase 3)
 *
 * 의존성:
 *   - sb       : index.html에서 선언된 Supabase 클라이언트
 *   - toast()  : index.html에서 선언된 토스트 함수
 *   - fmtDate(): index.html에서 선언된 날짜 포맷 함수
 *
 * 이 파일은 index.html </body> 직전에 아래 한 줄로 로드합니다:
 *   <script src="./insurance-tab.js"></script>
 */

'use strict';

// ─────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────
const INS_PROMPT_VERSION       = 'v2.3';
const INS_MODEL_NAME           = 'claude-sonnet-4-6';
const INS_LEGAL_BUNDLE_VERSION = 'v1.0';

const INS_TYPE_LABELS = {
  daily_liability_old: '일상생활배상책임 (구형)',
  daily_liability_new: '일상생활배상책임 (신형)',
  facility_liability:  '시설소유(관리)자배상책임',
  water_damage:        '급배수누출손해',
};

const INS_STATUS_KO = {
  docs_pending:     '기사제출 대기',
  docs_received:    '자료 도착',
  info_in_progress: '보험정보 입력중',
  ready_for_draft:  '생성 준비 완료',
  draft_generated:  '초안 생성 완료',
  pdf_submitted:    'PDF 제출 완료',
};

const INS_LEGAL_BUNDLE = `[민법 제750조] 고의 또는 과실로 인한 위법행위로 타인에게 손해를 가한 자는 그 손해를 배상할 책임이 있다.
[민법 제758조] 공작물의 설치 또는 보존의 하자로 인하여 타인에게 손해를 가한 때에는 공작물점유자가 손해를 배상할 책임이 있다. 그러나 점유자가 손해의 방지에 필요한 주의를 해태하지 아니한 때에는 그 소유자가 배상할 책임이 있다.`;

const INS_DRAFT_SECTIONS = [
  { key: 'insured_status',          label: '1. 피보험자 지위',      desc: '소유자겸점유자 / 임대인 / 임차인 / 확인불가' },
  { key: 'accident_cause',          label: '2. 사고원인',           desc: '위치 + 설비 + 원인 구조' },
  { key: 'accident_description',    label: '3. 사고내용(경위)',      desc: '날짜 + 장소 + 원인 + 피해 1문장' },
  { key: 'insurance_period_match',  label: '4. 보험기간 부합 여부', desc: '일치 / 불일치 / 확인불가' },
  { key: 'accident_location_match', label: '5. 사고장소 부합 여부', desc: '주소 표기 차이 허용' },
  { key: 'victim_damages',          label: '6. 피해사항',           desc: 'JSON 배열 — 피해자 다수 대응' },
  { key: 'investigator_opinion',    label: '7. 조사자 의견',        desc: '2~3문장, ~됨·~판단됨 간결체' },
];

// ─────────────────────────────────────────────
// 전역 상태
// ─────────────────────────────────────────────
let _insClaim      = null;   // insurance_claims 현재 row
let _insCaseId     = null;   // intake_cases.id
let _insField      = null;   // partner_assignments 현장 자료
let _insDraft      = null;   // insurance_claim_drafts 현재 초안
let _insSections   = {};     // 편집 중인 섹션 데이터
let _insStep       = 1;      // 현재 탭 단계 (1~5)
let _insUploaded   = [];     // insurance_doc_uploads (is_latest=true)
let _insRequired   = [];     // insurance_required_docs
let _insGenerating = false;

// ─────────────────────────────────────────────
// 진입점: 사건 목록 → 보험자료 탭 열기
// ─────────────────────────────────────────────
async function openInsuranceTab(caseId, caseNo) {
  _insClaim      = null;
  _insCaseId     = caseId;
  _insField      = null;
  _insDraft      = null;
  _insSections   = {};
  _insStep       = 1;
  _insUploaded   = [];
  _insRequired   = [];
  _insGenerating = false;

  go('insurance');
  document.getElementById('insurancePageSub').textContent = `사건 ${caseNo || caseId.slice(0,8)}`;
  document.getElementById('insuranceTabBody').innerHTML =
    `<div class="loading"><span class="spinner"></span> 데이터를 불러오는 중…</div>`;

  try {
    const [claimData, fieldRes] = await Promise.all([
      insEnsureClaim(caseId),
      insFetchFieldData(caseId),
    ]);
    _insClaim = claimData;
    _insField = fieldRes;

    const [uploads, docs] = await Promise.all([
      insFetchUploadedDocs(claimData.id),
      claimData.insurance_type ? insFetchRequiredDocs(claimData.insurance_type) : Promise.resolve([]),
    ]);
    _insUploaded = uploads;
    _insRequired = docs;

    if (claimData.current_draft_id) {
      _insDraft = await insFetchCurrentDraft(claimData.id);
      if (_insDraft) _insSections = _insDraft.sections_jsonb || {};
    }

    const stepMap = {
      docs_pending: 1, docs_received: 1, info_in_progress: 2,
      ready_for_draft: 3, draft_generated: 4, pdf_submitted: 5,
    };
    _insStep = stepMap[claimData.insurance_tab_status] || 1;
    insRender();
  } catch(e) {
    document.getElementById('insuranceTabBody').innerHTML =
      `<div class="card" style="color:var(--red)">오류: ${e.message}</div>`;
  }
}

// 드롭다운용: 수리완료 사건 목록 로드
async function loadInsuranceCaseSelector() {
  const sel = document.getElementById('insuranceCaseSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">— 사건 선택 —</option>';

  const { data } = await sb
    .from('partner_assignments')
    .select('case_id, intake_cases(case_no, customer_name)')
    .eq('work_status', 'repair_done')
    .eq('assignment_status', 'accepted')
    .order('created_at', { ascending: false });

  if (!data || !data.length) {
    sel.innerHTML = '<option value="">수리완료 사건이 없습니다</option>';
    return;
  }
  sel.innerHTML = '<option value="">— 사건 선택 —</option>' +
    data.map(a =>
      `<option value="${a.case_id}">${a.intake_cases?.case_no || '-'} · ${a.intake_cases?.customer_name || '-'}</option>`
    ).join('');
}

// 드롭다운 선택 시
async function onInsuranceCaseSelect(val) {
  if (!val) return;
  const sel = document.getElementById('insuranceCaseSelect');
  const opt = sel.options[sel.selectedIndex];
  const caseNo = opt.text.split('·')[0].trim();
  await openInsuranceTab(val, caseNo);
}

// ─────────────────────────────────────────────
// Phase 2 API 함수
// ─────────────────────────────────────────────

async function insEnsureClaim(caseId) {
  const { data: existing } = await sb
    .from('insurance_claims')
    .select('id, insurance_tab_status, insurance_type, accident_date, insurer_name, coverage_limit, deductible, current_draft_id, pdf_submitted_at, insurer_contact')
    .eq('case_id', caseId)
    .maybeSingle();
  if (existing) return existing;

  const { data, error } = await sb
    .from('insurance_claims')
    .insert({ case_id: caseId, insurance_tab_status: 'docs_received' })
    .select('id, insurance_tab_status, insurance_type, accident_date, insurer_name, coverage_limit, deductible, current_draft_id, pdf_submitted_at, insurer_contact')
    .single();
  if (error) throw new Error('claim 생성 실패: ' + error.message);
  return data;
}

async function insFetchFieldData(caseId) {
  const { data, error } = await sb
    .from('partner_assignments')
    .select('id, repair_cost, repair_opinion, work_done_at, visited_at')
    .eq('case_id', caseId)
    .eq('work_status', 'repair_done')
    .eq('assignment_status', 'accepted')
    .order('work_done_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('현장 자료 조회 실패: ' + error.message);
  return data;
}

async function insFetchRequiredDocs(insuranceType) {
  if (!insuranceType) return [];
  const { data, error } = await sb
    .from('insurance_required_docs')
    .select('doc_code, doc_name, is_required, display_order')
    .eq('insurance_type', insuranceType)
    .order('display_order', { ascending: true });
  if (error) throw new Error('필수서류 조회 실패: ' + error.message);
  return data || [];
}

async function insFetchUploadedDocs(claimId) {
  const { data, error } = await sb
    .from('insurance_doc_uploads')
    .select('id, doc_code, doc_name, file_path, uploaded_at')
    .eq('claim_id', claimId)
    .eq('is_latest', true)
    .order('uploaded_at', { ascending: false });
  if (error) throw new Error('업로드 목록 조회 실패: ' + error.message);
  return data || [];
}

async function insSaveInfo(payload) {
  const { error } = await sb
    .from('insurance_claims')
    .update({
      insurance_type:       payload.insurance_type  || null,
      accident_date:        payload.accident_date   || null,
      insurer_name:         payload.insurer_name    || null,
      coverage_limit:       payload.coverage_limit  ? Number(payload.coverage_limit)  : null,
      deductible:           payload.deductible      ? Number(payload.deductible)      : null,
      insurance_tab_status: 'info_in_progress',
    })
    .eq('id', _insClaim.id);
  if (error) throw new Error('보험정보 저장 실패: ' + error.message);
  _insClaim = { ..._insClaim, ...payload, insurance_tab_status: 'info_in_progress' };
}

async function insUploadDoc(file, docCode, docName) {
  if (!_insClaim || !_insClaim.id) throw new Error('사건 정보가 없습니다. 페이지를 새로고침 해주세요.');

  const allowedTypes = ['application/pdf','image/jpeg','image/jpg','image/png','image/webp','image/heic'];
  if (!allowedTypes.includes(file.type)) throw new Error('허용되지 않는 파일 형식입니다: ' + file.type);
  if (file.size > 20 * 1024 * 1024) throw new Error('파일이 20MB를 초과합니다.');

  await sb.from('insurance_doc_uploads')
    .update({ is_latest: false })
    .eq('claim_id', _insClaim.id)
    .eq('doc_code', docCode)
    .eq('is_latest', true);

  const ext = file.name.split('.').pop().toLowerCase() || 'pdf';
  const safeExt = ['pdf','jpg','jpeg','png','webp','heic'].includes(ext) ? ext : 'pdf';
  const filePath = `${_insClaim.id}/${docCode}/${Date.now()}.${safeExt}`;

  const { error: upErr } = await sb.storage
    .from('insurance-docs')
    .upload(filePath, file, { cacheControl: '3600', upsert: true });
  if (upErr) throw new Error('Storage 업로드 실패: ' + upErr.message);

  const { error: dbErr } = await sb.from('insurance_doc_uploads').insert({
    claim_id:     _insClaim.id,
    doc_code:     docCode,
    doc_name:     docName,
    doc_category: 'insured',
    file_path:    filePath,
    file_kind:    'original',
    source_type:  'admin',
    is_latest:    true,
  });
  if (dbErr) throw new Error('서류 DB 저장 실패: ' + dbErr.message);

  _insUploaded = await insFetchUploadedDocs(_insClaim.id);
}

async function insValidateReady() {
  const [uploadsRes, assignmentRes, requiredRes] = await Promise.all([
    sb.from('insurance_doc_uploads').select('doc_code').eq('claim_id', _insClaim.id).eq('is_latest', true),
    sb.from('partner_assignments').select('repair_cost, repair_opinion, work_done_at')
      .eq('case_id', _insCaseId).eq('work_status', 'repair_done').limit(1).maybeSingle(),
    _insClaim.insurance_type
      ? sb.from('insurance_required_docs').select('doc_code, doc_name')
          .eq('insurance_type', _insClaim.insurance_type).eq('is_required', true)
      : Promise.resolve({ data: [] }),
  ]);

  const uploadedCodes = new Set((uploadsRes.data || []).map(u => u.doc_code));
  const missing = (requiredRes.data || []).filter(d => !uploadedCodes.has(d.doc_code)).map(d => d.doc_name);
  const pa = assignmentRes.data;

  return [
    { key: 'insurance_type', label: '보험종목 선택 완료',
      pass: !!_insClaim.insurance_type, reason: '보험종목을 선택해 주세요.' },
    { key: 'accident_date',  label: '사고일자 입력 완료',
      pass: !!_insClaim.accident_date, reason: '사고일자를 입력해 주세요.' },
    { key: 'required_docs',  label: '필수서류 전체 업로드 완료',
      pass: missing.length === 0, reason: missing.length ? '미업로드: ' + missing.join(', ') : null },
    { key: 'field_data',     label: '현장 자료 확인 완료 (수리비·소견·방문일)',
      pass: !!(pa?.repair_cost && pa?.repair_opinion && pa?.work_done_at),
      reason: '기사가 수리완료 보고서를 제출해야 합니다.' },
    { key: 'sanitized_vars', label: '비식별화 처리 완료 (Phase 2: 수동 입력)', pass: true },
  ];
}

async function insMarkReady() {
  const { error } = await sb.from('insurance_claims')
    .update({ insurance_tab_status: 'ready_for_draft' })
    .eq('id', _insClaim.id);
  if (error) throw new Error('상태 전환 실패: ' + error.message);
  _insClaim = { ..._insClaim, insurance_tab_status: 'ready_for_draft' };
}

// ─────────────────────────────────────────────
// Phase 3 API 함수
// ─────────────────────────────────────────────

async function insRunClaude(vars, onProgress) {
  const stages = INS_DRAFT_SECTIONS.map(s => s.label);

  const systemPrompt = `당신은 대한민국 독립손해사정사입니다.
누수사고 자료를 기반으로 손해사정서 초안을 작성합니다.
반드시 JSON 형식으로만 응답하세요. 마크다운 코드블록 없이 순수 JSON만 반환합니다.
개인정보(실명, 주민번호, 전체 주소)는 절대 포함하지 마세요.

적용 법령:
${INS_LEGAL_BUNDLE}`;

  const userPrompt = `아래 7개 필드를 포함한 JSON 객체를 반환하세요.

{
  "insured_status": "소유자겸점유자 | 임대인 | 임차인 | 확인불가",
  "accident_cause": "위치+설비+원인 구조 1~2문장",
  "accident_description": "사고일+장소(비식별)+원인+피해 1문장",
  "insurance_period_match": "일치 | 불일치 | 확인불가",
  "accident_location_match": "일치 | 불일치 | 확인불가",
  "victim_damages": [{"victim_id": "피해자(비식별)", "damage_type": "대물피해", "amount": 숫자, "description": "내용"}],
  "investigator_opinion": "2~3문장, ~됨·~판단됨 간결체"
}

=== 입력 변수 (비식별화 완료) ===
보험종목: ${vars.insurance_type_label}
사고일자: ${vars.accident_date}
보험사: ${vars.insurer_name || '미확인'}
보상한도액: ${vars.coverage_limit ? Number(vars.coverage_limit).toLocaleString() + '원' : '미확인'}
자기부담금: ${vars.deductible ? Number(vars.deductible).toLocaleString() + '원' : '미확인'}
피보험자: ${vars.insured_name_masked}
사고장소: ${vars.accident_location_masked}
수리금액: ${vars.repair_cost ? Number(vars.repair_cost).toLocaleString() + '원' : '미확인'}
수리 소견: ${vars.repair_opinion || '없음'}
방문일: ${vars.work_done_at || '미확인'}
`;

  for (let i = 0; i < stages.length; i++) {
    onProgress(i + 1, stages[i], stages.length);
    await new Promise(r => setTimeout(r, 100));
  }

  const response = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:      INS_MODEL_NAME,
      max_tokens: 2000,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error('Claude API 오류: ' + (err?.error?.message || response.status));
  }

  const result = await response.json();
  const raw    = result.content?.[0]?.text || '';

  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    throw new Error('Claude 응답 파싱 실패: ' + raw.slice(0, 120));
  }
}

async function insSaveDraft(inputVars, sections) {
  const { data, error } = await sb.rpc('rpc_create_insurance_draft', {
    p_claim_id:             _insClaim.id,
    p_prompt_version:       INS_PROMPT_VERSION,
    p_model_name:           INS_MODEL_NAME,
    p_legal_bundle_version: INS_LEGAL_BUNDLE_VERSION,
    p_input_vars_jsonb:     inputVars,
    p_sections_jsonb:       sections,
  });
  if (error) throw new Error('초안 저장 실패: ' + error.message);
  return data?.[0];
}

async function insFetchCurrentDraft(claimId) {
  const { data, error } = await sb
    .from('insurance_claim_drafts')
    .select('id, draft_version, sections_jsonb, model_name, created_at, status')
    .eq('claim_id', claimId)
    .eq('is_current', true)
    .maybeSingle();
  if (error) throw new Error('초안 조회 실패: ' + error.message);
  return data;
}

async function insUpdateDraftSections(sections) {
  if (!_insDraft) return;
  const { error } = await sb
    .from('insurance_claim_drafts')
    .update({ sections_jsonb: sections, status: 'reviewed' })
    .eq('id', _insDraft.id);
  if (error) throw new Error('초안 수정 실패: ' + error.message);
}

async function insSubmitToInsurer(contact, memo) {
  const { error } = await sb
    .from('insurance_claims')
    .update({
      insurance_tab_status: 'pdf_submitted',
      pdf_submitted_at:     new Date().toISOString(),
      insurer_contact:      contact || null,
      submission_memo:      memo    || null,
    })
    .eq('id', _insClaim.id)
    .neq('insurance_tab_status', 'pdf_submitted');
  if (error) throw new Error('제출 처리 실패: ' + error.message);
  _insClaim = { ..._insClaim, insurance_tab_status: 'pdf_submitted' };
}

// ─────────────────────────────────────────────
// 렌더링
// ─────────────────────────────────────────────

function insRender() {
  const body = document.getElementById('insuranceTabBody');
  if (!body) return;
  body.innerHTML = `${insRenderStepBar()}<div id="insStepContent"></div>`;
  const content = document.getElementById('insStepContent');
  if      (_insStep === 1) content.innerHTML = insStep1HTML();
  else if (_insStep === 2) content.innerHTML = insStep2HTML();
  else if (_insStep === 3) content.innerHTML = insStep3HTML();
  else if (_insStep === 4) content.innerHTML = insStep4HTML();
  else if (_insStep === 5) content.innerHTML = insStep5HTML();
}

function insRenderStepBar() {
  const steps = ['현장제출 자료', '보험정보 입력', '생성 준비 확인', '초안 검토', 'PDF 제출관리'];
  return `<div class="ins-step-bar">${steps.map((label, i) => {
    const n   = i + 1;
    const cls = n < _insStep ? 'ins-step-done' : n === _insStep ? 'ins-step-active' : 'ins-step-locked';
    return `<div class="ins-step ${cls}"><div class="ins-step-dot"></div><div class="ins-step-num">${n}단계</div><div class="ins-step-label">${label}</div></div>`;
  }).join('')}</div>`;
}

// ── 1단계 ──
function insStep1HTML() {
  const fd = _insField;
  const fieldCard = fd
    ? `<div class="detail-grid" style="margin-bottom:0">
        <div class="detail-item"><label>수리 금액</label><span>${fd.repair_cost ? Number(fd.repair_cost).toLocaleString() + '원' : '—'}</span></div>
        <div class="detail-item"><label>수리 완료일</label><span>${fd.work_done_at ? fd.work_done_at.slice(0,10) : '—'}</span></div>
        <div class="detail-item full"><label>누수 소견</label><span>${fd.repair_opinion || '—'}</span></div>
      </div>`
    : '<div class="empty"><div class="empty-text">기사가 아직 수리완료 보고서를 제출하지 않았습니다</div></div>';

  return `
    <div class="card">
      <div style="font-size:14px;font-weight:900;margin-bottom:14px">기사 제출 자료</div>
      ${fieldCard}
    </div>
    <div class="ins-action-bar">
      <span></span>
      <button class="btn btn-primary" ${!fd ? 'disabled' : ''} onclick="insGoStep(2)">
        다음 — 보험정보 입력
      </button>
    </div>`;
}

// ── 2단계 ──
function insStep2HTML() {
  const cl = _insClaim || {};
  const uploadedSet = new Set(_insUploaded.map(d => d.doc_code));

  const docListHTML = !cl.insurance_type
    ? `<div class="ins-banner ins-banner-info">보험종목을 선택하면 필수서류 목록이 표시됩니다.</div>`
    : _insRequired.map(doc => {
        const done       = uploadedSet.has(doc.doc_code);
        const uploadedAt = done
          ? (_insUploaded.find(u => u.doc_code === doc.doc_code)?.uploaded_at?.slice(0,10) || '')
          : null;
        return `
          <div class="ins-doc-item ${done ? 'ins-doc-done' : 'ins-doc-missing'}">
            <div class="ins-doc-left">
              <span class="ins-doc-icon ${done ? 'ins-icon-ok' : 'ins-icon-no'}">${done ? '✓' : '!'}</span>
              <div>
                <div class="ins-doc-name">${doc.doc_name}</div>
                <div class="ins-doc-sub">${done ? '업로드 완료 · ' + uploadedAt : (doc.is_required ? '필수 서류' : '선택 서류')}</div>
              </div>
            </div>
            <label class="btn btn-ghost btn-sm" style="cursor:pointer">
              ${done ? '재업로드' : '업로드'}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" style="display:none"
                onchange="insHandleFileUpload(event, '${doc.doc_code}', '${doc.doc_name}')"/>
            </label>
          </div>`;
      }).join('');

  const allRequired = _insRequired.filter(d => d.is_required).every(d => uploadedSet.has(d.doc_code));
  const canNext     = !!cl.insurance_type && !!cl.accident_date && allRequired;

  return `
    <div class="card">
      <div style="font-size:14px;font-weight:900;margin-bottom:14px">보험 기본 정보</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group">
          <label class="form-label">보험종목 *</label>
          <select class="form-control" id="insTypeSelect" onchange="insOnTypeChange(this.value)">
            <option value="">— 선택 —</option>
            ${Object.entries(INS_TYPE_LABELS).map(([v,l]) =>
              `<option value="${v}" ${cl.insurance_type===v?'selected':''}>${l}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">사고일자 *</label>
          <input class="form-control" type="date" id="insDateInput" value="${cl.accident_date||''}"/>
        </div>
        <div class="form-group">
          <label class="form-label">보험사</label>
          <input class="form-control" type="text" id="insInsurerInput" placeholder="예: 삼성화재" value="${cl.insurer_name||''}"/>
        </div>
        <div class="form-group">
          <label class="form-label">보상한도액 (원)</label>
          <input class="form-control" type="number" id="insCovInput" placeholder="예: 100000000" value="${cl.coverage_limit||''}"/>
        </div>
        <div class="form-group">
          <label class="form-label">자기부담금 (원)</label>
          <input class="form-control" type="number" id="insDedInput" placeholder="예: 200000" value="${cl.deductible||''}"/>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:4px">
        <button class="btn btn-ghost btn-sm" onclick="insSaveInfoClick()">임시 저장</button>
      </div>
    </div>

    <div class="card">
      <div style="font-size:14px;font-weight:900;margin-bottom:14px">필수서류 업로드</div>
      <div>${docListHTML}</div>
    </div>

    <div class="ins-action-bar">
      <button class="btn btn-ghost" onclick="insGoStep(1)">이전</button>
      <button class="btn btn-primary" ${canNext ? '' : 'disabled'} onclick="insGoStep3Click()">
        다음 — 생성 준비 확인
      </button>
    </div>`;
}

// ── 3단계 ──
function insStep3HTML() {
  const cl = _insClaim || {};
  return `
    <div id="insChecklist" class="card">
      <div style="font-size:14px;font-weight:900;margin-bottom:14px">생성 준비 체크리스트</div>
      <div class="loading"><span class="spinner"></span> 검증 중…</div>
    </div>

    <div class="card">
      <div style="font-size:14px;font-weight:900;margin-bottom:14px">Claude 전송 변수 미리보기 (비식별화 완료)</div>
      <div class="detail-grid">
        <div class="detail-item"><label>보험종목</label><span>${INS_TYPE_LABELS[cl.insurance_type]||'—'}</span></div>
        <div class="detail-item"><label>사고일자</label><span>${cl.accident_date||'—'}</span></div>
        <div class="detail-item"><label>보험사</label><span>${cl.insurer_name||'—'}</span></div>
        <div class="detail-item"><label>수리금액</label><span>${_insField?.repair_cost ? Number(_insField.repair_cost).toLocaleString()+'원' : '—'}</span></div>
        <div class="detail-item"><label>피보험자</label><span>홍○○ (비식별화)</span></div>
        <div class="detail-item"><label>사고장소</label><span>용인시 수지구 (비식별화)</span></div>
        <div class="detail-item full"><label>수리 소견</label><span>${_insField?.repair_opinion||'—'}</span></div>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:8px">※ 실명·전체 주소·주민번호는 Claude API에 전송되지 않습니다.</div>
    </div>

    <div class="ins-action-bar">
      <button class="btn btn-ghost" onclick="insGoStep(2)">이전</button>
      <button class="btn btn-primary" id="insGenerateBtn" disabled onclick="insGenerateClick()">
        Claude 초안 생성
      </button>
    </div>

    <div id="insProgressBar" style="display:none;margin-top:12px;padding:12px;background:var(--primary-soft);border-radius:8px">
      <div style="height:6px;background:var(--line);border-radius:3px;overflow:hidden;margin-bottom:6px">
        <div id="insProgressFill" style="height:100%;background:var(--primary);border-radius:3px;transition:width .3s;width:0%"></div>
      </div>
      <div id="insProgressLabel" style="font-size:12px;color:var(--primary)">준비 중…</div>
    </div>`;
}

// ── 4단계 ──
function insStep4HTML() {
  const draftInfo = _insDraft
    ? `✓ 초안 v${_insDraft.draft_version} · ${_insDraft.model_name || INS_MODEL_NAME} · ${(_insDraft.created_at||'').slice(0,10)}`
    : '초안 정보 없음';

  const sectionsHTML = INS_DRAFT_SECTIONS.map(sec => {
    const val = _insSections[sec.key];
    let displayVal = '(생성된 내용 없음 — 클릭하여 직접 입력)';
    if (val !== undefined && val !== null) {
      if (sec.key === 'victim_damages' && Array.isArray(val)) {
        displayVal = val.map(v =>
          `<div>${v.victim_id} · ${v.damage_type}${v.amount ? ' · '+Number(v.amount).toLocaleString()+'원':''} — ${v.description||''}</div>`
        ).join('');
      } else {
        displayVal = String(val);
      }
    }
    return `
      <div class="ins-draft-section" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div>
            <strong style="font-size:13px">${sec.label}</strong>
            <span style="font-size:11px;color:var(--muted);margin-left:6px">${sec.desc}</span>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="insStartEdit('${sec.key}')">수정</button>
        </div>
        <div id="insSecDisplay_${sec.key}" class="ins-draft-content" onclick="insStartEdit('${sec.key}')" style="cursor:pointer">
          ${displayVal}
        </div>
        <div id="insSecEdit_${sec.key}" style="display:none">
          <textarea class="form-control" id="insSecTA_${sec.key}" rows="3" style="font-size:13px"
            >${sec.key === 'victim_damages' && Array.isArray(val) ? JSON.stringify(val, null, 2) : (val||'')}</textarea>
          <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:6px">
            <button class="btn btn-ghost btn-sm" onclick="insCancelEdit('${sec.key}')">취소</button>
            <button class="btn btn-primary btn-sm" onclick="insConfirmEdit('${sec.key}')">확인</button>
          </div>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="ins-banner ins-banner-success">${draftInfo} <span id="insDraftSaving" style="margin-left:8px;opacity:.6;display:none">저장 중…</span></div>
    <div class="card">
      <div style="font-size:14px;font-weight:900;margin-bottom:14px">손해사정서 초안 — 섹션별 검토·수정</div>
      ${sectionsHTML}
    </div>
    <div class="ins-action-bar">
      <button class="btn btn-ghost" onclick="insGoStep(3)">이전</button>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" onclick="insRegenerate()" ${_insGenerating?'disabled':''}>
          ${_insGenerating ? '재생성 중…' : '초안 재생성'}
        </button>
        <button class="btn btn-primary" onclick="insGoStep(5)">검토 완료 — PDF 제출관리</button>
      </div>
    </div>`;
}

// ── 5단계 ──
function insStep5HTML() {
  const submitted = _insClaim?.insurance_tab_status === 'pdf_submitted';
  const banner    = submitted
    ? `<div class="ins-banner ins-banner-success">✓ 보험사 제출 완료 처리됨 — 사건 종결 대기</div>`
    : '';
  return `
    ${banner}
    <div class="card">
      <div style="font-size:14px;font-weight:900;margin-bottom:14px">보험사 제출</div>
      <div class="form-group">
        <label class="form-label">보험사 담당자</label>
        <input class="form-control" id="insContactInput" placeholder="예: 삼성화재 홍○○ 팀장 010-0000-0000"
          value="${_insClaim?.insurer_contact||''}" ${submitted?'disabled':''}/>
      </div>
      <div class="form-group">
        <label class="form-label">제출 메모</label>
        <input class="form-control" id="insMemoInput" placeholder="예: 이메일 접수 / 팩스 발송" ${submitted?'disabled':''}/>
      </div>
      ${!submitted ? `
        <button class="btn btn-success" style="width:100%;justify-content:center" onclick="insSubmitClick()">
          보험사 제출 완료 처리
        </button>` : `
        <div class="detail-grid" style="margin-top:12px">
          <div class="detail-item"><label>제출일시</label><span>${(_insClaim?.pdf_submitted_at||'').slice(0,10)||'—'}</span></div>
          <div class="detail-item"><label>담당자</label><span>${_insClaim?.insurer_contact||'—'}</span></div>
        </div>`}
    </div>
    <div class="ins-action-bar">
      <button class="btn btn-ghost" onclick="insGoStep(4)">이전</button>
      <span class="badge ${submitted?'badge-green':'badge-blue'}">${submitted?'PDF 제출 완료':'제출 대기'}</span>
    </div>`;
}

// ─────────────────────────────────────────────
// 이벤트 핸들러 (HTML onclick에서 호출)
// ─────────────────────────────────────────────

function insGoStep(n) {
  _insStep = n;
  insRender();
  if (n === 3) insLoadChecklist();
}

async function insGoStep3Click() {
  try {
    await insSaveInfoClick();
    insGoStep(3);
  } catch(e) {
    toast('저장 실패: ' + e.message, 'e');
  }
}

// ✅ 수정됨: 깨진 함수 복원
async function insSaveInfoClick() {
  const payload = {
    insurance_type: document.getElementById('insTypeSelect')?.value || _insClaim?.insurance_type,
    accident_date:  document.getElementById('insDateInput')?.value  || _insClaim?.accident_date,
    insurer_name:   document.getElementById('insInsurerInput')?.value,
    coverage_limit: document.getElementById('insCovInput')?.value,
    deductible:     document.getElementById('insDedInput')?.value,
  };
  await insSaveInfo(payload);
  toast('임시 저장 완료', 's');
}

// ✅ 수정됨: 깨진 함수 복원
async function insOnTypeChange(val) {
  _insClaim    = { ..._insClaim, insurance_type: val };
  _insRequired = await insFetchRequiredDocs(val);
  _insStep     = 2;
  insRender();
}

async function insHandleFileUpload(e, docCode, docName) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    await insUploadDoc(file, docCode, docName);
    toast(docName + ' 업로드 완료', 's');
    _insUploaded = await insFetchUploadedDocs(_insClaim.id);
    insRender();
  } catch(err) {
    console.error('업로드 에러 상세:', err);
    toast('업로드 실패: ' + err.message, 'e');
  }
  e.target.value = '';
}

async function insLoadChecklist() {
  try {
    const checks  = await insValidateReady();
    const allPass = checks.every(c => c.pass);
    const html    = checks.map(c => `
      <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;color:${c.pass?'var(--green)':'var(--red)'}">
        <span style="width:18px;height:18px;border-radius:50%;background:${c.pass?'var(--green)':'var(--red)'};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0">${c.pass?'✓':'!'}</span>
        <div>
          <span style="font-size:13px">${c.label}</span>
          ${!c.pass && c.reason ? `<div style="font-size:11px;margin-top:2px">${c.reason}</div>` : ''}
        </div>
      </div>`).join('');

    const box = document.getElementById('insChecklist');
    if (box) {
      box.style.background  = allPass ? 'var(--green-soft)' : 'var(--red-soft)';
      box.style.borderLeft  = `3px solid ${allPass ? 'var(--green)' : 'var(--red)'}`;
      box.innerHTML = `<div style="font-size:14px;font-weight:900;margin-bottom:12px">생성 준비 체크리스트</div>${html}`;
    }
    const btn = document.getElementById('insGenerateBtn');
    if (btn) btn.disabled = !allPass;
    if (allPass) await insMarkReady();
  } catch(e) {
    toast('검증 오류: ' + e.message, 'e');
  }
}

async function insGenerateClick() {
  if (_insGenerating || !_insField) return;
  _insGenerating = true;

  const btn   = document.getElementById('insGenerateBtn');
  const bar   = document.getElementById('insProgressBar');
  const fill  = document.getElementById('insProgressFill');
  const label = document.getElementById('insProgressLabel');
  if (btn) btn.disabled = true;
  if (bar) bar.style.display = 'block';

  try {
    const inputVars = {
      insurance_type_label:     INS_TYPE_LABELS[_insClaim.insurance_type] || _insClaim.insurance_type,
      accident_date:            _insClaim.accident_date,
      insurer_name:             _insClaim.insurer_name,
      coverage_limit:           _insClaim.coverage_limit,
      deductible:               _insClaim.deductible,
      insured_name_masked:      '홍○○',
      accident_location_masked: '용인시 수지구',
      repair_cost:              _insField.repair_cost,
      repair_opinion:           _insField.repair_opinion,
      work_done_at:             (_insField.work_done_at||'').slice(0,10),
    };

    const generated = await insRunClaude(inputVars, (stage, stageName, total) => {
      if (btn)   btn.textContent     = `${stage}/${total} — ${stageName}`;
      if (fill)  fill.style.width    = `${(stage/total)*100}%`;
      if (label) label.textContent   = stageName + ' 분석 중…';
    });

    const saved = await insSaveDraft(inputVars, generated);
    _insSections = generated;
    _insDraft    = {
      id:            saved.draft_id,
      draft_version: saved.draft_version,
      model_name:    INS_MODEL_NAME,
      created_at:    new Date().toISOString(),
    };
    _insClaim = { ..._insClaim, insurance_tab_status: 'draft_generated', current_draft_id: saved.draft_id };
    _insStep  = 4;
    insRender();
    toast('초안 생성 완료!', 's');
  } catch(e) {
    toast('생성 실패: ' + e.message, 'e');
    if (btn) { btn.disabled = false; btn.textContent = 'Claude 초안 생성'; }
    if (bar) bar.style.display = 'none';
  } finally {
    _insGenerating = false;
  }
}

async function insRegenerate() {
  if (!confirm('현재 초안을 버리고 새로 생성합니다. 계속하시겠습니까?')) return;
  _insStep = 3;
  insRender();
  await insLoadChecklist();
  const checks = await insValidateReady();
  if (checks.every(c => c.pass)) await insGenerateClick();
}

function insStartEdit(key) {
  const display = document.getElementById(`insSecDisplay_${key}`);
  const editDiv = document.getElementById(`insSecEdit_${key}`);
  if (display) display.style.display = 'none';
  if (editDiv) editDiv.style.display = 'block';
  const ta = document.getElementById(`insSecTA_${key}`);
  if (ta) { ta.focus(); ta.select(); }
}

function insCancelEdit(key) {
  const display = document.getElementById(`insSecDisplay_${key}`);
  const editDiv = document.getElementById(`insSecEdit_${key}`);
  if (display) display.style.display = 'block';
  if (editDiv) editDiv.style.display = 'none';
}

async function insConfirmEdit(key) {
  const ta = document.getElementById(`insSecTA_${key}`);
  if (!ta) return;
  let val = ta.value;
  try { val = JSON.parse(val); } catch { /* 문자열 유지 */ }

  _insSections = { ..._insSections, [key]: val };

  const display = document.getElementById(`insSecDisplay_${key}`);
  const editDiv = document.getElementById(`insSecEdit_${key}`);
  if (display) {
    if (key === 'victim_damages' && Array.isArray(val)) {
      display.innerHTML = val.map(v =>
        `<div>${v.victim_id} · ${v.damage_type}${v.amount?' · '+Number(v.amount).toLocaleString()+'원':''} — ${v.description||''}</div>`
      ).join('');
    } else {
      display.textContent = String(val);
    }
    display.style.display = 'block';
  }
  if (editDiv) editDiv.style.display = 'none';

  const savingEl = document.getElementById('insDraftSaving');
  if (savingEl) savingEl.style.display = 'inline';
  try { await insUpdateDraftSections(_insSections); }
  catch(e) { toast('수정 저장 실패: ' + e.message, 'e'); }
  finally { if (savingEl) savingEl.style.display = 'none'; }
}

async function insSubmitClick() {
  const contact = document.getElementById('insContactInput')?.value || '';
  const memo    = document.getElementById('insMemoInput')?.value    || '';
  try {
    await insSubmitToInsurer(contact, memo);
    insRender();
    toast('보험사 제출 완료 처리됐습니다.', 's');
  } catch(e) {
    toast('제출 실패: ' + e.message, 'e');
  }
}
