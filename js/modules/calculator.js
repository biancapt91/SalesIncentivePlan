// ===========================
// CALCULATOR
// ===========================
let _abRankState = null; // { empId, allAchData }
let _calcState = null; // { assoc, level, area, budget, kpiItems, dbTargets, monthKey }

function initCalculator() {
  const assocSel = document.getElementById('calc-associate');
  const monthSel = document.getElementById('calc-month');
  if (!assocSel) return;

  // Populate month selector (Jan ? current month)
  if (!monthSel.options.length) {
    for (let i = 0; i <= NOW_MONTH; i++) {
      const opt = document.createElement('option');
      opt.value = MONTH_KEYS[i];
      opt.textContent = MONTH_NAMES[i];
      monthSel.appendChild(opt);
    }
    monthSel.value = NOW_KEY;
  }

  // Populate associate dropdown - filter by viewable IDs
  const viewableIds = getViewableEmployeeIds();
  const curVal = assocSel.value;
  assocSel.innerHTML = '<option value="">-- Select Associate --</option>';
  
  const viewableAssociates = associates.filter(a => viewableIds.includes(a.employee_id));
  const sorted = viewableAssociates.sort((a, b) =>
    (a.full_name || '').localeCompare(b.full_name || '', 'id'));
  
  sorted.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.employee_id;
    // Mark current user with "(You)"
    const label = a.employee_id === currentAssociateId 
      ? `${a.full_name} (You)` 
      : `${a.full_name} (${a.employee_id})`;
    opt.textContent = label;
    assocSel.appendChild(opt);
  });
  
  // Set default value
  if (curVal && viewableIds.includes(curVal)) {
    assocSel.value = curVal;
  } else if (currentRole === 'sales_associate' && currentAssociateId) {
    assocSel.value = currentAssociateId;
  }

  // Avoid double-binding event listeners
  if (assocSel._calcWired) return;
  assocSel._calcWired = true;
  assocSel.addEventListener('change', () => calcLoadData());
  monthSel.addEventListener('change', () => calcLoadData());
}

async function calcLoadData() {
  const assocSel = document.getElementById('calc-associate');
  const monthSel = document.getElementById('calc-month');
  const section  = document.getElementById('calc-kpi-section');
  const result   = document.getElementById('calc-result');
  const pills    = document.getElementById('calc-info-pills');

  const empId    = assocSel.value;
  const monthKey = monthSel.value;

  if (!empId) {
    section.style.display = 'none';
    result.style.display  = 'none';
    pills.style.display   = 'none';
    _calcState = null;
    return;
  }

  const assoc = associates.find(a => a.employee_id === empId);
  if (!assoc) return;

  const area = assoc.detail_area || '';
  pills.style.display = '';

  // Show loading indicator
  section.style.display = '';
  const tableWrap = document.getElementById('calc-table-wrap');
  tableWrap.innerHTML = '<div style="padding:16px;color:#94a3b8;font-size:13px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading targets�</div>';

  // Resolve historical budget and level for the selected month
  const year      = new Date().getFullYear();
  const monthIdx  = MONTH_KEYS.indexOf(monthKey);
  const lastDay   = new Date(year, monthIdx + 1, 0).getDate();
  const monthEnd  = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${lastDay}`;
  let level  = assoc.level;
  let budget = assoc.sip_budget_current || 0;
  let dbTargets = {};

  try {
    const [tRes, hRes] = await Promise.all([
      fetch(`${API.KPI_TARGETS}?employee_id=${encodeURIComponent(empId)}&year=${year}`),
      fetch(`${HIST_API}?employee_id=${encodeURIComponent(empId)}`),
    ]);
    const [tJson, hJson] = await Promise.all([tRes.json(), hRes.json()]);
    if (tJson.success) tJson.data.forEach(r => { dbTargets[r.component] = r; });
    if (hJson.success && hJson.data.length > 0) {
      const histSorted = [...hJson.data].sort((a, b) => a.effective_date.localeCompare(b.effective_date));
      let applicable = null;
      for (const h of histSorted) { if (h.effective_date <= monthEnd) applicable = h; }
      if (applicable) {
        level  = applicable.level  || level;
        budget = applicable.sip_budget ?? budget;
      }
    }
  } catch(e) { /* silently use defaults */ }

  // Update info pills with resolved historical values
  document.getElementById('calc-pill-level').textContent  = level || '�';
  document.getElementById('calc-pill-area').textContent   = area  || '�';
  document.getElementById('calc-pill-budget').textContent = formatRupiah(budget);

  const kpiItems = getKpiItems(level, area);
  if (!kpiItems) { section.style.display = 'none'; return; }

  _calcState = { assoc, level, area, budget, kpiItems, dbTargets, monthKey, plan: assoc.plan };
  calcBuildTable();
  result.style.display = '';
  calcRecalc();
}

function calcBuildTable() {
  if (!_calcState) return;
  const { level, budget, kpiItems, dbTargets, monthKey } = _calcState;
  const tableWrap = document.getElementById('calc-table-wrap');
  const baseKpi   = KPI_TARGETS[level] || [];
  const numStyle  = currentRole === 'sales_associate' ? 'display:none' : '';
  const numTh     = currentRole === 'sales_associate' ? 'style="display:none"' : '';
  const monthName = MONTH_NAMES[MONTH_KEYS.indexOf(monthKey)];
  const year      = new Date().getFullYear();

  let inputIdx = 0;
  let rowNum   = 0;
  const rows = kpiItems.map(it => {
    if (it._isParentHeader) {
      return `<tr class="kpi-parent-header">
        <td colspan="8" style="font-weight:600;padding-left:12px;">${it.label}</td>
      </tr>`;
    }

    const isCW     = it.label === 'Closed Won/Consumption';
    const db       = dbTargets[it.label] || {};
    const dbWeight = (db.weight != null) ? db.weight : it.pct;
    const target   = (db[monthKey] != null) ? db[monthKey] : 0;
    const idx      = inputIdx++;
    rowNum++;

    const col   = getKpiColor(it.label) || {};
    const bg    = col.bg ? `background:${col.bg};border-left:4px solid ${col.border};` : '';
    const label = it._sub ? `<span class="kpi-sub-arrow">?</span> ${it._sub}` : it.label;

    let wfDisp;
    if (isCW) {
      wfDisp = `<span style="color:#7c3aed;font-weight:600;font-size:12px;">15% � SIP Budget</span>`;
    } else if (dbWeight === 0) {
      wfDisp = `<span style="color:var(--text-muted);font-size:12px;">0% (excluded)</span>`;
    } else if (it._sub) {
      const parentPct = baseKpi.find(x => x.label === it._parent)?.pct || 0;
      const subPct    = it._sub === 'Distributor' ? JABODETABEK_DIST_PCT : JABODETABEK_DIR_PCT;
      wfDisp = `<span style="color:var(--text-muted);font-size:12px;">80% � ${parentPct}%�${subPct}%</span>`;
    } else {
      wfDisp = `<span style="color:var(--text-muted);font-size:12px;">80% � ${dbWeight}%</span>`;
    }

    const targetDisp = target > 0
      ? target.toLocaleString('id-ID')
      : `<span style="color:#94a3b8">�</span>`;

    return `<tr style="${bg}">
      <td style="${numStyle}">${rowNum}</td>
      <td>${label}</td>
      <td style="text-align:right;">${targetDisp}</td>
      <td style="text-align:right;"><input type="number" class="calc-inp" data-idx="${idx}" min="0" placeholder="0" /></td>
      <td id="calc-ach-${idx}" style="text-align:center;">�</td>
      <td id="calc-tiered-${idx}" style="text-align:center;">�</td>
      <td style="text-align:center;">${wfDisp}</td>
      <td id="calc-earned-${idx}" style="text-align:right;font-weight:600;"><span style="color:#94a3b8">�</span></td>
    </tr>`;
  }).join('');

  tableWrap.innerHTML = `
    <div style="padding:12px 16px 8px;background:#f8fafc;border-bottom:1px solid var(--border);font-size:13px;color:var(--text-secondary);">
      <strong style="color:var(--text-primary);">${monthName} ${year}</strong>
      &nbsp;�&nbsp; MONTHLY Budget: <strong>${formatRupiah(budget)}</strong>
    </div>
    <div class="table-responsive">
      <table class="data-table">
        <thead>
          <tr>
            <th ${numTh}>#</th>
            <th>KPI COMPONENT</th>
            <th style="text-align:right;">TARGET</th>
            <th style="text-align:right;">ACTUAL <span style="font-weight:400;font-size:11px;color:var(--text-muted);">(input)</span></th>
            <th style="text-align:center;">ACHIEVEMENT %</th>
            <th style="text-align:center;">TIERED SIP</th>
            <th style="text-align:center;">WEIGHT FACTOR</th>
            <th style="text-align:right;">EARNED</th>
          </tr>
        </thead>
        <tbody id="calc-kpi-body">${rows}</tbody>
      </table>
    </div>`;

  document.querySelectorAll('#calc-kpi-body .calc-inp').forEach(inp =>
    inp.addEventListener('input', calcRecalc));
}

function calcRecalc() {
  if (!_calcState) return;
  const { level, budget, kpiItems, dbTargets, monthKey, plan } = _calcState;
  const baseKpi = KPI_TARGETS[level] || [];
  const fmt     = v => formatRupiah(Math.round(v));

  let totalEarned = 0;
  let inputIdx    = 0;

  for (const it of kpiItems) {
    if (it._isParentHeader) continue;

    const idx      = inputIdx++;
    const achEl    = document.getElementById(`calc-ach-${idx}`);
    const tieredEl = document.getElementById(`calc-tiered-${idx}`);
    const earnedEl = document.getElementById(`calc-earned-${idx}`);
    if (!achEl) continue;

    const db       = dbTargets[it.label] || {};
    const dbWeight = (db.weight != null) ? db.weight : it.pct;
    const target   = (db[monthKey] != null) ? db[monthKey] : 0;
    const actualEl = document.querySelector(`#calc-kpi-body .calc-inp[data-idx="${idx}"]`);
    const actual   = parseFloat(actualEl ? actualEl.value : 0) || 0;
    const isCW     = it.label === 'Closed Won/Consumption';

    if (target <= 0) {
      achEl.innerHTML    = '<span style="color:#94a3b8">�</span>';
      tieredEl.innerHTML = '<span style="color:#94a3b8">�</span>';
      earnedEl.innerHTML = '<span style="color:#94a3b8">�</span>';
      continue;
    }

    const achPct = actual / target * 100;
    const pctCls = achPct >= 100 ? 'actual-pct-met' : achPct >= 85 ? 'actual-pct-partial' : 'actual-pct-low';
    achEl.innerHTML = `<span class="${pctCls}">${achPct.toFixed(2)}%</span>`;

    let earned = 0;

    if (isCW) {
      const met = actual >= target;
      tieredEl.innerHTML = target > 0
        ? (met ? '<span class="actual-pct-met">Met ?</span>' : '<span class="actual-pct-low">Not Met</span>')
        : '<span style="color:#94a3b8">�</span>';
      earned = met ? Math.round(budget * SIP_CW_PCT / 100) : 0;
    } else if (dbWeight === 0) {
      tieredEl.innerHTML = '<span style="color:var(--text-muted)">�</span>';
      earnedEl.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">excluded</span>';
      continue;
    } else {
      const rawSIP = tieredSIP(achPct, plan);
      tieredEl.innerHTML = rawSIP > 0
        ? fmt(rawSIP)
        : '<span style="color:#dc2626;font-size:12px;">Below 85%</span>';
      let weightFactor;
      if (it._sub) {
        const parentKpi   = baseKpi.find(x => x.label === it._parent);
        const parentPct   = parentKpi ? parentKpi.pct : 0;
        const subSplitPct = it._sub === 'Distributor' ? JABODETABEK_DIST_PCT : JABODETABEK_DIR_PCT;
        weightFactor = (parentPct / 100) * (subSplitPct / 100);
      } else {
        weightFactor = dbWeight / 100;
      }
      earned = rawSIP * SIP_MONTHLY_SALES_PCT / 100 * weightFactor;
    }

    totalEarned += earned;
    earnedEl.textContent = fmt(earned);
    earnedEl.style.color = earned > 0 ? '' : 'var(--text-muted)';
  }

  const total = Math.round(totalEarned);
  document.getElementById('calc-result-amount').textContent = formatRupiah(total);
  const pct = budget > 0 ? Math.round(total / budget * 100) : 0;
  document.getElementById('calc-result-note').textContent = budget > 0
    ? `${pct}% of monthly SIP budget (${formatRupiah(budget)})`
    : '';
}

