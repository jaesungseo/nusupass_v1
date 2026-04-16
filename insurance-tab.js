// v2026-04-16-v4 — 3단계 구조 (준비→분석→보고서)
/**
 * insurance-tab.js  v4
 * 누수패스 보험자료 탭
 *
 * 의존성: sb, toast(), curUser (index.html)
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
const INS_PROMPT_VER = 'v4.0';
const INS_LEGAL_VER  = 'v1.1';

const INS_LEGAL = `[민법 제750조] 고의 또는 과실로 인한 위법행위로 타인에게 손해를 가한 자는 그 손해를 배상할 책임이 있다.
[민법 제758조] 공작물의 설치 또는 보존의 하자로 인하여 타인에게 손해를 가한 때에는 공작물점유자가 손해를 배상할 책임이 있다. 그러나 점유자가 손해의 방지에 필요한 주의를 해태하지 아니한 때에는 그 소유자가 배상할 책임이 있다.
[상법 제680조] 보험계약자와 피보험자는 손해의 방지와 경감을 위하여 노력하여야 한다.`;

// 약관 구분별 프롬프트 차이
const INS_TYPE_CONTEXT = {
  daily_liability_old: `약관 구분: 일상생활배상책임 (구형)
- 제3자 대물·대인 배상만 담보. 피보험자 직접 재산 손해는 담보 외.
- 책임 판단 시 피보험자에게 법률상 배상책임 성립 여부 중심으로 판단.`,
  daily_liability_new: `약관 구분: 일상생활배상책임 (신형)
- 제3자 대물·대인 배상 + 피보험자 직접 재산 손해(누수 포함) 일부 담보.
- 신형 특약 기준으로 담보 범위 확인 필요.`,
  facility_liability: `약관 구분: 시설소유(관리)자배상책임
- 시설 관리 하자로 인한 제3자 피해 배상 담보.
- 피보험자의 시설 관리 의무 위반 여부 중심으로 판단.`,
  water_damage: `약관 구분: 급배수누출손해
- 급배수 설비 누출로 인한 직접 재산 손해 담보.
- 누수 발생 원인 및 설비 하자 여부 중심으로 판단.`,
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

const INS_DOCS = [
  { code:'insurance_policy',    name:'보험증권',           type:'pdf', required:true },
  { code:'resident_reg',        name:'주민등록등본',        type:'pdf', required:true },
  { code:'building_reg_insured',name:'건축물대장 (가해자)', type:'pdf', required:true },
  { code:'building_reg_victim', name:'건축물대장 (피해자)', type:'pdf', required:true },
  { code:'family_cert',         name:'가족관계증명서',      type:'pdf', required:false },
  { code:'claim_form',          name:'보험청구서',          type:'pdf', required:false },
];

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

  <!-- ── 섹션 B: 약관 구분 선택 (핵심!) ── -->
  <div class="card">
    <div style="font-size:14px;font-weight:900;margin-bottom:6px">📌 약관 구분 선택</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px">
      서류 분석 전에 선택하면 Claude가 해당 약관 기준으로 판단합니다
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${[
        ['daily_liability_old','일상생활배상책임 (구형)','제3자 대물·대인 배상','구형 약관 — 누수 직접손해 담보 없음'],
        ['daily_liability_new','일상생활배상책임 (신형)','제3자 배상 + 직접손해 일부 담보','신형 약관 — 누수 직접손해 담보 포함'],
        ['facility_liability', '시설소유(관리)자배상책임','시설 관리 하자로 인한 피해','상업용 시설 등 해당'],
        ['water_damage',       '급배수누출손해',         '급배수 설비 누출 직접손해','설비 누출 전용 담보'],
      ].map(([val, name, desc, note]) => {
        const sel = (cl.insurance_type||'daily_liability_old') === val;
        return `<div class="ins-type-card ${sel?'ins-type-selected':''}" onclick="s1SelectType('${val}',this)">
          <input type="radio" name="ins-type" value="${val}" ${sel?'checked':''} style="display:none">
          <div style="font-size:13px;font-weight:700;margin-bottom:4px">${name}</div>
          <div style="font-size:12px;color:${sel?'#1d4ed8':'var(--muted)'}">${desc}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:3px">${note}</div>
        </div>`;
      }).join('')}
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

  const insType = document.querySelector('input[name="ins-type"]:checked')?.value || 'daily_liability_old';
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
    await sb.from('insurance_claims')
      .update({ insurance_type: insType })
      .eq('id', _insClaim.id);

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
    await sb.from('insurance_doc_uploads')
      .update({is_latest:false})
      .eq('claim_id',_insClaim.id).eq('doc_code',code).eq('is_latest',true);

    const ext = file.name.split('.').pop().toLowerCase();
    const safeExt = ['pdf','jpg','jpeg','png','webp','heic'].includes(ext)?ext:'pdf';
    const path = `${_insClaim.id}/${code}/${Date.now()}.${safeExt}`;

    const { error: upErr } = await sb.storage.from('insurance-docs')
      .upload(path, file, {cacheControl:'3600',upsert:true});
    if (upErr) throw new Error('Storage: '+upErr.message);

    const { data: row, error: dbErr } = await sb.from('insurance_doc_uploads').insert({
      claim_id: _insClaim.id, doc_code: code, doc_name: file.name,
      doc_category:'insured', file_path: path, file_kind:'original',
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

  const established = r.insured_status_liability || 'yes';
  const payFlag     = r.liability_pay || 'pay';

  const estStyle = established==='yes'
    ? 'background:#dcfce7;color:#15803d;border-color:#15803d'
    : 'background:#fee2e2;color:#dc2626;border-color:#dc2626';
  const payStyle = payFlag==='pay'
    ? 'background:#dcfce7;color:#15803d;border-color:#15803d'
    : 'background:#fee2e2;color:#dc2626;border-color:#dc2626';

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
        <input class="form-control" id="ex-insured" value="${r.insured_name||cl.insured_name||''}" placeholder="비식별 (홍○○)"/>
      </div>
      <div class="form-group">
        <label class="form-label">
          피보험자 지위
          <span style="font-size:10px;color:var(--muted);font-weight:400"> 건축물대장 기반 판단</span>
        </label>
        <select class="form-control" id="ex-status">
          ${['소유자 겸 점유자','임차인 겸 점유자','임대인','확인불가'].map(v =>
            `<option value="${v}" ${(r.insured_status||cl.insured_status||'임차인 겸 점유자')===v?'selected':''}>${v}</option>`
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
  </div>

  <!-- 책임 판단 -->
  <div class="card">
    <div style="font-size:14px;font-weight:900;margin-bottom:14px">
      ⚖️ 법률상 손해배상책임 판단
      <span style="font-size:11px;font-weight:400;color:var(--muted);margin-left:8px">드롭다운으로 직접 수정 가능</span>
    </div>

    <div class="ins-judge-box">
      <div class="ins-judge-head">
        <div class="ins-judge-label">가. 피보험자 손해배상책임 성립 여부</div>
        <select class="ins-judge-sel" id="j-established" style="${estStyle}" onchange="s2JudgeStyle(this)">
          <option value="yes" ${established==='yes'?'selected':''}>성립</option>
          <option value="no"  ${established==='no' ?'selected':''}>불성립</option>
        </select>
      </div>
      <div class="ins-judge-body">
        ${r.liability_established_reason || '분석 후 자동으로 채워집니다.'}
        <br><span class="badge badge-blue" style="margin-top:6px;display:inline-block">민법 제750조</span>
        <span class="badge badge-blue" style="margin-top:6px">민법 제758조</span>
      </div>
    </div>

    <div class="ins-judge-box">
      <div class="ins-judge-head">
        <div class="ins-judge-label">나. 보험금 지급 (면·부책)</div>
        <select class="ins-judge-sel" id="j-pay" style="${payStyle}" onchange="s2JudgeStyle(this)">
          <option value="pay"    ${payFlag==='pay'   ?'selected':''}>부책</option>
          <option value="exempt" ${payFlag==='exempt'?'selected':''}>면책</option>
        </select>
      </div>
      <div class="ins-judge-body">
        ${r.liability_pay_reason || '보험기간, 소재지 일치 여부, 면책 조항 검토 후 자동으로 채워집니다.'}
        <br><span class="badge badge-blue" style="margin-top:6px;display:inline-block">상법 제680조</span>
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
        <strong style="font-size:18px;color:var(--green)">${pay.toLocaleString()}원</strong>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:6px">
        수리금액 ${rc.toLocaleString()}원 − 자기부담금 <input type="number" id="j-ded" value="${ded}"
          style="width:100px;padding:2px 6px;border:1px solid var(--line);border-radius:4px;font-size:12px"
          onchange="s2RecalcPay()"/> 원 = <strong id="j-pay-display" style="color:var(--green)">${pay.toLocaleString()}원</strong>
        <span class="badge badge-blue" style="margin-left:8px">상법 제680조</span>
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
function s2JudgeStyle(sel) {
  const pos = sel.value==='yes'||sel.value==='pay';
  sel.style.cssText = pos
    ? 'background:#dcfce7;color:#15803d;border-color:#15803d'
    : 'background:#fee2e2;color:#dc2626;border-color:#dc2626';
}
function s2RecalcPay() {
  const rc  = _insField?.repair_cost || 0;
  const ded = parseInt(document.getElementById('j-ded')?.value)||0;
  const pay = Math.max(0, rc - ded);
  const el = document.getElementById('j-pay-display');
  if (el) el.textContent = pay.toLocaleString() + '원';
}

// ─────────────────────────────────────────────
// STEP 2: Claude 분석 (보험증권 + 건축물대장 + 주민등록등본 순차 호출)
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

  const insType    = _insClaim.insurance_type || 'daily_liability_old';
  const typeCtx    = INS_TYPE_CONTEXT[insType] || INS_TYPE_CONTEXT['daily_liability_old'];
  const SYS = `당신은 대한민국 독립손해사정사입니다. 누수사고 보험 서류를 분석합니다.
${typeCtx}
적용 법령: ${INS_LEGAL}
개인정보 비식별화: 성명→홍○○, 주민번호→앞6자리만, 주소→시·구까지만.
순수 JSON만 반환. 마크다운 코드블록 금지.`;

  const progress = (pct, msg) => {
    if (fill)  fill.style.width  = pct + '%';
    if (label) label.textContent = msg;
  };

  try {
    const result = { ..._insResult };

    // ── 1차: 보험증권 ──
    if (_insUploaded['insurance_policy']) {
      progress(20, '보험증권 분석 중…');
      const b64 = await fetchBase64(_insUploaded['insurance_policy'].file_path);
      if (b64) {
        const mt = docMediaType(_insUploaded['insurance_policy'].file_path);
        const r1 = await callClaudeDoc(b64, mt, '보험증권', SYS,
`보험증권에서 아래 JSON을 추출하세요.
{
  "policy_product": "보험종목명",
  "policy_no": "증권번호 (*마스킹 유지)",
  "policy_start": "YYYY.MM.DD",
  "policy_end": "YYYY.MM.DD",
  "insured_name": "홍○○",
  "policy_address_raw": "피보험자 소재지 원문 그대로",
  "coverage_limit": 숫자,
  "deductible": 숫자
}`);
        Object.assign(result, r1);
      }
    }

    // ── 2차: 건축물대장(가해자) + 주민등록등본 교차 분석 ──
    progress(50, '피보험자 지위 판단 중…');
    const contentArr = [];
    for (const code of ['building_reg_insured','resident_reg']) {
      const up = _insUploaded[code];
      if (!up) continue;
      const b64 = await fetchBase64(up.file_path);
      if (!b64) continue;
      const mt = docMediaType(up.file_path);
      const isPdf = mt === 'application/pdf';
      contentArr.push({
        type: isPdf ? 'document' : 'image',
        source: { type:'base64', media_type: mt, data: b64 },
        ...(isPdf ? { title: code==='building_reg_insured'?'피보험자 건축물대장':'주민등록등본' } : {}),
      });
    }
    if (contentArr.length > 0) {
      const policyAddr = result.policy_address_raw || '(보험증권 주소 미추출)';
      contentArr.push({ type:'text', text:
`위 서류(건축물대장, 주민등록등본)를 교차 분석하여 아래 JSON을 반환하세요.

판단 기준:
1. 피보험자 지위: 건축물대장 소유자와 주민등록 세대주 비교.
   - 동일인 → "소유자 겸 점유자" / 다른 사람 → "임차인 겸 점유자"
2. 주소 일치: 보험증권 소재지 "${policyAddr}"와 비교.
   - 동일 건물(표기만 다름) → "warn" / 구/동/호수 불일치 → "error" / 일치 → "ok"
3. 법률상 책임 성립: ${typeCtx}

{
  "insured_status": "소유자 겸 점유자 | 임차인 겸 점유자 | 임대인 | 확인불가",
  "insured_status_reason": "소유자명과 세대주명 비교 결과 명시한 1문장",
  "insured_status_liability": "yes | no",
  "liability_established_reason": "민법 조문 근거 포함 2문장",
  "liability_pay": "pay | exempt",
  "liability_pay_reason": "보험기간 일치 여부·소재지 일치 여부·면책 해당 여부 명시",
  "fault_ratio": "피보험자 100% | 기타",
  "fault_reason": "과실 비율 판단 근거",
  "investigator_opinion": "2~3문장, ~됨·~판단됨 간결체",
  "address_match": "ok | warn | error",
  "address_match_note": "주소 차이 설명 (일치하면 null)"
}` });

      const resp = await fetch('/api/claude', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ model: INS_MODEL, max_tokens: 800, system: SYS,
          messages: [{ role:'user', content: contentArr }] }),
      });
      if (!resp.ok) throw new Error('API 오류 ' + resp.status);
      const res = await resp.json();
      const r2 = JSON.parse((res.content?.[0]?.text||'{}').replace(/```json|```/g,'').trim());
      Object.assign(result, r2);
    }

    // ── 3차: 피해자 건축물대장 ──
    if (_insUploaded['building_reg_victim']) {
      progress(80, '피해자 정보 추출 중…');
      const b64 = await fetchBase64(_insUploaded['building_reg_victim'].file_path);
      if (b64) {
        const mt = docMediaType(_insUploaded['building_reg_victim'].file_path);
        const r3 = await callClaudeDoc(b64, mt, '피해자 건축물대장', SYS,
`피해자 건축물대장에서 피해자 소재지를 추출하세요.
{"victim_address":"동호수 (예: 101동 1204호)"}`);
        if (r3.victim_address) result.victim_address = r3.victim_address;
      }
    }

    progress(100, '✓ 분석 완료!');
    setTimeout(() => { if(load) load.style.display='none'; }, 600);

    _insResult = result;

    // 화면 필드 반영
    const set = (id, val) => {
      if (!val) return;
      const el = document.getElementById(id);
      if (!el) return;
      if (el.tagName==='SELECT') { for(const o of el.options) if(o.value===val){o.selected=true;break;} }
      else el.value = val;
    };
    set('ex-product', result.policy_product);
    set('ex-no',      result.policy_no);
    if (result.policy_start && result.policy_end)
      set('ex-period', result.policy_start + ' ~ ' + result.policy_end);
    set('ex-insured', result.insured_name);
    set('ex-status',  result.insured_status);
    if (result.coverage_limit) set('ex-coverage',  String(result.coverage_limit));
    if (result.deductible)     set('ex-deductible', String(result.deductible));
    set('ex-victim',  result.victim_address);
    if (result.address_match) {
      set('ex-addr', result.address_match);
      s2AddrChange();
    }
    if (result.address_match_note) set('ex-addr-note', result.address_match_note);
    set('j-opinion', result.investigator_opinion);
    // 책임 판단 드롭다운
    if (result.insured_status_liability) {
      set('j-established', result.insured_status_liability);
      const jEl = document.getElementById('j-established');
      if (jEl) s2JudgeStyle(jEl);
    }
    if (result.liability_pay) {
      set('j-pay', result.liability_pay);
      const jEl = document.getElementById('j-pay');
      if (jEl) s2JudgeStyle(jEl);
    }

    toast('분석 완료! 내용을 확인하고 수정하세요.', 's');
  } catch(e) {
    if (load) load.style.display = 'none';
    toast('분석 실패: ' + e.message, 'e');
  } finally {
    _insAnalyzing = false;
    if (btn) { btn.disabled=false; btn.textContent='↺ 재분석'; }
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
  return JSON.parse(raw.replace(/```json|```/g,'').trim());
}

async function s2Save() {
  const period = (document.getElementById('ex-period')?.value||'').split('~').map(s=>s.trim());
  const ded    = parseInt(document.getElementById('j-ded')?.value)||0;
  const rc     = _insField?.repair_cost||0;
  const pay    = Math.max(0, rc - ded);

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
    insured_status_liability: document.getElementById('j-established')?.value,
    liability_pay:   document.getElementById('j-pay')?.value,
    fault_ratio:     document.getElementById('j-fault')?.value,
    investigator_opinion: document.getElementById('j-opinion')?.value,
    payout_amount:   pay,
  };

  try {
    // Supabase 저장
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
      p_liability_established: _insResult.insured_status_liability||'yes',
      p_liability_pay:         _insResult.liability_pay||'pay',
      p_fault_ratio:           _insResult.fault_ratio||'피보험자 100%',
      p_liability_memo:        null,
      p_damage_amount:         rc||null,
      p_payout_amount:         pay||null,
    });

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
  const co = _insCompany || {};
  const r  = _insResult;
  const fd = _insField;
  const rc  = fd?.repair_cost || 0;
  const ded = r.deductible || cl.deductible || 200000;
  const pay = r.payout_amount || Math.max(0, rc - ded);
  const submitted = cl.insurance_tab_status === 'pdf_submitted';

  return `
  ${submitted ? `<div class="ins-banner ins-banner-success" style="margin-bottom:14px">
    ✓ 보험사 제출 완료 — ${(cl.pdf_submitted_at||'').slice(0,10)}
  </div>` : ''}

  <!-- 손해사정서 양식 미리보기 -->
  <div style="border:1px solid var(--line);border-radius:12px;overflow:hidden;box-shadow:var(--shadow);margin-bottom:16px">

    <!-- 표지 헤더 -->
    <div style="background:#0f172a;color:#fff;padding:16px 24px">
      <div style="font-size:11px;opacity:.6;margin-bottom:4px">손 해 사 정 서</div>
      <div style="font-size:16px;font-weight:900">${co.company_name||'누수패스손해사정'}</div>
      <div style="font-size:11px;opacity:.6;margin-top:2px">${co.company_name_en||'NUSUPASS ADJUSTERS CO.,LTD.'}</div>
    </div>

    <!-- 수신/참조/제목 -->
    <div style="padding:14px 24px;border-bottom:1px solid var(--line);background:#f8fafc">
      <div style="display:grid;grid-template-columns:60px 1fr;gap:6px 12px;font-size:13px">
        <div style="font-weight:700;color:var(--muted)">수  신</div>
        <div><input class="form-control" style="padding:4px 8px;font-size:13px" id="r-to" value="${cl.insurer_name||''}"/></div>
        <div style="font-weight:700;color:var(--muted)">참  조</div>
        <div><input class="form-control" style="padding:4px 8px;font-size:13px" id="r-ref" value="${cl.insurer_contact||''}"/></div>
        <div style="font-weight:700;color:var(--muted)">제  목</div>
        <div><input class="form-control" style="padding:4px 8px;font-size:13px" id="r-title"
          value="${r.policy_product||''} ${r.insured_name||''} 손해사정보고서"/></div>
      </div>
    </div>

    <!-- 1. 총괄표 -->
    <div style="padding:14px 24px;border-bottom:1px solid var(--line)">
      <div class="ins-report-sec-title">1. 총괄표</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#f1f5f9">
          <th style="padding:8px;border:1px solid var(--line);font-size:11px">구분</th>
          <th style="padding:8px;border:1px solid var(--line);font-size:11px">보상한도액</th>
          <th style="padding:8px;border:1px solid var(--line);font-size:11px">손해액</th>
          <th style="padding:8px;border:1px solid var(--line);font-size:11px">자기부담금</th>
          <th style="padding:8px;border:1px solid var(--line);font-size:11px">지급보험금</th>
        </tr></thead>
        <tbody>
          <tr><td style="padding:8px;border:1px solid var(--line);text-align:center">대물배상</td>
            <td style="padding:8px;border:1px solid var(--line);text-align:right">
              <input class="form-control" style="text-align:right;padding:3px 6px;font-size:12px" id="r-limit"
                value="${r.coverage_limit?Number(r.coverage_limit).toLocaleString()+'원':''}"/>
            </td>
            <td style="padding:8px;border:1px solid var(--line);text-align:right">
              <input class="form-control" style="text-align:right;padding:3px 6px;font-size:12px" id="r-damage"
                value="${rc?rc.toLocaleString()+'원':''}"/>
            </td>
            <td style="padding:8px;border:1px solid var(--line);text-align:right">
              <input class="form-control" style="text-align:right;padding:3px 6px;font-size:12px" id="r-ded"
                value="${ded?ded.toLocaleString()+'원':'200,000원'}"/>
            </td>
            <td style="padding:8px;border:1px solid var(--line);text-align:right;font-weight:700;color:var(--green)">
              <input class="form-control" style="text-align:right;padding:3px 6px;font-size:12px;color:var(--green);font-weight:700" id="r-pay"
                value="${pay?pay.toLocaleString()+'원':''}"/>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 2. 보험계약사항 -->
    <div style="padding:14px 24px;border-bottom:1px solid var(--line)">
      <div class="ins-report-sec-title">2. 보험계약사항</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;font-size:13px">
        ${[
          ['보험종목', 'r-product', r.policy_product||''],
          ['증권번호', 'r-pno', r.policy_no||cl.policy_no||''],
          ['피보험자', 'r-insured', r.insured_name||cl.insured_name||''],
          ['보험기간', 'r-period', r.policy_start&&r.policy_end?r.policy_start+' ~ '+r.policy_end:''],
          ['보상한도', 'r-cov', r.coverage_limit?Number(r.coverage_limit).toLocaleString()+'원':''],
          ['자기부담금', 'r-dedshow', ded?ded.toLocaleString()+'원':'200,000원'],
          ['특약조건', 'r-special', INS_TYPE_LABELS[cl.insurance_type]||'가족일상생활배상책임'],
          ['피해자 소재지', 'r-victim', r.victim_address||cl.victim_address||''],
        ].map(([k,id,v]) => `
          <div style="display:contents">
            <div style="color:var(--muted);font-weight:700;padding:4px 0;align-self:center">${k}</div>
            <div><input class="form-control" style="padding:4px 8px;font-size:12px" id="${id}" value="${v}"/></div>
          </div>`).join('')}
      </div>
    </div>

    <!-- 4. 사고사항 + 조사자의견 -->
    <div style="padding:14px 24px;border-bottom:1px solid var(--line)">
      <div class="ins-report-sec-title">4. 사고사항 — 조사자의견</div>
      <textarea class="form-control" id="r-opinion" rows="4" style="font-size:13px"
        >${r.investigator_opinion||''}</textarea>
    </div>

    <!-- 5. 법률상 손해배상책임 -->
    <div style="padding:14px 24px;border-bottom:1px solid var(--line)">
      <div class="ins-report-sec-title">5. 법률상 손해배상책임</div>
      <div style="display:grid;grid-template-columns:90px 1fr;gap:6px 12px;font-size:13px">
        <div style="color:var(--muted);font-weight:700">성립/불성립</div>
        <div style="font-weight:700;color:${r.insured_status_liability==='yes'?'var(--green)':'var(--red)'}">
          ${r.insured_status_liability==='yes'?'성립 · 부책':'불성립 · 면책'}
        </div>
        <div style="color:var(--muted);font-weight:700">관련법규</div>
        <div>민법 제750조, 제758조 / 상법 제680조</div>
        <div style="color:var(--muted);font-weight:700">판단근거</div>
        <div><textarea class="form-control" id="r-judgment" rows="2" style="font-size:12px"
          >${r.liability_established_reason||''}</textarea></div>
      </div>
    </div>

    <!-- 서명란 -->
    <div style="padding:16px 24px;text-align:right;background:#f8fafc">
      <div style="font-size:14px;font-weight:900;margin-bottom:6px">${co.company_name||'누수패스손해사정'}</div>
      <div style="font-size:13px;color:var(--muted)">
        손해사정사 ${co.adjuster_name||'서재성'} (등록번호 ${co.adjuster_license_no||'B11661166'}) (인)
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">${cl.submit_date||new Date().toISOString().slice(0,10)}</div>
    </div>
  </div>

  <!-- 출력/제출 -->
  <div class="card">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div style="text-align:center">
        <div style="font-size:28px;margin-bottom:8px">📄</div>
        <div style="font-size:14px;font-weight:700;margin-bottom:4px">PDF 출력</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:14px">브라우저 인쇄 → PDF 저장</div>
        <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="s3PrintPDF()">PDF 출력</button>
      </div>
      <div style="text-align:center">
        <div style="font-size:28px;margin-bottom:8px">✅</div>
        <div style="font-size:14px;font-weight:700;margin-bottom:4px">제출 완료</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:14px">지급보험금 ${pay.toLocaleString()}원 DB 기록</div>
        <button class="btn btn-success" style="width:100%;justify-content:center"
          ${submitted?'disabled':''} onclick="s3Submit()">
          ${submitted?'제출 완료됨':'보험사 제출 완료 처리'}
        </button>
      </div>
    </div>
  </div>

  <div class="ins-action-bar">
    <button class="btn btn-ghost" onclick="insGoStep(2)">← 이전</button>
    <button class="btn btn-ghost" onclick="s3SaveDraft()">초안 저장</button>
  </div>`;
}

async function s3SaveDraft() {
  const sections = {
    ..._insResult,
    report_title:       document.getElementById('r-title')?.value,
    insurer_contact:    document.getElementById('r-ref')?.value,
    investigator_opinion: document.getElementById('r-opinion')?.value,
    liability_established_reason: document.getElementById('r-judgment')?.value,
  };
  try {
    await sb.from('insurance_claim_drafts')
      .update({ is_current: false }).eq('claim_id', _insClaim.id);
    await sb.from('insurance_claim_drafts').insert({
      claim_id: _insClaim.id, sections_jsonb: sections,
      status:'reviewed', is_current:true,
      prompt_version: INS_PROMPT_VER, model_name: INS_MODEL,
    });
    await sb.from('insurance_claims')
      .update({ insurance_tab_status:'draft_generated', updated_at: new Date().toISOString() })
      .eq('id', _insClaim.id);
    _insClaim = { ..._insClaim, insurance_tab_status:'draft_generated' };
    _insResult = sections;
    toast('초안 저장 완료!', 's');
  } catch(e) { toast('저장 실패: ' + e.message, 'e'); }
}

function s3PrintPDF() {
  // 보고서 영역만 인쇄
  window.print();
}

async function s3Submit() {
  try {
    await s3SaveDraft();
    await sb.rpc('rpc_submit_insurance_claim', { p_claim_id: _insClaim.id });
    _insClaim = { ..._insClaim, insurance_tab_status:'pdf_submitted',
      pdf_submitted_at: new Date().toISOString() };
    insRender();
    toast('보험사 제출 완료 처리됐습니다.', 's');
  } catch(e) { toast('제출 실패: ' + e.message, 'e'); }
}

// ─────────────────────────────────────────────
// CSS 주입
// ─────────────────────────────────────────────
(function injectCSS() {
  if (document.getElementById('ins-css')) return;
  const s = document.createElement('style');
  s.id = 'ins-css';
  s.textContent = `
/* 스텝 바 */
.ins-step-bar{display:flex;gap:0;margin-bottom:16px;background:#fff;border-radius:12px;padding:6px;box-shadow:0 1px 3px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.08)}
.ins-step{flex:1;text-align:center;padding:8px 4px;border-radius:8px;cursor:default;transition:all .15s}
.ins-step-active{background:#2563eb;cursor:pointer}
.ins-step-done{cursor:pointer}.ins-step-done:hover{background:#f0fdf4}
.ins-step-locked{opacity:.4}
.ins-step-dot{width:8px;height:8px;border-radius:50%;margin:0 auto 4px;background:#e2e8f0}
.ins-step-active .ins-step-dot{background:#fff}
.ins-step-done .ins-step-dot{background:#15803d}
.ins-step-num{font-size:10px;font-weight:700;color:#94a3b8;margin-bottom:1px}
.ins-step-active .ins-step-num{color:rgba(255,255,255,.8)}
.ins-step-done .ins-step-num{color:#15803d}
.ins-step-label{font-size:12px;font-weight:700;color:#64748b}
.ins-step-active .ins-step-label{color:#fff}
.ins-step-done .ins-step-label{color:#111827}
.ins-step-sub{font-size:10px;color:#94a3b8;margin-top:1px}
.ins-step-active .ins-step-sub{color:rgba(255,255,255,.65)}

/* 약관 카드 */
.ins-type-card{border:1.5px solid #e2e8f0;border-radius:10px;padding:13px;cursor:pointer;transition:all .15s}
.ins-type-card:hover{border-color:#2563eb;background:#eff6ff}
.ins-type-selected{border-color:#2563eb !important;background:#eff6ff !important}

/* 드롭존 */
.ins-dz{border:1.5px dashed #cbd5e1;border-radius:10px;padding:14px 10px;text-align:center;cursor:pointer;transition:all .18s;position:relative;overflow:hidden;background:#fff}
.ins-dz:hover{border-color:#2563eb;background:#eff6ff}
.ins-dz-over{border-color:#2563eb;background:#eff6ff;transform:scale(1.02)}
.ins-dz-done{border-style:solid;border-color:#15803d;background:#f0fdf4}
.ins-dz-progress{position:absolute;bottom:0;left:0;height:3px;background:#2563eb;width:0%;transition:width .1s linear;display:none}
.ins-dz-icon{font-size:20px;margin-bottom:4px}
.ins-dz-name{font-size:12px;font-weight:700}
.ins-dz-sub{font-size:10px;color:#94a3b8;margin-top:2px}
.ins-dz-badge{display:inline-block;margin-top:5px;font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px}
.ins-badge-req{background:#dbeafe;color:#1d4ed8}
.ins-badge-opt{background:#f1f5f9;color:#64748b}
.ins-dz-done .ins-dz-badge{background:#dcfce7;color:#15803d}

/* 판단 박스 */
.ins-judge-box{border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:10px}
.ins-judge-head{padding:10px 15px;background:#f8fafc;display:flex;align-items:center;gap:10px;border-bottom:1px solid #e2e8f0}
.ins-judge-label{font-size:13px;font-weight:700;flex:1;color:#1e293b}
.ins-judge-sel{padding:5px 10px;font-size:12px;font-weight:700;border:1.5px solid #e2e8f0;border-radius:8px;cursor:pointer;outline:none;font-family:inherit}
.ins-judge-body{padding:11px 15px;font-size:12px;line-height:1.8;color:#6b7280}

/* 배너 */
.ins-banner{padding:10px 14px;border-radius:8px;font-size:13px;font-weight:500;margin-bottom:0}
.ins-banner-success{background:#f0fdf4;color:#15803d;border-left:3px solid #15803d}
.ins-banner-warn{background:#fffbeb;color:#d97706;border-left:3px solid #d97706}
.ins-banner-info{background:#eff6ff;color:#2563eb;border-left:3px solid #2563eb}

/* 액션바 */
.ins-action-bar{display:flex;align-items:center;justify-content:space-between;padding:14px 0;gap:10px;margin-top:8px}

/* 보고서 섹션 타이틀 */
.ins-report-sec-title{font-size:11px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px}

/* 인쇄 스타일 */
@media print {
  .sidebar, .sb-btn, .ins-step-bar, .ins-action-bar, .btn,
  #insuranceCaseSelect, .page-header button { display:none !important; }
  .content { padding: 0 !important; }
  body { background: white !important; }
}
`;
  document.head.appendChild(s);
})();

// INS_TYPE_LABELS 보완 (insStep2HTML에서 사용)
const INS_TYPE_LABELS = {
  daily_liability_old: '일상생활배상책임 (구형)',
  daily_liability_new: '일상생활배상책임 (신형)',
  facility_liability:  '시설소유(관리)자배상책임',
  water_damage:        '급배수누출손해',
};
