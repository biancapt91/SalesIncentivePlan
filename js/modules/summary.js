// ===========================
// SUMMARY PAGE
// ===========================
(function () {
  const monthInput = document.getElementById('summaryMonth');
  const now = new Date();
  monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
})();

/**
 * Compute the SIP amount earned by one associate for a given month.
 * @param {number} budget        - MONTHLY (100%) budget for that month
 * @param {string} level         - associate level
 * @param {string} detailArea    - associate detail area
 * @param {Object} actuals       - map of component → { target_val, actual_val }
 * @param {string} plan          - associate SIP plan key (e.g. '1', '2L', '3')
 */
function computeSIPEarned(budget, level, detailArea, actuals, plan) {
  const kpiItems = getKpiItems(level, detailArea);
  if (!kpiItems) return 0;

  const baseKpi = KPI_TARGETS[level] || [];
  const t       = SIP_TIERS[plan];
  let earned = 0;

  for (const it of kpiItems) {
    if (it._isParentHeader) continue;

    const row    = actuals[it.label] || {};
    const target = row.target_val ?? 0;
    const actual = row.actual_val ?? 0;
    if (target <= 0) continue;

    const isCW = it.label === 'Closed Won/Consumption';
    if (isCW) {
      // CW: met → 15% of SIP budget, not met → 0
      if (actual >= target) earned += Math.round(budget * SIP_CW_PCT / 100);
      continue;
    }

    const effectiveWeightPct = (row.weight != null) ? row.weight : it.pct;
    if (effectiveWeightPct === 0) continue;

    const achievementPct = (actual / target) * 100;
    const rawSIP = tieredSIP(achievementPct, plan);
    let weightFactor;
    if (it._sub) {
      const parentKpi   = baseKpi.find(x => x.label === it._parent);
      const parentPct   = parentKpi ? parentKpi.pct : 0;
      const subSplitPct = it._sub === 'Distributor' ? JABODETABEK_DIST_PCT : JABODETABEK_DIR_PCT;
      weightFactor = (parentPct / 100) * (subSplitPct / 100);
    } else {
      weightFactor = effectiveWeightPct / 100;
    }
    earned += rawSIP * SIP_MONTHLY_SALES_PCT / 100 * weightFactor;
  }

  return Math.round(earned);
}

async function renderSummary() {
  const month  = document.getElementById('summaryMonth').value;
  const tbody  = document.getElementById('summaryTableBody');
  const count  = document.getElementById('summaryCount');
  const totalEl = document.getElementById('summaryTotalSIP');
  if (!month) { showToast('Please select a month first.', 'error'); return; }

  const [yearStr, monthNumStr] = month.split('-');
  const year      = parseInt(yearStr);
  const endMonthIdx = parseInt(monthNumStr) - 1; // 0-based

  tbody.innerHTML = `<tr><td colspan="12" class="no-data"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</td></tr>`;

  try {
    await loadAssociates();

    if (_summaryMode !== 'monthly') {
      // ── Multi-month mode (YTD / Q1–Q4) ──
      const QUARTER_START_IDX = { q1: 0, q2: 3, q3: 6, q4: 9 };
      const QUARTER_END_IDX   = { q1: 2, q2: 5, q3: 8, q4: 11 };
      const QUARTER_LABEL_MAP = {
        q1: 'Q1 (Jan–Mar)', q2: 'Q2 (Apr–Jun)',
        q3: 'Q3 (Jul–Sep)', q4: 'Q4 (Oct–Dec)',
      };

      let startIdx, rangeEndIdx, periodLabel;
      if (_summaryMode === 'ytd') {
        startIdx    = 0;
        rangeEndIdx = endMonthIdx;
        periodLabel = `Jan–${MONTH_NAMES[endMonthIdx]}`;
      } else {
        startIdx    = QUARTER_START_IDX[_summaryMode];
        rangeEndIdx = Math.min(QUARTER_END_IDX[_summaryMode], endMonthIdx);
        periodLabel = QUARTER_LABEL_MAP[_summaryMode];
        if (startIdx > endMonthIdx) {
          tbody.innerHTML = `<tr><td colspan="12" class="no-data">No data for this quarter in the selected period.</td></tr>`;
          count.textContent = 'Showing 0 records';
          totalEl.style.display = 'none';
          return;
        }
      }

      const monthsRange    = MONTH_KEYS.slice(startIdx, rangeEndIdx + 1);
      const endMonthKey    = MONTH_KEYS[rangeEndIdx];
      const periodEndMonth = `${year}-${String(rangeEndIdx + 1).padStart(2, '0')}`;

      const fetches = [
        fetch(`${HIST_API}?year=${year}&per_month=1`).then(r => r.json()),
        ...monthsRange.map(mk =>
          fetch(`${ACTUAL_API}?year=${year}&month_key=${mk}`).then(r => r.json())
        ),
      ];
      const [budgetRes, ...actResults] = await Promise.all(fetches);

      const budgetPerMonth   = budgetRes.success ? budgetRes.data              : {};
      const levelPerMonth    = budgetRes.success ? (budgetRes.levels     || {}) : {};
      const positionPerMonth = budgetRes.success ? (budgetRes.positions  || {}) : {};
      const planPerMonth     = budgetRes.success ? (budgetRes.plans      || {}) : {};
      const categoryPerMonth = budgetRes.success ? (budgetRes.categories || {}) : {};
      const salaryPerMonth   = budgetRes.success ? (budgetRes.salaries   || {}) : {};

      const actByMonth = actResults.map(j => {
        const map = {};
        if (j.success) j.data.forEach(r => {
          if (!map[r.employee_id]) map[r.employee_id] = {};
          map[r.employee_id][r.component] = r;
        });
        return map;
      });

      const _sumNumTh = document.querySelector('#summaryTable thead th:first-child');
      if (_sumNumTh) _sumNumTh.style.display = currentRole === 'sales_associate' ? 'none' : '';

      const q = (document.getElementById('searchSummary').value || '').toLowerCase().trim();
      let data = (currentRole === 'sales_associate' && currentAssociateId)
        ? associates.filter(a => getViewableEmployeeIds().includes(a.employee_id))
        : associates;
      if (q) data = data.filter(a =>
        a.full_name.toLowerCase().includes(q) ||
        a.employee_id.toLowerCase().includes(q) ||
        a.detail_area.toLowerCase().includes(q) ||
        a.group_area.toLowerCase().includes(q)
      );

      let totalSIP = 0;
      const rows = data.map((a, i) => {
        let periodBudget = 0;
        let periodSIP    = 0;
        
        if (_summaryMode !== 'monthly' && /^q[1-4]$/.test(_summaryMode)) {
          // Quarter mode: use quarter calculation logic (exclude Closed Won/Consumption)
          const quarterIdx = _summaryMode === 'q1' ? 0 : _summaryMode === 'q2' ? 1 : _summaryMode === 'q3' ? 2 : 3;
          const quarterMonths = [
            ['jan', 'feb', 'mar'],
            ['apr', 'may', 'jun'],
            ['jul', 'aug', 'sep'],
            ['oct', 'nov', 'dec'],
          ][quarterIdx];
          
          const lastLvl  = (levelPerMonth[a.employee_id]    ?? {})[endMonthKey] || a.level;
          const lastPlan = (planPerMonth[a.employee_id]     ?? {})[endMonthKey] || a.plan;
          const kpiItems = getKpiItems(lastLvl, a.detail_area) || [];
          const baseKpi  = KPI_TARGETS[lastLvl] || [];
          
          for (const it of kpiItems.filter(it2 => !it2._isParentHeader && it2.label !== 'Closed Won/Consumption')) {
            const monthsInQuarter = [];
            for (let mi = startIdx; mi <= rangeEndIdx; mi++) {
              if (quarterMonths.includes(MONTH_KEYS[mi])) monthsInQuarter.push(mi);
            }
            
            let target = 0, actual = 0, weight = it.pct;
            for (const mi of monthsInQuarter) {
              const comp = (actByMonth[mi - startIdx] ?? {})[a.employee_id]?.[it.label];
              if (comp) {
                target += comp.target_val ?? 0;
                actual += comp.actual_val ?? 0;
                if (comp.weight != null) weight = comp.weight;
              }
            }
            
            if (target > 0) {
              const quarterAchPct = (actual / target) * 100;
              if (quarterAchPct >= 100) {
                // Sum tiered SIP per quarter month using each month's own plan
                const tieredVal = monthsInQuarter.reduce((sum, mi) => {
                  const qPlan = (planPerMonth[a.employee_id] ?? {})[MONTH_KEYS[mi]] || a.plan;
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
                
                const earned = Math.round(tieredVal * SIP_QUARTER_PCT / 100 * weightFactor);
                periodSIP += earned;
              }
            }
          }
          
          // Calculate budget for quarter
          for (let mi = startIdx; mi <= rangeEndIdx; mi++) {
            const mk      = MONTH_KEYS[mi];
            const mBudget = (budgetPerMonth[a.employee_id] ?? {})[mk] ?? 0;
            periodBudget += mBudget;
          }
        } else {
          // Monthly or YTD mode: sum monthly SIP
          for (let mi = startIdx; mi <= rangeEndIdx; mi++) {
            const mk      = MONTH_KEYS[mi];
            const mBudget = (budgetPerMonth[a.employee_id] ?? {})[mk] ?? 0;
            const mLevel  = (levelPerMonth[a.employee_id] ?? {})[mk] || a.level;
            const mPlan   = (planPerMonth[a.employee_id]  ?? {})[mk] || a.plan;
            const acts    = (actByMonth[mi - startIdx] ?? {})[a.employee_id] ?? {};
            periodBudget += mBudget;
            periodSIP    += computeSIPEarned(mBudget, mLevel, a.detail_area, acts, mPlan);
          }
        }
        
        totalSIP += periodSIP;

        const lastLvl      = (levelPerMonth[a.employee_id]    ?? {})[endMonthKey] || a.level;
        const lastPosition = (positionPerMonth[a.employee_id] ?? {})[endMonthKey] || a.position;
        const lastPlan     = (planPerMonth[a.employee_id]     ?? {})[endMonthKey] || a.plan;
        const lastCategory = (categoryPerMonth[a.employee_id] ?? {})[endMonthKey] || a.category;
        const lastSalary   = (salaryPerMonth[a.employee_id]   ?? {})[endMonthKey] ?? a.salary;
        const _numStyle = currentRole === 'sales_associate' ? 'none' : '';
        return `<tr>
          <td style="display:${_numStyle}">${i + 1}</td>
          <td>${a.group_area}</td>
          <td>${a.detail_area}</td>
          <td><code style="background:#f1f5f9;padding:2px 7px;border-radius:4px;font-size:12px;">${a.employee_id}</code></td>
          <td><strong>${a.full_name}</strong></td>
          <td>${lastPosition}</td>
          <td>${lastPlan ? `<span class="badge ${getPlanBadge(lastPlan)}">${lastPlan}</span>` : '—'}</td>
          <td>${lastCategory || '—'}</td>
          <td class="money-col">${formatRupiah(lastSalary)}</td>
          <td class="money-col">${periodBudget > 0 ? formatRupiah(periodBudget) : '<span style="color:#94a3b8">—</span>'}</td>
          <td class="money-col"><strong>${periodSIP > 0 ? formatRupiah(periodSIP) : '<span style="color:#dc2626">Rp 0</span>'}</strong></td>
          <td style="display:flex;gap:6px;align-items:center;">
            <button class="btn-icon detail" title="Detail Achievement" onclick="openSummaryDetail('${a.employee_id}','${a.full_name.replace(/'/g,"\\'")}','${periodEndMonth}',${periodBudget},'${lastLvl}','${(a.detail_area||'').replace(/'/g,"\\'")}','${_summaryMode}','${lastPlan}')">
              <i class="fa-solid fa-eye"></i>
            </button>
          </td>
        </tr>`;
      });

      const thBudH = document.getElementById('thSumSIPBudget');
      const thAmtH = document.getElementById('thSumSIPAmount');
      if (thBudH) thBudH.textContent = `${periodLabel} SIP Budget`;
      if (thAmtH) {
        if (_summaryMode !== 'monthly' && /^q[1-4]$/.test(_summaryMode)) {
          thAmtH.textContent = `${periodLabel} SIP Quarter Amount`;
        } else {
          thAmtH.textContent = `${periodLabel} SIP Amount`;
        }
      }
      count.textContent  = `Showing ${data.length} records`;
      totalEl.style.display = canSeeMoney() ? '' : 'none';
      const totalLabel = (_summaryMode !== 'monthly' && /^q[1-4]$/.test(_summaryMode)) 
        ? `${periodLabel} SIP Quarter Amount`
        : `${periodLabel} SIP Amount`;
      totalEl.textContent = `${totalLabel} (${year}): ${formatRupiah(totalSIP)}`;
      tbody.innerHTML = rows.length ? rows.join('') :
        `<tr><td colspan="12" class="no-data">No data found.</td></tr>`;
      return;
    }

    // ── Monthly mode (original) ──
    const monthKey = MONTH_KEYS[endMonthIdx];
    const thBudM = document.getElementById('thSumSIPBudget');
    const thAmtM = document.getElementById('thSumSIPAmount');
    if (thBudM) thBudM.textContent = `SIP Budget (${MONTH_NAMES[endMonthIdx]})`;
    if (thAmtM) thAmtM.textContent = `SIP Amount`;

    // Fetch actuals AND per-month historical budgets in parallel
    const [resAct, resBudget] = await Promise.all([
      fetch(`${ACTUAL_API}?year=${year}&month_key=${monthKey}`),
      fetch(`${HIST_API}?year=${year}&per_month=1`),
    ]);
    const actJson    = await resAct.json();
    const budgetJson = await resBudget.json();
    const budgetPerMonth   = budgetJson.success ? budgetJson.data              : {};
    const levelPerMonth    = budgetJson.success ? (budgetJson.levels     || {}) : {};
    const positionPerMonth = budgetJson.success ? (budgetJson.positions  || {}) : {};
    const planPerMonth     = budgetJson.success ? (budgetJson.plans      || {}) : {};
    const categoryPerMonth = budgetJson.success ? (budgetJson.categories || {}) : {};
    const salaryPerMonth   = budgetJson.success ? (budgetJson.salaries   || {}) : {};

    // Build actuals map: employee_id → { component → { target_val, actual_val, weight } }
    const actMap = {};
    if (actJson.success) {
      for (const r of actJson.data) {
        if (!actMap[r.employee_id]) actMap[r.employee_id] = {};
        actMap[r.employee_id][r.component] = { target_val: r.target_val, actual_val: r.actual_val, weight: r.weight };
      }
    }

    const _sumNumTh = document.querySelector('#summaryTable thead th:first-child');
    if (_sumNumTh) _sumNumTh.style.display = currentRole === 'sales_associate' ? 'none' : '';
    const sumToolbar = document.querySelector('#page-summary .toolbar');
    if (sumToolbar) sumToolbar.style.display = currentRole === 'sales_associate' ? 'none' : '';
    // For sales_associate: hide only search + load button, keep month picker
    const sumSearchBox = document.getElementById('summarySearchBox');
    const btnLoadSum   = document.getElementById('btnLoadSummary');
    if (currentRole === 'sales_associate') {
      if (sumToolbar)   sumToolbar.style.display = '';
      if (sumSearchBox) sumSearchBox.style.display = 'none';
      if (btnLoadSum)   btnLoadSum.style.display = 'none';
      // Wire month picker to auto-reload summary on change (once)
      const sumMonthInp = document.getElementById('summaryMonth');
      if (sumMonthInp && !sumMonthInp._salesWired) {
        sumMonthInp._salesWired = true;
        sumMonthInp.addEventListener('change', renderSummary);
      }
    } else {
      if (sumSearchBox) sumSearchBox.style.display = '';
      if (btnLoadSum)   btnLoadSum.style.display = '';
    }
    const q = (document.getElementById('searchSummary').value || '').toLowerCase().trim();
    // Sales Associate: only show their own row
    let data = (currentRole === 'sales_associate' && currentAssociateId)
      ? associates.filter(a => getViewableEmployeeIds().includes(a.employee_id))
      : associates;
    if (q) {
      data = data.filter(a =>
        a.full_name.toLowerCase().includes(q) ||
        a.employee_id.toLowerCase().includes(q) ||
        a.detail_area.toLowerCase().includes(q) ||
        a.group_area.toLowerCase().includes(q)
      );
    }

    let totalSIP = 0;
    const rows = data.map((a, i) => {
      const sipBudget    = (budgetPerMonth[a.employee_id]    ?? {})[monthKey] ?? (a.sip_budget_current || 0);
      const histLevel    = (levelPerMonth[a.employee_id]    ?? {})[monthKey] || a.level;
      const histPosition = (positionPerMonth[a.employee_id] ?? {})[monthKey] || a.position;
      const histPlan     = (planPerMonth[a.employee_id]     ?? {})[monthKey] || a.plan;
      const histCategory = (categoryPerMonth[a.employee_id] ?? {})[monthKey] || a.category;
      const histSalary   = (salaryPerMonth[a.employee_id]   ?? {})[monthKey] ?? a.salary;
      const sipAmount  = computeSIPEarned(sipBudget, histLevel, a.detail_area, actMap[a.employee_id] || {}, histPlan);
      totalSIP += sipAmount;

      const _sumNumStyle = currentRole === 'sales_associate' ? 'none' : '';
      return `<tr>
        <td style="display:${_sumNumStyle}">${i + 1}</td>
        <td>${a.group_area}</td>
        <td>${a.detail_area}</td>
        <td><code style="background:#f1f5f9;padding:2px 7px;border-radius:4px;font-size:12px;">${a.employee_id}</code></td>
        <td><strong>${a.full_name}</strong></td>
        <td>${histPosition}</td>
        <td>${histPlan ? `<span class="badge ${getPlanBadge(histPlan)}">${histPlan}</span>` : '—'}</td>
        <td>${histCategory || '—'}</td>
        <td class="money-col">${formatRupiah(histSalary)}</td>
        <td class="money-col">${sipBudget > 0 ? formatRupiah(sipBudget) : '<span style="color:#94a3b8">—</span>'}</td>
        <td class="money-col"><strong>${sipAmount > 0 ? formatRupiah(sipAmount) : '<span style="color:#dc2626">Rp 0</span>'}</strong></td>
        <td>
          <button class="btn-icon detail" title="Detail Achievement" onclick="openSummaryDetail('${a.employee_id}','${a.full_name.replace(/'/g,"\\'")}',${'`'}${month}${'`'},${sipBudget},'${histLevel}','${(a.detail_area||'').replace(/'/g,"\\'")}','monthly','${histPlan}')">
            <i class="fa-solid fa-eye"></i>
          </button>
        </td>
      </tr>`;
    });

    count.textContent = `Showing ${data.length} records`;
    totalEl.style.display = canSeeMoney() ? '' : 'none';
    totalEl.textContent = `Total SIP Amount (${MONTH_NAMES[endMonthIdx]} ${year}): ${formatRupiah(totalSIP)}`;
    tbody.innerHTML = rows.length ? rows.join('') :
      `<tr><td colspan="12" class="no-data">No data found.</td></tr>`;

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="12" class="no-data">Failed to load: ${e.message}</td></tr>`;
  }
}

async function openSummaryDetail(empId, name, month, budget, level, detailArea, mode = 'monthly', plan = '') {
  const _sipAssoc = associates.find(a => a.employee_id === empId);
  if (!plan) plan = _sipAssoc ? (_sipAssoc.plan || '') : '';
  document.getElementById('summaryDetailTitle').innerHTML =
    `<i class="fa-solid fa-calculator"></i> SIP Calculation — <span style="font-weight:400;font-size:15px;color:var(--text-secondary)">${name || empId}</span>`;
  const body = document.getElementById('summaryDetailBody');
  body.innerHTML = `<div style="padding:24px;text-align:center;color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>`;
  openModal('summaryDetailOverlay');

  try {
    const [yearStr, monthNumStr] = month.split('-');
    const year      = parseInt(yearStr);
    const monthIdx  = parseInt(monthNumStr) - 1;
    const monthKey  = MONTH_KEYS[monthIdx];
    const monthName = MONTH_NAMES[monthIdx];

    // ── Multi-month mode (YTD / Q1–Q4) ──
    if (mode !== 'monthly') {
      const QUARTER_START_IDX = { q1: 0, q2: 3, q3: 6, q4: 9 };
      const QUARTER_END_IDX   = { q1: 2, q2: 5, q3: 8, q4: 11 };
      const QUARTER_LABEL_MAP = {
        q1: 'Q1 (Jan–Mar)', q2: 'Q2 (Apr–Jun)',
        q3: 'Q3 (Jul–Sep)', q4: 'Q4 (Oct–Dec)',
      };

      let startIdx, endIdx, periodLabel;
      if (mode === 'ytd') {
        startIdx    = 0;
        endIdx      = monthIdx;
        periodLabel = `Jan–${MONTH_NAMES[monthIdx]} ${year} (YTD)`;
      } else {
        startIdx    = QUARTER_START_IDX[mode];
        endIdx      = Math.min(QUARTER_END_IDX[mode], monthIdx);
        periodLabel = `${QUARTER_LABEL_MAP[mode]} ${year}`;
      }

      const monthsRange = MONTH_KEYS.slice(startIdx, endIdx + 1);

      const [histRes, ...actResults] = await Promise.all([
        fetch(`${HIST_API}?employee_id=${encodeURIComponent(empId)}`).then(r => r.json()),
        ...monthsRange.map(mk =>
          fetch(`${ACTUAL_API}?year=${year}&month_key=${mk}`).then(r => r.json())
        ),
      ]);

      const histSorted = (histRes.success && histRes.data.length > 0)
        ? [...histRes.data].sort((a, b) => a.effective_date.localeCompare(b.effective_date))
        : [];

      const actByMonth = actResults.map(j => {
        const map = {};
        if (j.success) j.data.filter(r => r.employee_id === empId).forEach(r => { map[r.component] = r; });
        return map;
      });

      // Aggregate per KPI component across all months in range
      const compAgg      = {};  // label → { target, actual, earned }
      const monthPlansList = [];  // plan for each month in range (for proportional tiered calc)
      let lastLevel  = level;
      let lastPlan   = plan;
      const isQuarterMode = /^q[1-4]$/.test(mode);

      for (let i = 0; i < monthsRange.length; i++) {
        const mi   = startIdx + i;
        const mEnd = `${year}-${String(mi + 1).padStart(2, '0')}-${new Date(year, mi + 1, 0).getDate()}`;
        let mLevel = level, mBudget = 0, mPlan = plan;
        let applicable = null;
        for (const h of histSorted) { if (h.effective_date <= mEnd) applicable = h; }
        if (applicable) {
          mLevel  = applicable.level || level;
          mBudget = applicable.sip_budget ?? 0;
          mPlan   = applicable.plan  || plan;
        }
        if (i === monthsRange.length - 1) { lastLevel = mLevel; lastPlan = mPlan; }
        monthPlansList.push(mPlan);

        const mActuals  = actByMonth[i] || {};
        const mKpiItems = getKpiItems(mLevel, detailArea) || [];
        const mBaseKpi  = KPI_TARGETS[mLevel] || [];

        for (const it of mKpiItems) {
          if (it._isParentHeader) continue;
          if (!compAgg[it.label]) compAgg[it.label] = { target: 0, actual: 0, earned: 0 };
          const r      = mActuals[it.label] || {};
          const target = r.target_val ?? 0;
          const actual = r.actual_val ?? 0;
          const isCW   = it.label === 'Closed Won/Consumption';
          
          // For quarter mode, skip Closed Won/Consumption entirely
          if (isQuarterMode && isCW) continue;
          
          compAgg[it.label].target += target;
          compAgg[it.label].actual += actual;
          const effectiveWeightPct = (r.weight != null) ? r.weight : it.pct;
          
          if (isCW) {
            // Monthly/YTD mode: Closed Won/Consumption earned logic
            const met = target > 0 && actual >= target;
            compAgg[it.label].earned += met ? Math.round(mBudget * SIP_CW_PCT / 100) : 0;
          } else if (effectiveWeightPct > 0 && target > 0) {
            if (isQuarterMode) {
              // Quarter mode: will calculate at the end using total target/actual
              // Skip per-month calculation
            } else {
              // Monthly/YTD mode: sum monthly SIP
              const achPct = (actual / target) * 100;
              const rawSIP = tieredSIP(achPct, mPlan);
              let wf;
              if (it._sub) {
                const parentKpi = mBaseKpi.find(x => x.label === it._parent);
                const parentPct = parentKpi ? parentKpi.pct : 0;
                const ssp = it._sub === 'Distributor' ? JABODETABEK_DIST_PCT : JABODETABEK_DIR_PCT;
                wf = (parentPct / 100) * (ssp / 100);
              } else { wf = effectiveWeightPct / 100; }
              compAgg[it.label].earned += rawSIP * SIP_MONTHLY_SALES_PCT / 100 * wf;
            }
          }
        }
      }

      // For quarter mode, now calculate earned using quarter formula
      if (isQuarterMode) {
        const kpiFinal = getKpiItems(lastLevel, detailArea) || [];
        for (const it of kpiFinal) {
          if (it._isParentHeader || it.label === 'Closed Won/Consumption') continue;
          const agg = compAgg[it.label];
          if (!agg) continue;
          
          const target = agg.target;
          const actual = agg.actual;
          if (target <= 0) continue;
          
          const quarterAchPct = (actual / target) * 100;
          
          let wf;
          if (it._sub) {
            const baseKpi = KPI_TARGETS[lastLevel] || [];
            const parentKpi = baseKpi.find(x => x.label === it._parent);
            const parentPct = parentKpi ? parentKpi.pct : 0;
            const ssp = it._sub === 'Distributor' ? JABODETABEK_DIST_PCT : JABODETABEK_DIR_PCT;
            wf = (parentPct / 100) * (ssp / 100);
          } else {
            wf = (it.pct ?? 0) / 100;
          }
          
          if (quarterAchPct >= 100) {
            // Sum tiered SIP per month using each month's own plan
            const tieredVal = monthPlansList.reduce((sum, mp) => sum + tieredSIP(quarterAchPct, mp), 0);
            agg.tieredVal = tieredVal;
            agg.weightFactor = wf;
            agg.status = 'Qualified';
            agg.earned = Math.round(tieredVal * SIP_QUARTER_PCT / 100 * wf);
          } else {
            agg.tieredVal = 0;
            agg.weightFactor = wf;
            agg.status = 'Not Qualified';
            agg.earned = 0;
          }
        }
      }

      // Build table using the last month's KPI structure
      const kpiFinal = getKpiItems(lastLevel, detailArea) || [];
      const fmt = v => formatRupiah(Math.round(v));
      let rows = '', rowNum = 0, totalEarned = 0;

      for (const it of kpiFinal) {
        if (it._isParentHeader) {
          rows += `<tr class="kpi-parent-header"><td colspan="${isQuarterMode ? '9' : '6'}" style="font-weight:600;padding-left:12px;">${it.label}</td></tr>`;
          continue;
        }
        // For quarter mode, skip Closed Won/Consumption
        if (isQuarterMode && it.label === 'Closed Won/Consumption') continue;
        
        rowNum++;
        const agg = compAgg[it.label] || { target: 0, actual: 0, earned: 0 };
        const achPct     = agg.target > 0 ? (agg.actual / agg.target) * 100 : 0;
        const pctDisplay = agg.target > 0 ? achPct.toFixed(2) + '%' : '—';
        const pctCls     = achPct >= 100 ? 'actual-pct-met' : achPct >= 85 ? 'actual-pct-partial' : 'actual-pct-low';
        const col        = getKpiColor(it.label) || {};
        const bg         = col.bg ? `background:${col.bg};border-left:4px solid ${col.border};` : '';
        const lbl        = it._sub ? `<span class="kpi-sub-arrow">↳</span> ${it._sub}` : it.label;
        totalEarned += agg.earned;
        
        if (isQuarterMode) {
          const tieredDisplay = agg.tieredVal > 0 ? fmt(Math.round(agg.tieredVal)) : '—';
          const wfDisplay = (agg.weightFactor ?? 0) > 0 ? (agg.weightFactor * 100).toFixed(0) + '%' : '—';
          const statusCls = agg.status === 'Qualified' ? 'status-qualified' : 'status-not-qualified';
          rows += `<tr style="${bg}">
            <td style="display:${currentRole === 'sales_associate' ? 'none' : ''}">${rowNum}</td>
            <td>${lbl}</td>
            <td style="text-align:right;">${agg.target > 0 ? agg.target.toLocaleString('id-ID') : '<span style="color:#94a3b8">—</span>'}</td>
            <td style="text-align:right;">${agg.target > 0 ? formatActual(agg.actual) : '<span style="color:#94a3b8">—</span>'}</td>
            <td style="text-align:center;"><span class="${pctCls}">${pctDisplay}</span></td>
            <td style="text-align:right;">${tieredDisplay}</td>
            <td style="text-align:center;">${wfDisplay}</td>
            <td style="text-align:center;"><span class="${statusCls}" style="padding:2px 8px;border-radius:3px;font-size:12px;font-weight:600;">${agg.status}</span></td>
            <td style="text-align:right;font-weight:600;">${agg.target > 0 ? fmt(agg.earned) : '<span style="color:#94a3b8">—</span>'}</td>
          </tr>`;
        } else {
          rows += `<tr style="${bg}">
            <td style="display:${currentRole === 'sales_associate' ? 'none' : ''}">${rowNum}</td>
            <td>${lbl}</td>
            <td style="text-align:right;">${agg.target > 0 ? agg.target.toLocaleString('id-ID') : '<span style="color:#94a3b8">—</span>'}</td>
            <td style="text-align:right;">${agg.target > 0 ? formatActual(agg.actual) : '<span style="color:#94a3b8">—</span>'}</td>
            <td style="text-align:center;"><span class="${pctCls}">${pctDisplay}</span></td>
            <td style="text-align:right;font-weight:600;">${agg.target > 0 ? fmt(agg.earned) : '<span style="color:#94a3b8">—</span>'}</td>
          </tr>`;
        }
      }

      const tBg  = totalEarned > 0 ? '#eff6ff' : '#fef2f2';
      const tBrd = totalEarned > 0 ? '#93c5fd' : '#fca5a5';
      const tClr = totalEarned > 0 ? '#1d4ed8' : '#dc2626';
      const earnedLabel = isQuarterMode ? 'TOTAL SIP QUARTER EARNED' : 'TOTAL SIP EARNED';
      body.innerHTML = `
        <div style="padding:12px 16px 8px;background:#f8fafc;border-bottom:1px solid var(--border);font-size:13px;color:var(--text-secondary);">
          <strong style="color:var(--text-primary);">${periodLabel}</strong> &nbsp;&middot;&nbsp;
          Period Budget: <strong>${fmt(budget)}</strong>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th style="display:${currentRole === 'sales_associate' ? 'none' : ''}">#</th>
                <th>KPI Component</th>
                <th style="text-align:right;">Total Target</th>
                <th style="text-align:right;">Total Actual</th>
                <th style="text-align:center;">Achievement %</th>
                ${isQuarterMode ? `<th style="text-align:right;">Tiered SIP</th>
                <th style="text-align:center;">Weight Factor</th>
                <th style="text-align:center;">Status</th>` : ''}
                <th style="text-align:right;">Earned</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div style="padding:14px 16px;background:${tBg};border-top:2px solid ${tBrd};display:flex;justify-content:space-between;align-items:center;gap:12px;">
          <span style="font-size:13px;font-weight:600;color:${tClr};letter-spacing:.5px;">${earnedLabel}</span>
          <span style="font-size:18px;font-weight:700;color:${tClr};">${fmt(totalEarned)}</span>
        </div>`;
      return;
    }

    const lastDay  = new Date(year, monthIdx + 1, 0).getDate();
    const monthEnd = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${lastDay}`;

    const [res, histRes] = await Promise.all([
      fetch(`${ACTUAL_API}?year=${year}&month_key=${monthKey}`),
      fetch(`${HIST_API}?employee_id=${encodeURIComponent(empId)}`),
    ]);
    const json     = await res.json();
    const histJson = await histRes.json();
    if (!json.success) throw new Error(json.message);

    // Resolve historically correct level and budget for this specific month
    if (histJson.success && histJson.data.length > 0) {
      const histSorted = [...histJson.data].sort((a, b) => a.effective_date.localeCompare(b.effective_date));
      let applicable = null;
      for (const h of histSorted) { if (h.effective_date <= monthEnd) applicable = h; }
      if (applicable) {
        level  = applicable.level  || level;
        budget = applicable.sip_budget ?? budget;
        if (applicable.plan) plan = applicable.plan;
      }
    }

    // Filter to this employee
    const empActuals = {};
    for (const r of json.data) {
      if (r.employee_id === empId) empActuals[r.component] = r;
    }

    const kpiItems = getKpiItems(level, detailArea) || [];
    const baseKpi  = KPI_TARGETS[level] || [];
    const fmt      = v => formatRupiah(Math.round(v));

    let totalEarned = 0;
    let rows = '';
    let rowNum = 0;

    for (const it of kpiItems) {
      if (it._isParentHeader) {
        rows += `<tr class="kpi-parent-header">
          <td colspan="7" style="font-weight:600;padding-left:12px;">${it.label}</td>
        </tr>`;
        continue;
      }
      rowNum++;
      const r      = empActuals[it.label] || {};
      const target = r.target_val ?? 0;
      const actual = r.actual_val ?? 0;
      const isCW   = it.label === 'Closed Won/Consumption';

      const achievementPct = target > 0 ? (actual / target) * 100 : 0;
      const pctDisplay     = target > 0 ? achievementPct.toFixed(2) + '%' : '—';
      const pctCls              = achievementPct >= 100 ? 'actual-pct-met' : achievementPct >= 85 ? 'actual-pct-partial' : 'actual-pct-low';

      const col   = getKpiColor(it.label) || {};
      const bg    = col.bg ? `background:${col.bg};border-left:4px solid ${col.border};` : '';
      const label = it._sub ? `<span class="kpi-sub-arrow">↳</span> ${it._sub}` : it.label;

      // Effective weight: use DB weight if available, fallback to KPI_TARGETS default
      const effectiveWeightPct = (r.weight != null) ? r.weight : it.pct;

      let tierCell, weightCell, earned;
      if (isCW) {
        const met    = target > 0 && actual >= target;
        earned       = met ? Math.round(budget * SIP_CW_PCT / 100) : 0;
        tierCell  = `<td style="text-align:center;font-size:12px;">${target > 0 ? (met ? '<span class="actual-pct-met">Met ✓</span>' : '<span class="actual-pct-low">Not Met</span>') : '<span style="color:var(--text-muted)">—</span>'}</td>`;
        weightCell = `<td style="text-align:center;font-size:12px;color:#7c3aed;font-weight:600;">15% × SIP Budget</td>`;
      } else if (effectiveWeightPct === 0) {
        // 0% weight → excluded from SIP calculation
        earned    = 0;
        tierCell  = `<td style="text-align:center;font-size:12px;color:var(--text-muted);">—</td>`;
        weightCell = `<td style="text-align:center;font-size:12px;color:var(--text-muted);">0% (excluded)</td>`;
      } else {
        const rawSIP = target > 0 ? tieredSIP(achievementPct, plan) : 0;
        let weightFactor;
        if (it._sub) {
          const parentKpi   = baseKpi.find(x => x.label === it._parent);
          const parentPct   = parentKpi ? parentKpi.pct : 0;
          const subSplitPct = it._sub === 'Distributor' ? JABODETABEK_DIST_PCT : JABODETABEK_DIR_PCT;
          weightFactor = (parentPct / 100) * (subSplitPct / 100);
        } else {
          weightFactor = effectiveWeightPct / 100;
        }
        earned    = rawSIP * SIP_MONTHLY_SALES_PCT / 100 * weightFactor;
        tierCell  = `<td style="text-align:center;">${rawSIP > 0 ? fmt(rawSIP) : '<span style="color:#dc2626;font-size:12px;">Below 85%</span>'}</td>`;
        weightCell = `<td style="text-align:center;font-size:12px;color:var(--text-muted);">80% × ${it._sub ? ((baseKpi.find(x=>x.label===it._parent)?.pct||0) + '%×' + (it._sub==='Distributor'?JABODETABEK_DIST_PCT:JABODETABEK_DIR_PCT) + '%') : effectiveWeightPct + '%'}</td>`;
      }
      totalEarned += earned;

      rows += `<tr style="${bg}">
        <td style="display:${currentRole==='sales_associate'?'none':''}">${rowNum}</td>
        <td>${label}</td>
        <td style="text-align:right;">${target > 0 ? target.toLocaleString('id-ID') : '<span style="color:#94a3b8">—</span>'}</td>
        <td style="text-align:right;">${target > 0 ? formatActual(actual) : '<span style="color:#94a3b8">—</span>'}</td>
        <td style="text-align:center;"><span class="${pctCls}">${pctDisplay}</span></td>
        ${tierCell}
        ${weightCell}
        <td style="text-align:right;font-weight:600;">${target > 0 ? fmt(earned) : '<span style="color:#94a3b8">—</span>'}</td>
      </tr>`;
    }

    const totalCls = totalEarned / budget >= 1 ? 'actual-pct-met' : totalEarned / budget >= 0.5 ? 'actual-pct-partial' : 'actual-pct-low';

    const finalSIP    = totalEarned;
    const cwRow2      = empActuals['Closed Won/Consumption'] || {};
    const cwHasTarget = (cwRow2.target_val ?? 0) > 0;
    const cwMet       = cwHasTarget && (cwRow2.actual_val ?? 0) >= (cwRow2.target_val ?? 0);
    const totalBg     = finalSIP > 0 ? '#eff6ff' : '#fef2f2';
    const totalBorder = finalSIP > 0 ? '#93c5fd' : '#fca5a5';
    const totalColor  = finalSIP > 0 ? '#1d4ed8' : '#dc2626';

    body.innerHTML = `
      <div style="padding:12px 16px 8px;background:#f8fafc;border-bottom:1px solid var(--border);font-size:13px;color:var(--text-secondary);">
        <strong style="color:var(--text-primary);">${monthName} ${year}</strong> &nbsp;&middot;&nbsp;
        MONTHLY Budget: <strong>${fmt(budget)}</strong>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th style="display:${currentRole==='sales_associate'?'none':''}">#</th>
              <th>KPI Component</th>
              <th style="text-align:right;">Target</th>
              <th style="text-align:right;">Actual</th>
              <th style="text-align:center;">Achievement %</th>
              <th style="text-align:center;">Tiered SIP</th>
              <th style="text-align:center;">Weight Factor</th>
              <th style="text-align:right;">Earned</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="padding:14px 16px;background:${totalBg};border-top:2px solid ${totalBorder};display:flex;justify-content:space-between;align-items:center;gap:12px;">
        <span style="font-size:13px;font-weight:600;color:${totalColor};letter-spacing:.5px;">TOTAL SIP EARNED</span>
        <span style="font-size:18px;font-weight:700;color:${totalColor};">${fmt(finalSIP)}</span>
      </div>`;
  } catch(e) {
    body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--red);">Failed to load: ${e.message}</div>`;
  }
}

document.getElementById('summaryDetailClose').addEventListener('click', () => closeModal('summaryDetailOverlay'));
document.getElementById('summaryDetailCloseBtn').addEventListener('click', () => closeModal('summaryDetailOverlay'));
document.getElementById('summaryDetailOverlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal('summaryDetailOverlay');
});

document.getElementById('btnLoadSummary').addEventListener('click', renderSummary);
document.getElementById('searchSummary').addEventListener('input', renderSummary);

// Summary mode toggle buttons
let _summaryMode = 'monthly';
const _summaryBtnIds = ['btnSummaryMonthly','btnSummaryYTD','btnSummaryQ1','btnSummaryQ2','btnSummaryQ3','btnSummaryQ4'];
function setSummaryMode(mode) {
  _summaryMode = mode;
  const modeMap = {
    monthly: 'btnSummaryMonthly', ytd: 'btnSummaryYTD',
    q1: 'btnSummaryQ1', q2: 'btnSummaryQ2', q3: 'btnSummaryQ3', q4: 'btnSummaryQ4',
  };
  const activeId = modeMap[mode];
  _summaryBtnIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.className     = 'btn ' + (id === activeId ? 'btn-primary' : 'btn-secondary') + ' btn-sm';
    el.style.cssText = 'border-radius:0;border:none;';
  });
  
  // Enable/disable month picker based on mode
  const summaryMonthInput = document.getElementById('summaryMonth');
  if (summaryMonthInput) {
    const isMonthlyMode = mode === 'monthly';
    summaryMonthInput.disabled = !isMonthlyMode;
    summaryMonthInput.style.opacity = isMonthlyMode ? '1' : '0.5';
    summaryMonthInput.style.cursor = isMonthlyMode ? 'pointer' : 'not-allowed';
  }
}
document.getElementById('btnSummaryMonthly').addEventListener('click', () => { setSummaryMode('monthly'); });
document.getElementById('btnSummaryYTD').addEventListener('click',     () => { setSummaryMode('ytd'); });
document.getElementById('btnSummaryQ1').addEventListener('click',      () => { setSummaryMode('q1'); });
document.getElementById('btnSummaryQ2').addEventListener('click',      () => { setSummaryMode('q2'); });
document.getElementById('btnSummaryQ3').addEventListener('click',      () => { setSummaryMode('q3'); });
document.getElementById('btnSummaryQ4').addEventListener('click',      () => { setSummaryMode('q4'); });

// Initialize summary mode on page load
setSummaryMode('monthly');

