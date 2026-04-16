// v2026-04-16 — 6단계 플로우 + 드래그앤드롭 업로드 + 판단 드롭다운 수정
/**
 * insurance-tab.js
 * 누수패스 보험자료 탭 — 완성본 v3
 *
 * 의존성 (index.html에서 선언):
 *   - sb       : Supabase 클라이언트
 *   - toast()  : 토스트 함수
 *   - curUser  : 현재 로그인 사용자
 *
 * 6단계 플로우:
 *   1. 보고서 시작  (보험사, 조사자, 사고원인 분류)
 *   2. 서류 업로드  (드래그앤드롭 + 클릭, 파트너 수리정보 자동 연동)
 *   3. 정보 추출    (Claude 자동 추출 + 수정 가능)
 *   4. 책임 판단    (드롭다운으로 직접 수정)
 *   5. 보고서 초안  (핵심 필드만 수정)
 *   6. 최종 출력    (PDF + 제출 완료)
 */

'use strict';

// ─────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────
const INS_MODEL        = 'claude-sonnet-4-6';
const INS_PROMPT_VER   = 'v3.0';
const INS_LEGAL_VER    = 'v1.1';

const INS_LEGAL_BUNDLE = `[민법 제750조] 고의 또는 과실로 인한 위법행위로 타인에게 손해를 가한 자는 그 손해를 배상할 책임이 있다.
[민법 제758조] 공작물의 설치 또는 보존의 하자로 인하여 타인에게 손해를 가한 때에는 공작물점유자가 손해를 배상할 책임이 있다. 그러나 점유자가 손해의 방지에 필요한 주의를 해태하지 아니한 때에는 그 소유자가 배상할 책임이 있다.
[상법 제680조] 보험계약자와 피보험자는 손해의 방지와 경감을 위하여 노력하여야 한다.`;

const INS_TYPE_LABELS = {
  daily_liability_old: '일상생활배상책임 (구형)',
  daily_liability_new: '일상생활배상책임 (신형)',
  facility_liability:  '시설소유(관리)자배상책임',
  water_damage:        '급배수누출손해',
};

const INS_INSURERS = [
  '삼성화재해상보험','현대해상화재보험','DB손해보험주식회사',
  'KB손해보험','메리츠화재','한화손해보험','흥국화재해상보험',
  '롯데손해보험','농협손해보험',
];

const INS_CAUSES = [
  '배관','방수층','분배기','보일러',
  '세탁기 호스이탈','배수구 막힘','수도꼭지 미잠금','기타(직접입력)',
];

// 필수/선택 서류 정의
const INS_DOCS = [
  { code:'insurance_policy',    name:'보험증권',           type:'pdf', required:true },
  { code:'resident_reg',        name:'주민등록등본',        type:'img', required:true },
  { code:'building_reg_insured',name:'건축물대장 (가해자)', type:'pdf', required:true },
  { code:'building_reg_victim', name:'건축물대장 (피해자)', type:'pdf', required:true },
  { code:'family_cert',         name:'가족관계증명서',      type:'img', required:false },
  { code:'claim_form',          name:'보험청구서',          type:'pdf', required:false },
];

const STATUS_MAP = {
  docs_pending:     1,
  docs_received:    2,
  info_in_progress: 3,
  ready_for_draft:  4,
  draft_generated:  5,
  pdf_submitted:    6,
};

// ─────────────────────────────────────────────
// 전역 상태
// ─────────────────────────────────────────────
let _insClaim      = null;
let _insCaseId     = null;
let _insField      = null;   // partner_assignments 수리 자료
let _insDraft      = null;
let _insSections   = {};
let _insStep       = 1;
let _insUploaded   = {};     // { doc_code: { id, file_path, doc_name, uploaded_at } }
let _insCompany    = null;   // company_settings
let _insGenerating = false;

// ─────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────
async function openInsuranceTab(caseId, caseNo) {
  // 초기화
  _insClaim = null; _insCaseId = caseId; _insField = null;
  _insDraft = null; _insSections = {}; _insStep = 1;
  _insUploaded = {};

  go('insurance');
  document.getElementById('insurancePageSub').textContent = `사건 ${caseNo || caseId.slice(0,8)}`;
  document.getElementById('insuranceTabBody').innerHTML =
    `<div class="loading"><span class="spinner"></span> 데이터를 불러오는 중…</div>`;

  try {
    // 병렬 로드
    const [claim, field, company] = await Promise.all([
      insEnsureClaim(caseId),
      insFetchFieldData(caseId),
      insFetchCompany(),
    ]);
    _insClaim  = claim;
    _insField  = field;
    _insCompany = company;

    // 업로드된 서류
    const uploads = await insFetchUploadedDocs(claim.id);
    uploads.forEach(u => { _insUploaded[u.doc_code] = u; });

    // 기존 초안
    if (claim.current_draft_id) {
      _insDraft = await insFetchCurrentDraft(claim.id);
      if (_insDraft) _insSections = _insDraft.sections_jsonb || {};
    }

    // 단계 복원
    _insStep = STATUS_MAP[claim.insurance_tab_status] || 1;
    insRender();
  } catch(e) {
    document.getElementById('insuranceTabBody').innerHTML =
      `<div class="card" style="color:var(--red)">오류: ${e.message}</div>`;
  }
}

// 드롭다운용 수리완료 사건 로드
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

  if (!data?.length) {
    sel.innerHTML = '<option value="">수리완료 사건이 없습니다</option>'; return;
  }
  sel.innerHTML = '<option value="">— 사건 선택 —</option>' +
    data.map(a =>
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
// API 함수
// ─────────────────────────────────────────────
async function insEnsureClaim(caseId) {
  const { data: ex } = await sb.from('insurance_claims').select('*')
    .eq('case_id', caseId).maybeSingle();
  if (ex) return ex;
  const { data, error } = await sb.from('insurance_claims')
    .insert({ case_id: caseId, insurance_tab_status: 'docs_pending' })
    .select('*').single();
  if (error) throw new Error('claim 생성 실패: ' + error.message);
  return data;
}

async function insFetchFieldData(caseId) {
  const { data } = await sb.from('partner_assignments')
    .select('id, repair_cost, repair_opinion, work_done_at, visited_at, case_id')
    .eq('case_id', caseId)
    .in('work_status', ['repair_done', 'repair_completed'])
    .order('work_done_at', { ascending: false })
    .limit(1).maybeSingle();
  return data;
}

async function insFetchUploadedDocs(claimId) {
  const { data } = await sb.from('insurance_doc_uploads')
    .select('id, doc_code, doc_name, file_path, uploaded_at')
    .eq('claim_id', claimId).eq('is_latest', true);
  return data || [];
}

async function insFetchCurrentDraft(claimId) {
  const { data } = await sb.from('insurance_claim_drafts')
    .select('id, draft_version, sections_jsonb, model_name, created_at, status')
    .eq('claim_id', claimId).eq('is_current', true).maybeSingle();
  return data;
}

async function insFetchCompany() {
  const { data } = await sb.from('company_settings').select('*').eq('id', 1).maybeSingle();
  return data;
}

// ─────────────────────────────────────────────
// 렌더링 (메인)
// ─────────────────────────────────────────────
function insRender() {
  const body = document.getElementById('insuranceTabBody');
  if (!body) return;
  body.innerHTML = insStepBarHTML() + `<div id="insStepContent"></div>`;
  const c = document.getElementById('insStepContent');
  const renders = [insStep1HTML, insStep2HTML, insStep3HTML, insStep4HTML, insStep5HTML, insStep6HTML];
  c.innerHTML = (renders[_insStep - 1] || insStep1HTML)();
  // 드롭존 초기화 (2단계)
  if (_insStep === 2) insInitDropzones();
}

function insStepBarHTML() {
  const labels = ['보고서 시작', '서류 업로드', '정보 추출', '책임 판단', '보고서 초안', '최종 출력'];
  return `<div class="ins-step-bar">${labels.map((label, i) => {
    const n = i + 1;
    const cls = n < _insStep ? 'ins-step-done' : n === _insStep ? 'ins-step-active' : 'ins-step-locked';
    return `<div class="ins-step ${cls}" onclick="${n <= _insStep ? `insGoStep(${n})` : ''}">
      <div class="ins-step-dot"></div>
      <div class="ins-step-num">${n}단계</div>
      <div class="ins-step-label">${label}</div>
    </div>`;
  }).join('')}</div>`;
}

// ─────────────────────────────────────────────
// STEP 1: 보고서 시작
// ─────────────────────────────────────────────
function insStep1HTML() {
  const cl = _insClaim || {};
  const co = _insCompany || {};
  const today = new Date().toISOString().split('T')[0];

  const insurerOptions = INS_INSURERS
    .map(n => `<option ${cl.insurer_name === n ? 'selected' : ''}>${n}</option>`)
    .join('') + `<option value="기타">기타 (직접 입력)</option>`;

  return `
  <div class="card">
    <div style="font-size:14px;font-weight:900;margin-bottom:16px">📋 보고서 기본 정보</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label class="form-label">보고서 번호</label>
        <input class="form-control" id="ins1-report-no" value="${cl.report_no || ''}" placeholder="저장 시 자동채번" readonly
          style="background:var(--bg);color:var(--muted)"/>
      </div>
      <div class="form-group">
        <label class="form-label">제출일자 *</label>
        <input class="form-control" type="date" id="ins1-date" value="${cl.submit_date || today}"/>
      </div>
      <div class="form-group">
        <label class="form-label">수신 보험사 *</label>
        <select class="form-control" id="ins1-insurer" onchange="ins1OnInsurerChange(this.value)">
          <option value="">— 선택 —</option>
          ${insurerOptions}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">참조 (담당팀/담당자)</label>
        <input class="form-control" id="ins1-contact" value="${cl.insurer_contact || ''}"
          placeholder="예: 일반보험팀 OOO 과장"/>
      </div>
    </div>
    <div id="ins1-custom-wrap" style="display:none;margin-top:-4px;margin-bottom:12px">
      <label class="form-label">보험사명 직접 입력</label>
      <input class="form-control" id="ins1-insurer-custom" placeholder="보험사명을 입력하세요"/>
    </div>
    <div id="ins1-cause-custom-wrap" style="display:none;margin-top:-4px;margin-bottom:12px">
      <label class="form-label">사고원인 직접 입력</label>
      <input class="form-control" id="ins1-cause-custom" placeholder="사고원인을 직접 입력하세요"/>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label class="form-label">사고원인 분류 *</label>
        <select class="form-control" id="ins1-cause" onchange="ins1OnCauseChange(this.value)">
          ${INS_CAUSES.map(c => `<option value="${c}" ${(cl.accident_cause_type||'')===c?'selected':''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">조사자</label>
        <input class="form-control" id="ins1-investigator"
          value="${cl.investigator_name || co.investigator_name || co.adjuster_name || '서재성'}"/>
      </div>
    </div>
  </div>
  <div class="ins-action-bar">
    <span></span>
    <button class="btn btn-primary" onclick="insStep1Save()">저장 후 서류 업로드 →</button>
  </div>`;
}

function ins1OnInsurerChange(val) {
  document.getElementById('ins1-custom-wrap').style.display = val === '기타' ? 'block' : 'none';
}

function ins1OnCauseChange(val) {
  document.getElementById('ins1-cause-custom-wrap').style.display =
    val === '기타(직접입력)' ? 'block' : 'none';
}

async function insStep1Save() {
  let insurer = document.getElementById('ins1-insurer').value;
  if (insurer === '기타') insurer = document.getElementById('ins1-insurer-custom')?.value?.trim() || '';
  if (!insurer) { toast('보험사를 선택하거나 입력해 주세요.', 'e'); return; }

  try {
    const { data, error } = await sb.rpc('rpc_start_insurance_report', {
      p_claim_id:      _insClaim.id,
      p_insurer_name:  insurer,
      p_insurer_contact: document.getElementById('ins1-contact').value || null,
      p_cause_type:    (document.getElementById('ins1-cause').value === '기타(직접입력)'
        ? document.getElementById('ins1-cause-custom')?.value?.trim() || '기타'
        : document.getElementById('ins1-cause').value),
      p_investigator:  document.getElementById('ins1-investigator').value,
      p_submit_date:   document.getElementById('ins1-date').value,
    });
    if (error) throw error;
    _insClaim = { ..._insClaim, report_no: data?.report_no, insurer_name: insurer,
      insurance_tab_status: 'docs_pending' };
    toast('저장 완료!', 's');
    _insStep = 2; insRender();
  } catch(e) {
    toast('저장 실패: ' + e.message, 'e');
  }
}

// ─────────────────────────────────────────────
// STEP 2: 서류 업로드 (드래그앤드롭)
// ─────────────────────────────────────────────
function insStep2HTML() {
  const fd = _insField;
  const doneCount = Object.keys(_insUploaded).length;
  const reqDone   = INS_DOCS.filter(d => d.required && _insUploaded[d.code]).length;
  const reqTotal  = INS_DOCS.filter(d => d.required).length;

  const docsHTML = INS_DOCS.map(doc => {
    const up   = _insUploaded[doc.code];
    const done = !!up;
    return `
    <div class="ins-doc-zone ${done ? 'ins-doc-done' : ''}" id="ins-dz-${doc.code}"
         ondragover="event.preventDefault();this.classList.add('ins-doc-dragover')"
         ondragleave="this.classList.remove('ins-doc-dragover')"
         ondrop="insHandleDrop(event,'${doc.code}','${doc.name}')"
         onclick="insTriggerUpload('${doc.code}','${doc.name}')">
      <div class="ins-doc-progress" id="ins-dp-${doc.code}"></div>
      <div style="font-size:22px;margin-bottom:4px">${done ? '✅' : (doc.type==='pdf'?'📄':'🖼')}</div>
      <div style="font-size:13px;font-weight:700;margin-bottom:2px">${doc.name}</div>
      <div style="font-size:11px;color:${done?'var(--green)':'var(--muted)'}">
        ${done ? (up.doc_name || '업로드 완료') : (doc.required ? '필수 · 클릭하거나 파일을 끌어다 놓으세요' : '선택 · 클릭하거나 드래그')}
      </div>
      ${done ? `<div style="font-size:10px;color:var(--muted);margin-top:2px">${(up.uploaded_at||'').slice(0,10)}</div>` : ''}
      ${!done ? `<div style="margin-top:6px;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;background:${doc.required?'#dbeafe':'#f1f5f9'};color:${doc.required?'#1d4ed8':'#64748b'}">${doc.required?'필수':'선택'}</div>` : ''}
    </div>`;
  }).join('');

  const fieldCard = fd
    ? `<div class="detail-grid" style="margin-bottom:0">
        <div class="detail-item"><label>수리 금액</label><span>${fd.repair_cost ? Number(fd.repair_cost).toLocaleString()+'원' : '—'}</span></div>
        <div class="detail-item"><label>수리 완료일</label><span>${(fd.work_done_at||'').slice(0,10)||'—'}</span></div>
        <div class="detail-item full"><label>누수 소견</label><span>${fd.repair_opinion||'—'}</span></div>
      </div>`
    : `<div class="empty"><div class="empty-text">파트너가 아직 수리완료 보고서를 제출하지 않았습니다.</div></div>`;

  const allReqDone = reqDone >= reqTotal;

  return `
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-size:14px;font-weight:900">📎 보험 관련 서류 업로드</div>
      <div style="font-size:12px;color:var(--muted)">${doneCount}/${INS_DOCS.length}종 완료 · 필수 ${reqDone}/${reqTotal}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px" id="ins-doc-grid">
      ${docsHTML}
    </div>
    ${!allReqDone ? `<div class="ins-banner ins-banner-warn" style="margin-top:12px">⚠ 필수 서류 ${reqTotal-reqDone}건 미업로드</div>` : `<div class="ins-banner ins-banner-success" style="margin-top:12px">✓ 모든 필수 서류 업로드 완료</div>`}
  </div>

  <div class="card">
    <div style="font-size:14px;font-weight:900;margin-bottom:14px">🔧 파트너 수리 정보 (자동 연동)</div>
    ${fieldCard}
  </div>

  <div class="ins-action-bar">
    <button class="btn btn-ghost" onclick="insGoStep(1)">이전</button>
    <button class="btn btn-primary" ${allReqDone ? '' : 'disabled'} onclick="insGoStep(3)">
      정보 추출 →
    </button>
  </div>`;
}

function insInitDropzones() {
  // 드롭존은 onclick/ondragover가 HTML에 이미 있으므로 추가 초기화 불필요
}

function insTriggerUpload(docCode, docName) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.jpg,.jpeg,.png,.heic,.webp';
  input.onchange = e => {
    if (e.target.files[0]) insUploadFile(e.target.files[0], docCode, docName);
  };
  input.click();
}

function insHandleDrop(e, docCode, docName) {
  e.preventDefault();
  document.getElementById(`ins-dz-${docCode}`)?.classList.remove('ins-doc-dragover');
  const file = e.dataTransfer.files[0];
  if (file) insUploadFile(file, docCode, docName);
}

async function insUploadFile(file, docCode, docName) {
  const allowedTypes = ['application/pdf','image/jpeg','image/jpg','image/png','image/webp','image/heic'];
  if (!allowedTypes.includes(file.type)) { toast('PDF 또는 이미지 파일만 업로드 가능합니다.', 'e'); return; }
  if (file.size > 20 * 1024 * 1024) { toast('파일이 20MB를 초과합니다.', 'e'); return; }

  const zone     = document.getElementById(`ins-dz-${docCode}`);
  const progress = document.getElementById(`ins-dp-${docCode}`);
  if (zone) zone.style.opacity = '0.6';

  // 진행 애니메이션
  let pct = 0;
  if (progress) { progress.style.display = 'block'; progress.style.width = '0%'; }
  const timer = setInterval(() => {
    pct = Math.min(pct + 10, 85);
    if (progress) progress.style.width = pct + '%';
  }, 100);

  try {
    // 기존 is_latest 해제
    await sb.from('insurance_doc_uploads')
      .update({ is_latest: false })
      .eq('claim_id', _insClaim.id)
      .eq('doc_code', docCode)
      .eq('is_latest', true);

    const ext      = file.name.split('.').pop().toLowerCase();
    const safeExt  = ['pdf','jpg','jpeg','png','webp','heic'].includes(ext) ? ext : 'pdf';
    const filePath = `${_insClaim.id}/${docCode}/${Date.now()}.${safeExt}`;

    const { error: upErr } = await sb.storage
      .from('insurance-docs')
      .upload(filePath, file, { cacheControl: '3600', upsert: true });
    if (upErr) throw new Error('Storage 오류: ' + upErr.message);

    const { data: dbRow, error: dbErr } = await sb.from('insurance_doc_uploads').insert({
      claim_id:     _insClaim.id,
      doc_code:     docCode,
      doc_name:     file.name,
      doc_category: 'insured',
      file_path:    filePath,
      file_kind:    'original',
      source_type:  'admin',
      is_latest:    true,
    }).select('id, doc_code, doc_name, file_path, uploaded_at').single();
    if (dbErr) throw new Error('DB 오류: ' + dbErr.message);

    _insUploaded[docCode] = dbRow;

    clearInterval(timer);
    if (progress) { progress.style.width = '100%'; setTimeout(() => { progress.style.display='none'; progress.style.width='0%'; }, 400); }
    if (zone) zone.style.opacity = '1';
    toast(docName + ' 업로드 완료', 's');

    // 2단계 재렌더 (완료 상태 반영)
    _insStep = 2; insRender();
  } catch(err) {
    clearInterval(timer);
    if (progress) { progress.style.display='none'; progress.style.width='0%'; }
    if (zone) zone.style.opacity = '1';
    toast('업로드 실패: ' + err.message, 'e');
  }
}

// ─────────────────────────────────────────────
// STEP 3: 정보 추출
// ─────────────────────────────────────────────
function insStep3HTML() {
  const cl = _insClaim || {};
  const hasExtracted = !!(cl.policy_product || cl.policy_no);
  const addrMatch = cl.address_match || 'ok';
  const addrColor = addrMatch === 'ok' ? 'var(--green)' : addrMatch === 'warn' ? 'var(--amber)' : 'var(--red)';
  const addrBg    = addrMatch === 'ok' ? 'var(--green-soft)' : addrMatch === 'warn' ? 'var(--amber-soft)' : 'var(--red-soft)';

  // 신뢰도 배지
  const conf = (key) => {
    const v = (cl._conf || {})[key];
    if (!v || v === 'ok')   return '<span class="ins-conf-ok">자동추출</span>';
    if (v === 'warn')        return '<span class="ins-conf-warn">추정</span>';
    return '<span class="ins-conf-err">확인필요</span>';
  };

  return `
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div>
        <div style="font-size:14px;font-weight:900">🔍 서류 자동 추출 결과</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">Claude가 보험증권·건축물대장을 읽고 자동으로 채웁니다 · 틀린 값은 직접 수정</div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="ins3RunExtraction()">
        ${hasExtracted ? '↺ 재추출' : '▶ 서류 분석 시작'}
      </button>
    </div>

    <div id="ins3-loading" style="display:none;padding:14px;background:var(--primary-soft);border-radius:8px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span class="spinner"></span>
        <span id="ins3-label" style="font-size:13px;color:var(--primary)">보험증권 분석 중…</span>
      </div>
      <div style="height:5px;background:var(--line);border-radius:3px;overflow:hidden">
        <div id="ins3-fill" style="height:100%;background:var(--primary);border-radius:3px;transition:width .4s;width:0%"></div>
      </div>
    </div>

    ${!hasExtracted ? `<div class="ins-banner ins-banner-info" style="margin-bottom:12px">
      서류 업로드 완료 후 위 버튼을 누르면 아래 항목이 자동으로 채워집니다.
    </div>` : ''}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group">
        <label class="form-label">보험종목 ${conf('policy_product')}</label>
        <input class="form-control" id="ex-product" value="${cl.policy_product||''}" placeholder="보험증권에서 자동 추출"/>
      </div>
      <div class="form-group">
        <label class="form-label">증권번호 ${conf('policy_no')}</label>
        <input class="form-control" id="ex-policy-no" value="${cl.policy_no||''}" placeholder="보험증권에서 자동 추출"/>
      </div>
      <div class="form-group">
        <label class="form-label">약관 구분 ${conf('insurance_type')}<span style="font-size:10px;color:var(--muted);font-weight:400"> Claude 판단</span></label>
        <select class="form-control" id="ex-policy-type">
          <option value="daily_liability_old" ${(cl.insurance_type||'')==='daily_liability_old'?'selected':''}>일상생활배상책임 (구형)</option>
          <option value="daily_liability_new" ${(cl.insurance_type||'')==='daily_liability_new'?'selected':''}>일상생활배상책임 (신형)</option>
          <option value="facility_liability"  ${(cl.insurance_type||'')==='facility_liability' ?'selected':''}>시설소유(관리)자배상책임</option>
          <option value="water_damage"        ${(cl.insurance_type||'')==='water_damage'?'selected':''}>급배수누출손해</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">보험기간 ${conf('policy_period')}</label>
        <input class="form-control" id="ex-period"
          value="${cl.policy_start && cl.policy_end ? cl.policy_start+' ~ '+cl.policy_end : ''}"
          placeholder="보험증권에서 자동 추출"/>
      </div>
      <div class="form-group">
        <label class="form-label">피보험자 ${conf('insured_name')}</label>
        <input class="form-control" id="ex-insured-name" value="${cl.insured_name||''}" placeholder="성명 비식별 (홍○○)"/>
      </div>
      <div class="form-group">
        <label class="form-label">피보험자 지위 ${conf('insured_status')}<span style="font-size:10px;color:var(--muted);font-weight:400"> Claude 판단</span></label>
        <select class="form-control" id="ex-insured-status">
          <option value="소유자 겸 점유자" ${(cl.insured_status||'')==='소유자 겸 점유자'?'selected':''}>소유자 겸 점유자</option>
          <option value="임차인 겸 점유자" ${(cl.insured_status||'')==='임차인 겸 점유자'?'selected':''}>임차인 겸 점유자</option>
          <option value="임대인"           ${(cl.insured_status||'')==='임대인'?'selected':''}>임대인</option>
          <option value="확인불가"         ${(cl.insured_status||'')==='확인불가'?'selected':''}>확인불가</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">보상한도액 ${conf('coverage_limit')}</label>
        <input class="form-control" id="ex-coverage" value="${cl.coverage_limit||''}" type="number" placeholder="보험증권에서 자동 추출"/>
      </div>
      <div class="form-group">
        <label class="form-label">자기부담금 ${conf('deductible')}</label>
        <input class="form-control" id="ex-deductible" value="${cl.deductible||''}" type="number" placeholder="보험증권에서 자동 추출"/>
      </div>
      <div class="form-group" style="grid-column:1/-1">
        <label class="form-label">피해자 소재지 ${conf('victim_address')}<span style="font-size:10px;color:var(--muted);font-weight:400"> 피해자 건축물대장 기반</span></label>
        <input class="form-control" id="ex-victim-addr" value="${cl.victim_address||''}" placeholder="예: 101동 1204호"/>
      </div>
    </div>

    <!-- 주소 일치 판단 -->
    <div style="margin-top:12px;padding:12px;background:${addrBg};border-radius:8px;border-left:3px solid ${addrColor}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <strong style="font-size:13px;color:${addrColor}">주소 일치 (보험증권 ↔ 건축물대장)</strong>
        <select class="form-control" id="ex-addr-match" style="width:auto;font-size:12px" onchange="ins3UpdateAddrStyle()">
          <option value="ok"    ${addrMatch==='ok'   ?'selected':''}>✓ 일치</option>
          <option value="warn"  ${addrMatch==='warn' ?'selected':''}>⚠ 추정 일치</option>
          <option value="error" ${addrMatch==='error'?'selected':''}>✕ 불일치</option>
        </select>
      </div>
      <div id="ex-addr-note-wrap" style="display:${addrMatch!=='ok'?'block':'none'}">
        <input class="form-control" id="ex-addr-note" value="${cl.address_match_note||''}"
          placeholder="예: 보험증권 도로명 ↔ 건축물대장 지번 — 동일 건물 추정" style="font-size:12px"/>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">
          도로명/지번 표기 차이 → 추정 일치 · 동·호수 불일치 → 불일치
        </div>
      </div>
    </div>
  </div>

  <div class="ins-action-bar">
    <button class="btn btn-ghost" onclick="insGoStep(2)">이전</button>
    <button class="btn btn-primary" onclick="insStep3Save()">저장 후 책임 판단 →</button>
  </div>`;
}

// ─────────────────────────────────────────────
// STEP 3: Claude 서류 자동 추출
// ─────────────────────────────────────────────
async function ins3RunExtraction() {
  const loading = document.getElementById('ins3-loading');
  const fill    = document.getElementById('ins3-fill');
  const label   = document.getElementById('ins3-label');
  const btn     = document.querySelector('#insStepContent .btn-primary.btn-sm');
  if (loading) loading.style.display = 'block';
  if (btn) btn.disabled = true;

  const stages = [
    [10, '보험증권 읽는 중…'],
    [30, '증권번호 · 보험기간 추출 중…'],
    [50, '피보험자 정보 확인 중…'],
    [65, '건축물대장 (가해자) 분석 중…'],
    [80, '건축물대장 (피해자) 분석 중…'],
    [90, '피보험자 지위 판단 중…'],
    [100,'추출 완료'],
  ];

  try {
    // 1. Supabase Storage에서 업로드된 서류 파일 Base64 변환
    async function fetchBase64(filePath) {
      const { data } = await sb.storage.from('insurance-docs').download(filePath);
      if (!data) return null;
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result.split(',')[1]); // base64만
        reader.onerror = reject;
        reader.readAsDataURL(data);
      });
    }

    // 진행 애니메이션 시작
    let stageIdx = 0;
    const progressTimer = setInterval(() => {
      if (stageIdx < stages.length - 1) {
        if (fill)  fill.style.width  = stages[stageIdx][0] + '%';
        if (label) label.textContent = stages[stageIdx][1];
        stageIdx++;
      }
    }, 900);

    // 2. 서류별 Base64 준비
    const docs = {
      insurance_policy:     _insUploaded['insurance_policy'],
      building_reg_insured: _insUploaded['building_reg_insured'],
      building_reg_victim:  _insUploaded['building_reg_victim'],
      resident_reg:         _insUploaded['resident_reg'],
    };

    const b64 = {};
    for (const [key, doc] of Object.entries(docs)) {
      if (doc?.file_path) {
        try { b64[key] = await fetchBase64(doc.file_path); } catch(e) { b64[key] = null; }
      }
    }

    // 3. Claude API 호출 (서류 텍스트 추출 + 피보험자 지위 판단)
    const messages = [{ role: 'user', content: [] }];

    // 서류 문서 첨부 (PDF/이미지)
    const docDescriptions = {
      insurance_policy:     '보험증권',
      building_reg_insured: '피보험자(가해자) 건축물대장',
      building_reg_victim:  '피해자 건축물대장',
      resident_reg:         '주민등록등본',
    };

    for (const [key, b64data] of Object.entries(b64)) {
      if (!b64data) continue;
      const doc = docs[key];
      const ext = (doc.file_path || '').split('.').pop().toLowerCase();
      const isPdf = ext === 'pdf';
      messages[0].content.push({
        type: isPdf ? 'document' : 'image',
        source: {
          type: 'base64',
          media_type: isPdf ? 'application/pdf' : (ext === 'png' ? 'image/png' : 'image/jpeg'),
          data: b64data,
        },
        ...(isPdf ? { title: docDescriptions[key] } : {}),
      });
    }

    messages[0].content.push({
      type: 'text',
      text: `위 서류들을 분석하여 아래 JSON을 반환하세요. 마크다운 없이 순수 JSON만 반환합니다.
개인정보는 반드시 비식별화: 성명→홍○○, 주민번호→앞6자리만, 주소→시·구 단위까지만.

{
  "policy_product": "보험종목명 (보험증권에서)",
  "policy_no": "증권번호 (보험증권에서, *마스킹 유지)",
  "insurance_type": "daily_liability_old | daily_liability_new | facility_liability | water_damage",
  "insurance_type_reason": "구형/신형 판단 근거 1문장",
  "policy_start": "YYYY.MM.DD",
  "policy_end": "YYYY.MM.DD",
  "insured_name": "홍○○ (비식별)",
  "insured_status": "소유자 겸 점유자 | 임차인 겸 점유자 | 임대인 | 확인불가",
  "insured_status_reason": "피보험자 지위 판단 근거 — 건축물대장 소유자와 주민등록 세대주 비교",
  "coverage_limit": 숫자 (원),
  "deductible": 숫자 (원),
  "victim_address": "피해자 건축물대장 기준 동호수 (예: 101동 1204호)",
  "address_match": "ok | warn | error",
  "address_match_note": "주소 표기 차이 설명 (일치하면 null)",
  "_confidence": {
    "policy_product": "ok | warn",
    "policy_no": "ok | warn",
    "insurance_type": "ok | warn",
    "policy_period": "ok | warn",
    "insured_name": "ok | warn",
    "insured_status": "ok | warn",
    "coverage_limit": "ok | warn",
    "deductible": "ok | warn",
    "victim_address": "ok | warn | error"
  }
}`,
    });

    clearInterval(progressTimer);
    if (fill)  fill.style.width  = '85%';
    if (label) label.textContent = 'Claude 응답 대기 중…';

    const response = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:      INS_MODEL,
        max_tokens: 1500,
        system: `당신은 대한민국 독립손해사정사입니다. 
업로드된 보험 서류(보험증권, 건축물대장, 주민등록등본)를 읽고 정보를 추출합니다.
개인정보(실명, 전체 주민번호, 전체 주소)는 반드시 비식별화하세요.
구형/신형 약관 판단: 보험증권 특약 조항에 '누수 직접손해' 담보가 있으면 신형(new), 없으면 구형(old).
피보험자 지위 판단: 건축물대장 소유자와 주민등록 세대주가 동일하면 소유자, 다르면 임차인.
반드시 순수 JSON만 반환하세요. 마크다운 코드블록 금지.`,
        messages,
      }),
    });

    if (!response.ok) throw new Error('API 오류: ' + response.status);
    const result = await response.json();
    const raw    = result.content?.[0]?.text || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());

    if (fill)  fill.style.width  = '100%';
    if (label) label.textContent = '✓ 추출 완료!';
    setTimeout(() => { if (loading) loading.style.display = 'none'; }, 800);

    // 4. 화면 필드에 반영
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (!el || !val) return;
      if (el.tagName === 'SELECT') { for (let o of el.options) if (o.value === val) { o.selected = true; break; } }
      else el.value = val;
    };

    set('ex-product',     parsed.policy_product);
    set('ex-policy-no',   parsed.policy_no);
    set('ex-policy-type', parsed.insurance_type);
    if (parsed.policy_start && parsed.policy_end) {
      set('ex-period', parsed.policy_start + ' ~ ' + parsed.policy_end);
    }
    set('ex-insured-name',   parsed.insured_name);
    set('ex-insured-status', parsed.insured_status);
    if (parsed.coverage_limit) set('ex-coverage',  String(parsed.coverage_limit));
    if (parsed.deductible)     set('ex-deductible', String(parsed.deductible));
    set('ex-victim-addr', parsed.victim_address);

    // 주소 일치 여부 반영
    const addrSel = document.getElementById('ex-addr-match');
    if (addrSel && parsed.address_match) {
      for (let o of addrSel.options) if (o.value === parsed.address_match) { o.selected = true; break; }
      ins3UpdateAddrStyle();
    }
    if (parsed.address_match_note) {
      const noteEl = document.getElementById('ex-addr-note');
      if (noteEl) noteEl.value = parsed.address_match_note;
    }

    // confidence 로컬 저장
    _insClaim = { ..._insClaim, _conf: parsed._confidence || {} };

    // 판단 근거 토스트
    const reasons = [];
    if (parsed.insurance_type_reason) reasons.push('약관: ' + parsed.insurance_type_reason);
    if (parsed.insured_status_reason) reasons.push('지위: ' + parsed.insured_status_reason);
    toast('서류 추출 완료' + (reasons.length ? ' · ' + reasons[0] : ''), 's');

  } catch(e) {
    if (loading) loading.style.display = 'none';
    toast('추출 실패: ' + e.message, 'e');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function ins3UpdateAddrStyle() {
  const val  = document.getElementById('ex-addr-match')?.value;
  const wrap = document.getElementById('ex-addr-note-wrap');
  if (wrap) wrap.style.display = val !== 'ok' ? 'block' : 'none';
}

async function insStep3Save() {
  const period = (document.getElementById('ex-period')?.value || '').split('~').map(s => s.trim());
  try {
    const { error } = await sb.rpc('rpc_save_extraction', {
      p_claim_id:           _insClaim.id,
      p_policy_no:          document.getElementById('ex-policy-no')?.value || null,
      p_policy_product:     document.getElementById('ex-product')?.value || null,
      p_policy_type:        document.getElementById('ex-policy-type')?.value || null,
      p_policy_start:       period[0] || null,
      p_policy_end:         period[1] || null,
      p_insured_name:       document.getElementById('ex-insured-name')?.value || null,
      p_insured_status:     document.getElementById('ex-insured-status')?.value,
      p_address_match:      document.getElementById('ex-addr-match')?.value || 'ok',
      p_address_match_note: document.getElementById('ex-addr-note')?.value || null,
      p_victim_address:     document.getElementById('ex-victim-addr')?.value || null,
      p_coverage_limit:     parseInt(document.getElementById('ex-coverage')?.value) || null,
      p_deductible:         parseInt(document.getElementById('ex-deductible')?.value) || null,
    });
    if (error) throw error;

    // 로컬 상태 업데이트
    _insClaim = {
      ..._insClaim,
      policy_product:    document.getElementById('ex-product')?.value,
      policy_no:         document.getElementById('ex-policy-no')?.value,
      insurance_type:    document.getElementById('ex-policy-type')?.value,
      insured_name:      document.getElementById('ex-insured-name')?.value,
      insured_status:    document.getElementById('ex-insured-status')?.value,
      coverage_limit:    parseInt(document.getElementById('ex-coverage')?.value) || null,
      deductible:        parseInt(document.getElementById('ex-deductible')?.value) || null,
      victim_address:    document.getElementById('ex-victim-addr')?.value,
      address_match:     document.getElementById('ex-addr-match')?.value,
      address_match_note:document.getElementById('ex-addr-note')?.value,
      insurance_tab_status: 'info_in_progress',
    };
    toast('정보 저장 완료!', 's');
    _insStep = 4; insRender();
  } catch(e) {
    toast('저장 실패: ' + e.message, 'e');
  }
}

// ─────────────────────────────────────────────
// STEP 4: 책임 판단
// ─────────────────────────────────────────────
function insStep4HTML() {
  const cl  = _insClaim || {};
  const fd  = _insField;
  const rc  = fd?.repair_cost || 0;
  const ded = cl.deductible || 200000;
  const pay = Math.max(0, rc - ded);

  const established = cl.liability_established || 'yes';
  const payFlag     = cl.liability_pay         || 'pay';
  const fault       = cl.fault_ratio           || '피보험자 100%';

  const estStyle = established === 'yes'
    ? 'background:#dcfce7;color:#15803d;border-color:#15803d'
    : 'background:#fee2e2;color:#dc2626;border-color:#dc2626';
  const payStyle = payFlag === 'pay'
    ? 'background:#dcfce7;color:#15803d;border-color:#15803d'
    : 'background:#fee2e2;color:#dc2626;border-color:#dc2626';

  return `
  <div class="card">
    <div style="font-size:14px;font-weight:900;margin-bottom:14px">⚖️ 법률상 손해배상책임 검토</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:14px">
      Claude 자동 판단 결과 — 드롭다운으로 직접 수정 가능합니다.
    </div>

    <!-- 가. 성립 여부 -->
    <div class="ins-judge-box">
      <div class="ins-judge-head">
        <div class="ins-judge-label">가. 피보험자 손해배상책임 성립 여부</div>
        <select class="ins-judge-sel" id="j-established" style="${estStyle}" onchange="ins4UpdateStyle(this)">
          <option value="yes" ${established==='yes'?'selected':''}>성립</option>
          <option value="no"  ${established==='no' ?'selected':''}>불성립</option>
        </select>
      </div>
      <div class="ins-judge-body" id="j-established-body">
        ${insJudgeBody_established(established, cl)}
      </div>
    </div>

    <!-- 나. 면·부책 -->
    <div class="ins-judge-box">
      <div class="ins-judge-head">
        <div class="ins-judge-label">나. 보험금 지급 책임 (면·부책)</div>
        <select class="ins-judge-sel" id="j-pay" style="${payStyle}" onchange="ins4UpdateStyle(this)">
          <option value="pay"    ${payFlag==='pay'   ?'selected':''}>부책</option>
          <option value="exempt" ${payFlag==='exempt'?'selected':''}>면책</option>
        </select>
      </div>
      <div class="ins-judge-body">
        ${payFlag === 'pay'
          ? `보험기간 이내, 소재지 일치, 면책 조항 해당 없음.<br>
             <span class="badge badge-blue" style="margin-top:6px;display:inline-block">보험기간 일치</span>
             <span class="badge badge-blue" style="margin-top:6px">소재지 일치</span>
             <span class="badge badge-blue" style="margin-top:6px">면책 해당 없음</span>`
          : `피보험자에게 법률상 배상책임이 성립하지 않거나, 면책 조항에 해당합니다.
             <span class="badge badge-red" style="margin-top:6px;display:inline-block">면책</span>`
        }
      </div>
    </div>

    <!-- 다. 과실 비율 -->
    <div class="ins-judge-box">
      <div class="ins-judge-head">
        <div class="ins-judge-label">다. 과실 비율</div>
        <select class="ins-judge-sel" id="j-fault" style="background:#dcfce7;color:#15803d;border-color:#15803d">
          <option value="피보험자 100%"                ${fault==='피보험자 100%'?'selected':''}>피보험자 100%</option>
          <option value="피보험자 70% / 피해자 30%"   ${fault==='피보험자 70% / 피해자 30%'?'selected':''}>피보험자 70% / 피해자 30%</option>
          <option value="피보험자 50% / 피해자 50%"   ${fault==='피보험자 50% / 피해자 50%'?'selected':''}>피보험자 50% / 피해자 50%</option>
        </select>
      </div>
      <div class="ins-judge-body">피보험자 측 관리 책임 범위 내. 피해자 과실 없음.</div>
    </div>

    <!-- 라. 지급보험금 산정 -->
    <div class="ins-judge-box">
      <div class="ins-judge-head">
        <div class="ins-judge-label">라. 지급보험금 산정</div>
        <div style="font-size:15px;font-weight:900;color:var(--green);padding:3px 10px;background:var(--green-soft);border-radius:6px">
          ${pay.toLocaleString()}원
        </div>
      </div>
      <div class="ins-judge-body">
        수리금액 <strong>${rc.toLocaleString()}원</strong> −
        자기부담금 <strong>${ded.toLocaleString()}원</strong> =
        지급보험금 <strong style="color:var(--green)">${pay.toLocaleString()}원</strong><br>
        <span class="badge badge-blue" style="margin-top:6px;display:inline-block">상법 제680조</span>
      </div>
    </div>

    <!-- 메모 -->
    <div class="form-group" style="margin-top:14px">
      <label class="form-label">판단 메모 (보고서 반영)</label>
      <textarea class="form-control" id="j-memo" rows="2"
        placeholder="판단 근거 추가 메모 (선택사항)">${cl.liability_memo||''}</textarea>
    </div>
  </div>

  <div class="ins-action-bar">
    <button class="btn btn-ghost" onclick="insGoStep(3)">이전</button>
    <button class="btn btn-primary" onclick="insStep4Save()">저장 후 보고서 초안 생성 →</button>
  </div>`;
}

function insJudgeBody_established(established, cl) {
  if (established === 'yes') {
    return `${cl.accident_cause_type || '사고원인'}은 피보험자 점유·관리 하의 시설/기기 하자에 해당합니다.
    민법 제758조에 의거 점유자에게 1차 배상책임이 귀속됩니다.<br>
    <span class="badge badge-blue" style="margin-top:6px;display:inline-block">민법 제750조</span>
    <span class="badge badge-blue" style="margin-top:6px">민법 제758조</span>`;
  } else {
    return `사고원인은 피보험자 책임 범위 밖(공용부분 하자 등)으로, 피보험자에게 법률상 손해배상책임이 성립하지 않습니다.
    <span class="badge badge-red" style="margin-top:6px;display:inline-block">민법 제758조 — 소유자 책임</span>`;
  }
}

function ins4UpdateStyle(sel) {
  const isPositive = sel.value === 'yes' || sel.value === 'pay';
  sel.style.cssText = isPositive
    ? 'background:#dcfce7;color:#15803d;border-color:#15803d'
    : 'background:#fee2e2;color:#dc2626;border-color:#dc2626';
}

async function insStep4Save() {
  const fd  = _insField;
  const rc  = fd?.repair_cost || 0;
  const ded = _insClaim.deductible || 200000;
  const pay = Math.max(0, rc - ded);

  try {
    const { error } = await sb.rpc('rpc_save_judgment', {
      p_claim_id:              _insClaim.id,
      p_liability_established: document.getElementById('j-established')?.value || 'yes',
      p_liability_pay:         document.getElementById('j-pay')?.value || 'pay',
      p_fault_ratio:           document.getElementById('j-fault')?.value || '피보험자 100%',
      p_liability_memo:        document.getElementById('j-memo')?.value || null,
      p_damage_amount:         rc || null,
      p_payout_amount:         pay || null,
    });
    if (error) throw error;

    _insClaim = {
      ..._insClaim,
      liability_established: document.getElementById('j-established')?.value,
      liability_pay:         document.getElementById('j-pay')?.value,
      fault_ratio:           document.getElementById('j-fault')?.value,
      liability_memo:        document.getElementById('j-memo')?.value,
      insurance_tab_status:  'ready_for_draft',
    };
    toast('저장 완료! 보고서 초안을 생성합니다.', 's');
    _insStep = 5; insRender();
  } catch(e) {
    toast('저장 실패: ' + e.message, 'e');
  }
}

// ─────────────────────────────────────────────
// STEP 5: 보고서 초안
// ─────────────────────────────────────────────
function insStep5HTML() {
  const cl  = _insClaim || {};
  const co  = _insCompany || {};
  const fd  = _insField;
  const rc  = fd?.repair_cost || 0;
  const ded = cl.deductible || 200000;
  const pay = Math.max(0, rc - ded);

  const existingSections = _insSections || {};
  const draftBanner = _insDraft
    ? `<div class="ins-banner ins-banner-success" style="margin-bottom:12px">
         ✓ 초안 v${_insDraft.draft_version} · ${_insDraft.model_name || INS_MODEL} · ${(_insDraft.created_at||'').slice(0,10)}
         <span id="ins5-saving" style="display:none;margin-left:8px;opacity:.7">저장 중…</span>
       </div>`
    : '';

  const established = cl.liability_established === 'yes' ? '성립 · 부책' : '불성립 · 면책';

  return `
  ${draftBanner}
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0">
      <div style="font-size:14px;font-weight:900">📄 손해사정서 초안</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" onclick="insStep5Generate()">
          ${_insDraft ? '초안 재생성' : '▶ Claude 초안 생성'}
        </button>
      </div>
    </div>
  </div>

  <!-- 보고서 미리보기 (수정 가능 필드) -->
  <div style="border:1px solid var(--line);border-radius:12px;overflow:hidden;box-shadow:var(--shadow)">

    <!-- 헤더 -->
    <div style="background:#0f172a;color:#fff;padding:14px 20px;display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:14px;font-weight:700">${co.company_name || '누수패스손해사정'} · 손해사정서</div>
      <div style="font-size:12px;opacity:.75">${cl.report_no || 'NP-2026-XXXX'}</div>
    </div>

    <!-- 1. 총괄표 -->
    <div style="padding:14px 20px;border-bottom:1px solid var(--line)">
      <div style="font-size:11px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">1. 총괄표</div>
      <div style="display:grid;grid-template-columns:90px 1fr;gap:6px 12px;font-size:13px">
        <div style="color:var(--muted)">손해액</div>
        <div><input class="form-control" id="ins5-damage" value="${rc ? rc.toLocaleString()+'원' : ''}" style="padding:5px 8px;font-size:13px"/></div>
        <div style="color:var(--muted)">자기부담금</div>
        <div style="color:var(--text)">${ded.toLocaleString()}원 (자동)</div>
        <div style="color:var(--muted)">지급보험금</div>
        <div><input class="form-control" id="ins5-payout" value="${pay ? pay.toLocaleString()+'원' : ''}" style="padding:5px 8px;font-size:13px;color:var(--green);font-weight:700"/></div>
      </div>
    </div>

    <!-- 2. 보험계약사항 -->
    <div style="padding:14px 20px;border-bottom:1px solid var(--line)">
      <div style="font-size:11px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">2. 보험계약사항</div>
      <div style="display:grid;grid-template-columns:90px 1fr;gap:5px 12px;font-size:13px;color:var(--text)">
        <div style="color:var(--muted)">보험종목</div><div>${cl.policy_product || '—'}</div>
        <div style="color:var(--muted)">증권번호</div><div>${cl.policy_no || '—'}</div>
        <div style="color:var(--muted)">피보험자</div><div>${cl.insured_name || '—'}</div>
        <div style="color:var(--muted)">보험기간</div><div>${cl.policy_start && cl.policy_end ? cl.policy_start+' ~ '+cl.policy_end : '—'}</div>
        <div style="color:var(--muted)">특약조건</div><div>가족일상생활배상책임</div>
      </div>
    </div>

    <!-- 4. 조사자의견 -->
    <div style="padding:14px 20px;border-bottom:1px solid var(--line)">
      <div style="font-size:11px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">4. 사고사항 — 조사자의견</div>
      <textarea class="form-control" id="ins5-opinion" rows="3" style="font-size:13px"
        >${existingSections.investigator_opinion || fd?.repair_opinion || ''}</textarea>
    </div>

    <!-- 5. 법률상손해배상책임 -->
    <div style="padding:14px 20px;border-bottom:1px solid var(--line)">
      <div style="font-size:11px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">5. 법률상 손해배상책임</div>
      <div style="display:grid;grid-template-columns:90px 1fr;gap:6px 12px;font-size:13px">
        <div style="color:var(--muted)">성립/불성립</div>
        <div style="font-weight:700;color:${cl.liability_established==='yes'?'var(--green)':'var(--red)'}">
          ${established}
        </div>
        <div style="color:var(--muted)">관련법규</div>
        <div style="color:var(--text)">민법 제750조, 제758조 / 상법 제680조</div>
        <div style="color:var(--muted)">판단근거</div>
        <div><textarea class="form-control" id="ins5-judgment" rows="2" style="font-size:13px"
          >${existingSections.accident_cause || cl.liability_memo || ''}</textarea></div>
      </div>
    </div>

    <div style="padding:12px 20px;text-align:center;font-size:12px;color:var(--muted)">
      나머지 섹션 자동 완성 · 수리 전/중/후 사진 포함 · 총 4~5페이지
    </div>
  </div>

  <!-- 진행 바 -->
  <div id="ins5-progress" style="display:none;margin-top:12px;padding:12px;background:var(--primary-soft);border-radius:8px">
    <div style="height:6px;background:var(--line);border-radius:3px;overflow:hidden;margin-bottom:6px">
      <div id="ins5-fill" style="height:100%;background:var(--primary);border-radius:3px;transition:width .4s;width:0%"></div>
    </div>
    <div id="ins5-label" style="font-size:12px;color:var(--primary)">준비 중…</div>
  </div>

  <div class="ins-action-bar">
    <button class="btn btn-ghost" onclick="insGoStep(4)">이전</button>
    <button class="btn btn-ghost" onclick="insStep5SaveDraft()">초안 저장</button>
    <button class="btn btn-primary" onclick="insGoStep(6)">검토 완료 → 최종 출력</button>
  </div>`;
}

async function insStep5Generate() {
  if (_insGenerating || !_insField) { toast('파트너 수리 자료가 필요합니다.', 'e'); return; }
  _insGenerating = true;

  const btn   = document.querySelector('#insStepContent .btn-ghost');
  const prog  = document.getElementById('ins5-progress');
  const fill  = document.getElementById('ins5-fill');
  const label = document.getElementById('ins5-label');
  if (prog) prog.style.display = 'block';

  const stages = ['피보험자 지위 확인', '사고원인 분석', '사고내용 작성',
                  '보험기간 검토', '사고장소 검토', '피해사항 정리', '조사자의견 작성'];

  try {
    const cl  = _insClaim;
    const fd  = _insField;
    const inputVars = {
      insurance_type_label:     INS_TYPE_LABELS[cl.insurance_type] || cl.insurance_type || '미확인',
      accident_date:            cl.accident_date || '미확인',
      insurer_name:             cl.insurer_name || '미확인',
      coverage_limit:           cl.coverage_limit,
      deductible:               cl.deductible,
      insured_name_masked:      cl.insured_name || '홍○○',
      insured_status:           cl.insured_status || '확인불가',
      accident_location_masked: '용인시 수지구',
      repair_cost:              fd.repair_cost,
      repair_opinion:           fd.repair_opinion,
      work_done_at:             (fd.work_done_at || '').slice(0, 10),
    };

    // 진행 시각화
    for (let i = 0; i < stages.length; i++) {
      if (fill) fill.style.width = ((i+1)/stages.length * 80) + '%';
      if (label) label.textContent = stages[i] + ' 분석 중…';
      await new Promise(r => setTimeout(r, 150));
    }

    const response = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:      INS_MODEL,
        max_tokens: 2000,
        system: `당신은 대한민국 독립손해사정사입니다. 누수사고 자료를 기반으로 손해사정서 초안을 작성합니다.
반드시 JSON 형식으로만 응답하세요. 마크다운 코드블록 없이 순수 JSON만 반환합니다.
개인정보(실명, 주민번호, 전체 주소)는 절대 포함하지 마세요.

적용 법령:
${INS_LEGAL_BUNDLE}`,
        messages: [{ role: 'user', content: `아래 7개 필드를 포함한 JSON 객체를 반환하세요.

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
보험종목: ${inputVars.insurance_type_label}
피보험자 지위: ${inputVars.insured_status}
사고일자: ${inputVars.accident_date}
보험사: ${inputVars.insurer_name}
보상한도액: ${inputVars.coverage_limit ? Number(inputVars.coverage_limit).toLocaleString()+'원' : '미확인'}
자기부담금: ${inputVars.deductible ? Number(inputVars.deductible).toLocaleString()+'원' : '미확인'}
피보험자: ${inputVars.insured_name_masked}
사고장소: ${inputVars.accident_location_masked}
수리금액: ${inputVars.repair_cost ? Number(inputVars.repair_cost).toLocaleString()+'원' : '미확인'}
수리 소견: ${inputVars.repair_opinion || '없음'}
방문일: ${inputVars.work_done_at || '미확인'}
` }],
      }),
    });

    if (!response.ok) throw new Error('Claude API 오류: ' + response.status);
    const result = await response.json();
    const raw    = result.content?.[0]?.text || '';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());

    if (fill) fill.style.width = '100%';
    if (label) label.textContent = '초안 생성 완료!';

    // 저장
    const { data: saved, error } = await sb.rpc('rpc_create_insurance_draft', {
      p_claim_id:             _insClaim.id,
      p_prompt_version:       INS_PROMPT_VER,
      p_model_name:           INS_MODEL,
      p_legal_bundle_version: INS_LEGAL_VER,
      p_input_vars_jsonb:     inputVars,
      p_sections_jsonb:       parsed,
    });
    if (error) throw error;

    _insSections = parsed;
    _insDraft = { id: saved?.[0]?.draft_id, draft_version: saved?.[0]?.draft_version,
      model_name: INS_MODEL, created_at: new Date().toISOString() };
    _insClaim = { ..._insClaim, insurance_tab_status: 'draft_generated' };

    // 초안 내용 화면 반영
    const opEl = document.getElementById('ins5-opinion');
    const jdEl = document.getElementById('ins5-judgment');
    if (opEl) opEl.value = parsed.investigator_opinion || '';
    if (jdEl) jdEl.value = parsed.accident_cause || '';

    setTimeout(() => { if (prog) prog.style.display='none'; }, 1000);
    toast('초안 생성 완료!', 's');
  } catch(e) {
    toast('생성 실패: ' + e.message, 'e');
    if (prog) prog.style.display = 'none';
  } finally {
    _insGenerating = false;
  }
}

async function insStep5SaveDraft() {
  try {
    const sections = {
      ..._insSections,
      investigator_opinion: document.getElementById('ins5-opinion')?.value,
      accident_cause:       document.getElementById('ins5-judgment')?.value,
    };

    if (_insDraft?.id) {
      await sb.from('insurance_claim_drafts')
        .update({ sections_jsonb: sections, status: 'reviewed' })
        .eq('id', _insDraft.id);
    } else {
      // 새로 저장
      await sb.from('insurance_claim_drafts').insert({
        claim_id: _insClaim.id, sections_jsonb: sections, status: 'reviewed', is_current: true,
        prompt_version: INS_PROMPT_VER, model_name: INS_MODEL,
      });
    }

    // insurance_claims 상태 업데이트
    await sb.from('insurance_claims')
      .update({ insurance_tab_status: 'draft_generated', updated_at: new Date().toISOString() })
      .eq('id', _insClaim.id);
    _insClaim = { ..._insClaim, insurance_tab_status: 'draft_generated' };
    _insSections = sections;
    toast('초안 저장 완료!', 's');
  } catch(e) {
    toast('저장 실패: ' + e.message, 'e');
  }
}

// ─────────────────────────────────────────────
// STEP 6: 최종 출력
// ─────────────────────────────────────────────
function insStep6HTML() {
  const cl        = _insClaim || {};
  const submitted = cl.insurance_tab_status === 'pdf_submitted';
  const co        = _insCompany || {};

  return `
  ${submitted
    ? `<div class="ins-banner ins-banner-success">✓ 보험사 제출 완료 처리됨 — ${(cl.pdf_submitted_at||'').slice(0,10)}</div>`
    : ''}

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
    <div class="card" style="text-align:center">
      <div style="font-size:32px;margin-bottom:10px">📄</div>
      <div style="font-size:15px;font-weight:700;margin-bottom:6px">PDF 다운로드</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:16px">A4 · 4~5페이지 · 직인 포함</div>
      <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="insDownloadPDF()">
        PDF 다운로드
      </button>
    </div>
    <div class="card" style="text-align:center">
      <div style="font-size:32px;margin-bottom:10px">✅</div>
      <div style="font-size:15px;font-weight:700;margin-bottom:6px">제출 완료 처리</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:16px">
        지급보험금 ${Number(cl.payout_amount||0).toLocaleString()}원 DB 기록
      </div>
      <button class="btn btn-success" style="width:100%;justify-content:center"
        ${submitted ? 'disabled' : ''} onclick="insSubmitClick()">
        ${submitted ? '제출 완료' : '보험사 제출 완료 처리'}
      </button>
    </div>
  </div>

  <div class="card">
    <div style="font-size:14px;font-weight:900;margin-bottom:14px">제출 정보</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label class="form-label">보험사 담당자</label>
        <input class="form-control" id="ins6-contact" value="${cl.insurer_contact||''}"
          placeholder="예: 삼성화재 홍○○ 팀장 010-0000-0000" ${submitted?'disabled':''}/>
      </div>
      <div class="form-group">
        <label class="form-label">제출 메모</label>
        <input class="form-control" id="ins6-memo" placeholder="예: 이메일 접수 / 팩스 발송"
          ${submitted?'disabled':''}/>
      </div>
    </div>
    <div style="padding:12px;background:var(--primary-soft);border-radius:8px;font-size:13px">
      제출 완료 시 접수건 상태가 <strong>손해사정 완료</strong>로 변경되고,
      지급보험금이 DB에 기록됩니다.
    </div>
  </div>

  <div class="ins-action-bar">
    <button class="btn btn-ghost" onclick="insGoStep(5)">이전</button>
    <span class="badge ${submitted?'badge-green':'badge-blue'}">${submitted?'PDF 제출 완료':'제출 대기'}</span>
  </div>`;
}

function insDownloadPDF() {
  // TODO: PDF 생성 기능 (다음 배포에서 활성화)
  toast('PDF 생성 기능은 다음 업데이트에서 활성화됩니다.', 'i');
}

async function insSubmitClick() {
  const contact = document.getElementById('ins6-contact')?.value || '';
  const memo    = document.getElementById('ins6-memo')?.value    || '';
  try {
    await sb.rpc('rpc_submit_insurance_claim', {
      p_claim_id: _insClaim.id,
      p_memo: memo || null,
    });
    // insurer_contact 별도 업데이트
    if (contact) {
      await sb.from('insurance_claims')
        .update({ insurer_contact: contact })
        .eq('id', _insClaim.id);
    }
    _insClaim = { ..._insClaim, insurance_tab_status: 'pdf_submitted', pdf_submitted_at: new Date().toISOString() };
    insRender();
    toast('보험사 제출 완료 처리됐습니다.', 's');
  } catch(e) {
    toast('제출 실패: ' + e.message, 'e');
  }
}

// ─────────────────────────────────────────────
// 공통 네비게이션
// ─────────────────────────────────────────────
function insGoStep(n) {
  _insStep = n;
  insRender();
}

// ─────────────────────────────────────────────
// CSS (index.html에 없는 보험탭 전용 스타일)
// ─────────────────────────────────────────────
(function injectInsCSS() {
  if (document.getElementById('ins-tab-css')) return;
  const style = document.createElement('style');
  style.id = 'ins-tab-css';
  style.textContent = `
/* ── 스텝 바 ── */
.ins-step-bar{display:flex;gap:0;margin-bottom:16px;background:#fff;border-radius:12px;padding:6px;box-shadow:0 1px 3px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.08)}
.ins-step{flex:1;text-align:center;padding:8px 4px;border-radius:8px;cursor:default;transition:all .15s}
.ins-step-active{background:#2563eb;cursor:pointer}
.ins-step-done{cursor:pointer}
.ins-step-done:hover{background:#f0fdf4}
.ins-step-locked{opacity:.45}
.ins-step-dot{width:8px;height:8px;border-radius:50%;margin:0 auto 4px;background:#e2e8f0}
.ins-step-active .ins-step-dot{background:#fff}
.ins-step-done .ins-step-dot{background:#15803d}
.ins-step-num{font-size:10px;font-weight:700;color:#94a3b8;margin-bottom:2px}
.ins-step-active .ins-step-num{color:rgba(255,255,255,.8)}
.ins-step-done .ins-step-num{color:#15803d}
.ins-step-label{font-size:12px;font-weight:700;color:#64748b}
.ins-step-active .ins-step-label{color:#fff}
.ins-step-done .ins-step-label{color:#111827}

/* ── 서류 드롭존 ── */
.ins-doc-zone{border:1.5px dashed #cbd5e1;border-radius:10px;padding:16px 12px;text-align:center;cursor:pointer;transition:all .18s;position:relative;overflow:hidden;background:#fff}
.ins-doc-zone:hover{border-color:#2563eb;background:#eff6ff}
.ins-doc-dragover{border-color:#2563eb;background:#eff6ff;transform:scale(1.02);box-shadow:0 0 0 3px rgba(37,99,235,.15)}
.ins-doc-done{border-style:solid;border-color:#15803d;background:#f0fdf4}
.ins-doc-progress{position:absolute;bottom:0;left:0;height:3px;background:#2563eb;width:0%;transition:width .1s linear;display:none}

/* ── 판단 박스 ── */
.ins-judge-box{border:1px solid #e4e7ef;border-radius:10px;overflow:hidden;margin-bottom:10px}
.ins-judge-head{padding:11px 16px;background:#f8fafc;display:flex;align-items:center;gap:10px;border-bottom:1px solid #e4e7ef}
.ins-judge-label{font-size:13px;font-weight:700;flex:1;color:#1e293b}
.ins-judge-sel{padding:5px 10px;font-size:12px;font-weight:700;border:1.5px solid #e4e7ef;border-radius:8px;cursor:pointer;outline:none;font-family:inherit;transition:all .15s}
.ins-judge-body{padding:12px 16px;font-size:12px;line-height:1.8;color:#6b7280}

/* ── 배너 ── */
.ins-banner{padding:10px 14px;border-radius:8px;font-size:13px;font-weight:500}
.ins-banner-success{background:#f0fdf4;color:#15803d;border-left:3px solid #15803d}
.ins-banner-warn{background:#fffbeb;color:#d97706;border-left:3px solid #d97706}
.ins-banner-info{background:#eff6ff;color:#2563eb;border-left:3px solid #2563eb}
.ins-banner-error{background:#fef2f2;color:#dc2626;border-left:3px solid #dc2626}

/* ── 액션바 ── */
.ins-action-bar{display:flex;align-items:center;justify-content:space-between;padding:14px 0;gap:10px;margin-top:8px}
`;
  document.head.appendChild(style);
})();
