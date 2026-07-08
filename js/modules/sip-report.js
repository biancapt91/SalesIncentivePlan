// ===========================
// SIP REPORT PAGE
// ===========================
const SIP_REPORT_API = API.SIP_REPORT;
const HIST_API_SR    = API.EMPLOYMENT_HISTORY;
const UNLOCK_API     = API.SIP_UNLOCK_REQUEST;
// ACTUAL_API is declared in actual-achievement.js (loaded next) — available at runtime

let _sipReportData   = null;  // last generated report state
let _sipReportRows   = [];    // flat data for Excel export
let _sipReportMonth  = null;
let _sipReportYear   = null;
let _sipReportStatus = null;  // null | 'draft' | 'paid'
let _unlockReqData   = null;  // data for the submit-request modal
let _unlockRevData   = null;  // data for the review modal
let _pendingUnlockRequests = [];

function initSIPReport() {
  // Set default month to current month
  const now = new Date();
  const sipMonthInput = document.getElementById('sipReportMonth');
  if (sipMonthInput && !sipMonthInput.value) {
    sipMonthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  // Reset content
  document.getElementById('sipReportContent').style.display = 'none';
  // Show pending requests button for admin
  const pendingBtnWrap = document.getElementById('sipPendingBtnWrap');
  if (pendingBtnWrap) {
    if (currentRole === 'admin') {
      pendingBtnWrap.style.display = '';
      const pendingDropdown = document.getElementById('sipPendingDropdown');
      if (pendingDropdown) pendingDropdown.style.display = 'none'; // ensure closed
      loadPendingUnlockRequestsBadge();
    } else {
      pendingBtnWrap.style.display = 'none';
    }
  }
}

function togglePendingDropdown() {
  const dd = document.getElementById('sipPendingDropdown');
  if (!dd) return;
  if (dd.style.display !== 'none') {
    dd.style.display = 'none';
  } else {
    dd.style.display = '';
    loadPendingUnlockRequests();
  }
}

async function loadPendingUnlockRequestsBadge() {
  try {
    const res  = await fetch(`${UNLOCK_API}?action=count`);
    const json = await res.json();
    if (json.success) updatePendingBadge(json.count);
  } catch (e) { /* ignore */ }
}

function updatePendingBadge(count) {
  const badge = document.getElementById('sipPendingBadge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent   = count;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

document.getElementById('btnGenerateSIPReport').addEventListener('click', generateSIPReport);
document.getElementById('btnMarkPaid').addEventListener('click', markSIPReportPaid);
document.getElementById('btnUnmarkPaid').addEventListener('click', unmarkSIPReportPaid);

async function generateSIPReport() {
  const monthInput = document.getElementById('sipReportMonth').value;
  if (!monthInput) { showToast('Pilih periode terlebih dahulu.', 'error'); return; }

  const [yearStr, monthStr] = monthInput.split('-');
  const year  = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const monthIdx  = month - 1;  // 0-based
  const monthKey  = MONTH_KEYS[monthIdx];

  _sipReportMonth = month;
  _sipReportYear  = year;

  // Determine which quarter and get quarter month keys
  const quarterMonths = [
    ['jan', 'feb', 'mar'],
    ['apr', 'may', 'jun'],
    ['jul', 'aug', 'sep'],
    ['oct', 'nov', 'dec'],
  ];
  const quarterIdx = Math.floor(monthIdx / 3);
  const quarterMonthKeys = quarterMonths[quarterIdx];

  const btn = document.getElementById('btnGenerateSIPReport');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...';

  try {
    // Fetch all in parallel: actuals for month, quarterly actuals, budgets per month, report status, carry-forwards, adjustments, late entries
    const [resAct, resQuarterActuals, resBudget, resStatus, resCF, resAdj, resLateEntries] = await Promise.all([
      fetch(`${ACTUAL_API}?year=${year}&month_key=${monthKey}`).then(r => r.json()),
      Promise.all(quarterMonthKeys.map(qmk => fetch(`${ACTUAL_API}?year=${year}&month_key=${qmk}`).then(r => r.json()))),
      fetch(`${HIST_API_SR}?year=${year}&per_month=1`).then(r => r.json()),
      fetch(`${SIP_REPORT_API}?action=status&month=${month}&year=${year}`).then(r => r.json()),
      fetch(`${SIP_REPORT_API}?action=carryforward&month=${month}&year=${year}`).then(r => r.json()),
      fetch(`${UNLOCK_API}?action=adjustments&month=${month}&year=${year}`).then(r => r.json()),
      fetch(`${SIP_REPORT_API}?action=late_entries&month=${month}&year=${year}`).then(r => r.json()),
    ]);

    const reportRecord  = resStatus.success ? resStatus.data : null;
    _sipReportStatus    = reportRecord ? reportRecord.status : null;
    const budgetPerMonth   = resBudget.success ? resBudget.data              : {};
    const levelPerMonth    = resBudget.success ? resBudget.levels            : {};
    const planPerMonth     = resBudget.success ? (resBudget.plans      || {}) : {};
    const positionPerMonth = resBudget.success ? (resBudget.positions  || {}) : {};
    const categoryPerMonth = resBudget.success ? (resBudget.categories || {}) : {};
    const salaryPerMonth   = resBudget.success ? (resBudget.salaries   || {}) : {};
    const carryForwards  = resCF.success ? resCF.data : [];
    const adjustments    = resAdj.success ? resAdj.data : [];
    // late_entries returns a full array: [{employee_id, component, actual_val, target_month, target_year, full_name}]
    const lateEntries    = resLateEntries.success ? (resLateEntries.data || []) : [];
    console.log('[SIP Debug] month/year:', month, year, 'monthKey:', monthKey);
    console.log('[SIP Debug] lateEntries:', JSON.parse(JSON.stringify(lateEntries)));
    const lateEntriesSet = {};  // "empId::component" → true (for actMap zeroing)
    for (const le of lateEntries) {
      lateEntriesSet[`${le.employee_id}::${le.component}`] = true;
    }

    // Build actuals map: employee_id → { component → { target_val, actual_val, weight } }
    const actMap = {};
    const hasActualMap = {};   // employee_id → { component → bool (has non-zero actual) }
    if (resAct.success) {
      for (const r of resAct.data) {
        if (!actMap[r.employee_id]) { actMap[r.employee_id] = {}; hasActualMap[r.employee_id] = {}; }
        actMap[r.employee_id][r.component] = { target_val: r.target_val, actual_val: r.actual_val, weight: r.weight };
        hasActualMap[r.employee_id][r.component] = r.actual_val > 0;
      }
    }

    // Build quarterly actuals map: monthIdx → employee_id → component data
    const quarterActMap = {};
    if (resQuarterActuals && Array.isArray(resQuarterActuals)) {
      resQuarterActuals.forEach((res, idx) => {
        const mmap = {};
        if (res.success && Array.isArray(res.data)) {
          for (const r of res.data) {
            if (!mmap[r.employee_id]) mmap[r.employee_id] = {};
            mmap[r.employee_id][r.component] = { target_val: r.target_val, actual_val: r.actual_val, weight: r.weight };
          }
        }
        quarterActMap[idx] = mmap;
      });
    }

    // Compute outgoing carry-forward SIP deltas BEFORE zeroing actMap
    // (late entries submitted after this month was paid — shown on this month's report)
    const outCFList = [];
    for (const le of lateEntries) {
      const empActuals = actMap[le.employee_id] || {};
      if (!empActuals[le.component] || empActuals[le.component].actual_val <= 0) continue;
      const sipBudget = (budgetPerMonth[le.employee_id] ?? {})[monthKey] ?? 0;
      const sipLevel  = (levelPerMonth[le.employee_id]  ?? {})[monthKey] ?? '';
      const sipPlan   = (planPerMonth[le.employee_id]   ?? {})[monthKey] ?? '';
      const emp       = associates.find(a => a.employee_id === le.employee_id);
      let cfSip = 0;
      if (emp && sipBudget > 0) {
        const _plan       = sipPlan || emp.plan;
        const sipWith     = computeSIPEarned(sipBudget, sipLevel || emp.level, emp.detail_area, empActuals, _plan);
        const actsWithout = { ...empActuals, [le.component]: { ...empActuals[le.component], actual_val: 0 } };
        const sipWithout  = computeSIPEarned(sipBudget, sipLevel || emp.level, emp.detail_area, actsWithout, _plan);
        cfSip = Math.max(0, sipWith - sipWithout);
      }
      outCFList.push({
        empId: le.employee_id, empName: le.full_name || le.employee_id,
        component: le.component, actual_val: le.actual_val,
        cfSip, tgtMonth: le.target_month, tgtYear: le.target_year,
      });
    }

    // Zero out late-entry components from actMap so they don't inflate this month's SIP Earned.
    // Late entries are actuals submitted after the month was paid — they have a carry-forward
    // record targeting next month, returned by action=late_entries.
    // Also zero from quarterActMap so sipQuarter for the paid month doesn't include backdate values.
    const qmIdxCurrent = quarterMonthKeys.indexOf(monthKey); // position of current month in its quarter
    for (const key of Object.keys(lateEntriesSet)) {
      const sep   = key.indexOf('::');
      const empId = key.substring(0, sep);
      const comp  = key.substring(sep + 2);
      if (actMap[empId]?.[comp]) {
        actMap[empId][comp] = { ...actMap[empId][comp], actual_val: 0 };
        if (hasActualMap[empId]) hasActualMap[empId][comp] = false;
      }
      // Also zero from quarterActMap (prevents backdate value from inflating sipQuarter in paid month)
      if (qmIdxCurrent >= 0 && quarterActMap[qmIdxCurrent]?.[empId]?.[comp]) {
        quarterActMap[qmIdxCurrent][empId][comp] = { ...quarterActMap[qmIdxCurrent][empId][comp], actual_val: 0 };
      }
    }

    // Fetch source-month actuals for carry-forwards with sip_amount = 0
    // so we can compute the marginal SIP delta dynamically instead of showing Rp 0.
    // For quarter-end source months, also fetch the other 2 quarter months for quarterly SIP delta.
    const srcMonthKeys = new Set();
    console.log('[SIP Debug] carryForwards:', JSON.parse(JSON.stringify(carryForwards)));
    for (const cf of carryForwards) {
      if (!cf.sip_amount) {
        srcMonthKeys.add(`${cf.source_year}|${cf.source_month}`);
        const srcMIdx0 = cf.source_month - 1; // 0-based
        if (srcMIdx0 % 3 === 2) { // quarter-end month (Mar=2, Jun=5, Sep=8, Dec=11)
          const qStart = srcMIdx0 - 2;
          for (let qi = qStart; qi < srcMIdx0; qi++) srcMonthKeys.add(`${cf.source_year}|${qi + 1}`);
        }
      }
    }
    const srcActMap = {};
    if (srcMonthKeys.size > 0) {
      await Promise.all([...srcMonthKeys].map(async ym => {
        const [yr, mo] = ym.split('|').map(Number);
        const mk = MONTH_KEYS[mo - 1];
        try {
          const res = await fetch(`${ACTUAL_API}?year=${yr}&month_key=${mk}`).then(r => r.json());
          if (res.success) {
            const mmap = {};
            for (const r of res.data) {
              if (!mmap[r.employee_id]) mmap[r.employee_id] = {};
              mmap[r.employee_id][r.component] = { target_val: r.target_val, actual_val: r.actual_val, weight: r.weight };
            }
            srcActMap[ym] = mmap;
          }
        } catch(e) { /* ignore, cfSip stays 0 */ }
      }));
    }

    // Carry-forward total per employee (late entries + approved adjustments)
    const cfByEmp     = {};
    const cfSipMap    = {};  // "empId::comp::srcYear::srcMonth" → combined SIP (monthly + quarterly)
    const cfQtrSipMap = {};  // "empId::comp::srcYear::srcMonth" → quarterly SIP delta only
    console.log('[SIP Debug] srcActMap keys:', Object.keys(srcActMap));
    for (const cf of carryForwards) {
      let cfSip    = cf.sip_amount;
      let cfQtrSip = 0;  // quarterly portion, tracked separately for display
      if (!cfSip) {
        // Compute marginal SIP contribution of the late entry from source-month actuals
        const ym         = `${cf.source_year}|${cf.source_month}`;
        const srcEmpActs = (srcActMap[ym] || {})[cf.employee_id] || {};
        const emp        = associates.find(a => a.employee_id === cf.employee_id);
        const srcBudget  = (budgetPerMonth[cf.employee_id] ?? {})[MONTH_KEYS[cf.source_month - 1]] ?? (emp?.sip_budget_current || 0);
        const srcLevel   = (levelPerMonth[cf.employee_id]  ?? {})[MONTH_KEYS[cf.source_month - 1]] ?? (emp?.level || '');
        const srcPlan    = (planPerMonth[cf.employee_id]   ?? {})[MONTH_KEYS[cf.source_month - 1]] ?? (emp?.plan || '');
        console.log(`[SIP Debug] CF emp=${cf.employee_id} comp=${cf.component} ym=${ym} srcBudget=${srcBudget} srcLevel=${srcLevel} srcEmpActsLen=${Object.keys(srcEmpActs).length} empFound=${!!emp}`);
        if (emp && srcBudget > 0 && Object.keys(srcEmpActs).length > 0) {
          const _plan       = srcPlan || emp.plan;
          const sipWith     = computeSIPEarned(srcBudget, srcLevel, emp.detail_area, srcEmpActs, _plan);
          const actsWithout = { ...srcEmpActs };
          if (actsWithout[cf.component]) {
            actsWithout[cf.component] = { ...actsWithout[cf.component], actual_val: 0 };
          }
          const sipWithout = computeSIPEarned(srcBudget, srcLevel, emp.detail_area, actsWithout, _plan);
          cfSip = Math.max(0, sipWith - sipWithout);
          console.log(`[SIP Debug] CF emp=${cf.employee_id} sipWith=${sipWith} sipWithout=${sipWithout} cfSip=${cfSip}`);

          // For quarter-end source months: also compute quarterly SIP delta
          const srcMIdx0 = cf.source_month - 1; // 0-based
          if (srcMIdx0 % 3 === 2) {
            const qStart   = srcMIdx0 - 2;
            const qMos     = [qStart, qStart + 1, srcMIdx0]; // 0-based month indices
            const qActsArr = qMos.map(qi => (srcActMap[`${cf.source_year}|${qi + 1}`] || {})[cf.employee_id] || {});
            const qActsArrWithout = qActsArr.map((qActs, idx) => {
              if (qMos[idx] !== srcMIdx0) return qActs; // only modify source month
              const b = qActs[cf.component] || { target_val: 0, weight: 0 };
              return { ...qActs, [cf.component]: { ...b, actual_val: 0 } };
            });
            const kpiItemsQ = getKpiItems(srcLevel || emp.level, emp.detail_area || '') || [];
            const baseKpiQ  = KPI_TARGETS[srcLevel || emp.level] || [];
            const computeQSIP = (qArr) => {
              let total = 0;
              for (const it of kpiItemsQ.filter(it2 => !it2._isParentHeader && it2.label !== 'Closed Won/Consumption')) {
                let target = 0, actual = 0, weight = it.pct;
                qArr.forEach(qActs => {
                  const comp = qActs[it.label];
                  if (comp) { target += comp.target_val ?? 0; actual += comp.actual_val ?? 0; if (comp.weight != null) weight = comp.weight; }
                });
                if (target > 0 && (actual / target) * 100 >= 100) {
                  const achPct_ = (actual / target) * 100;
                  // Sum tiered SIP per quarter month using each month's own plan
                  const tieredVal = qMos.reduce((sum, qi) => {
                    const qPlan = (planPerMonth[cf.employee_id] ?? {})[MONTH_KEYS[qi]] || _plan;
                    return sum + tieredSIP(achPct_, qPlan);
                  }, 0);
                  let wf = 0;
                  if (it._sub) { const pk = baseKpiQ.find(x => x.label === it._parent); wf = ((pk?.pct||0)/100) * ((it._sub==='Distributor'?JABODETABEK_DIST_PCT:JABODETABEK_DIR_PCT)/100); }
                  else { wf = weight / 100; }
                  total += Math.round(tieredVal * SIP_QUARTER_PCT / 100 * wf);
                }
              }
              return total;
            };
            const qDelta = Math.max(0, computeQSIP(qActsArr) - computeQSIP(qActsArrWithout));
            if (qDelta > 0) {
              console.log(`[SIP Debug] CF quarterly delta emp=${cf.employee_id} qDelta=${qDelta}`);
              cfQtrSip = qDelta;  // store quarterly part separately
              cfSip    += qDelta; // still add to combined total for cfByEmp
            }
          }
        }
      }
      cfByEmp[cf.employee_id] = (cfByEmp[cf.employee_id] || 0) + cfSip;
      const _cfKey = `${cf.employee_id}::${cf.component}::${cf.source_year}::${cf.source_month}`;
      cfSipMap[_cfKey]    = cfSip;
      cfQtrSipMap[_cfKey] = cfQtrSip;
    }
    console.log('[SIP Debug] cfByEmp:', JSON.parse(JSON.stringify(cfByEmp)));
    for (const adj of adjustments) {
      cfByEmp[adj.employee_id] = (cfByEmp[adj.employee_id] || 0) + adj.sip_delta;
    }

    // Compute KPI completeness per employee
    function kpiStatus(empId) {
      const rows = actMap[empId] || {};
      const allKpis = Object.keys(rows);
      if (!allKpis.length) return { label: 'No Data', cls: 'badge-gray' };
      const complete = allKpis.filter(k => rows[k].actual_val > 0 || rows[k].target_val === 0).length;
      if (complete === allKpis.length) return { label: 'Complete', cls: 'badge-green' };
      if (complete === 0) return { label: 'Empty', cls: 'badge-red' };
      return { label: `${complete}/${allKpis.length} KPI`, cls: 'badge-yellow' };
    }

    // SIP Quarter is only applicable at the end of each quarter (Mar, Jun, Sep, Dec)
    const isEndOfQuarter = monthIdx % 3 === 2;

    let grandTotal    = 0;
    let cfGrandTotal  = 0;
    let budgetTotal   = 0;
    let quarterGrandTotal = 0;
    _sipReportRows = [];   // reset
    const tbody = document.getElementById('sipReportBody');

    const rows = associates.map((a, i) => {
      const sipBudget     = (budgetPerMonth[a.employee_id]    ?? {})[monthKey] ?? (a.sip_budget_current || 0);
      const sipLevel      = (levelPerMonth[a.employee_id]    ?? {})[monthKey] ?? a.level;
      const histPlan      = (planPerMonth[a.employee_id]     ?? {})[monthKey] || a.plan;
      const histPosition  = (positionPerMonth[a.employee_id] ?? {})[monthKey] || a.position;
      const sipEarned     = computeSIPEarned(sipBudget, sipLevel, a.detail_area, actMap[a.employee_id] || {}, histPlan);

      // Calculate quarterly SIP using the same logic as Summary Q-mode:
      // Sum target+actual across all 3 quarter months per KPI, apply tiered formula only if >=100%
      let sipQuarter = 0;
      if (isEndOfQuarter) {
        const qKpiItems = getKpiItems(sipLevel, a.detail_area) || [];
        const baseKpi   = KPI_TARGETS[sipLevel] || [];
        for (const it of qKpiItems.filter(it2 => !it2._isParentHeader && it2.label !== 'Closed Won/Consumption')) {
          let target = 0, actual = 0, weight = it.pct;
          quarterMonthKeys.forEach((qmk, qmIdx) => {
            const comp = quarterActMap[qmIdx]?.[a.employee_id]?.[it.label];
            if (comp) {
              target += comp.target_val ?? 0;
              actual += comp.actual_val ?? 0;
              if (comp.weight != null) weight = comp.weight;
            }
          });
          if (target > 0) {
            const quarterAchPct = (actual / target) * 100;
            if (quarterAchPct >= 100) {
              // Sum tiered SIP per quarter month using each month's own plan
              const tieredVal = quarterMonthKeys.reduce((sum, qmk) => {
                const qPlan = (planPerMonth[a.employee_id] ?? {})[qmk] || histPlan;
                return sum + tieredSIP(quarterAchPct, qPlan);
              }, 0);
              let weightFactor = 0;
              if (it._sub) {
                const parentKpi   = baseKpi.find(x => x.label === it._parent);
                const parentPct   = parentKpi ? parentKpi.pct : 0;
                const subSplitPct = it._sub === 'Distributor' ? JABODETABEK_DIST_PCT : JABODETABEK_DIR_PCT;
                weightFactor = (parentPct / 100) * (subSplitPct / 100);
              } else {
                weightFactor = weight / 100;
              }
              sipQuarter += Math.round(tieredVal * SIP_QUARTER_PCT / 100 * weightFactor);
            }
          }
        }
      }
      
      const cfAmount      = cfByEmp[a.employee_id] || 0;
      const totalPayable  = sipEarned + sipQuarter + cfAmount;
      grandTotal   += sipEarned;
      quarterGrandTotal += sipQuarter;
      cfGrandTotal += cfAmount;
      budgetTotal  += sipBudget;

      _sipReportRows.push({
        no: i + 1, employee_id: a.employee_id, full_name: a.full_name,
        position: histPosition || '', plan: histPlan || '',
        sip_budget: sipBudget, sip_earned: sipEarned, sip_quarter: sipQuarter,
        carry_forward: cfAmount, total_payable: totalPayable,
        kpi_status: kpiStatus(a.employee_id).label,
      });

      const ks = kpiStatus(a.employee_id);
      const cfCell = cfAmount > 0
        ? `<span style="color:#d97706;font-weight:600;">+${formatRupiah(cfAmount)}</span>`
        : cfAmount < 0
          ? `<span style="color:#dc2626;font-weight:600;">${formatRupiah(cfAmount)}</span>`
          : '<span style="color:#94a3b8;">—</span>';

      return `<tr>
        <td>${i + 1}</td>
        <td><code style="background:#f1f5f9;padding:2px 7px;border-radius:4px;font-size:12px;">${a.employee_id}</code></td>
        <td><strong>${a.full_name}</strong></td>
        <td>${histPosition || '—'}</td>
        <td>${histPlan ? `<span class="badge ${getPlanBadge(histPlan)}">${histPlan}</span>` : '—'}</td>
        <td>${sipBudget > 0 ? formatRupiah(sipBudget) : '<span style="color:#94a3b8">—</span>'}</td>
        <td><strong>${sipEarned > 0 ? formatRupiah(sipEarned) : '<span style="color:#dc2626">Rp 0</span>'}</strong></td>
        <td>${!isEndOfQuarter ? '<span style="color:#94a3b8;">—</span>' : sipQuarter > 0 ? `<strong style="color:#1e6ba8;">${formatRupiah(sipQuarter)}</strong>` : '<span style="color:#dc2626">Rp 0</span>'}</td>
        <td>${cfCell}</td>
        <td><strong style="color:#1e6ba8;">${formatRupiah(totalPayable)}</strong></td>
        <td><span class="badge ${ks.cls}">${ks.label}</span></td>
      </tr>`;
    });

    tbody.innerHTML = rows.join('') || `<tr><td colspan="11" class="no-data">Tidak ada data.</td></tr>`;

    if (associates.length > 0) {
      const totalPayableAll = grandTotal + quarterGrandTotal + cfGrandTotal;
      const cfTotalCell = cfGrandTotal > 0
        ? `<span style="color:#d97706;font-weight:700;">+${formatRupiah(cfGrandTotal)}</span>`
        : cfGrandTotal < 0
          ? `<span style="color:#dc2626;font-weight:700;">${formatRupiah(cfGrandTotal)}</span>`
          : '<span style="color:#94a3b8;">—</span>';
      tbody.innerHTML += `<tr style="background:#f1f5f9;border-top:2px solid #cbd5e1;">
        <td colspan="5" style="text-align:right;font-weight:700;font-size:13px;color:#374151;padding:10px 12px;">
          <i class="fa-solid fa-sigma" style="color:#1e6ba8;margin-right:6px;"></i>TOTAL &mdash; ${associates.length} Associate${associates.length !== 1 ? 's' : ''}
        </td>
        <td style="font-weight:700;">${budgetTotal > 0 ? formatRupiah(budgetTotal) : '<span style="color:#94a3b8">—</span>'}</td>
        <td style="font-weight:700;color:#1e6ba8;">${formatRupiah(grandTotal)}</td>
        <td style="font-weight:700;color:#1e6ba8;">${quarterGrandTotal > 0 ? formatRupiah(quarterGrandTotal) : '<span style="color:#94a3b8">—</span>'}</td>
        <td>${cfTotalCell}</td>
        <td style="font-weight:800;font-size:14px;color:#1e6ba8;">${formatRupiah(totalPayableAll)}</td>
        <td></td>
      </tr>`;
    }

    const total = grandTotal + quarterGrandTotal + cfGrandTotal;
    document.getElementById('sipReportGrandTotal').textContent = formatRupiah(total);
    document.getElementById('sipReportPeriodLabel').textContent = `${MONTH_NAMES[monthIdx]} ${year}`;

    // ── Carry-Forward modal content ─────────────────────────────────────────
    const cfBtnWrap   = document.getElementById('sipCFBtnWrap');
    const cfBadge     = document.getElementById('sipCFBadge');
    const cfBody      = document.getElementById('sipReportCFBody');
    const adjBody     = document.getElementById('sipReportAdjBody');
    const cfModalBack = document.getElementById('cfModalBackdateSection');
    const cfModalAdj  = document.getElementById('cfModalAdjSection');
    const totalCFItems = carryForwards.length + adjustments.length;

    // Populate Backdate Entry table
    if (cfBody && cfModalBack) {
      if (carryForwards.length > 0) {
        cfModalBack.style.display = '';
        cfBody.innerHTML = carryForwards.map(cf => {
          const _key      = `${cf.employee_id}::${cf.component}::${cf.source_year}::${cf.source_month}`;
          const cfSipTotal = cfSipMap[_key] ?? cf.sip_amount;
          const cfQtrPart  = cfQtrSipMap[_key] ?? 0;
          const cfMthPart  = Math.max(0, cfSipTotal - cfQtrPart);
          const qNum       = Math.ceil(cf.source_month / 3); // 1-4
          return `<tr>
            <td><strong>${cf.full_name || cf.employee_id}</strong></td>
            <td>${cf.component}</td>
            <td>${MONTH_NAMES[cf.source_month - 1]} ${cf.source_year}</td>
            <td style="text-align:right;">${formatActual(cf.actual_val)}</td>
            <td style="text-align:right;">${cfMthPart > 0 ? formatRupiah(cfMthPart) : '<span style="color:#94a3b8">—</span>'}</td>
            <td style="text-align:right;">${cfQtrPart > 0 ? `<strong style="color:#1e6ba8;">${formatRupiah(cfQtrPart)}</strong>` : '<span style="color:#94a3b8">—</span>'}</td>
          </tr>`;
        }).join('');
      } else {
        cfModalBack.style.display = 'none';
        cfBody.innerHTML = '';
      }
    }

    // Populate Actual Value Adjustment table
    if (adjBody && cfModalAdj) {
      if (adjustments.length > 0) {
        cfModalAdj.style.display = '';
        adjBody.innerHTML = adjustments.map(adj => {
          const srcName = adj.source_month >= 1 && adj.source_month <= 12
            ? `${MONTH_NAMES[adj.source_month - 1]} ${adj.source_year}` : adj.source_month;
          const sign = adj.sip_delta >= 0 ? '+' : '';
          const clr  = adj.sip_delta >= 0 ? '#16a34a' : '#dc2626';
          return `<tr>
            <td><strong>${adj.employee_name || adj.employee_id}</strong></td>
            <td style="font-size:12px;">${adj.component}</td>
            <td>${srcName}</td>
            <td>${formatActual(adj.old_value)} &rarr; <strong>${formatActual(adj.new_value)}</strong></td>
            <td style="text-align:right;font-weight:700;color:${clr};">${sign}${formatRupiah(adj.sip_delta)}</td>
          </tr>`;
        }).join('');
      } else {
        cfModalAdj.style.display = 'none';
        adjBody.innerHTML = '';
      }
    }

    // Show/hide Carry-Forward button + update badge
    if (cfBtnWrap) {
      if (totalCFItems > 0) {
        cfBtnWrap.style.display = '';
        if (cfBadge) { cfBadge.textContent = totalCFItems; cfBadge.style.display = ''; }
      } else {
        cfBtnWrap.style.display = 'none';
        if (cfBadge) cfBadge.style.display = 'none';
      }
    }

    // Status badge & buttons
    const badge    = document.getElementById('sipReportStatusBadge');
    const paidInfo = document.getElementById('sipReportPaidInfo');
    const btnPay   = document.getElementById('btnMarkPaid');
    const btnUnpay = document.getElementById('btnUnmarkPaid');

    badge.style.display = '';
    // Always reset button states when rendering
    btnPay.disabled  = false;
    btnPay.innerHTML = '<i class="fa-solid fa-circle-check"></i> Mark as Paid';
    btnUnpay.disabled  = false;
    btnUnpay.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Revert to Draft';

    if (_sipReportStatus === 'paid') {
      badge.innerHTML = '<span class="badge badge-green" style="font-size:13px;padding:5px 14px;"><i class="fa-solid fa-circle-check" style="margin-right:5px;"></i>PAID</span>';
      paidInfo.textContent = reportRecord.paid_at
        ? `Paid on ${new Date(reportRecord.paid_at).toLocaleDateString('id-ID')} by ${reportRecord.paid_by}`
        : '';
      btnPay.style.display   = 'none';
      btnUnpay.style.display = '';
    } else {
      badge.innerHTML = '<span class="badge badge-yellow" style="font-size:13px;padding:5px 14px;">Draft</span>';
      paidInfo.textContent = '';
      btnPay.style.display   = '';
      btnUnpay.style.display = 'none';
    }

    // Store for pay action
    _sipReportData = { grandTotal: total, month, year };

    document.getElementById('sipReportContent').style.display = '';

  } catch (e) {
    showToast('Gagal generate report: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-file-chart-column"></i> Generate Report';
  }
}

async function markSIPReportPaid() {
  if (!_sipReportData) return;
  const { grandTotal, month, year } = _sipReportData;
  const monthName = MONTH_NAMES[month - 1];

  if (!confirm(`Mark laporan ${monthName} ${year} sebagai PAID?\n\nSemua KPI yang sudah memiliki nilai actual akan dikunci dan tidak dapat diubah.\nKPI yang masih kosong tetap bisa diinput dan akan masuk ke tagihan bulan berikutnya.`)) return;

  const btn = document.getElementById('btnMarkPaid');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';

  try {
    const res  = await fetch(SIP_REPORT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pay', month, year, total_sip: grandTotal, paid_by: document.getElementById('topbarUsername').textContent }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    showToast(`Laporan ${monthName} ${year} berhasil di-PAID. ${json.locked_count} sel dikunci.`, 'success');
    // Re-generate to refresh state
    await generateSIPReport();
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Mark as Paid';
  }
}

async function unmarkSIPReportPaid() {
  if (!_sipReportData) return;
  const { month, year } = _sipReportData;
  const monthName = MONTH_NAMES[month - 1];

  if (!confirm(`Revert laporan ${monthName} ${year} ke status Draft?\n\nSemua kunci aktual akan dibuka kembali.`)) return;

  try {
    const res  = await fetch(SIP_REPORT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unpay', month, year }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    showToast(`Laporan ${monthName} ${year} dikembalikan ke Draft.`, 'success');
    await generateSIPReport();
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

function exportSIPReportExcel() {
  if (!_sipReportRows.length || !_sipReportData) {
    showToast('Generate report terlebih dahulu.', 'error');
    return;
  }
  const { month, year } = _sipReportData;
  const monthName = MONTH_NAMES[month - 1];

  const header = ['#', 'Employee ID', 'Full Name', 'Position', 'Plan',
                  'SIP Budget (Rp)', 'SIP Earned (Rp)', 'SIP Quarter (Rp)', 'Carry-forward (Rp)',
                  'Total Payable (Rp)', 'KPI Status'];

  const dataRows = _sipReportRows.map(r => [
    r.no, r.employee_id, r.full_name, r.position, r.plan,
    r.sip_budget, r.sip_earned, r.sip_quarter, r.carry_forward, r.total_payable, r.kpi_status,
  ]);

  const totalRow = [
    'TOTAL', '', '', '', '',
    _sipReportRows.reduce((s, r) => s + r.sip_budget,    0),
    _sipReportRows.reduce((s, r) => s + r.sip_earned,    0),
    _sipReportRows.reduce((s, r) => s + r.sip_quarter,   0),
    _sipReportRows.reduce((s, r) => s + r.carry_forward, 0),
    _sipReportRows.reduce((s, r) => s + r.total_payable, 0),
    '',
  ];

  const aoa = [header, ...dataRows, totalRow];
  const ws  = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths
  ws['!cols'] = [
    { wch: 4 }, { wch: 14 }, { wch: 28 }, { wch: 22 }, { wch: 10 },
    { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 14 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SIP Report');
  XLSX.writeFile(wb, `SIP_Report_${monthName}_${year}.xlsx`);
}

// ===========================
// KPI UNLOCK REQUEST WORKFLOW
// ===========================

/** Open the "Request Change" modal for a locked KPI cell. */
function openUnlockRequestModal(empId, component, monthKey, year, oldValue) {
  const emp      = associates.find(a => a.employee_id === empId);
  const empName  = emp ? emp.full_name : empId;
  const monthIdx = MONTH_KEYS.indexOf(monthKey);
  const monthLbl = monthIdx >= 0 ? `${MONTH_NAMES[monthIdx]} ${year}` : `${monthKey} ${year}`;

  _unlockReqData = { empId, empName, component, monthKey, year: parseInt(year, 10), oldValue: parseFloat(oldValue) };

  document.getElementById('unlockReqEmployee').value  = empName;
  document.getElementById('unlockReqComponent').value = component;
  document.getElementById('unlockReqMonth').value     = monthLbl;
  document.getElementById('unlockReqOldValue').value  = parseFloat(oldValue) > 0
    ? parseFloat(oldValue).toLocaleString('id-ID') : '0';
  document.getElementById('unlockReqNewValue').value  = '';
  document.getElementById('unlockReqReason').value    = '';

  // Populate carry-forward month selector (next 12 months from source month)
  const cfSel = document.getElementById('unlockReqCFMonth');
  cfSel.innerHTML = '';
  const srcIdx = MONTH_KEYS.indexOf(monthKey);
  const srcYr  = parseInt(year, 10);
  for (let offset = 1; offset <= 12; offset++) {
    const absIdx = srcIdx + offset;
    const mIdx   = absIdx % 12;
    const yr     = srcYr + Math.floor(absIdx / 12);
    const opt    = document.createElement('option');
    opt.value       = `${yr}-${String(mIdx + 1).padStart(2, '0')}`;
    opt.textContent = `${MONTH_NAMES[mIdx]} ${yr}`;
    if (offset === 1) opt.selected = true;
    cfSel.appendChild(opt);
  }

  openModal('unlockRequestOverlay');
}

/** Submit the unlock request to the API. */
async function submitUnlockRequest() {
  if (!_unlockReqData) return;
  const { empId, component, monthKey, year, oldValue } = _unlockReqData;
  const newValue  = parseFloat(document.getElementById('unlockReqNewValue').value);
  const reason    = document.getElementById('unlockReqReason').value.trim();
  const cfMonthVal = document.getElementById('unlockReqCFMonth').value;

  if (isNaN(newValue) || newValue < 0) {
    showToast('Masukkan nilai baru yang valid (≥ 0).', 'error'); return;
  }
  if (!reason) {
    showToast('Alasan perubahan wajib diisi.', 'error'); return;
  }
  if (!cfMonthVal) {
    showToast('Pilih bulan carry-forward.', 'error'); return;
  }
  const [cfYear, cfMonthNum] = cfMonthVal.split('-').map(Number);

  const btn = document.getElementById('btnSubmitUnlockRequest');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';

  try {
    const res  = await fetch(UNLOCK_API, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ action: 'request', employee_id: empId, year, component,
                                 month_key: monthKey, old_value: oldValue, new_value: newValue,
                                 reason, cf_target_month: cfMonthNum, cf_target_year: cfYear }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    showToast(json.message, 'success');
    closeModal('unlockRequestOverlay');
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kirim Permintaan';
  }
}

/** Fetch and render the list of pending unlock requests (admin panel). */
async function loadPendingUnlockRequests() {
  const body = document.getElementById('sipPendingRequestsBody');
  if (!body) return;
  body.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:12px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>';
  try {
    const res  = await fetch(`${UNLOCK_API}?action=list&status=pending`);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    _pendingUnlockRequests = json.data || [];
    renderUnlockRequests(_pendingUnlockRequests, body);
    updatePendingBadge(_pendingUnlockRequests.length);
  } catch (e) {
    body.innerHTML = `<div style="text-align:center;color:var(--red);padding:12px;">${e.message}</div>`;
  }
}

/** Render the pending requests table inside `container`. */
function renderUnlockRequests(requests, container) {
  if (!requests.length) {
    container.innerHTML = `<div style="text-align:center;color:#94a3b8;font-size:13px;padding:16px 0;">
      <i class="fa-solid fa-circle-check" style="color:#10b981;"></i> No pending requests.
    </div>`;
    return;
  }
  const rows = requests.map(r => {
    const midx    = MONTH_KEYS.indexOf(r.month_key);
    const mLabel  = midx >= 0 ? `${MONTH_NAMES[midx]} ${r.year}` : r.month_key;
    const reqAt   = new Date(r.requested_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
    return `<tr>
      <td><strong>${r.employee_name || r.employee_id}</strong><br>
          <code style="font-size:11px;color:#64748b;">${r.employee_id}</code></td>
      <td style="font-size:12px;">${r.component}</td>
      <td>${mLabel}</td>
      <td style="text-align:right;">${r.old_value > 0 ? r.old_value.toLocaleString('id-ID') : '—'}</td>
      <td style="text-align:right;"><strong>${r.new_value.toLocaleString('id-ID')}</strong></td>
      <td style="max-width:180px;font-size:12px;color:#374151;">${r.reason}</td>
      <td style="font-size:11px;color:#6b7280;">${r.requested_by}<br>${reqAt}</td>
      <td><button class="btn btn-sm btn-primary" onclick="openUnlockReviewModal(${r.id})">
        <i class="fa-solid fa-magnifying-glass"></i> Review
      </button></td>
    </tr>`;
  }).join('');
  container.innerHTML = `
    <div class="table-responsive">
      <table class="data-table" style="font-size:12px;">
        <thead><tr>
          <th>Karyawan</th><th>KPI Component</th><th>Bulan</th>
          <th style="text-align:right;">Nilai Lama</th><th style="text-align:right;">Nilai Baru</th>
          <th>Alasan</th><th>Diajukan Oleh</th><th>Aksi</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/** Open the admin review modal for a specific request. Computes SIP delta async. */
async function openUnlockReviewModal(reqId) {
  const req = _pendingUnlockRequests.find(r => r.id === reqId);
  if (!req) { showToast('Data permintaan tidak ditemukan.', 'error'); return; }

  _unlockRevData = { ...req, sipDelta: 0 };
  const midx   = MONTH_KEYS.indexOf(req.month_key);
  const mLabel = midx >= 0 ? `${MONTH_NAMES[midx]} ${req.year}` : req.month_key;
  const reqAt  = new Date(req.requested_at).toLocaleDateString('id-ID');

  // Build carry-forward target label
  const cfMIdx   = req.cf_target_month ? req.cf_target_month - 1 : -1;
  const cfLabel  = cfMIdx >= 0 ? `${MONTH_NAMES[cfMIdx]} ${req.cf_target_year}` : '(tidak ditentukan — bulan berikutnya)';

  // Show modal with loading state while we compute the delta
  const reviewBody = document.getElementById('unlockReviewBody');
  reviewBody.innerHTML = `
    <table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:14px;">
      <tr><td style="padding:4px 0;color:#6b7280;width:42%;">Karyawan</td>
          <td style="padding:4px 0;font-weight:600;">${req.employee_name || req.employee_id}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;">KPI Component</td>
          <td style="padding:4px 0;">${req.component}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;">Bulan</td>
          <td style="padding:4px 0;">${mLabel}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;">Nilai Lama</td>
          <td style="padding:4px 0;">${req.old_value > 0 ? req.old_value.toLocaleString('id-ID') : '0'}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;">Nilai Baru</td>
          <td style="padding:4px 0;font-weight:600;color:#16a34a;">${req.new_value.toLocaleString('id-ID')}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;">CF Dibayarkan di Bulan</td>
          <td style="padding:4px 0;font-weight:600;color:#1e6ba8;">${cfLabel}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;">Alasan</td>
          <td style="padding:4px 0;font-style:italic;">${req.reason}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;">Diajukan Oleh</td>
          <td style="padding:4px 0;">${req.requested_by} — ${reqAt}</td></tr>
    </table>
    <div id="unlockReviewDeltaSection"
         style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;font-size:13px;">
      <i class="fa-solid fa-spinner fa-spin"></i> Menghitung estimasi selisih SIP…
    </div>
    <div id="unlockReviewNotesSection" style="display:none;margin-top:12px;">
      <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px;">
        Catatan Penolakan <span style="font-weight:400;color:#6b7280;">(opsional)</span>
      </label>
      <textarea id="unlockReviewNotes" class="form-input" rows="2"
                placeholder="Alasan penolakan..."></textarea>
    </div>`;

  // Wire buttons
  const btnApprove = document.getElementById('btnApproveUnlock');
  const btnReject  = document.getElementById('btnRejectUnlock');
  btnApprove.disabled = true;
  btnApprove.innerHTML = '<i class="fa-solid fa-check"></i> Setujui';
  btnReject.innerHTML  = '<i class="fa-solid fa-xmark"></i> Tolak';
  btnApprove.onclick   = confirmApproveUnlock;
  btnReject.onclick    = confirmRejectUnlock;

  openModal('unlockReviewOverlay');

  // ── Compute SIP delta asynchronously ─────────────────────────────────────
  try {
    await loadAssociates();
    const emp = associates.find(a => a.employee_id === req.employee_id);
    if (!emp) throw new Error('Data karyawan tidak ditemukan');

    // Determine quarter months for the source month
    const _srcMIdx   = MONTH_KEYS.indexOf(req.month_key);
    const _qIdx      = Math.floor(_srcMIdx / 3);
    const _qMKeys    = [['jan','feb','mar'],['apr','may','jun'],['jul','aug','sep'],['oct','nov','dec']][_qIdx];
    const _otherQMKeys = _qMKeys.filter(qmk => qmk !== req.month_key);

    const [resBudget, resActuals, ...resOtherQActuals] = await Promise.all([
      fetch(`${HIST_API_SR}?year=${req.year}&per_month=1`).then(r => r.json()),
      fetch(`${ACTUAL_API}?year=${req.year}&month_key=${req.month_key}`).then(r => r.json()),
      ..._otherQMKeys.map(qmk => fetch(`${ACTUAL_API}?year=${req.year}&month_key=${qmk}`).then(r => r.json())),
    ]);

    const budget = ((resBudget.success ? resBudget.data : {})[req.employee_id] ?? {})[req.month_key] ?? 0;
    const levels = (resBudget.success && resBudget.levels) ? resBudget.levels : {};
    const level  = (levels[req.employee_id] ?? {})[req.month_key] || emp.level || '';
    const plans  = (resBudget.success && resBudget.plans)  ? resBudget.plans  : {};
    const plan   = (plans[req.employee_id]  ?? {})[req.month_key] || emp.plan  || '';

    const actuals = {};
    if (resActuals.success) {
      resActuals.data
        .filter(r => r.employee_id === req.employee_id)
        .forEach(r => { actuals[r.component] = { target_val: r.target_val, actual_val: r.actual_val, weight: r.weight }; });
    }

    const base       = actuals[req.component] || { target_val: 0, weight: 0 };
    const withOld    = { ...actuals, [req.component]: { ...base, actual_val: req.old_value } };
    const withNew    = { ...actuals, [req.component]: { ...base, actual_val: req.new_value } };
    const oldSIP     = computeSIPEarned(budget, level, emp.detail_area || '', withOld, plan);
    const newSIP     = computeSIPEarned(budget, level, emp.detail_area || '', withNew, plan);
    const sipDelta   = newSIP - oldSIP;

    // ── Quarterly SIP delta ────────────────────────────────────────────────
    // Build per-quarter-month actuals (reuse already-fetched data)
    const qActualsPerMonth = _qMKeys.map(qmk => {
      const result = qmk === req.month_key ? resActuals : resOtherQActuals[_otherQMKeys.indexOf(qmk)];
      const qActs = {};
      if (result && result.success) {
        result.data
          .filter(r => r.employee_id === req.employee_id)
          .forEach(r => { qActs[r.component] = { target_val: r.target_val, actual_val: r.actual_val, weight: r.weight }; });
      }
      return qActs;
    });

    // Old/new versions: replace source-month component value
    const qActualsOld = qActualsPerMonth.map((qActs, idx) => {
      if (_qMKeys[idx] !== req.month_key) return qActs;
      const b = qActs[req.component] || { target_val: 0, weight: 0 };
      return { ...qActs, [req.component]: { ...b, actual_val: req.old_value } };
    });
    const qActualsNew = qActualsPerMonth.map((qActs, idx) => {
      if (_qMKeys[idx] !== req.month_key) return qActs;
      const b = qActs[req.component] || { target_val: 0, weight: 0 };
      return { ...qActs, [req.component]: { ...b, actual_val: req.new_value } };
    });

    const kpiItemsQ = getKpiItems(level, emp.detail_area || '') || [];
    const baseKpiQ  = KPI_TARGETS[level] || [];
    function computeQuarterlySIP(qActsArr) {
      let total = 0;
      for (const it of kpiItemsQ.filter(it2 => !it2._isParentHeader && it2.label !== 'Closed Won/Consumption')) {
        let target = 0, actual = 0, weight = it.pct;
        qActsArr.forEach(qActs => {
          const comp = qActs[it.label];
          if (comp) {
            target += comp.target_val ?? 0;
            actual += comp.actual_val ?? 0;
            if (comp.weight != null) weight = comp.weight;
          }
        });
        if (target > 0 && (actual / target) * 100 >= 100) {
          const tieredVal = tieredSIP((actual / target) * 100, plan) * 3;
          let weightFactor = 0;
          if (it._sub) {
            const parentKpi = baseKpiQ.find(x => x.label === it._parent);
            const parentPct = parentKpi ? parentKpi.pct : 0;
            weightFactor = (parentPct / 100) * ((it._sub === 'Distributor' ? JABODETABEK_DIST_PCT : JABODETABEK_DIR_PCT) / 100);
          } else {
            weightFactor = weight / 100;
          }
          total += Math.round(tieredVal * SIP_QUARTER_PCT / 100 * weightFactor);
        }
      }
      return total;
    }

    const oldQuarterSIP   = computeQuarterlySIP(qActualsOld);
    const newQuarterSIP   = computeQuarterlySIP(qActualsNew);
    const quarterSIPDelta = newQuarterSIP - oldQuarterSIP;
    const totalDelta      = sipDelta + quarterSIPDelta;

    _unlockRevData.sipDelta = totalDelta;

    const deltaEl = document.getElementById('unlockReviewDeltaSection');
    if (deltaEl) {
      const sign   = totalDelta >= 0 ? '+' : '';
      const color  = totalDelta >= 0 ? '#16a34a' : '#dc2626';
      const bg     = totalDelta >= 0 ? '#f0fdf4' : '#fef2f2';
      const border = totalDelta >= 0 ? '#bbf7d0' : '#fecaca';
      deltaEl.style.cssText = `background:${bg};border:1px solid ${border};border-radius:8px;padding:10px 14px;font-size:13px;`;
      const qLabel = ['Q1 (Jan–Mar)', 'Q2 (Apr–Jun)', 'Q3 (Jul–Sep)', 'Q4 (Oct–Dec)'][_qIdx];
      let html = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <i class="fa-solid fa-calculator" style="color:${color};"></i>
          <span>Total carry-forward ke bulan berikutnya:
            <strong style="color:${color};">${sign}${formatRupiah(totalDelta)}</strong>
          </span>
        </div>
        <div style="font-size:11px;color:#6b7280;">
          Monthly SIP: ${formatRupiah(oldSIP)} &rarr; ${formatRupiah(newSIP)}
          (${sipDelta >= 0 ? '+' : ''}${formatRupiah(sipDelta)})
        </div>`;
      if (quarterSIPDelta !== 0) {
        const qSign  = quarterSIPDelta >= 0 ? '+' : '';
        const qColor = quarterSIPDelta >= 0 ? '#0369a1' : '#dc2626';
        html += `<div style="font-size:11px;color:${qColor};margin-top:2px;">
          ${qLabel} SIP Quarter: ${formatRupiah(oldQuarterSIP)} &rarr; ${formatRupiah(newQuarterSIP)}
          <strong>(${qSign}${formatRupiah(quarterSIPDelta)})</strong>
        </div>`;
      }
      deltaEl.innerHTML = html;
    }
    btnApprove.disabled = false;
  } catch (e) {
    const deltaEl = document.getElementById('unlockReviewDeltaSection');
    if (deltaEl) {
      deltaEl.innerHTML = `<span style="color:#b45309;"><i class="fa-solid fa-triangle-exclamation"></i>
        Gagal menghitung selisih: ${e.message}. Selisih SIP akan dicatat Rp 0.</span>`;
      deltaEl.style.cssText = 'background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;font-size:13px;';
    }
    _unlockRevData.sipDelta = 0;
    btnApprove.disabled = false;
  }
}

/** Confirm and execute the approval of the current review request. */
async function confirmApproveUnlock() {
  if (!_unlockRevData) return;
  const { id, employee_name, component, month_key, year, old_value, new_value, sipDelta,
          cf_target_month, cf_target_year } = _unlockRevData;
  const midx  = MONTH_KEYS.indexOf(month_key);
  const mLabel = midx >= 0 ? `${MONTH_NAMES[midx]} ${year}` : month_key;
  const cfMIdx = cf_target_month ? cf_target_month - 1 : -1;
  const cfLabel = cfMIdx >= 0 ? `${MONTH_NAMES[cfMIdx]} ${cf_target_year}` : 'bulan berikutnya';
  const sign   = sipDelta >= 0 ? '+' : '';
  if (!confirm(`Setujui perubahan KPI?\n\n${employee_name || id} — ${component} (${mLabel})\n${old_value.toLocaleString('id-ID')} → ${new_value.toLocaleString('id-ID')}\n\nSelisih SIP carry-forward: ${sign}${formatRupiah(sipDelta)}\nDibayarkan di: ${cfLabel}\n\nLanjutkan?`)) return;

  const btn = document.getElementById('btnApproveUnlock');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    const res  = await fetch(UNLOCK_API, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ action: 'approve', id, sip_delta: sipDelta }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    showToast(json.message, 'success');
    closeModal('unlockReviewOverlay');
    loadPendingUnlockRequests();
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Setujui';
  }
}

/** Show rejection notes field on first click; execute rejection on second click. */
async function confirmRejectUnlock() {
  if (!_unlockRevData) return;
  const notesSection = document.getElementById('unlockReviewNotesSection');
  const btn = document.getElementById('btnRejectUnlock');

  // First click: reveal notes field
  if (notesSection && notesSection.style.display === 'none') {
    notesSection.style.display = '';
    btn.innerHTML = '<i class="fa-solid fa-xmark"></i> Konfirmasi Tolak';
    return;
  }

  // Second click: execute rejection
  const notes = document.getElementById('unlockReviewNotes')?.value.trim() ?? '';
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    const res  = await fetch(UNLOCK_API, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ action: 'reject', id: _unlockRevData.id, review_notes: notes }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    showToast(json.message, 'success');
    closeModal('unlockReviewOverlay');
    loadPendingUnlockRequests();
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-xmark"></i> Konfirmasi Tolak';
  }
}
const DEPT_HEAD_API = API.DEPARTMENT_HEADS;
// deptHeads is declared in state.js

async function loadDeptHeads() {
  try {
    const res  = await fetch(DEPT_HEAD_API);
    const json = await res.json();
    if (json.success) deptHeads = json.data;
  } catch (e) { deptHeads = []; }
}

function renderDepartmentHeadPage() {
  const tbody   = document.getElementById('deptHeadTableBody');
  const countEl = document.getElementById('deptHeadCount');
  if (!tbody) return;
  const canEdit = currentRole === 'admin';
  const btnAdd  = document.getElementById('btnAddDeptHead');
  if (btnAdd) btnAdd.style.display = canEdit ? '' : 'none';
  countEl.textContent = `Showing ${deptHeads.length} record${deptHeads.length !== 1 ? 's' : ''}`;
  tbody.innerHTML = deptHeads.length === 0
    ? `<tr><td colspan="6" class="no-data">No data available.</td></tr>`
    : deptHeads.map((d, i) => {
      const manager = d.reporting_manager_id ? (associates.find(a => a.employee_id === d.reporting_manager_id) || deptHeads.find(dh => dh.employee_id === d.reporting_manager_id)) : null;
      const managerName = manager ? manager.full_name : (d.reporting_manager_id ? d.reporting_manager_id : '—');
      return `
    <tr>
      <td>${i + 1}</td>
      <td><code style="background:#f1f5f9;padding:2px 7px;border-radius:4px;font-size:12px;">${escHtml(d.employee_id)}</code></td>
      <td>${escHtml(d.full_name)}</td>
      <td>${escHtml(d.position)}</td>
      <td>${managerName === '—' ? '<span style="color:#94a3b8">—</span>' : escHtml(managerName)}</td>
      <td style="text-align:center;">
        ${canEdit ? `
        <button class="btn-icon edit" title="Edit" onclick="openDeptHeadModal(${d.id})"><i class="fa-solid fa-pen"></i></button>
        <button class="btn-icon delete" title="Delete" onclick="deleteDeptHead(${d.id},'${escHtml(d.full_name)}')"><i class="fa-solid fa-trash"></i></button>
        ` : '—'}
      </td>
    </tr>`}).join('');
}

// ── Modal helpers ──
function openDeptHeadModal(id = null) {
  const d = id ? deptHeads.find(x => x.id === id) : null;
  document.getElementById('deptHeadModalTitle').innerHTML =
    `<i class="fa-solid fa-user-tie"></i> ${d ? 'Edit' : 'Add'} Department Head`;
  document.getElementById('deptHeadSaveText').textContent = d ? 'Save Changes' : 'Save';
  document.getElementById('deptHeadEditId').value   = d?.id ?? '';
  document.getElementById('dhFormId').value         = d?.employee_id ?? '';
  document.getElementById('dhFormFullName').value   = d?.full_name ?? '';
  document.getElementById('dhFormPosition').value   = d?.position ?? '';
  
  // Populate reporting manager dropdown
  const rmSelect = document.getElementById('dhFormReportingManager');
  const dhOpts = deptHeads.filter(dh => dh.id !== id).map(dh => `<option value="${escHtml(dh.employee_id)}">${escHtml(dh.full_name)}</option>`).join('');
  const assocOpts = associates.map(a => `<option value="${escHtml(a.employee_id)}">${escHtml(a.full_name)}</option>`).join('');
  rmSelect.innerHTML = `<option value="">— No Manager —</option>` +
    (dhOpts ? `<optgroup label="Department Head">${dhOpts}</optgroup>` : '') +
    (assocOpts ? `<optgroup label="Associates">${assocOpts}</optgroup>` : '');
  rmSelect.value = d?.reporting_manager_id ?? '';
  
  document.getElementById('deptHeadFormError').classList.add('hidden');
  openModal('deptHeadModalOverlay');
}

document.getElementById('btnAddDeptHead').addEventListener('click', () => openDeptHeadModal());
document.getElementById('deptHeadModalClose').addEventListener('click',  () => closeModal('deptHeadModalOverlay'));
document.getElementById('deptHeadModalCancel').addEventListener('click', () => closeModal('deptHeadModalOverlay'));

document.getElementById('deptHeadModalSave').addEventListener('click', async () => {
  const editId   = document.getElementById('deptHeadEditId').value;
  const employee_id = document.getElementById('dhFormId').value.trim();
  const full_name   = document.getElementById('dhFormFullName').value.trim();
  const position    = document.getElementById('dhFormPosition').value.trim();
  const reporting_manager_id = document.getElementById('dhFormReportingManager').value.trim() || null;
  const errEl       = document.getElementById('deptHeadFormError');

  if (!employee_id || !full_name || !position) {
    errEl.textContent = 'ID, Full Name, dan Position wajib diisi.';
    errEl.classList.remove('hidden');
    return;
  }
  errEl.classList.add('hidden');

  const btn = document.getElementById('deptHeadModalSave');
  btn.disabled = true;

  try {
    const url    = editId ? `${DEPT_HEAD_API}?id=${editId}` : DEPT_HEAD_API;
    const method = editId ? 'PUT' : 'POST';
    const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employee_id, full_name, position, salary: 0, reporting_manager_id }) });
    const json   = await res.json();
    if (json.success) {
      closeModal('deptHeadModalOverlay');
      showToast(json.message);
      await loadDeptHeads();
      renderDepartmentHeadPage();
    } else {
      errEl.textContent = json.message;
      errEl.classList.remove('hidden');
    }
  } catch (e) {
    errEl.textContent = 'Error: ' + e.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
});

async function deleteDeptHead(id, name) {
  if (!confirm(`Hapus Department Head "${name}"?`)) return;
  try {
    const res  = await fetch(`${DEPT_HEAD_API}?id=${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      showToast(json.message);
      await loadDeptHeads();
      renderDepartmentHeadPage();
    } else {
      showToast(json.message, 'error');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

function populateManagerPicker(excludeId) {
  const sel = document.getElementById('formReportingManager');
  const dhOpts = deptHeads
    .map(d => `<option value="${escHtml(d.employee_id)}">${escHtml(d.full_name)} (${escHtml(d.employee_id)})</option>`)
    .join('');
  const assocOpts = associates
    .filter(a => !a.resign_date && a.employee_id !== excludeId)
    .map(a => `<option value="${escHtml(a.employee_id)}">${escHtml(a.full_name)} (${escHtml(a.employee_id)})</option>`)
    .join('');
  sel.innerHTML = '<option value="">\u2014 No Manager \u2014</option>' +
    (dhOpts ? `<optgroup label="Department Head">${dhOpts}</optgroup>` : '') +
        (assocOpts ? `<optgroup label="Associates">${assocOpts}</optgroup>` : '');
}

function openEditModal(empId) {
  const a = associates.find(x => x.employee_id === empId);
  if (!a) return;
  editingId = empId;
  document.getElementById('modalTitle').textContent  = 'Edit Associate';
  document.getElementById('formId').value            = a.employee_id;
  document.getElementById('formFullName').value      = a.full_name;
  document.getElementById('formEmployeeId').value    = a.employee_id;
  document.getElementById('formPosition').value      = a.position;
  document.getElementById('formLevel').value         = a.level || '';
  document.getElementById('formCategory').value      = a.category || '';
  document.getElementById('formPlan').value          = a.plan || '';
  document.getElementById('formDetailArea').value    = a.detail_area;
  document.getElementById('formGroupArea').value     = a.group_area;
  populateManagerPicker(empId);
  document.getElementById('formReportingManager').value = a.reporting_manager_id || '';
  document.getElementById('formSalary').value        = a.salary;
  document.getElementById('formTargetNC').value      = a.target_nc;
  document.getElementById('formCurrentSIP').value    = a.current_sip_percent || 0;
  document.getElementById('formJoinDate').value       = a.join_date || '';

  // Auto-fill SIP Budget from employment history
  const budgetEl = document.getElementById('formBudgetMonthly');
  budgetEl.value = '';
  budgetEl.placeholder = 'Loading...';
  fetch(`${HIST_API}?employee_id=${encodeURIComponent(empId)}`)
    .then(r => r.json())
    .then(json => {
      if (!json.success) throw new Error();
      const sorted = [...json.data].sort((a, b) => a.effective_date.localeCompare(b.effective_date));
      const year     = new Date().getFullYear();
      const lastDay  = new Date(year, NOW_MONTH + 1, 0).getDate();
      const monthEnd = `${year}-${String(NOW_MONTH + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      let applicable = null;
      for (const h of sorted) {
        if (h.effective_date <= monthEnd) applicable = h;
      }
      budgetEl.value = applicable ? applicable.sip_budget : 0;
    })
    .catch(() => { budgetEl.value = 0; })
    .finally(() => { budgetEl.placeholder = '0'; });

  openModal('modalOverlay');
}

