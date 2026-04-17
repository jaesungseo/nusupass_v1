// v2026-04-17-v5.2 — 룰북 15케이스 + 758조 본문/단서 + 등기부 우선 + 25개 추출 항목
/**
 * insurance-tab.js  v5.2
 * 누수패스 보험자료 탭
 *
 * 의존성: sb, toast(), curUser (index.html)
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
const INS_PROMPT_VER = 'v5.2';
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

const INS_CAUSES = [
  '배관','방수층','분배기','보일러',
  '세탁기 호스이탈','배수구 막힘','수도꼭지 미잠금','기타(직접입력)',
];

const INS_DOCS = [
  { code:'insurance_policy',  name:'보험증권',                                           type:'pdf', required:true  },
  { code:'resident_reg',      name:'주민등록등본',                                       type:'pdf', required:true  },
  { code:'ownership_insured', name:'피보험자 소유자료 (등기부등본 또는 건축물대장)',     type:'pdf', required:true  },
  { code:'ownership_victim',  name:'피해자 소유자료 (등기부등본 또는 건축물대장)',       type:'pdf', required:true  },
  { code:'family_cert',       name:'가족관계증명서',                                     type:'pdf', required:false },
  { code:'claim_form',        name:'보험청구서',                                         type:'pdf', required:false },
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
    for (const code of ['ownership_insured','resident_reg']) {
      const up = _insUploaded[code];
      if (!up) continue;
      const b64 = await fetchBase64(up.file_path);
      if (!b64) continue;
      const mt = docMediaType(up.file_path);
      const isPdf = mt === 'application/pdf';
      contentArr.push({
        type: isPdf ? 'document' : 'image',
        source: { type:'base64', media_type: mt, data: b64 },
        ...(isPdf ? { title: code==='ownership_insured'?'피보험자 소유자료(등기부 또는 건축물대장)':'주민등록등본' } : {}),
      });
    }
    if (contentArr.length > 0) {
      const policyAddr = result.policy_address_raw || '(보험증권 주소 미추출)';
      contentArr.push({ type:'text', text:
`위 서류(피보험자 소유자료 + 주민등록등본)를 교차 분석하여 아래 JSON을 반환하세요.

★ 자료 판독 우선순위:
   - 피보험자 소유자료가 "등기부등본"이면: 최우선 (소유권 공시의 법적 근거)
   - 피보험자 소유자료가 "건축물대장"이면: 보조 (소유자 란 참고 가능)
   - 둘 다 있으면 등기부등본 기준으로 판단, 건축물대장과 불일치 시 등기부 우선

판단 기준:

1. 피보험자 지위 (insured_status, 4-value):
   - 소유자(등기부/건축물대장) = 주민등록 세대주 (동일인) → "소유자겸점유자"
   - 주민등록상 해당 주소에 거주 중이나 소유자 ≠ 세대주 → "임차인겸점유자"
   - 소유자이지만 주민등록상 다른 주소에 거주 → "임대인"
   - 판단 근거 부족 → "확인불가"

2. 주소 일치 (보험증권 소재지 "${policyAddr}" 기준):
   - 완전 일치 또는 도로명↔지번 동일건물 표기차이 → "ok"
   - 동일 건물 추정되나 표기 차이 큼 → "warn"
   - 구/동/호수 불일치 → "error"

3. 세대 소유자 정보 추출 (등기부등본 우선):
   - 소유자 성명
   - 소유권 이전일 (YYYY-MM-DD 포맷)

4. 주민등록등본 동거인 요약:
   - 세대주 외 동거 구성원 성명+관계 (예: "김세연(배우자), 백지훈(부)")

{
  "insured_status": "소유자겸점유자 | 임차인겸점유자 | 임대인 | 확인불가",
  "insured_status_reason": "소유자명·세대주명·주소·거주여부를 비교한 결과를 1문장으로 명시",
  "insured_residence": "주민등록상 실거주지 전체 주소",
  "insured_owner_name": "세대 소유자 성명",
  "insured_owner_transfer_date": "YYYY-MM-DD 또는 null",
  "insured_cohabitants": "동거인 요약 (없거나 미확인 시 null)",
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

    // ── 3차: 피해자 소유자료 ──
    if (_insUploaded['ownership_victim']) {
      progress(55, '피해자 정보 추출 중…');
      const b64 = await fetchBase64(_insUploaded['ownership_victim'].file_path);
      if (b64) {
        const mt = docMediaType(_insUploaded['ownership_victim'].file_path);
        const r3 = await callClaudeDoc(b64, mt, '피해자 소유자료', SYS,
`피해자 소유자료(등기부등본 또는 건축물대장)에서 아래 JSON을 추출하세요.
등기부등본이면 소유자 란, 건축물대장이면 소유자 란을 참조하세요.

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
    const cause = _insClaim.accident_cause_type || '배관';
    const repairOpinion = _insField?.repair_opinion || '';
    const judgePrompt = buildJudgmentPrompt(insType, {
      insured_status:         result.insured_status         || '확인불가',
      insured_status_reason:  result.insured_status_reason  || '',
      insurance_location:     result.policy_address_raw     || '확인불가',
      accident_location:      result.victim_address         || '확인불가',
      insurance_period:       (result.policy_start && result.policy_end)
                               ? `${result.policy_start} ~ ${result.policy_end}` : '확인불가',
      accident_location_match: result.address_match         || 'ok',
      accident_cause:         cause,
      repair_opinion:         repairOpinion,
      insured_owner_name:     result.insured_owner_name     || '',
      victim_owner_name:      result.victim_owner_name      || '',
    });

    const judgeResp = await fetch('/api/claude', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ model: INS_MODEL, max_tokens: 900, system: SYS,
        messages: [{ role:'user', content: [{ type:'text', text: judgePrompt }] }] }),
    });
    if (!judgeResp.ok) throw new Error('판단 API 오류 ' + judgeResp.status);
    const judgeRes = await judgeResp.json();
    const r4 = JSON.parse((judgeRes.content?.[0]?.text||'{}').replace(/```json|```/g,'').trim());
    Object.assign(result, r4);

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
[피보험자 지위] ${ctx.insured_status}
[피보험자 지위 근거] ${ctx.insured_status_reason || '(미추출)'}
[보험증권 소재지] ${ctx.insurance_location}
[사고 발생 장소(피해자 소재지)] ${ctx.accident_location}
[보험기간] ${ctx.insurance_period}
[사고장소 부합 여부] ${ctx.accident_location_match}
[사고원인 분류 (관리자 선택)] ${ctx.accident_cause}
[수리 소견 (파트너 작성)] ${ctx.repair_opinion || '없음'}
[피보험자 세대 소유자] ${ctx.insured_owner_name || '확인불가'}
[피해자 세대 소유자] ${ctx.victim_owner_name || '확인불가'}

⚠ 절대 규칙: [피보험자 지위]는 사전 교차분석으로 확정된 값입니다.
당신이 임의로 재판단하거나 liability_reasoning/investigator_opinion 안에서
다른 지위로 바꿔 서술하면 안 됩니다. 반드시 위 지위 그대로 인용하세요.

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
  · 일치 → STEP 9-C
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
  "accident_type": "일상생활 | 주택관리 | 공용부 | 시공불량",
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
8. shared_liability = true면 coverage_reasoning에 "과실 비율에 따른 보험금 산정이 필요할 수 있음" 포함`;
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
    });

    // v5.2 신규: RPC가 커버 못하는 11개 컬럼 직접 UPDATE
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
      accident_cause_detail:       _insResult.accident_cause_detail       || null,
      accident_description:        _insResult.accident_description        || null,
      accident_type:               _insResult.accident_type               || null,
      shared_liability:            _insResult.shared_liability === true,
      liability_reasoning:         _insResult.liability_reasoning         || null,
      coverage_result:             _insResult.coverage_result             || null,
      coverage_reasoning:          _insResult.coverage_reasoning          || null,
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
