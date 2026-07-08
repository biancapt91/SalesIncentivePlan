// ===========================
// ACHIEVEMENT BOARD
// ===========================
function initAchievementBoard() {
  const assocSel = document.getElementById('ab-associate');
  const yearInp  = document.getElementById('ab-year');
  const monthSel = document.getElementById('ab-month');
  if (!assocSel) return;

  if (!yearInp.value) yearInp.value = new Date().getFullYear();

  // Populate month dropdown
  abBuildMonthOptions();

  // Get viewable employee IDs
  const viewableIds = getViewableEmployeeIds();
  const hasSubordinates = currentRole === 'sales_associate' && getSubordinateIds().length > 0;

  // Sales Associate without subordinates: hide selector and show only their data
  if (currentRole === 'sales_associate' && !hasSubordinates && currentAssociateId) {
    if (assocSel) assocSel.style.display = 'none';
    // Ensure the option exists in the select before setting value
    if (!assocSel.querySelector(`option[value="${currentAssociateId}"]`)) {
      const assocData = associates.find(a => a.employee_id === currentAssociateId);
      const opt = document.createElement('option');
      opt.value = currentAssociateId;
      opt.textContent = assocData ? assocData.full_name : currentAssociateId;
      assocSel.appendChild(opt);
    }
    assocSel.value = currentAssociateId;
    if (!assocSel._abWired) {
      assocSel._abWired = true;
      yearInp.addEventListener('change', () => { abBuildMonthOptions(); loadAchievementBoard(); });
      monthSel.addEventListener('change', loadAchievementBoard);
    }
    loadAchievementBoard();
    return;
  }

  // Admin/Supervisor/Sales Associate with subordinates: show selector
  if (assocSel) assocSel.style.display = '';

  const curVal = assocSel.value;
  assocSel.innerHTML = '<option value="">— select associate —</option>';
  
  // Filter associates based on viewable IDs
  const viewableAssociates = associates.filter(a => viewableIds.includes(a.employee_id));
  
  viewableAssociates
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'id'))
    .forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.employee_id;
      // Mark current user with "(You)"
      const label = a.employee_id === currentAssociateId 
        ? `${a.full_name} (You)` 
        : `${a.full_name} (${a.employee_id})`;
      opt.textContent = label;
      assocSel.appendChild(opt);
    });
  
  // Set default to current user if sales associate
  if (curVal && viewableIds.includes(curVal)) {
    assocSel.value = curVal;
  } else if (currentRole === 'sales_associate' && currentAssociateId) {
    assocSel.value = currentAssociateId;
  }

  if (assocSel._abWired) return;
  assocSel._abWired = true;
  assocSel.addEventListener('change', loadAchievementBoard);
  yearInp.addEventListener('change', () => { abBuildMonthOptions(); loadAchievementBoard(); });
  monthSel.addEventListener('change', loadAchievementBoard);
}

function abBuildMonthOptions() {
  const yearInp  = document.getElementById('ab-year');
  const monthSel = document.getElementById('ab-month');
  const year     = parseInt(yearInp.value) || new Date().getFullYear();
  const curYear  = new Date().getFullYear();
  const maxMon   = (year === curYear) ? NOW_MONTH : 11;
  const curVal   = monthSel.value;

  monthSel.innerHTML = '<option value="ytd">YTD</option>';
  for (let i = 0; i <= maxMon; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = MONTH_NAMES[i];
    monthSel.appendChild(opt);
  }
  // Restore selection if still valid, else default to current month
  if (curVal !== 'ytd' && parseInt(curVal) <= maxMon) {
    monthSel.value = curVal;
  } else if (curVal === 'ytd') {
    monthSel.value = 'ytd';
  } else {
    monthSel.value = maxMon;
  }
}

// Calculate quarter earnings (Q1, Q2, Q3, Q4 for each KPI)
function calculateQuarterEarnings({ monthlyBudgets, hardMax, kpiItems, dbTargets, dbActuals, level, plan, monthlyPlans }) {
  const quarterMonths = [
    ['jan', 'feb', 'mar'],
    ['apr', 'may', 'jun'],
    ['jul', 'aug', 'sep'],
    ['oct', 'nov', 'dec'],
  ];
  
  const baseKpi = KPI_TARGETS[level] || [];
  const quarterTotals = Array(4).fill(0);

  for (const it of kpiItems.filter(it2 => !it2._isParentHeader)) {
    const isCW = it.label === 'Closed Won/Consumption';
    const db = dbTargets[it.label] || {};
    const act = dbActuals[it.label] || {};
    const effectiveWeightPct = (db.weight != null) ? db.weight : it.pct;
    
    let weightFactor;
    if (it._sub) {
      const parentKpi = baseKpi.find(x => x.label === it._parent);
      const parentPct = parentKpi ? parentKpi.pct : 0;
      const subSplitPct = it._sub === 'Distributor' ? JABODETABEK_DIST_PCT : JABODETABEK_DIR_PCT;
      weightFactor = (parentPct / 100) * (subSplitPct / 100);
    } else {
      weightFactor = effectiveWeightPct / 100;
    }

    quarterMonths.forEach((months, qi) => {
      let target = 0;
      let actual = 0;
      let earned = 0;

      months.forEach(mk => {
        const m = MONTH_KEYS.indexOf(mk);
        if (m < 0 || m > hardMax) return;
        const monthTarget = db[mk] ?? 0;
        const monthActual = act[mk] ?? 0;
        const monthlyBudget = monthlyBudgets[m] || 0;
        
        target += monthTarget;
        actual += monthActual;

        if (isCW && monthTarget > 0 && monthActual >= monthTarget) {
          earned += Math.round(monthlyBudget * SIP_CW_PCT / 100);
        }
      });

      if (!isCW && target > 0) {
        const quarterAchPct = (actual / target) * 100;
        if (quarterAchPct >= 100) {
          // Sum tiered SIP per month using each month's own plan (proportional for mid-quarter plan changes)
          const tieredVal = months.reduce((sum, mk) => {
            const m = MONTH_KEYS.indexOf(mk);
            if (m < 0 || m > hardMax) return sum;
            return sum + tieredSIP(quarterAchPct, (monthlyPlans?.[m]) || plan);
          }, 0);
          const weight = it._sub
            ? ((baseKpi.find(x => x.label === it._parent)?.pct || 0) / 100) * ((it._sub === 'Distributor' ? JABODETABEK_DIST_PCT : JABODETABEK_DIR_PCT) / 100)
            : (effectiveWeightPct / 100);
          earned = Math.round(tieredVal * SIP_QUARTER_PCT / 100 * weight);
        }
      }

      quarterTotals[qi] += earned;
    });
  }

  return quarterTotals;
}

async function loadAchievementBoard() {
  const empId    = document.getElementById('ab-associate').value;
  const year     = parseInt(document.getElementById('ab-year').value) || new Date().getFullYear();
  const monthVal = document.getElementById('ab-month').value;
  const board    = document.getElementById('ab-board');
  const loading  = document.getElementById('ab-loading');

  if (!empId) { board.style.display = 'none'; loading.style.display = 'none'; return; }

  const assoc = associates.find(a => a.employee_id === empId);
  if (!assoc) return;

  board.style.display   = 'none';
  loading.style.display = '';

  try {
    const currentYear = new Date().getFullYear();
    const hardMax     = (year === currentYear) ? NOW_MONTH : 11;
    // startMonth / maxMonth define the selected range
    const isYtd       = (monthVal === 'ytd');
    const maxMonth    = isYtd ? hardMax : Math.min(parseInt(monthVal), hardMax);
    const startMonth  = isYtd ? 0 : maxMonth; // single month when not YTD

    // Per-month all-associates fetches (for rank) — only within selected range
    const monthFetches = MONTH_KEYS.slice(startMonth, maxMonth + 1).map(mk =>
      fetch(`${ACTUAL_API}?year=${year}&month_key=${mk}`).then(r => r.json())
    );

    const [tRes, aRes, hRes, ...monthResults] = await Promise.all([
      fetch(`api/kpi_targets.php?employee_id=${encodeURIComponent(empId)}&year=${year}`).then(r => r.json()),
      fetch(`${ACTUAL_API}?employee_id=${encodeURIComponent(empId)}&year=${year}`).then(r => r.json()),
      fetch(`${HIST_API}?employee_id=${encodeURIComponent(empId)}`).then(r => r.json()),
      ...monthFetches,
    ]);

    // Parse targets: component → { weight, jan..dec }
    const dbTargets = {};
    if (tRes.success) tRes.data.forEach(r => { dbTargets[r.component] = r; });

    // Parse actuals for this associate: component → { jan..dec }
    const dbActuals = {};
    if (aRes.success) aRes.data.forEach(r => { dbActuals[r.component] = r; });

    // Monthly budgets from employment history
    const histSorted = hRes.success
      ? [...hRes.data].sort((a, b) => a.effective_date.localeCompare(b.effective_date))
      : [];
    const monthlyBudgets = MONTH_KEYS.map((_, m) => {
      const lastDay  = new Date(year, m + 1, 0).getDate();
      const monthEnd = `${year}-${String(m + 1).padStart(2, '0')}-${lastDay}`;
      let applicable = null;
      for (const h of histSorted) { if (h.effective_date <= monthEnd) applicable = h; }
      return applicable ? applicable.sip_budget : (assoc.sip_budget_current || 0);
    });

    const monthlyLevels = MONTH_KEYS.map((_, m) => {
      const lastDay  = new Date(year, m + 1, 0).getDate();
      const monthEnd = `${year}-${String(m + 1).padStart(2, '0')}-${lastDay}`;
      let applicable = null;
      for (const h of histSorted) { if (h.effective_date <= monthEnd) applicable = h; }
      return applicable?.level || assoc.level;
    });

    const monthlyPlans = MONTH_KEYS.map((_, m) => {
      const lastDay  = new Date(year, m + 1, 0).getDate();
      const monthEnd = `${year}-${String(m + 1).padStart(2, '0')}-${lastDay}`;
      let applicable = null;
      for (const h of histSorted) { if (h.effective_date <= monthEnd) applicable = h; }
      return applicable?.plan || assoc.plan;
    });

    // (payMap removed)

    const kpiItems = getKpiItems(assoc.level, assoc.detail_area) || [];

    // Compute per-month SIP earned for this associate (selected range, used for stats/rank)
    const monthlySIP = [];
    for (let m = startMonth; m <= maxMonth; m++) {
      const mk     = MONTH_KEYS[m];
      const budget = monthlyBudgets[m];
      const actMap = {};
      for (const it of kpiItems) {
        if (it._isParentHeader) continue;
        const db  = dbTargets[it.label] || {};
        const act = dbActuals[it.label] || {};
        actMap[it.label] = { target_val: db[mk] ?? 0, actual_val: act[mk] ?? 0, weight: db.weight ?? null };
      }
      monthlySIP[m] = computeSIPEarned(budget, monthlyLevels[m], assoc.detail_area, actMap, assoc.plan);
    }

    // Compute per-month SIP for ALL months Jan..hardMax (for timeline)
    const allMonthlySIP = [];
    for (let m = 0; m <= hardMax; m++) {
      if (m >= startMonth && m <= maxMonth && monthlySIP[m] !== undefined) {
        allMonthlySIP[m] = monthlySIP[m]; // reuse already computed
      } else {
        const mk     = MONTH_KEYS[m];
        const budget = monthlyBudgets[m];
        const actMap = {};
        for (const it of kpiItems) {
          if (it._isParentHeader) continue;
          const db  = dbTargets[it.label] || {};
          const act = dbActuals[it.label] || {};
          actMap[it.label] = { target_val: db[mk] ?? 0, actual_val: act[mk] ?? 0, weight: db.weight ?? null };
        }
        allMonthlySIP[m] = computeSIPEarned(budget, monthlyLevels[m], assoc.detail_area, actMap, assoc.plan);
      }
    }

    // KPI totals per component (for selected range)
    const kpiYtd = {};
    for (const it of kpiItems) {
      if (it._isParentHeader) continue;
      const db  = dbTargets[it.label] || {};
      const act = dbActuals[it.label] || {};
      let tSum = 0, aSum = 0;
      for (let m = startMonth; m <= maxMonth; m++) {
        tSum += db[MONTH_KEYS[m]] ?? 0;
        aSum += act[MONTH_KEYS[m]] ?? 0;
      }
      kpiYtd[it.label] = { target: tSum, actual: aSum, weight: (db.weight != null) ? db.weight : it.pct };
    }

    // Compute rank from per-month all-associates data (within selected range)
    const allEmpSIP = {};
    for (let i = 0; i < monthResults.length; i++) {
      const monthData = monthResults[i];
      if (!monthData || !monthData.success) continue;
      const empRows = {};
      for (const r of monthData.data) {
        if (!empRows[r.employee_id]) empRows[r.employee_id] = {};
        empRows[r.employee_id][r.component] = { target_val: r.target_val, actual_val: r.actual_val, weight: r.weight };
      }
      for (const [id, compMap] of Object.entries(empRows)) {
        const a2 = associates.find(x => x.employee_id === id);
        if (!a2) continue;
        allEmpSIP[id] = (allEmpSIP[id] || 0) + computeSIPEarned(a2.sip_budget_current || 0, a2.level, a2.detail_area, compMap, a2.plan);
      }
    }
    const periodTotal = monthlySIP.reduce((s, v) => s + (v || 0), 0);
    allEmpSIP[empId]  = periodTotal;
    const rankList    = Object.values(allEmpSIP).sort((a, b) => b - a);
    const rank        = rankList.indexOf(periodTotal) + 1;
    const totalRanked = rankList.length;

    // Calculate quarter earnings
    const quarterEarnings = calculateQuarterEarnings({
      monthlyBudgets,
      hardMax,
      kpiItems,
      dbTargets,
      dbActuals,
      level: assoc.level,
      plan: assoc.plan,
      monthlyPlans,
    });
    const quarterTotal = quarterEarnings.reduce((s, v) => s + v, 0);

    // YTD totals — monthly + quarter bonus (always Jan..hardMax, unaffected by month filter)
    const monthlyTotal = allMonthlySIP.reduce((s, v) => s + (v || 0), 0);
    const ytdTotal    = monthlyTotal + quarterTotal;
    const ytdBudget   = monthlyBudgets.slice(0, hardMax + 1).reduce((s, v) => s + v, 0);

    // Build allAchData from monthResults for rank filter
    const empAchMap = {};
    for (let i = 0; i < monthResults.length; i++) {
      const monthData = monthResults[i];
      if (!monthData?.success) continue;
      for (const r of monthData.data) {
        if (!empAchMap[r.employee_id]) empAchMap[r.employee_id] = { components: {} };
        const comps = empAchMap[r.employee_id].components;
        if (!comps[r.component]) comps[r.component] = { actual: 0, target: 0 };
        comps[r.component].actual += r.actual_val || 0;
        comps[r.component].target += r.target_val || 0;
      }
    }
    const allAchData = Object.entries(empAchMap).map(([id, d]) => {
      let sum = 0, cnt = 0, salesAct = 0, cwAct = 0;
      for (const [comp, cv] of Object.entries(d.components)) {
        if (cv.target <= 0) continue;
        sum += comp === 'Closed Won/Consumption'
          ? (cv.actual >= cv.target ? 100 : cv.actual / cv.target * 100)
          : cv.actual / cv.target * 100;
        cnt++;
        if (comp === 'Closed Won/Consumption') cwAct += cv.actual; else salesAct += cv.actual;
      }
      const cwComp    = d.components['Closed Won/Consumption'];
      const cwPctVal  = cwComp && cwComp.target > 0 ? Math.min(Math.round(cwComp.actual / cwComp.target * 100), 999) : 0;
      const salesComps = Object.entries(d.components).filter(([c]) => c !== 'Closed Won/Consumption');
      const salesPctVal = salesComps.length
        ? Math.round(salesComps.reduce((s, [, cv]) => s + (cv.target > 0 ? cv.actual / cv.target * 100 : 0), 0) / salesComps.length)
        : 0;
      return { employee_id: id, avgPct: cnt > 0 ? sum / cnt : 0,
        salesActual: salesAct, cwActual: cwAct, cwPct: cwPctVal, salesPct: salesPctVal,
        sip: allEmpSIP[id] || 0 };
    });
    // Build kpiEmpMap: component → [{employee_id, level, detail_area, pct, actual, target}]
    const kpiEmpMap = {};
    for (const [id2, d] of Object.entries(empAchMap)) {
      const assoc2 = associates.find(a => a.employee_id === id2);
      const area2  = assoc2?.detail_area || '';
      const lvl2   = assoc2?.level || '';
      const cat2   = assoc2?.category || '';
      for (const [comp, cv] of Object.entries(d.components)) {
        if (cv.target <= 0) continue;
        if (JABODETABEK_SPLIT_LABELS.has(comp) && isJabodetabek(area2)) continue;
        if (!kpiEmpMap[comp]) kpiEmpMap[comp] = [];
        kpiEmpMap[comp].push({ employee_id: id2, level: lvl2, detail_area: area2, category: cat2, pct: (cv.actual / cv.target) * 100, actual: cv.actual, target: cv.target });
      }
    }
    _abRankState = { empId, myLevel: assoc.level || '', myArea: assoc.detail_area || '', myCategory: assoc.category || '', allAchData, kpiEmpMap };

    // Render
    abRenderInfoStrip(assoc, year, startMonth, maxMonth, isYtd);
    abRenderKpiChart(kpiItems, dbTargets, dbActuals, year, hardMax);
    abRenderStats({ ytdTotal, ytdBudget, hardMax, year });
    abRenderRankBanner();
    abRenderTimeline({ monthlySIP: allMonthlySIP, monthlyBudgets, monthlyPlans, year, maxMonth: hardMax, kpiItems, dbTargets, dbActuals, level: assoc.level, plan: assoc.plan });
    abRenderQuarterOverview({ monthlySIP: allMonthlySIP, monthlyBudgets, monthlyPlans, year, maxMonth: hardMax, kpiItems, dbTargets, dbActuals, level: assoc.level, plan: assoc.plan });

    loading.style.display = 'none';
    board.style.display   = '';
  } catch(e) {
    loading.style.display = 'none';
    board.style.display   = '';
    document.getElementById('ab-kpi-grid').innerHTML =
      `<div class="card" style="padding:24px;color:var(--red);">Error: ${e.message}</div>`;
  }
}

function abRenderKpiChart(kpiItems, dbTargets, dbActuals, year, hardMax) {
  const items = kpiItems.filter(it => !it._isParentHeader);
  const n = hardMax + 1; // total months to display (always full year up to hardMax)

  const W = 700, H = 310, ML = 60, MB = 70, MT = 20, MR = 10;
  const chartW = W - ML - MR;
  const chartH = H - MB - MT;
  const grpW   = chartW / n;
  const bW     = Math.min(Math.floor(grpW * 0.68), 38);

  const fmtY = v => {
    if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(0) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
    return v.toFixed(0);
  };

  const charts = items.map(it => {
    const db  = dbTargets[it.label] || {};
    const act = dbActuals[it.label] || {};
    const col = getKpiColor(it.label) || { bg: '#f8fafc', border: '#3b82f6' };
    const labelDisp = it._sub ? `${it._parent} · ${it._sub}` : it.label;

    const targets = MONTH_KEYS.slice(0, n).map(mk => db[mk] ?? 0);
    const actuals = MONTH_KEYS.slice(0, n).map(mk => act[mk] ?? 0);
    const maxVal  = Math.max(...targets, ...actuals, 1);

    // Y-axis ticks (5 levels: 0, 25%, 50%, 75%, 100%)
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => ({
      label: fmtY(maxVal * f),
      y: MT + chartH - f * chartH,
    }));

    let svg = '';

    // Grid lines + Y-axis labels
    ticks.forEach(({ label, y }) => {
      svg += `<line x1="${ML}" y1="${y.toFixed(1)}" x2="${W - MR}" y2="${y.toFixed(1)}" stroke="#f1f5f9" stroke-width="1"/>`;
      svg += `<text x="${ML - 5}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="16" fill="#94a3b8">${label}</text>`;
    });

    // Axis lines
    svg += `<line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT + chartH}" stroke="#e2e8f0" stroke-width="1"/>`;
    svg += `<line x1="${ML}" y1="${MT + chartH}" x2="${W - MR}" y2="${MT + chartH}" stroke="#e2e8f0" stroke-width="1"/>`;

    // Bars + month labels
    for (let i = 0; i < n; i++) {
      const cx   = ML + grpW * i + grpW / 2;
      const tVal = targets[i];
      const aVal = actuals[i];
      const tH   = tVal > 0 ? Math.max(tVal / maxVal * chartH, 2) : 0;
      const aH   = aVal > 0 ? Math.max(aVal / maxVal * chartH, 2) : 0;
      const tY   = MT + chartH - tH;
      const aY   = MT + chartH - aH;
      const pct  = tVal > 0 ? (aVal / tVal * 100) : 0;
      const aClr = tVal <= 0 ? '#94a3b8' : (pct >= 100 ? '#16a34a' : pct >= 85 ? '#f59e0b' : '#ef4444');

      if (tH > 0) svg += `<rect x="${(cx - bW - 1).toFixed(1)}" y="${tY.toFixed(1)}" width="${bW}" height="${tH.toFixed(1)}" fill="#cbd5e1" rx="2"/>`;
      if (aH > 0) svg += `<rect x="${(cx + 1).toFixed(1)}" y="${aY.toFixed(1)}" width="${bW}" height="${aH.toFixed(1)}" fill="${aClr}" rx="2" opacity="0.9"/>`;

      // Value labels rotated inside bars (only if bar tall enough)
      const tCx = cx - bW / 2 - 1, aCx = cx + 1 + bW / 2;
      if (tH > 18) {
        const ty = tY + tH / 2;
        svg += `<text x="${tCx.toFixed(1)}" y="${ty.toFixed(1)}" dominant-baseline="middle" text-anchor="middle" font-size="16" fill="#475569" transform="rotate(-90,${tCx.toFixed(1)},${ty.toFixed(1)})">${tVal.toLocaleString('id-ID')}</text>`;
      } else if (tH > 0) {
        svg += `<text x="${tCx.toFixed(1)}" y="${(tY - 3).toFixed(1)}" dominant-baseline="auto" text-anchor="middle" font-size="16" fill="#94a3b8">${tVal.toLocaleString('id-ID')}</text>`;
      }
      if (aH > 18) {
        const ay2 = aY + aH / 2;
        svg += `<text x="${aCx.toFixed(1)}" y="${ay2.toFixed(1)}" dominant-baseline="middle" text-anchor="middle" font-size="16" fill="#fff" transform="rotate(-90,${aCx.toFixed(1)},${ay2.toFixed(1)})">${formatActual(aVal)}</text>`;
      } else if (aH > 0) {
        svg += `<text x="${aCx.toFixed(1)}" y="${(aY - 3).toFixed(1)}" dominant-baseline="auto" text-anchor="middle" font-size="16" fill="${aClr}">${formatActual(aVal)}</text>`;
      }

      // % label above the taller bar
      const topY = MT + chartH - Math.max(tH, aH) - 5;
      const pctLabel = tVal > 0 ? `${pct.toFixed(2)}%` : '—';
      svg += `<text x="${cx.toFixed(1)}" y="${topY.toFixed(1)}" text-anchor="middle" font-size="16" font-weight="700" fill="${aClr}">${pctLabel}</text>`;

      // Month label
      svg += `<text x="${cx.toFixed(1)}" y="${(MT + chartH + 14).toFixed(1)}" text-anchor="middle" font-size="16" fill="#64748b">${MONTH_NAMES[i].slice(0, 3)}</text>`;
    
    }

    // Quarterly achievement summary
    const isCW       = it.label === 'Closed Won/Consumption';
    const Q_MONTHS   = [[0,1,2],[3,4,5],[6,7,8],[9,10,11]];
    const quarterHtml = Q_MONTHS.map((months, qi) => {
      const qLabel  = `Q${qi + 1}`;
      const qTarget = months.reduce((s, m) => s + (db[MONTH_KEYS[m]] ?? 0), 0);
      const qActual = months.reduce((s, m) => s + (act[MONTH_KEYS[m]] ?? 0), 0);
      if (qTarget <= 0) {
        return `<div class="ab-kpi-q-card ab-kpi-q-na"><div class="ab-kpi-q-label">${qLabel}</div><div class="ab-kpi-q-pct">—</div><div class="ab-kpi-q-detail">No target</div></div>`;
      }
      const qPct     = qActual / qTarget * 100;
      const met      = qActual >= qTarget;
      const pctColor = met ? '#16a34a' : (qPct >= 85 ? '#f59e0b' : '#ef4444');
      const needMore = Math.max(0, qTarget - qActual);
      const needHtml = met
        ? `<div class="ab-kpi-q-need" style="color:#16a34a;"><i class="fa-solid fa-circle-check" style="margin-right:3px;"></i>Target Achieved</div>`
        : `<div class="ab-kpi-q-need">Need <strong>${needMore.toLocaleString('id-ID')}</strong> more</div>`;
      if (isCW) {
        return `<div class="ab-kpi-q-card">
          <div class="ab-kpi-q-label">${qLabel}</div>
          <div class="ab-kpi-q-pct" style="color:${pctColor};">${met ? '<i class="fa-solid fa-circle-check" style="margin-right:3px;"></i>Met' : '<i class="fa-solid fa-circle-xmark" style="margin-right:3px;"></i>Not Met'}</div>
          <div class="ab-kpi-q-detail"><span>A: <b>${formatActual(qActual)}</b></span><span>T: <b>${qTarget.toLocaleString('id-ID')}</b></span></div>
          ${needHtml}
        </div>`;
      }
      return `<div class="ab-kpi-q-card">
        <div class="ab-kpi-q-label">${qLabel}</div>
        <div class="ab-kpi-q-pct" style="color:${pctColor};">${qPct.toFixed(2)}%</div>
        <div class="ab-kpi-q-detail"><span>A: <b>${formatActual(qActual)}</b></span><span>T: <b>${qTarget.toLocaleString('id-ID')}</b></span></div>
        ${needHtml}
      </div>`;
    }).join('');

    return `<div class="ab-kpi-chart-card" style="border-top:3px solid ${col.border};background:#fff;">
  <div class="ab-kpi-chart-header">
    <span class="ab-kpi-chart-title">${labelDisp}</span>
    <span class="ab-kpi-chart-legend">
      <span class="ab-kpi-chart-dot" style="background:#cbd5e1;"></span>Target
      <span class="ab-kpi-chart-dot" style="background:#16a34a;"></span>&#x2265;100%
      <span class="ab-kpi-chart-dot" style="background:#f59e0b;"></span>&#x2265;85%
      <span class="ab-kpi-chart-dot" style="background:#ef4444;"></span>&lt;85%
    </span>
  </div>
  <svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block;" aria-hidden="true">${svg}</svg>
  ${!isCW ? `<div class="ab-kpi-quarter-row">${quarterHtml}</div>` : ''}
</div>`;
  });

  document.getElementById('ab-kpi-chart').innerHTML = charts.join('');
}

function abRenderInfoStrip(assoc, year, startMonth, maxMonth, isYtd) {
  let periodLabel;
  if (isYtd) {
    periodLabel = startMonth === maxMonth
      ? `${MONTH_NAMES[maxMonth]} ${year}`
      : `Jan – ${MONTH_NAMES[maxMonth]} ${year}`;
  } else {
    periodLabel = `${MONTH_NAMES[maxMonth]} ${year}`;
  }
  document.getElementById('ab-info-strip').innerHTML = `
    <div class="ab-info-row">
      <div class="ab-info-item">
        <span class="ab-info-lbl">Associate</span>
        <span class="ab-info-val"><strong>${assoc.full_name}</strong></span>
      </div>
      <div class="ab-info-item">
        <span class="ab-info-lbl">ID</span>
        <span class="ab-info-val"><code style="background:#f1f5f9;border-radius:4px;font-size:12px;">${assoc.employee_id}</code></span>
      </div>
      <div class="ab-info-item">
        <span class="ab-info-lbl">Position</span>
        <span class="ab-info-val">${assoc.position || '—'}</span>
      </div>
      <div class="ab-info-item">
        <span class="ab-info-lbl">Level</span>
        <span class="ab-info-val"><span class="badge ${getLevelBadge(assoc.level)}"><style="text align: left">${assoc.level || '—'}</style></span></span>
      </div>
      <div class="ab-info-item">
        <span class="ab-info-lbl">Category</span>
        <span class="ab-info-val">${assoc.category || '—'}</span>
      </div>
      <div class="ab-info-item">
        <span class="ab-info-lbl">Detail Area</span>
        <span class="ab-info-val">${assoc.detail_area || '—'}</span>
      </div>
      <div class="ab-info-item">
        <span class="ab-info-lbl">Period</span>
        <span class="ab-info-val">${periodLabel}</span>
      </div>
    </div>`;
}

function abRenderKpiCards(kpiItems, kpiYtd, level) {
  const baseKpi = KPI_TARGETS[level] || [];
  const cards   = kpiItems.filter(it => !it._isParentHeader).map(it => {
    const ytd  = kpiYtd[it.label] || { target: 0, actual: 0, weight: 0 };
    const col  = getKpiColor(it.label) || { bg: '#f8fafc', border: '#cbd5e1' };
    const isCW = it.label === 'Closed Won/Consumption';

    let weightDisp;
    if (it._sub) {
      const parentKpi = baseKpi.find(x => x.label === it._parent);
      const pPct = parentKpi ? parentKpi.pct : 0;
      const sPct = it._sub === 'Distributor' ? JABODETABEK_DIST_PCT : JABODETABEK_DIR_PCT;
      weightDisp = `${pPct}% × ${sPct}%`;
    } else {
      weightDisp = `${ytd.weight}%`;
    }

    const labelDisp = it._sub ? `${it._parent}<br><small>↳ ${it._sub}</small>` : it.label;

    if (isCW) {
      const met      = ytd.target > 0 && ytd.actual >= ytd.target;
      const notSet   = ytd.target <= 0;
      const pctVal   = ytd.target > 0 ? (ytd.actual / ytd.target * 100) : 0;
      const barW     = Math.min(pctVal, 100);
      const pctColor = notSet ? '#94a3b8' : (met ? '#16a34a' : '#dc2626');
      const pctText  = notSet ? '—' : (met ? '<i class="fa-solid fa-circle-check" style="margin-right:3px;"></i>Met' : `${pctVal.toFixed(2)}%`);
      return `<div class="ab-kpi-card" style="border-top:3px solid ${col.border};background:${col.bg};">
        <div class="ab-kpi-header">
          <span class="ab-kpi-name">${labelDisp}</span>
          <span class="ab-kpi-weight">${weightDisp}</span>
        </div>
        <div class="ab-kpi-pct" style="color:${pctColor};">${pctText}</div>
        <div class="ab-kpi-bar-wrap">
          <div class="ab-kpi-bar-fill" style="width:${barW}%;background:${pctColor};"></div>
        </div>
        <div class="ab-kpi-nums">
          <span>Actual: <strong>${formatActual(ytd.actual)}</strong></span>
          <span>Target: <strong>${ytd.target > 0 ? ytd.target.toLocaleString('id-ID') : '—'}</strong></span>
        </div>
      </div>`;
    }

    const pct      = ytd.target > 0 ? (ytd.actual / ytd.target * 100) : 0;
    const barW     = Math.min(pct / 150 * 100, 100); // 100% target at 2/3 of bar width
    const pctColor = ytd.target <= 0 ? '#94a3b8' : (pct >= 100 ? '#16a34a' : pct >= 85 ? '#f59e0b' : '#dc2626');
    const pctText  = ytd.target > 0 ? `${pct.toFixed(2)}%` : '—';

    return `<div class="ab-kpi-card" style="border-top:3px solid ${col.border};background:${col.bg};">
      <div class="ab-kpi-header">
        <span class="ab-kpi-name">${labelDisp}</span>
        <span class="ab-kpi-weight">${weightDisp}</span>
      </div>
      <div class="ab-kpi-pct" style="color:${pctColor};">${pctText}</div>
      <div class="ab-kpi-bar-wrap">
        <div class="ab-kpi-bar-fill" style="width:${barW}%;background:${pctColor};"></div>
        <div class="ab-kpi-bar-100" title="100% target"></div>
      </div>
      <div class="ab-kpi-nums">
        <span>Actual: <strong>${formatActual(ytd.actual)}</strong></span>
        <span>Target: <strong>${ytd.target > 0 ? ytd.target.toLocaleString('id-ID') : '—'}</strong></span>
      </div>
    </div>`;
  });

  document.getElementById('ab-kpi-grid').innerHTML = cards.join('');
}

function abRenderStats({ ytdTotal, ytdBudget, hardMax, year }) {
  const ytdPct = ytdBudget > 0 ? Math.round(ytdTotal / ytdBudget * 100) : 0;
  document.getElementById('ab-val-yearly').textContent = formatRupiah(ytdTotal);
  document.getElementById('ab-sub-yearly').textContent = `${ytdPct}% of YTD budget · Jan – ${MONTH_NAMES[hardMax]} ${year}`;
}

function abRenderRankBanner() {
  if (!_abRankState) return;
  const { empId, myLevel, myArea, myCategory, kpiEmpMap } = _abRankState;

  const filterEl = document.getElementById('ab-rank-filter');
  if (!filterEl) return;

  // Merge "Area Sales Leader - Distributor" into "Area Sales Leader" so they compete together
  if (kpiEmpMap['Area Sales Leader - Distributor']) {
    if (kpiEmpMap['Area Sales Leader']) {
      kpiEmpMap['Area Sales Leader'] = [
        ...kpiEmpMap['Area Sales Leader'],
        ...kpiEmpMap['Area Sales Leader - Distributor']
      ];
    } else {
      kpiEmpMap['Area Sales Leader'] = kpiEmpMap['Area Sales Leader - Distributor'];
    }
    delete kpiEmpMap['Area Sales Leader - Distributor'];
  }
  // Merge "Individual Sales Non-Leader - Distributor" into "Individual Sales Non-Leader" so they compete together
  if (kpiEmpMap['Individual Sales Non-Leader - Distributor']) {
    if (kpiEmpMap['Individual Sales Non-Leader']) {
      kpiEmpMap['Individual Sales Non-Leader'] = [
        ...kpiEmpMap['Individual Sales Non-Leader'],
        ...kpiEmpMap['Individual Sales Non-Leader - Distributor']
      ];
    } else {
      kpiEmpMap['Individual Sales Non-Leader'] = kpiEmpMap['Individual Sales Non-Leader - Distributor'];
    }
    delete kpiEmpMap['Individual Sales Non-Leader - Distributor'];
  }

  // Ordered list of KPI components available
  const KPI_RANK_ORDER = [
    'Individual Sales Leader',
    'Individual Sales Leader - Distributor', 'Individual Sales Leader - Direct',
    'Area Sales Leader',
    'Individual Sales Non-Leader', 'Area Sales TAC', 'Key Customer',
    'Closed Won/Consumption',
  ];
  const comps = Object.keys(kpiEmpMap)
    .filter(comp => kpiEmpMap[comp].some(d => d.employee_id === empId))
    .sort((a, b) => {
      const ia = KPI_RANK_ORDER.indexOf(a), ib = KPI_RANK_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

  // Rebuild filter buttons if components changed
  const existingBtns = [...filterEl.querySelectorAll('.ach-filter-btn')];
  const needRebuild  = existingBtns.length !== comps.length ||
    !comps.every((c, i) => existingBtns[i]?.dataset.kpi === c);

  if (needRebuild) {
    const shortLabel = comp => comp
      .replace('Individual Sales Leader', 'Ind. Sales')
      .replace('Individual Sales Non-Leader', 'Ind. Sales Non-Leader')
      .replace('Closed Won/Consumption', 'Closed Won/Consump.')
      .replace(' - Distributor', ' Dist.')
      .replace(' - Direct', ' Dir.');

    // Add checkboxes for All Level / All Area / All Category above the KPI buttons
    filterEl.innerHTML = `
      <div style="margin-bottom:8px; color:#FFFFFF;">
        <label style="margin-right:12px;"><input type="checkbox" id="ab-filter-all-level" checked /> All Level</label>
        <label style="margin-right:12px;"><input type="checkbox" id="ab-filter-all-area" checked /> All Area</label>
        <label><input type="checkbox" id="ab-filter-all-category" checked /> All Category</label>
      </div>
    ` + comps.map((comp, i) =>
      `<button class="ach-filter-btn${i === 0 ? ' active' : ''}" data-kpi="${comp}">${shortLabel(comp)}</button>`
    ).join('');

    filterEl.querySelectorAll('.ach-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        filterEl.querySelectorAll('.ach-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        abRenderRankBanner();
      });
    });

    const cbAllLevel = filterEl.querySelector('#ab-filter-all-level');
    const cbAllArea  = filterEl.querySelector('#ab-filter-all-area');
    const cbAllCategory = filterEl.querySelector('#ab-filter-all-category');
    if (cbAllLevel) cbAllLevel.addEventListener('change', abRenderRankBanner);
    if (cbAllArea)  cbAllArea.addEventListener('change', abRenderRankBanner);
    if (cbAllCategory) cbAllCategory.addEventListener('change', abRenderRankBanner);
  }

  const activeBtn = filterEl.querySelector('.ach-filter-btn.active');
  const comp      = activeBtn?.dataset.kpi ?? comps[0];
  if (!comp) return;

  // Respect "All Level" / "All Area" / "All Category" checkboxes (if present)
  const cbAllLevel = filterEl.querySelector('#ab-filter-all-level');
  const cbAllArea  = filterEl.querySelector('#ab-filter-all-area');
  const cbAllCategory = filterEl.querySelector('#ab-filter-all-category');
  const allLevelChecked = cbAllLevel ? cbAllLevel.checked : false;
  const allAreaChecked  = cbAllArea  ? cbAllArea.checked  : false;
  const allCategoryChecked = cbAllCategory ? cbAllCategory.checked : false;

  const employees = (kpiEmpMap[comp] || []).filter(d =>
    (allCategoryChecked || d.category === myCategory) &&
    (allLevelChecked || d.level === myLevel) &&
    (allAreaChecked  || d.detail_area === myArea)
  );
  const ranked    = [...employees].sort((a, b) => b.pct - a.pct);
  const myIdx     = ranked.findIndex(d => d.employee_id === empId);
  const rank      = myIdx + 1;
  const total     = ranked.length;
  const myPct     = myIdx >= 0 ? ranked[myIdx].pct : 0;
  const medal     = '';  // rank shown via #N notation; emoji removed (cross-platform rendering)

  document.getElementById('ab-val-rank').textContent = total > 0 && rank > 0 ? `${medal}#${rank} of ${total}` : '—';
  document.getElementById('ab-sub-rank').textContent = `by ${comp} achievement %`;
  const valEl = document.getElementById('ab-rank-myval');
  if (valEl) valEl.textContent = total > 0 && rank > 0 ? `${myPct.toFixed(2)}%` : '';

  // Animated character
  const charEl = document.getElementById('ab-rank-char-area');
  if (!charEl) return;
  if (!total || !rank) { charEl.innerHTML = ''; return; }

  let imgSrc, animClass, message;
  if (rank <= 3) {
    animClass = 'ab-char-bounce';
    imgSrc    = 'img/Richy - rank 1 to 3.png';
    message   = "Congratulations! You're leading the way. Keep shining and stay unstoppable!";
  } else if (rank <= 10) {
    animClass = 'ab-char-pulse';
    imgSrc    = 'img/Richy - rank 4 to 10.png';
    message   = "Keep it up! You're almost there! Success is within reach!";
  } else if (rank <= 20) {
    animClass = 'ab-char-float';
    imgSrc    = 'img/Richy - rank 11 to 20.png';
    message   = "You're making strong progress! Keep growing and rise higher!";
  } else {
    animClass = 'ab-char-sway';
    imgSrc    = 'img/Richy - rank upper 20.png';
    message   = "Don't give up! Every champion starts with a single step.";
  }

  charEl.innerHTML = `
    <div class="ab-char-figure ${animClass}"><img src="${imgSrc}" alt="Richy" style="height:100%;max-height:220px;width:auto;display:block;"></div>
    <div class="ab-char-bubble">${message}</div>`;
}

function abRenderQuarterOverview({ monthlySIP, monthlyBudgets, monthlyPlans, year, maxMonth, kpiItems, dbTargets, dbActuals, level, plan }) {
  const body = document.getElementById('ab-quarter-body');
  if (!body) return;

  const baseKpi = KPI_TARGETS[level] || [];
  const fmtR = v => (v > 0 ? formatRupiah(v) : '—');
  const fmtN = v => (v > 0 ? v.toLocaleString('id-ID') : '—');
  const fmtActualN = v => (v > 0 ? formatActual(v) : '—');

  if (!kpiItems || kpiItems.length === 0) {
    body.innerHTML = '<div style="padding:24px;color:var(--text-muted);text-align:center;">No KPI data available.</div>';
    return;
  }

  const quarterMonths = [
    ['jan', 'feb', 'mar'],
    ['apr', 'may', 'jun'],
    ['jul', 'aug', 'sep'],
    ['oct', 'nov', 'dec'],
  ];

  const quarterLabels = ['Q1 (Jan–Mar)', 'Q2 (Apr–Jun)', 'Q3 (Jul–Sep)', 'Q4 (Oct–Dec)'];

  const quarterTotals = Array(quarterLabels.length).fill(0);
  let tableRows = '';
  for (const it of kpiItems.filter(it2 => !it2._isParentHeader && it2.label !== 'Closed Won/Consumption')) {
    const isCW = it.label === 'Closed Won/Consumption';
    const db = dbTargets[it.label] || {};
    const act = dbActuals[it.label] || {};
    const col = getKpiColor(it.label) || { bg: '#f8fafc', border: '#64748b' };

    const effectiveWeightPct = (db.weight != null) ? db.weight : it.pct;
    let weightFactor;
    if (it._sub) {
      const parentKpi = baseKpi.find(x => x.label === it._parent);
      const parentPct = parentKpi ? parentKpi.pct : 0;
      const subSplitPct = it._sub === 'Distributor' ? JABODETABEK_DIST_PCT : JABODETABEK_DIR_PCT;
      weightFactor = (parentPct / 100) * (subSplitPct / 100);
    } else {
      weightFactor = effectiveWeightPct / 100;
    }

    const quarterData = quarterMonths.map((months, qi) => {
      let budget = 0;
      let target = 0;
      let actual = 0;
      let tieredVal = 0;
      let earned = 0;
      // (plan resolved per-month in tiered calc below — no single quarterPlan needed)

      months.forEach(mk => {
        const m = MONTH_KEYS.indexOf(mk);
        if (m < 0 || m > maxMonth) return;
        const monthlyBudget = monthlyBudgets[m] || 0;
        const monthTarget = db[mk] ?? 0;
        const monthActual = act[mk] ?? 0;
        target += monthTarget;
        actual += monthActual;

        if (isCW) {
          budget += monthlyBudget * SIP_CW_PCT / 100;
          if (monthTarget > 0 && monthActual >= monthTarget) {
            earned += Math.round(monthlyBudget * SIP_CW_PCT / 100);
          }
        } else {
          const weight = it._sub
            ? ((baseKpi.find(x => x.label === it._parent)?.pct || 0) / 100) * ((it._sub === 'Distributor' ? JABODETABEK_DIST_PCT : JABODETABEK_DIR_PCT) / 100)
            : (effectiveWeightPct / 100);
          budget += monthlyBudget * SIP_QUARTER_PCT / 100 * weight;
        }
      });

      if (!isCW && target > 0) {
        const quarterAchPct = (actual / target) * 100;
        const weight = it._sub
          ? ((baseKpi.find(x => x.label === it._parent)?.pct || 0) / 100) * ((it._sub === 'Distributor' ? JABODETABEK_DIST_PCT : JABODETABEK_DIR_PCT) / 100)
          : (effectiveWeightPct / 100);

        if (quarterAchPct >= 100) {
          // Sum tiered SIP per included month using each month's own plan
          tieredVal = months.reduce((sum, mk) => {
            const m = MONTH_KEYS.indexOf(mk);
            if (m < 0 || m > maxMonth) return sum;
            return sum + tieredSIP(quarterAchPct, (monthlyPlans?.[m]) || plan);
          }, 0);
          earned = Math.round(tieredVal * SIP_QUARTER_PCT / 100 * weight);
        } else {
          tieredVal = 0;
          earned = 0;
        }
      }

      quarterTotals[qi] += earned;

      return { label: quarterLabels[qi], budget, target, actual, tieredVal, earned, qIdx: qi };
    });

    const kpiLabel = it._sub ? `${it._parent}<br><small style="font-weight:400;opacity:.75;font-size:10px;">↳ ${it._sub}</small>` : it.label;

    tableRows += `<tr>
      <td class="ab-ov-kpi-name" rowspan="8" style="border-left:4px solid ${col.border};vertical-align:top;padding:5px 8px;font-size:12px;font-weight:600;">${kpiLabel}</td>
      <td class="ab-ov-sublabel" style="color:#26bd71;padding:5px 8px;font-size:12px;font-weight:600;">SIP Quarter Budget per KPI</td>
      ${quarterData.map(q => `<td class="ab-ov-cell" style="color:#26bd71;text-align:right;padding:10px 8px;font-size:12px;">${fmtR(q.budget)}</td>`).join('')}
    </tr>`;
    tableRows += `<tr><td class="ab-ov-sublabel" style="padding:5px 8px;font-size:12px;font-weight:600;">Target</td>${quarterData.map(q => `<td class="ab-ov-cell" style="text-align:right;padding:5px 8px;font-size:12px;">${fmtN(q.target)}</td>`).join('')}</tr>`;
    tableRows += `<tr><td class="ab-ov-sublabel" style="padding:5px 8px;font-size:12px;font-weight:600;">Actual</td>${quarterData.map(q => `<td class="ab-ov-cell" style="text-align:right;padding:5px 8px;font-size:12px;">${fmtActualN(q.actual)}</td>`).join('')}</tr>`;
    tableRows += `<tr><td class="ab-ov-sublabel" style="padding:5px 8px;font-size:12px;font-weight:600;">% Achievement</td>${quarterData.map(q => {
      if (q.target <= 0) return `<td class="ab-ov-cell" style="text-align:right;padding:10px 8px;font-size:12px;color:#94a3b8;">—</td>`;
      const pct = (q.actual / q.target) * 100;
      const clr = pct >= 100 ? '#16a34a' : pct >= 85 ? '#b45309' : '#dc2626';
      const bg = pct >= 100 ? '#dcfce7' : pct >= 85 ? '#fef3c7' : '#fee2e2';
      return `<td class="ab-ov-cell" style="text-align:right;padding:5px 8px;font-size:12px;"><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:11px;font-weight:700;color:${clr};background:${bg};">${pct.toFixed(2)}%</span></td>`;
    }).join('')}</tr>`;

    tableRows += `<tr><td class="ab-ov-sublabel" style="padding:5px 8px;font-size:12px;font-weight:600;">Status</td>${quarterData.map(q => {
      if (q.target <= 0) return `<td class="ab-ov-cell" style="text-align:right;padding:5px 8px;font-size:12px;color:#94a3b8;">—</td>`;
      const pct = (q.actual / q.target) * 100;
      const isAchieved = pct >= 100;
      const color = isAchieved ? '#16a34a' : '#dc2626';
      const label = isAchieved ? '<i class="fa-solid fa-circle-check" style="margin-right:3px;"></i>Target Achieved' : '<i class="fa-solid fa-circle-xmark" style="margin-right:3px;"></i>Target Not Achieved';
      return `<td class="ab-ov-cell" style="text-align:right;padding:5px 8px;font-size:12px;"><span style="font-size:11px;font-weight:700;color:${color};">${label}</span></td>`;
    }).join('')}</tr>`;

    if (isCW) {
      tableRows += `<tr><td class="ab-ov-sublabel" style="padding:5px 8px;font-size:12px;font-weight:600;">Weight Factor</td>${quarterData.map(() => `<td class="ab-ov-cell" style="text-align:right;padding:5px 8px;font-size:11px;color:#7c3aed;font-weight:600;">15% × SIP Budget</td>`).join('')}</tr>`;
    } else {
      tableRows += `<tr><td class="ab-ov-sublabel" style="padding:5px 8px;font-size:12px;font-weight:600;">Tiered</td>${quarterData.map(q => `<td class="ab-ov-cell" style="text-align:right;padding:5px 8px;font-size:12px;">${fmtR(q.tieredVal)}</td>`).join('')}</tr>`;
      tableRows += `<tr><td class="ab-ov-sublabel" style="padding:5px 8px;font-size:12px;font-weight:600;">Weight Factor</td>${quarterData.map(() => `<td class="ab-ov-cell" style="text-align:right;padding:5px 8px;font-size:11px;color:var(--text-muted);">20% × ${it._sub ? ((baseKpi.find(x=>x.label===it._parent)?.pct||0)+'%×'+(it._sub==='Distributor'?JABODETABEK_DIST_PCT:JABODETABEK_DIR_PCT)+'%') : effectiveWeightPct + '%'}</td>`).join('')}</tr>`;
    }

    tableRows += `<tr class="ab-ov-earned-row"><td class="ab-ov-sublabel" style="font-weight:700;color:#050546;background:#ADD8E6;border-top:1px solid #ADD8E6;border-bottom:2px solid #ADD8E6;padding:10px 12px;font-size:12px;">SIP Earned</td>${quarterData.map(q => `<td class="ab-ov-cell ab-ov-earned-cell" style="font-weight:700;text-align:right;padding:10px 8px;font-size:12px;">${fmtR(q.earned)}</td>`).join('')}</tr>`;
    tableRows += `<tr class="ab-ov-spacer"><td colspan="6"></td></tr>`;
  }

  tableRows += `<tr class="ab-ov-total-row" style="background:#eff6ff;">
    <td colspan="2" style="padding:10px 12px;font-size:12px;font-weight:700;color:#ffffff;">Total Quarter SIP Earned</td>
    ${quarterTotals.map(v => `<td class="ab-ov-cell" style="text-align:right;padding:10px 8px;font-size:12px;font-weight:700;color:#ffffff;">${fmtR(v)}</td>`).join('')}
  </tr>`;

  body.innerHTML = `
    <div style="padding:8px 12px 12px 12px;">
      <div style="overflow-x:auto;border:1px solid var(--border);border-radius:12px;background:#fff;box-shadow:0 8px 18px rgba(15,23,42,0.06);">
        <table class="data-table ab-ov-table" style="min-width:1100px;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:#A22445;">
              <th style="text-align:left;padding:10px 12px;border-bottom:1px solid var(--border);font-size:12px;font-weight:700;color:#FFFFFF;">KPI</th>
              <th style="text-align:left;padding:10px 12px;border-bottom:1px solid var(--border);font-size:12px;font-weight:700;color:#FFFFFF;">Metric</th>
              ${quarterLabels.map(q => `<th style="text-align:center;padding:10px 8px;border-bottom:1px solid var(--border);font-size:12px;font-weight:700;color:#FFFFFF;">${q}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function abRenderTimeline({ monthlySIP, monthlyBudgets, monthlyPlans, year, maxMonth, kpiItems, dbTargets, dbActuals, level, plan }) {
  const n         = maxMonth + 1;
  const curYear   = new Date().getFullYear();
  const isCurYear = year === curYear;
  const baseKpi   = KPI_TARGETS[level] || [];
  const fmtN = v => (v > 0 ? v.toLocaleString('id-ID') : '—');
  const fmtActualN = v => (v > 0 ? formatActual(v) : '—');
  const fmtR = v => (v > 0 ? formatRupiah(v) : '—');

  if (!kpiItems || kpiItems.length === 0) {
    document.getElementById('ab-timeline-body').innerHTML =
      `<div style="padding:24px;text-align:center;color:var(--text-muted);">No KPI data available.</div>`;
    return;
  }

  // Month header cells (row 2)
  const monthCells = MONTH_KEYS.slice(0, n).map((_, i) => {
    const isCur = i === NOW_MONTH && isCurYear;
    return `<th style="">${MONTH_NAMES[i].slice(0, 3)}</th>`;
  }).join('');

  let tableRows = '';

  for (const it of kpiItems.filter(it2 => !it2._isParentHeader)) {
    const isCW = it.label === 'Closed Won/Consumption';
    const db   = dbTargets[it.label] || {};
    const act  = dbActuals[it.label] || {};
    const col  = getKpiColor(it.label) || { bg: '#f8fafc', border: '#64748b' };

    // Weight factor computation
    const effectiveWeightPct = (db.weight != null) ? db.weight : it.pct;
    let weightFactor, wfLabel;
    if (it._sub) {
      const parentKpi   = baseKpi.find(x => x.label === it._parent);
      const parentPct   = parentKpi ? parentKpi.pct : 0;
      const subSplitPct = it._sub === 'Distributor' ? JABODETABEK_DIST_PCT : JABODETABEK_DIR_PCT;
      weightFactor = (parentPct / 100) * (subSplitPct / 100);
      wfLabel = `${parentPct}% × ${subSplitPct}%`;
    } else {
      weightFactor = effectiveWeightPct / 100;
      wfLabel = `${effectiveWeightPct}%`;
    }

    // Per-month data
    const perMonth = MONTH_KEYS.slice(0, n).map((mk, m) => {
      const monthlyBudget = monthlyBudgets[m] || 0;
      const target        = db[mk] ?? 0;
      const actual        = act[mk] ?? 0;
      const achPct        = target > 0 ? (actual / target * 100) : 0;
      const effectiveWeightPct = (db.weight != null) ? db.weight : it.pct;
      const parentKpi     = baseKpi.find(x => x.label === it._parent);
      const parentPct     = parentKpi ? parentKpi.pct : 0;
      const subSplitPct   = it._sub === 'Distributor' ? JABODETABEK_DIST_PCT : JABODETABEK_DIR_PCT;

      // Match the Associate Detail "SIP Monthly Budget per KPI" logic:
      // sales KPI budget = monthly budget × 80% × KPI weight
      // CW budget        = monthly budget × 15%
      const kpiBudget = isCW
        ? monthlyBudget * SIP_CW_PCT / 100
        : monthlyBudget * SIP_MONTHLY_SALES_PCT / 100 * (it._sub
            ? (parentPct / 100) * (subSplitPct / 100)
            : (effectiveWeightPct / 100));

      let tieredVal = 0, sipEarned = 0;
      if (isCW) {
        sipEarned = (target > 0 && actual >= target) ? Math.round(monthlyBudget * SIP_CW_PCT / 100) : 0;
      } else {
        const monthPlan = monthlyPlans?.[m] || plan; // Use per-month plan
        tieredVal = target > 0 ? tieredSIP(achPct, monthPlan) : 0;
        sipEarned = target > 0 ? Math.round(tieredVal * SIP_MONTHLY_SALES_PCT / 100 * weightFactor) : 0;
      }
      return { budget: kpiBudget, target, actual, achPct, tieredVal, sipEarned };
    });

    const kpiLabel = it._sub
      ? `${it._parent}<br><small style="font-weight:400;opacity:.75;font-size:10px;">↳ ${it._sub}</small>`
      : it.label;

    const SUB_ROWS = isCW ? 7 : 7; // always 7

    // Helper: cell with current-month tint
    const cell = (i, content, extraStyle = '') =>
      `<td class="ab-ov-cell${i === NOW_MONTH && isCurYear ? ' ab-ov-cur' : ''}" style="${extraStyle}">${content}</td>`;

    // Row 1: SIP Budget (includes KPI name cell with rowspan)
    tableRows += `<tr>
      <td class="ab-ov-kpi-name" rowspan="${SUB_ROWS}" style="border-left:4px solid ${col.border};">${kpiLabel}</td>
      <td class="ab-ov-sublabel" style="color:#26bd71;">SIP Monthly Budget per KPI</td>
      ${perMonth.map((d, i) => cell(i, fmtR(d.budget), 'color:#26bd71;')).join('')} 
    </tr>`;

    // Row 2: Target
    tableRows += `<tr>
      <td class="ab-ov-sublabel">Target</td>
      ${perMonth.map((d, i) => cell(i, fmtN(d.target))).join('')}
    </tr>`;

    // Row 3: Actual
    tableRows += `<tr>
      <td class="ab-ov-sublabel">Actual</td>
      ${perMonth.map((d, i) => cell(i, fmtActualN(d.actual))).join('')}
    </tr>`;

    // Row 4: % Achievement
    tableRows += `<tr>
      <td class="ab-ov-sublabel">% Achievement</td>
      ${perMonth.map((d, i) => {
        if (d.target <= 0) return cell(i, '<span style="color:#94a3b8;">—</span>');
        const pct = d.achPct;
        const clr = pct >= 100 ? '#16a34a' : pct >= 85 ? '#b45309' : '#dc2626';
        const bg  = pct >= 100 ? '#dcfce7' : pct >= 85 ? '#fef3c7' : '#fee2e2';
        return cell(i, `<span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:11px;font-weight:700;color:${clr};background:${bg};">${pct.toFixed(2)}%</span>`);
      }).join('')}
    </tr>`;

    if (isCW) {
      // Row 5: Status (Met/Not Met)
      tableRows += `<tr>
        <td class="ab-ov-sublabel">Status</td>
        ${perMonth.map((d, i) => {
          if (d.target <= 0) return cell(i, '<span style="color:#94a3b8;">—</span>');
          return cell(i, d.actual >= d.target
            ? '<span style="font-size:11px;font-weight:700;color:#16a34a;"><i class="fa-solid fa-circle-check" style="margin-right:3px;"></i>Met</span>'
            : '<span style="font-size:11px;font-weight:700;color:#dc2626;"><i class="fa-solid fa-circle-xmark" style="margin-right:3px;"></i>Not Met</span>');
        }).join('')}
      </tr>`;

      // Row 6: Weight Factor
      tableRows += `<tr>
        <td class="ab-ov-sublabel">Weight Factor</td>
        ${perMonth.map((_, i) => cell(i, `<span style="color:#7c3aed;font-weight:600;font-size:11px;">${SIP_CW_PCT}% × SIP Budget</span>`)).join('')}
      </tr>`;
    } else {
      // Row 5: Tiered
      tableRows += `<tr>
        <td class="ab-ov-sublabel">Tiered</td>
        ${perMonth.map((d, i) => cell(i, fmtR(d.tieredVal))).join('')}
      </tr>`;

      // Row 6: Weight Factor
      tableRows += `<tr>
        <td class="ab-ov-sublabel">Weight Factor</td>
        ${perMonth.map((_, i) => cell(i, `<span style="color:var(--text-muted);font-size:11px;">80% × ${it._sub ? ((baseKpi.find(x=>x.label===it._parent)?.pct||0) + '%\u00d7' + (it._sub==='Distributor'?JABODETABEK_DIST_PCT:JABODETABEK_DIR_PCT) + '%') : effectiveWeightPct + '%'}</span>`)).join('')}
      </tr>`;
    }

    // Row 7: SIP Earned (highlighted)
    tableRows += `<tr class="ab-ov-earned-row">
      <td class="ab-ov-sublabel" style="font-weight:700;color:#050546;background:#ADD8E6;border-top:1px solid #ADD8E6;border-bottom:2px solid #ADD8E6;">SIP Earned</td>
      ${perMonth.map((d, i) => `<td class="ab-ov-cell ab-ov-earned-cell${i === NOW_MONTH && isCurYear ? ' ab-ov-cur' : ''}" style="font-weight:700;">${fmtR(d.sipEarned)}</td>`).join('')}
    </tr>`;

    // Spacer between groups
    tableRows += `<tr class="ab-ov-spacer"><td colspan="${n + 2}"></td></tr>`;
  }

  // Total SIP Earned row
  tableRows += `<tr class="ab-ov-total-row">
    <td colspan="2">TOTAL SIP EARNED</td>
    ${MONTH_KEYS.slice(0, n).map((_, m) => {
      const isCur = m === NOW_MONTH && isCurYear;
      return `<td class="ab-ov-cell" style="text-align:right;">${fmtR(monthlySIP[m] || 0)}</td>`;
    }).join('')}
  </tr>`;

  document.getElementById('ab-timeline-body').innerHTML = `
    <div class="table-responsive" style="overflow-x:auto;border-radius:12px;overflow:hidden;border:1px solid #f1f5f9;">
      <table class="ab-overview-table">
        <thead>
          <tr>
            <th class="ab-ov-kpi-name" rowspan="2" style="background:#A22445;color:#FFFFFF;text-align:center;font-size:13px;min-width:130px;border-bottom:2px solid #f5e7eb;">KPI</th>
            <th rowspan="2" style="background:#A22445;color:#FFFFFF;font-size:12px;font-weight:500;min-width:110px;text-align:center;padding-left:16px;border-bottom:2px solid #f5e7eb;">SUB-METRIC</th>
            <th colspan="${n}" style="text-align:center;background:#A22445;color:#FFFFFF;font-size:13px;font-weight:700;letter-spacing:.5px;border-bottom:1px solid #f5e7eb;">${year}</th>
          </tr>
          <tr>${monthCells}</tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`;
}

