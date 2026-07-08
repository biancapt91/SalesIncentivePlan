// NEW CUSTOMER ACHIEVEMENT
// ===========================
const NC_API = API.NEW_CUSTOMER;

// ===========================
// ACTUAL ACHIEVEMENT FORM
// ===========================
const ACTUAL_API = API.KPI_ACTUALS;

let _actualCache      = {};  // component → { jan, feb, ..., dec }
let _actualEmpId      = null;
let _actualYear       = null;
let _actualMonthKey   = null;
let _actualPeriodPaid = false;  // true when the selected month is already paid

function renderActualAchievementPage() {
  const monthInput = document.getElementById('actualMonth');
  if (!monthInput.value) {
    const now = new Date();
    monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  // Clear stale data from previous session
  const summaryBody = document.getElementById('actualSummaryBody');
  if (summaryBody) summaryBody.innerHTML = '';
  const asmFilterBar = document.getElementById('actualSummaryFilterBar');
  if (asmFilterBar) asmFilterBar.style.display = 'none';

  // Clear info card and KPI section stale content
  const infoCard   = document.getElementById('actualInfoCard');
  const kpiSection = document.getElementById('actualKpiSection');
  if (infoCard)   { infoCard.innerHTML = '';   infoCard.style.display   = 'none'; }
  if (kpiSection) { kpiSection.innerHTML = ''; kpiSection.style.display = 'none'; }

  // Sales Associate: hide form section, auto-load their own summary
  const toolbar = document.querySelector('#page-actual-achievement .toolbar');

  if (currentRole === 'sales_associate' && currentAssociateId) {
    if (toolbar)    toolbar.style.display = '';   // keep toolbar visible (month picker)
    const toolbarControls = document.getElementById('actualToolbarControls');
    if (toolbarControls) toolbarControls.style.display = 'none';
    if (infoCard)   infoCard.style.display = 'none';
    if (kpiSection) kpiSection.style.display = 'none';
    // Wire month picker to re-load summary on change (once)
    const monthInp = document.getElementById('actualMonth');
    if (monthInp && !monthInp._salesWired) {
      monthInp._salesWired = true;
      monthInp.addEventListener('change', () => loadActualSummaryTable(currentAssociateId));
    }
    // Hide Load button and filter bar in summary section
    const btnLoadSum = document.getElementById('btnLoadActualSummary');
    if (btnLoadSum) btnLoadSum.style.display = 'none';
    // Also hide the actualSummaryFilterBar (search/filter inside summary section)
    const asmFilterBar = document.getElementById('actualSummaryFilterBar');
    if (asmFilterBar) asmFilterBar.style.display = 'none';
    // Auto-load summary filtered to their visible associate scope
    loadActualSummaryTable();
    return;
  }

  // Admin/Supervisor/HeadAdmin/SalesAdmin: show full form
  if (toolbar) toolbar.style.display = '';
  const toolbarControlsAdmin = document.getElementById('actualToolbarControls');
  if (toolbarControlsAdmin) toolbarControlsAdmin.style.display = currentRole === 'supervisor' ? 'none' : '';
  const btnLoadSumAdmin = document.getElementById('btnLoadActualSummary');
  if (btnLoadSumAdmin) btnLoadSumAdmin.style.display = '';
  const sel = document.getElementById('actualAssociate');
  sel.value = ''; // Reset selection from previous session
  // For head_admin/sales_admin: only show associates in their detail_area
  const isAreaRole = currentRole === 'head_admin' || currentRole === 'sales_admin';
  const visibleAssocs = (isAreaRole && currentDetailArea)
    ? associates.filter(a => currentDetailArea.split(',').map(s => s.trim()).includes(a.detail_area))
    : associates;
  sel.innerHTML = '<option value="">-- Select Associate --</option>' +
    visibleAssocs.map(a =>
      `<option value="${a.employee_id}">${a.full_name} (${a.employee_id})</option>`
    ).join('');
}

async function loadActualAchievementForm() {
  const monthFull = document.getElementById('actualMonth').value;
  const empId     = document.getElementById('actualAssociate').value;
  if (!monthFull || !empId) {
    showToast('Please select a month and an associate first.', 'error');
    return;
  }

  const [yearStr, monthNumStr] = monthFull.split('-');
  const year      = parseInt(yearStr);
  const monthIdx  = parseInt(monthNumStr) - 1;
  const monthKey  = MONTH_KEYS[monthIdx];
  const monthName = MONTH_NAMES[monthIdx];

  _actualEmpId    = empId;
  _actualYear     = year;
  _actualMonthKey = monthKey;
  _actualCache    = {};

  const a = associates.find(x => x.employee_id === empId);
  if (!a) { showToast('Associate tidak ditemukan.', 'error'); return; }

  // Determine level effective for the selected month from employment history
  // History API returns records sorted by effective_date DESC
  let effectiveLevel    = a.level;
  let effectivePosition = a.position;
  try {
    const histRes  = await fetch(`${HIST_API}?employee_id=${encodeURIComponent(empId)}`);
    const histJson = await histRes.json();
    if (histJson.success && histJson.data.length > 0) {
      // Last day of the selected month
      const lastDay = `${year}-${String(monthIdx + 1).padStart(2,'0')}-${new Date(year, monthIdx + 1, 0).getDate().toString().padStart(2,'0')}`;
      // Find most recent history entry where effective_date <= lastDay of selected month
      // Data is DESC so iterate and pick first match
      const applicableEntry = histJson.data
        .slice() // already desc
        .find(h => h.effective_date <= lastDay);
      if (applicableEntry) {
        // Only override level if the history entry has a level stored
        if (applicableEntry.level) effectiveLevel = applicableEntry.level;
        if (applicableEntry.position) effectivePosition = applicableEntry.position;
      }
    }
  } catch (_) { /* fallback to current level */ }

  const items = getKpiItems(effectiveLevel, a.detail_area);

  // Show associate info card (hidden for supervisor role)
  const infoCard = document.getElementById('actualInfoCard');
  if (currentRole !== 'supervisor') infoCard.style.display = '';
  const levelChanged = effectiveLevel !== a.level;
  infoCard.innerHTML = `
    <div style="padding:14px 20px;display:flex;gap:28px;align-items:center;flex-wrap:wrap;">
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px;">Associate</div>
        <strong style="font-size:15px;">${a.full_name}</strong>
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px;">ID</div>
        <code style="background:#f1f5f9;padding:2px 7px;border-radius:4px;font-size:12px;">${a.employee_id}</code>
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px;">Level</div>
        <span class="badge ${getLevelBadge(effectiveLevel)}">${effectiveLevel || '—'}</span>
        ${levelChanged ? `<span style="font-size:11px;color:#f59e0b;margin-left:4px;" title="Level at this period. Current level: ${a.level}"><i class="fa-solid fa-circle-info"></i> current: ${a.level}</span>` : ''}
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px;">Position</div>
        ${effectivePosition}
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px;">Detail Area</div>
        ${a.detail_area || '—'}
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px;">Period</div>
        <strong>${monthName} ${year}</strong>
      </div>
    </div>`;

  const section = document.getElementById('actualKpiSection');
  if (currentRole !== 'supervisor') {
    section.style.display = '';
    section.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>';
  }

  if (!items) {
    if (currentRole !== 'supervisor') section.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);">KPI not available for this level.</div>';
    return;
  }

  try {
    const monthNum = MONTH_KEYS.indexOf(monthKey) + 1;
    const [resT, resA, resLock, resPeriodStatus] = await Promise.all([
      fetch(`${API.KPI_TARGETS}?employee_id=${encodeURIComponent(empId)}&year=${year}`),
      fetch(`${ACTUAL_API}?employee_id=${encodeURIComponent(empId)}&year=${year}`),
      fetch(`${SIP_REPORT_API}?action=locked_cells&employee_id=${encodeURIComponent(empId)}&year=${year}`).then(r => r.json()).catch(() => ({ success: false })),
      fetch(`${SIP_REPORT_API}?action=status&month=${monthNum}&year=${year}`).then(r => r.json()).catch(() => ({ success: false })),
    ]);
    const [tJson, aJson] = await Promise.all([resT.json(), resA.json()]);

    const targets    = {};
    const actuals    = {};
    const lockedSet  = resLock.success ? resLock.data : {};   // "component::monthKey" → true
    _actualPeriodPaid = resPeriodStatus.success && resPeriodStatus.data?.status === 'paid';
    if (tJson.success) tJson.data.forEach(r => { targets[r.component] = r; });
    if (aJson.success) aJson.data.forEach(r => { actuals[r.component] = r; _actualCache[r.component] = r; });

    let prevParentA = null;
    let rowNumA = 0;
    const rows = items.map((it) => {
      if (it._isParentHeader) {
        rowNumA++;
        return `<tr class="kpi-parent-header">
          <td>${rowNumA}</td>
          <td class="kpi-label" colspan="5" style="font-weight:600;">${it.label} <span style="color:var(--text-muted);font-weight:400;font-size:12px;">(${it.pct}%)</span></td>
        </tr>`;
      }
      const tRow   = targets[it.label] || {};
      const aRow   = actuals[it.label] || {};
      const target = tRow[monthKey] ?? 0;
      const actual = aRow[monthKey] ?? 0;
      const weight = it._sub ? it.pct : ((tRow.weight != null && Object.keys(tRow).length > 0) ? tRow.weight : it.pct);
      let pctHtml = '<span style="color:var(--text-muted)">—</span>';
      if (target > 0) {
        const pct = (actual / target * 100).toFixed(2);
        const cls = actual >= target ? 'actual-pct-met' : actual >= target * 0.5 ? 'actual-pct-partial' : 'actual-pct-low';
        pctHtml = `<span class="${cls}">${pct}%</span>`;
      }
      const isFirstSubA   = it._sub && it._parent !== prevParentA;
      if (it._sub) prevParentA = it._parent; else prevParentA = null;
      const rowClassA     = it._sub ? `kpi-sub-row${isFirstSubA ? ' kpi-sub-first' : ''}` : '';
      if (!it._sub) rowNumA++;
      const _akpiNumStyle = currentRole === 'sales_associate' ? ' style="display:none"' : '';
      const numCellA      = it._sub ? `<td${_akpiNumStyle}></td>` : `<td${_akpiNumStyle}>${rowNumA}</td>`;
      const displayLabelA = it._sub ? `<span class="kpi-sub-arrow">↳</span> ${it._sub}` : it.label;
      const cellKey       = `${it.label}::${monthKey}`;
      const isLocked      = !!lockedSet[cellKey];
      const canReqChange  = isLocked && currentRole !== 'sales_associate';
      const escapedComp   = it.label.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const reqBtn        = canReqChange
        ? ` <button style="background:transparent;border:1px solid #c7d2fe;border-radius:4px;padding:1px 5px;cursor:pointer;line-height:1;" title="Minta Perubahan Nilai" onclick="openUnlockRequestModal('${empId}','${escapedComp}','${monthKey}',${year},${actual})"><i class="fa-solid fa-pen-to-square" style="color:#6366f1;font-size:10px;"></i></button>`
        : '';
      const inputHtml     = isLocked
        ? `<span style="display:inline-flex;align-items:center;gap:4px;color:#6b7280;font-size:13px;">
             <i class="fa-solid fa-lock" style="color:#f59e0b;font-size:11px;"></i>
             ${actual > 0 ? actual.toLocaleString('id-ID') : '—'}${reqBtn}
           </span>`
        : `<input type="number" class="kpi-input actual-input" value="${actual}" min="0" step="any" oninput="recalcAchievementPct(this)" style="width:100px;" />`;
      return `<tr data-component="${it.label.replace(/"/g,'&quot;')}" data-target="${target}"${rowClassA ? ` class="${rowClassA}"` : ''}>
        ${numCellA}
        <td class="kpi-label">${displayLabelA}</td>
        <td style="text-align:center;">${weight}%</td>
        <td style="text-align:right;">${target > 0 ? target.toLocaleString('id-ID') : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td style="text-align:right;">${inputHtml}</td>
        <td class="actual-pct-cell" style="text-align:center;font-weight:600;">${pctHtml}</td>
      </tr>`;
    }).join('');

    section.innerHTML = `
      <div class="detail-section-header" style="padding:12px 16px 0;">
        <h4 style="font-size:14px;font-weight:600;"><i class="fa-solid fa-chart-line"></i> KPI Actuals — ${monthName} ${year}</h4>
      </div>
      <div class="table-responsive" style="margin-top:8px;">
        <table class="data-table">
          <thead>
            <tr>
              <th style="display:${currentRole==='sales_associate'?'none':''};">#</th>
              <th>Key Performance Indicator</th>
              <th style="text-align:center;">Weight</th>
              <th style="text-align:right;">Target (${monthName})</th>
              <th style="text-align:right;">Actual</th>
              <th style="text-align:center;">Achievement %</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="padding:12px 16px;text-align:right;border-top:1px solid var(--border);">
        <button class="btn btn-primary" onclick="saveAllActuals()">
          <i class="fa-solid fa-floppy-disk"></i> Save All
        </button>
      </div>`;

  } catch(e) {
    section.innerHTML = `<div style="padding:24px;text-align:center;color:var(--red);">Failed to load: ${e.message}</div>`;
  }
}

function recalcAchievementPct(input) {
  const tr     = input.closest('tr');
  const target = parseFloat(tr.dataset.target) || 0;
  const actual = parseFloat(input.value) || 0;
  const cell   = tr.querySelector('.actual-pct-cell');
  if (target > 0) {
    const pct = (actual / target * 100).toFixed(2);
    const cls = actual >= target ? 'actual-pct-met' : actual >= target * 0.5 ? 'actual-pct-partial' : 'actual-pct-low';
    cell.innerHTML = `<span class="${cls}">${pct}%</span>`;
  } else {
    cell.innerHTML = '<span style="color:var(--text-muted)">—</span>';
  }
}

async function saveAllActuals() {
  const empId    = _actualEmpId;
  const year     = _actualYear;
  const monthKey = _actualMonthKey;
  if (!empId || !year || !monthKey) return;

  const section  = document.getElementById('actualKpiSection');
  const rows     = [...section.querySelectorAll('tbody tr:not(.kpi-parent-header)')];
  if (!rows.length) return;

  // Detect late entries: paid month + new value > 0 + previously 0
  let lateTargetMonth = null;
  let lateTargetYear  = null;
  if (_actualPeriodPaid) {
    const lateComponents = [];
    for (const tr of rows) {
      const component   = tr.dataset.component;
      const inputEl     = tr.querySelector('.actual-input');
      if (!inputEl) continue;
      const newVal      = parseFloat(inputEl.value) || 0;
      const existingVal = (_actualCache[component] ?? {})[monthKey] ?? 0;
      if (newVal > 0 && existingVal === 0) lateComponents.push(component);
    }
    if (lateComponents.length > 0) {
      try {
        const sourceMonth = MONTH_KEYS.indexOf(monthKey) + 1;
        const chosen = await showCFTargetMonthModal(sourceMonth, year, lateComponents);
        lateTargetMonth = chosen.target_month;
        lateTargetYear  = chosen.target_year;
      } catch (e) {
        return; // user cancelled
      }
    }
  }

  const saveBtns = section.querySelectorAll('button[onclick="saveAllActuals()"]');
  saveBtns.forEach(b => { b.disabled = true; b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...'; });

  let errors = 0;
  let lockedCount = 0;
  let carryFwdCount = 0;
  await Promise.all(rows.map(async tr => {
    const component = tr.dataset.component;
    const inputEl   = tr.querySelector('.actual-input');
    if (!inputEl) return;  // locked cell (no input), skip
    const actual    = parseFloat(inputEl.value) || 0;
    const existing  = _actualCache[component] || {};
    const payload   = { employee_id: empId, year, component };
    MONTH_KEYS.forEach(k => { payload[k] = existing[k] ?? 0; });
    payload[monthKey] = actual;
    // Pass chosen carry-forward target month for late entries
    if (lateTargetMonth && lateTargetYear) {
      const existingVal = existing[monthKey] ?? 0;
      if (actual > 0 && existingVal === 0) {
        payload.late_entry_target_month = lateTargetMonth;
        payload.late_entry_target_year  = lateTargetYear;
      }
    }
    try {
      const res  = await fetch(ACTUAL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      lockedCount   += (json.locked_rejected?.length || 0);
      carryFwdCount += (json.carry_forwards || 0);
      _actualCache[component] = { ...existing, [monthKey]: actual };
    } catch(e) { errors++; }
  }));

  saveBtns.forEach(b => { b.disabled = false; b.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save All'; });
  const cfMonthName = lateTargetMonth ? `${MONTH_NAMES[lateTargetMonth - 1]} ${lateTargetYear}` : 'berikutnya';
  let msg = errors > 0 ? `${errors} rows failed to save.` : 'All actuals saved successfully.';
  if (lockedCount > 0)   msg += ` (${lockedCount} sel terkunci diabaikan)`;
  if (carryFwdCount > 0) msg += ` — ${carryFwdCount} nilai carry-forward masuk ke ${cfMonthName}.`;
  showToast(msg, errors > 0 ? 'error' : 'success');
  if (errors === 0) loadActualSummaryTable();
}

// Modal for choosing the carry-forward target month when saving a late entry
function showCFTargetMonthModal(sourceMonth, sourceYear, lateComponents) {
  if (!document.getElementById('cfTargetMonthOverlay')) {
    const el = document.createElement('div');
    el.id = 'cfTargetMonthOverlay';
    el.style.cssText = 'display:none;position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,.45);align-items:center;justify-content:center;';
    el.innerHTML = `
      <div class="card" style="min-width:420px;max-width:92vw;padding:28px 32px;background:rgb(254, 253, 253);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.2);">
        <h3 style="margin:0 0 8px;font-size:17px;">
          <i class="fa-solid fa-clock-rotate-left" style="color:#f59e0b;margin-right:8px;"></i>
          Select Billing Month
        </h3>
        <ul id="cfLateCompList" style="margin:0 0 18px;padding-left:20px;font-size:13px;color:#374151;"></ul>
        <label style="font-weight:600;font-size:13px;display:block;margin-bottom:6px;">Dibayarkan di bulan:</label>
        <select id="cfTargetMonthSelect" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:6px;font-size:14px;"></select>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:22px;">
          <button id="cfTargetMonthCancel" class="btn btn-secondary">Batal</button>
          <button id="cfTargetMonthConfirm" class="btn btn-primary">
            <i class="fa-solid fa-check"></i> Konfirmasi
          </button>
        </div>
      </div>`;
    document.body.appendChild(el);
  }

  const overlay = document.getElementById('cfTargetMonthOverlay');
  const sel     = document.getElementById('cfTargetMonthSelect');
  const list    = document.getElementById('cfLateCompList');

  list.innerHTML = lateComponents.map(c => `<li>${c}</li>`).join('');

  sel.innerHTML = '';
  for (let i = 1; i <= 12; i++) {
    let m = sourceMonth + i;
    let y = sourceYear;
    if (m > 12) { m -= 12; y++; }
    const opt = document.createElement('option');
    opt.value = `${y}-${m}`;
    opt.textContent = `${MONTH_NAMES[m - 1]} ${y}`;
    sel.appendChild(opt);
  }

  overlay.style.display = 'flex';

  return new Promise((resolve, reject) => {
    const confirmBtn = document.getElementById('cfTargetMonthConfirm');
    const cancelBtn  = document.getElementById('cfTargetMonthCancel');

    function cleanup() {
      overlay.style.display = 'none';
      confirmBtn.onclick = null;
      cancelBtn.onclick  = null;
    }

    confirmBtn.onclick = () => {
      const [yr, mo] = sel.value.split('-').map(Number);
      cleanup();
      resolve({ target_month: mo, target_year: yr });
    };
    cancelBtn.onclick = () => {
      cleanup();
      reject(new Error('cancelled'));
    };
  });
}

// Module-level summary state for client-side filtering
let _summaryGrouped  = {};
let _summaryOrder    = [];
let _summaryYear     = null;
let _summaryMonthName = '';

async function loadActualSummaryTable(filterEmpId = null) {
  const monthFull = document.getElementById('actualMonth').value;
  if (!monthFull) {
    // For sales associate auto-load, default to current month
    const now = new Date();
    document.getElementById('actualMonth').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  const monthVal = document.getElementById('actualMonth').value;
  if (!monthVal) { showToast('Please select a month first.', 'error'); return; }
  const [yearStr, monthNumStr] = monthVal.split('-');
  const year      = parseInt(yearStr);
  const monthIdx  = parseInt(monthNumStr) - 1;
  const monthKey  = MONTH_KEYS[monthIdx];
  const monthName = MONTH_NAMES[monthIdx];

  // Determine effective filter: explicit param > sales_associate visible scope
  const salesScope = currentRole === 'sales_associate' ? getViewableEmployeeIds() : null;
  const empFilter  = filterEmpId ?? (currentRole === 'sales_associate' ? salesScope : null);
  // For head_admin/sales_admin without a specific empFilter: restrict to their detail_area
  const _areaList  = (currentDetailArea || '').split(',').map(s => s.trim()).filter(Boolean);
  const areaFilter = (!empFilter && (currentRole === 'head_admin' || currentRole === 'sales_admin') && _areaList.length > 0)
    ? _areaList : null;

  const summaryBody = document.getElementById('actualSummaryBody');
  document.getElementById('actualSummaryFilterBar').style.display = 'none';
  summaryBody.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>';

  try {
    const res  = await fetch(`${ACTUAL_API}?year=${year}&month_key=${monthKey}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    // Filter to the visible scope for Sales Associates (own + subordinates)
    let data = empFilter
      ? json.data.filter(r => Array.isArray(empFilter)
        ? empFilter.includes(r.employee_id)
        : r.employee_id === empFilter)
      : json.data;
    // Filter by detail_area for head_admin/sales_admin
    if (areaFilter) {
      data = data.filter(r => areaFilter.includes(r.detail_area));
    }

    if (!data.length) {
      summaryBody.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-muted);">No actuals found for this period.</div>';
      return;
    }

    // Group by employee_id, preserving order
    const grouped = {};
    const order   = [];
    data.forEach(r => {
      if (!grouped[r.employee_id]) { grouped[r.employee_id] = []; order.push(r.employee_id); }
      grouped[r.employee_id].push(r);
    });

    // Sort each employee's rows by getKpiItems order (Closed Won/Consumption last)
    order.forEach(empId => {
      const sample   = grouped[empId][0];
      const kpiOrder = (getKpiItems(sample.level, sample.detail_area) || []).map(it => it.label);
      grouped[empId].sort((a, b) => {
        const aIdx = kpiOrder.findIndex(l => l === a.component);
        const bIdx = kpiOrder.findIndex(l => l === b.component);
        return aIdx - bIdx;
      });
    });

    // Sort by level order then by name
    const LEVEL_ORDER = ['Manager','Leader','Senior','Senior TAC','Junior TAC','Junior'];
    order.sort((a, b) => {
      const la = grouped[a][0].level || '';
      const lb = grouped[b][0].level || '';
      const ia = LEVEL_ORDER.indexOf(la);
      const ib = LEVEL_ORDER.indexOf(lb);
      const lvlCmp = (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      if (lvlCmp !== 0) return lvlCmp;
      return grouped[a][0].full_name.localeCompare(grouped[b][0].full_name, 'id');
    });

    // Store for filter use
    _summaryGrouped   = grouped;
    _summaryOrder     = order;
    _summaryYear      = year;
    _summaryMonthName = monthName;

    // Populate + show filter bar (only for admin/supervisor)
    _populateActualSummaryFilters();
    if (currentRole !== 'sales_associate') {
      document.getElementById('actualSummaryFilterBar').style.display = 'flex';
    }

    _renderActualSummary();
  } catch(e) {
    summaryBody.innerHTML = `<div style="padding:24px;text-align:center;color:var(--red);">Failed to load: ${e.message}</div>`;
  }
}

function _populateActualSummaryFilters() {
  const allSamples = _summaryOrder.map(id => _summaryGrouped[id][0]);
  const unique = (key) => [...new Set(allSamples.map(r => r[key]).filter(Boolean))].sort();

  const fill = (id, values) => {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML = `<option value="">${sel.options[0].text}</option>` +
      values.map(v => `<option value="${v}"${v === cur ? ' selected' : ''}>${v}</option>`).join('');
  };
  fill('filterSummaryLevel',      unique('level'));
  fill('filterSummaryDetailArea', unique('detail_area'));
}

function resetActualSummaryFilters() {
  document.getElementById('searchActualSummary').value  = '';
  document.getElementById('filterSummaryLevel').value      = '';
  document.getElementById('filterSummaryDetailArea').value = '';
  _renderActualSummary();
}

function _renderActualSummary() {
  const year      = _summaryYear;
  const monthName = _summaryMonthName;

  const q          = document.getElementById('searchActualSummary').value.toLowerCase().trim();
  const levelF     = document.getElementById('filterSummaryLevel').value;
  const detailAreaF = document.getElementById('filterSummaryDetailArea').value;

  // Filter order by associate-level fields
  const filteredOrder = _summaryOrder.filter(empId => {
    const r = _summaryGrouped[empId][0];
    if (q && !(
      r.full_name.toLowerCase().includes(q) ||
      r.employee_id.toLowerCase().includes(q)
    )) return false;
    if (levelF      && r.level       !== levelF)      return false;
    if (detailAreaF && r.detail_area !== detailAreaF) return false;
    return true;
  });

  const summaryBody = document.getElementById('actualSummaryBody');
  const countEl     = document.getElementById('actualSummaryCount');

  if (!filteredOrder.length) {
    summaryBody.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-muted);">No records match the filter.</div>';
    countEl.textContent = '0 associates';
    return;
  }

  countEl.textContent = `${filteredOrder.length} associate(s)`;

  let rowNo = 0;
  const rows = filteredOrder.flatMap(empId => {
    const empRows = _summaryGrouped[empId];
    rowNo++;

    // Inject synthetic parent rows for Distributor/Direct groups (not stored in DB)
    const processedRows = [];
    const insertedParents = new Set();
    for (const r of empRows) {
      const subMatch = r.component.match(/^(.+) - (Distributor|Direct)$/);
      if (subMatch) {
        const parentName = subMatch[1];
        if (!insertedParents.has(parentName)) {
          const kpiItem = (getKpiItems(r.level, r.detail_area) || []).find(it => it.label === parentName);
          processedRows.push({ ...r, component: parentName, _isParentHeader: true, weight: kpiItem ? kpiItem.pct : r.weight });
          insertedParents.add(parentName);
        }
      }
      processedRows.push(r);
    }

    // Compute total weighted achievement (using effective weights for sub-rows)
    const kpiItems = getKpiItems(empRows[0].level, empRows[0].detail_area) || [];
    let totalWeighted = 0;
    empRows.forEach(r => {
      const target = r.target_val;
      const actual = r.actual_val;
      if (target <= 0) return;
      const subM = r.component.match(/^(.+) - (Distributor|Direct)$/);
      let effectiveWeight;
      if (subM) {
        const parentItem = kpiItems.find(it => it.label === subM[1] && it._isParentHeader);
        const subPct = subM[2] === 'Distributor' ? JABODETABEK_DIST_PCT : JABODETABEK_DIR_PCT;
        effectiveWeight = parentItem ? (parentItem.pct * subPct / 100) : r.weight;
      } else {
        effectiveWeight = r.weight;
      }
      const isCW = r.component === 'Closed Won/Consumption';
      const achievementRatio = isCW
        ? (actual >= target ? 1 : 0)
        : (actual / target);
      totalWeighted += achievementRatio * effectiveWeight;
    });
    const totalCls  = totalWeighted >= 100 ? 'actual-pct-met' : totalWeighted >= 50 ? 'actual-pct-partial' : 'actual-pct-low';
    const totalHtml = `<span class="${totalCls}" style="font-size:14px;font-weight:700;">${totalWeighted.toFixed(2)}%</span>`;

    // +1 rowspan to include the total row
    const rowspan = processedRows.length + 1;
    const isJabodetabek = insertedParents.size > 0;
    const spanBg = isJabodetabek ? 'background:#fff;' : '';
    let isFirstRow = true;

    return processedRows.map((r) => {
      const isHeader = !!r._isParentHeader;
      const subMatch = r.component.match(/ - (Distributor|Direct)$/);
      const isSub    = !!subMatch;

      const rowFirstClass = isFirstRow ? 'asum-first' : 'asum-sub';
      const headerClass   = isHeader ? ' kpi-parent-header' : '';

      const _asumNumStyle = currentRole === 'sales_associate' ? 'display:none;' : '';
      const associateCells = isFirstRow ? `
        <td rowspan="${rowspan}" class="asum-span" style="${spanBg}${_asumNumStyle}text-align:center;">${rowNo}</td>
        <td rowspan="${rowspan}" class="asum-span" style="${spanBg}"><code style="background:#f1f5f9;padding:2px 7px;border-radius:4px;font-size:12px;">${r.employee_id}</code></td>
        <td rowspan="${rowspan}" class="asum-span" style="${spanBg}"><strong>${r.full_name}</strong></td>
        <td rowspan="${rowspan}" class="asum-span" style="${spanBg}font-size:13px;">${r.position}</td>
        <td rowspan="${rowspan}" class="asum-span" style="${spanBg}"><span class="badge ${getLevelBadge(r.level)}">${r.level || '—'}</span></td>
        <td rowspan="${rowspan}" class="asum-span" style="${spanBg}font-size:13px;">${r.detail_area || '—'}</td>` : '';
      isFirstRow = false;

      if (isHeader) {
        return `<tr class="${rowFirstClass}${headerClass}">
          ${associateCells}
          <td style="font-weight:600;">${r.component}</td>
          <td style="text-align:center;">${r.weight}%</td>
          <td colspan="4" style="text-align:center;color:var(--text-muted);font-size:12px;font-style:italic;"></td>
        </tr>`;
      }

      const target = r.target_val;
      const actual = r.actual_val;
      let pctHtml = '<span style="color:var(--text-muted)">—</span>';
      if (target > 0) {
        const pct = parseFloat((actual / target * 100).toFixed(2));
        const cls = pct >= 100 ? 'actual-pct-met' : pct >= 50 ? 'actual-pct-partial' : 'actual-pct-low';
        pctHtml = `<span class="${cls}">${pct.toFixed(2)}%</span>`;
      }
      const targetFmt = target > 0
        ? target.toLocaleString('id-ID')
        : '<span style="color:var(--text-muted)">—</span>';
      const actualFmt = actual > 0
        ? `<strong>${actual.toLocaleString('id-ID')}</strong>`
        : '<span style="color:var(--text-muted)">0</span>';

      const compDisplay = isSub
        ? `<span class="kpi-sub-arrow">↳</span> ${subMatch[1]}`
        : r.component;

      return `<tr class="${rowFirstClass}">
        ${associateCells}
        <td style="font-size:13px;">${compDisplay}</td>
        <td style="text-align:center;">${r.weight}%</td>
        <td style="text-align:right;">${targetFmt}</td>
        <td style="text-align:right;">${actualFmt}</td>
        <td style="text-align:center;font-weight:600;">${pctHtml}</td>
        ${currentRole === 'admin' ? `<td style="text-align:center;"><button class="btn-icon delete" title="Delete" onclick="deleteActual('${r.employee_id}',${year},'${r.component.replace(/'/g,"\\'")}')"><i class="fa-solid fa-trash"></i></button></td>` : ''}
      </tr>`;
    }).concat([`<tr style="background:#a1c7f4;border-top:2px solid #a1c7f4;">
      <td colspan="4" style="text-align:right;padding-right:14px;font-size:12px;font-weight:600;color:#000000;letter-spacing:.5px;">TOTAL ACHIEVEMENT</td>
      <td style="text-align:center;">${totalHtml}</td>
      ${currentRole === 'admin' ? '<td></td>' : ''}
    </tr>`]);
  });

  summaryBody.innerHTML = `
    <div class="table-responsive">
      <table class="data-table actual-summary-table">
        <thead>
          <tr>
            <th style="display:${currentRole==='sales_associate'?'none':''}">#</th>
            <th>ID</th>
            <th>Full Name</th>
            <th>Initial Position</th>
            <th>Level</th>
            <th>Detail Area</th>
            <th>Key Performance Indicator</th>
            <th style="text-align:center;">Weight</th>
            <th style="text-align:right;">Target</th>
            <th style="text-align:right;">Actual</th>
            <th style="text-align:center;">Achievement %</th>
            ${currentRole === 'admin' ? '<th style="text-align:center;">Action</th>' : ''}
          </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
}

// Wire filter inputs (non-blocking — elements exist in HTML from page load)
['searchActualSummary','filterSummaryLevel','filterSummaryDetailArea'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    if (_summaryOrder.length) _renderActualSummary();
  });
});

async function deleteActual(empId, year, component) {
  if (!confirm(`Delete actual data "${component}" for ${empId}?`)) return;
  try {
    const res  = await fetch(ACTUAL_API, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: empId, year, component })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    showToast('Actual data deleted successfully.', 'success');
    loadActualSummaryTable();
  } catch(e) {
    showToast('Failed to delete: ' + e.message, 'error');
  }
}

// ===========================
// IMPORT ACTUAL EXCEL
// ===========================
let _importActualData = []; // parsed rows ready to save

function openImportActualModal() {
  const monthFull = document.getElementById('actualMonth').value;
  if (!monthFull) { showToast('Please select a month first.', 'error'); return; }
  // Reset state
  _importActualData = [];
  document.getElementById('importActualFile').value = '';
  document.getElementById('importActualFileName').textContent = 'No file selected';
  document.getElementById('importActualPreview').style.display = 'none';
  document.getElementById('importActualError').style.display = 'none';
  document.getElementById('btnConfirmImport').disabled = true;
  openModal('importActualOverlay');
}

function downloadActualTemplate(e) {
  e.preventDefault();
  const monthFull = document.getElementById('actualMonth').value;
  const [yearStr, monthNumStr] = (monthFull || `${new Date().getFullYear()}-01`).split('-');
  const monthName = MONTH_NAMES[parseInt(monthNumStr) - 1] || 'Month';

  const header = ['employee_id', 'full_name', 'level', 'detail_area', 'component', 'actual'];
  const rows = [header];

  associates.forEach(a => {
    const items = getKpiItems(a.level, a.detail_area);
    if (!items) return;
    items.forEach(it => {
      if (it._isParentHeader) return; // skip header-only rows
      rows.push([a.employee_id, a.full_name, a.level || '', a.detail_area || '', it.label, '']);
    });
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  // Column widths
  ws['!cols'] = [{ wch: 14 }, { wch: 28 }, { wch: 12 }, { wch: 22 }, { wch: 42 }, { wch: 12 }];
  // Style header row note via a separate sheet
  const info = XLSX.utils.aoa_to_sheet([
    [`Template Actual KPI — ${monthName} ${yearStr}`],
    [`Fill the "actual" column with the actual value. Other columns are reference only, do not change.`],
  ]);
  XLSX.utils.book_append_sheet(wb, info, 'Petunjuk');
  XLSX.utils.book_append_sheet(wb, ws, 'Actual');
  XLSX.writeFile(wb, `template_actual_kpi_${monthName}_${yearStr}.xlsx`);
}

function previewImportActual(input) {
  const file = input.files[0];
  if (!file) return;
  document.getElementById('importActualFileName').textContent = file.name;
  document.getElementById('importActualError').style.display = 'none';

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb     = XLSX.read(e.target.result, { type: 'array' });
      const sheetName = wb.SheetNames.includes('Actual') ? 'Actual' : wb.SheetNames[0];
      const ws     = wb.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' });

      if (!rawRows.length) throw new Error('File kosong atau tidak ada data.');

      // Normalise header names (trim + lowercase)
      const rows = rawRows.map(r => {
        const norm = {};
        Object.keys(r).forEach(k => { norm[k.trim().toLowerCase()] = r[k]; });
        return norm;
      });

      if (!('employee_id' in rows[0]) || !('component' in rows[0]) || !('actual' in rows[0])) {
        throw new Error('Kolom wajib: employee_id, component, actual');
      }

      // Validate and build preview
      const empIds    = new Set(associates.map(a => a.employee_id));
      _importActualData = [];
      const tbody     = document.getElementById('importActualBody');
      tbody.innerHTML = '';

      rows.forEach((r, i) => {
        const empId    = String(r['employee_id']).trim();
        const comp     = String(r['component']).trim();
        const actual   = parseFloat(r['actual']) || 0;
        const valid    = empIds.has(empId) && comp !== '';
        const statusHtml = valid
          ? '<span style="color:#16a34a;"><i class="fa-solid fa-check"></i> OK</span>'
          : `<span style="color:#dc2626;"><i class="fa-solid fa-xmark"></i> ${!empIds.has(empId) ? 'ID tidak ditemukan' : 'Component kosong'}</span>`;

        if (valid) _importActualData.push({ employee_id: empId, component: comp, actual });

        tbody.innerHTML += `<tr>
          <td>${i + 1}</td>
          <td><code style="font-size:12px;">${empId}</code></td>
          <td style="font-size:12px;">${comp}</td>
          <td style="text-align:right;">${actual.toLocaleString('id-ID')}</td>
          <td>${statusHtml}</td>
        </tr>`;
      });

      document.getElementById('importActualCount').textContent =
        `(${_importActualData.length} valid dari ${rows.length} baris)`;
      document.getElementById('importActualPreview').style.display = '';
      document.getElementById('btnConfirmImport').disabled = _importActualData.length === 0;
    } catch(err) {
      document.getElementById('importActualError').textContent = 'Error: ' + err.message;
      document.getElementById('importActualError').style.display = '';
      document.getElementById('importActualPreview').style.display = 'none';
      document.getElementById('btnConfirmImport').disabled = true;
    }
  };
  reader.readAsArrayBuffer(file);
}

async function confirmImportActual() {
  if (!_importActualData.length) return;
  const monthFull = document.getElementById('actualMonth').value;
  if (!monthFull) { showToast('Please select a month first.', 'error'); return; }

  const [yearStr, monthNumStr] = monthFull.split('-');
  const year     = parseInt(yearStr);
  const monthIdx = parseInt(monthNumStr) - 1;
  const monthKey = MONTH_KEYS[monthIdx];

  const btn = document.getElementById('btnConfirmImport');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

  let errors = 0;
  await Promise.all(_importActualData.map(async row => {
    // Fetch existing data for this employee/year/component to preserve other months
    let existing = {};
    try {
      const res  = await fetch(`${ACTUAL_API}?employee_id=${encodeURIComponent(row.employee_id)}&year=${year}`);
      const json = await res.json();
      if (json.success) {
        const found = json.data.find(d => d.component === row.component);
        if (found) existing = found;
      }
    } catch(e) { /* proceed with zeroes */ }

    const payload = { employee_id: row.employee_id, year, component: row.component };
    MONTH_KEYS.forEach(k => { payload[k] = existing[k] ?? 0; });
    payload[monthKey] = row.actual;

    try {
      const res  = await fetch(ACTUAL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
    } catch(e) { errors++; }
  }));

  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-cloud-upload-alt"></i> Save Import';

  if (errors === 0) {
    showToast(`${_importActualData.length} rows imported successfully.`, 'success');
    closeModal('importActualOverlay');
    loadActualSummaryTable();
  } else {
    showToast(`${errors} rows failed to save.`, 'error');
  }
}

