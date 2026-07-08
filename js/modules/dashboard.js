// ===========================
// DASHBOARD RENDER
// ===========================

// Cached actuals + payment data so period changes don't re-fetch
let _dashCache = null;

async function renderDashboard() {
  _dashCache = null;
  const year = new Date().getFullYear();

  // ── Stat cards (initial) ──
  const activeAssociates = associates.filter(a => !a.resign_date);
  document.getElementById('stat-associates').textContent = activeAssociates.length;
  document.getElementById('stat-sip-budget').textContent = '—';
  const statEarnedEl = document.getElementById('stat-sip-earned');
  if (statEarnedEl) statEarnedEl.textContent = '—';

  const isSalesAssociate = currentRole === 'sales_associate';
  const statBudgetCard = document.getElementById('stat-sip-budget')?.closest('.stat-card');
  const statEarnedCard = document.getElementById('stat-sip-earned')?.closest('.stat-card');
  const sipSummaryTitle = document.getElementById('dash-sip-summary-title');
  const sipSummaryBody = document.getElementById('dash-top3-sip');
  if (isSalesAssociate) {
    if (statBudgetCard) statBudgetCard.style.display = 'none';
    if (statEarnedCard) statEarnedCard.style.display = 'none';
    if (sipSummaryTitle) sipSummaryTitle.style.display = 'none';
    if (sipSummaryBody) sipSummaryBody.style.display = 'none';
  } else {
    if (statBudgetCard) statBudgetCard.style.display = '';
    if (statEarnedCard) statEarnedCard.style.display = '';
    if (sipSummaryTitle) sipSummaryTitle.style.display = '';
    if (sipSummaryBody) sipSummaryBody.style.display = '';
  }

  // ── Employee distribution charts (sync, from memory) ──
  const levelCounts    = {}; // category → { level: count }
  const positionCounts = {};
  const areaCounts     = {};
  for (const a of activeAssociates) {
    const cat = a.category || 'N/A';
    const lv  = a.level    || 'N/A';
    const pos = a.position || 'N/A';
    if (!levelCounts[cat]) levelCounts[cat] = {};
    levelCounts[cat][lv] = (levelCounts[cat][lv] || 0) + 1;
    positionCounts[pos]  = (positionCounts[pos]  || 0) + 1;
    if (!areaCounts[a.group_area]) areaCounts[a.group_area] = {};
    areaCounts[a.group_area][a.detail_area] = (areaCounts[a.group_area][a.detail_area] || 0) + 1;
  }
  dashRenderLevelChart(levelCounts);
  dashRenderPositionChart(positionCounts);
  dashRenderAreaChart(areaCounts);

  // ── Loading placeholders for async sections ──
  const loadingHTML = `<div style="color:var(--text-muted);font-size:12px;padding:16px;text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>`;
  ['dash-top3-achievement','dash-kpi-totals','dash-monthly-nc','dash-top3-sip']
    .forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = loadingHTML; });

  // ── Fetch all actuals (batch) + per-month budget in parallel ──
  // annualBudgetMap already loaded by loadAssociates() — no duplicate fetch needed
  let monthlyActuals = {};
  let monthlyBudgetMap = {};
  try {
    const [actualsJson, budgetMonthlyJson] = await Promise.all([
      fetch(`${ACTUAL_API}?year=${year}&all_months=1`)
        .then(r => r.json())
        .catch(() => ({ success: false })),
      fetch(`${HIST_API}?year=${year}&per_month=1`)
        .then(r => r.json())
        .catch(() => ({ success: false }))
    ]);
    if (actualsJson.success) monthlyActuals = actualsJson.data;
    if (budgetMonthlyJson.success) monthlyBudgetMap = budgetMonthlyJson.data;
  } catch(e) { /* graceful empty state */ }

  // Total annual SIP budget
  const totalAnnualBudget = associates.reduce((s, a) => s + (annualBudgetMap[a.employee_id] || 0), 0);
  document.getElementById('stat-sip-budget').textContent = formatRupiah(totalAnnualBudget);

  // ── YTD Earned stat card ──
  const ytdMonths = MONTH_KEYS.slice(0, NOW_MONTH + 1);
  let ytdEarned = 0;
  for (const a of associates) {
    for (const mk of ytdMonths) {
      const empActuals = {};
      for (const r of (monthlyActuals[mk] || [])) {
        if (r.employee_id === a.employee_id)
          empActuals[r.component] = { target_val: r.target_val, actual_val: r.actual_val, weight: r.weight };
      }
      const mBudget = (monthlyBudgetMap[a.employee_id] ?? {})[mk] ?? (a.sip_budget_current || 0);
      ytdEarned += computeSIPEarned(mBudget, a.level, a.detail_area, empActuals, a.plan);
    }
  }
  if (statEarnedEl) statEarnedEl.textContent = formatRupiah(ytdEarned);

  // ── Closed Won / Consumption per month (split by TAC level) ──
  const isTACLevel = l => l === 'Senior TAC' || l === 'Junior TAC';
  const monthlyCW = {};
  for (const mk of MONTH_KEYS) {
    const rows = (monthlyActuals[mk] || []).filter(r => r.component === 'Closed Won/Consumption');
    monthlyCW[mk] = {
      cw:  rows.filter(r => !isTACLevel(r.level)).reduce((s, r) => s + (r.actual_val || 0), 0),
      con: rows.filter(r =>  isTACLevel(r.level)).reduce((s, r) => s + (r.actual_val || 0), 0),
    };
  }
  // ── Cache for period re-renders ──
  _dashCache = { year, monthlyActuals, monthlyCW, monthlyBudgetMap };

  // ── Build period picker then render default (current month) ──
  dashBuildPeriodPicker(year);
  dashRenderPeriod(NOW_KEY);
}

const QUARTER_MONTHS = {
  'q1': ['jan','feb','mar'],
  'q2': ['apr','may','jun'],
  'q3': ['jul','aug','sep'],
  'q4': ['oct','nov','dec'],
};
const QUARTER_LABELS = { 'q1': 'Q1 (Jan–Mar)', 'q2': 'Q2 (Apr–Jun)', 'q3': 'Q3 (Jul–Sep)', 'q4': 'Q4 (Oct–Dec)' };

function dashBuildPeriodPicker(year) {
  const picker = document.getElementById('dash-period-picker');
  if (!picker) return;
  // Remove old dynamic buttons
  picker.querySelectorAll('[data-period^="m-"],[data-period^="q"]').forEach(b => b.remove());

  const sepQ = document.getElementById('dash-period-sep-q');
  const sepM = document.getElementById('dash-period-sep-m');

  // Add Q1–Q4 buttons (only quarters that have started)
  const QUARTERS = ['q1','q2','q3','q4'];
  const quarterStartMonth = { 'q1': 0, 'q2': 3, 'q3': 6, 'q4': 9 };
  let anyQ = false;
  QUARTERS.forEach(q => {
    if (quarterStartMonth[q] > NOW_MONTH) return;
    anyQ = true;
    const btn = document.createElement('button');
    btn.className = 'dash-period-btn';
    btn.dataset.period = q;
    btn.textContent = q.toUpperCase();
    picker.insertBefore(btn, sepM);
  });
  if (sepQ) sepQ.style.display = anyQ ? '' : 'none';

  // Add Jan → current month buttons
  for (let i = 0; i <= NOW_MONTH; i++) {
    const btn = document.createElement('button');
    btn.className = 'dash-period-btn';
    btn.dataset.period = `m-${MONTH_KEYS[i]}`;
    btn.textContent = MONTH_NAMES[i].slice(0, 3);
    picker.appendChild(btn);
  }

  picker.querySelectorAll('.dash-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      picker.querySelectorAll('.dash-period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const p = btn.dataset.period;
      dashRenderPeriod(p === 'ytd' ? 'ytd' : p.startsWith('q') ? p : p.replace('m-', ''));
    });
  });
  // Activate current month by default
  const def = picker.querySelector(`[data-period="m-${NOW_KEY}"]`);
  if (def) def.classList.add('active');
}

function dashRenderPeriod(periodKey) {
  // periodKey: 'ytd' | 'q1'|'q2'|'q3'|'q4' | 'jan' | 'feb' | ...
  if (!_dashCache) return;
  const { year, monthlyActuals, monthlyCW } = _dashCache;
  const isYTD = periodKey === 'ytd';
  const isQ   = /^q[1-4]$/.test(periodKey);
  const months = isYTD ? MONTH_KEYS.slice(0, NOW_MONTH + 1)
               : isQ   ? QUARTER_MONTHS[periodKey].filter(mk => MONTH_KEYS.indexOf(mk) <= NOW_MONTH)
               : [periodKey];
  const label  = isYTD ? `Jan – ${MONTH_NAMES[NOW_MONTH]} ${year} (YTD)`
               : isQ   ? `${QUARTER_LABELS[periodKey]} ${year}`
               : `${MONTH_NAMES[MONTH_KEYS.indexOf(periodKey)]} ${year}`;

  ['dash-month-label','dash-sip-month-label'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
  });

  // ── Aggregate achievement & KPI totals ──
  const empAchMap = {};
  const kpiTotals = {};
  for (const mk of months) {
    for (const r of (monthlyActuals[mk] || [])) {
      if (r.target_val <= 0) continue;
      // Skip parent split-label components for Jabodetabek associates
      // (their data lives in "... - Distributor" / "... - Direct" sub-components)
      if (JABODETABEK_SPLIT_LABELS.has(r.component) && isJabodetabek(r.detail_area)) continue;
      if (!empAchMap[r.employee_id]) {
        const assocRow = associates.find(a => a.employee_id === r.employee_id) || {};
        empAchMap[r.employee_id] = {
          full_name: r.full_name,
          detail_area: r.detail_area || '',
          level: r.level || assocRow.level || '',
          category: assocRow.category || r.category || '',
          components: {}
        };
      }
      if (!empAchMap[r.employee_id].components[r.component])
        empAchMap[r.employee_id].components[r.component] = { actual: 0, target: 0 };
      empAchMap[r.employee_id].components[r.component].actual += r.actual_val || 0;
      empAchMap[r.employee_id].components[r.component].target += r.target_val || 0;

      if (!kpiTotals[r.component]) kpiTotals[r.component] = { actual: 0, target: 0 };
      kpiTotals[r.component].actual += r.actual_val || 0;
      kpiTotals[r.component].target += r.target_val || 0;
    }
  }
  const allAchData = Object.entries(empAchMap).map(([id, d]) => {
    let sum = 0, count = 0, salesActual = 0, cwActual = 0;
    for (const [comp, cv] of Object.entries(d.components)) {
      if (cv.target <= 0) continue;
      sum += comp === 'Closed Won/Consumption'
        ? (cv.actual >= cv.target ? 100 : (cv.actual / cv.target) * 100)
        : (cv.actual / cv.target) * 100;
      count++;
      if (comp === 'Closed Won/Consumption') cwActual += cv.actual;
      else salesActual += cv.actual;
    }
    const totalActual = salesActual + cwActual;
    const cwPct    = totalActual > 0 ? Math.round(cwActual    / (cwActual    || 1) * 100) : 0;
    const salesPct = totalActual > 0 ? Math.round(salesActual / (salesActual || 1) * 100) : 0;
    // cwPct & salesPct as % of own target
    const cwComp    = d.components['Closed Won/Consumption'];
    const cwPctVal  = cwComp    ? Math.min(Math.round(cwComp.actual    / cwComp.target    * 100), 999) : 0;
    const salesComps = Object.entries(d.components).filter(([c]) => c !== 'Closed Won/Consumption');
    const salesPctVal = salesComps.length
      ? Math.round(salesComps.reduce((s,[,cv]) => s + (cv.target > 0 ? cv.actual/cv.target*100 : 0), 0) / salesComps.length)
      : 0;
    return { employee_id: id, full_name: d.full_name, detail_area: d.detail_area,
             avgPct: count > 0 ? sum / count : 0, salesActual, cwActual,
             cwPct: cwPctVal, salesPct: salesPctVal };
  });
  _dashCache.allAchData = allAchData;

  // ── Build per-KPI employee map for Achievement Rank cards ──
  const kpiEmpMap = {};
  for (const [empId, d] of Object.entries(empAchMap)) {
    for (const [comp, cv] of Object.entries(d.components)) {
      if (cv.target <= 0) continue;
      if (!kpiEmpMap[comp]) kpiEmpMap[comp] = [];
      const pct = (cv.actual / cv.target) * 100;
      kpiEmpMap[comp].push({ employee_id: empId, full_name: d.full_name, level: d.level, detail_area: d.detail_area, category: d.category, actual: cv.actual, target: cv.target, pct });
    }
  }
  _dashCache.kpiEmpMap = kpiEmpMap;

  // ── SIP per associate across selected months ──
  const { monthlyBudgetMap } = _dashCache;
  const allSIPData = associates.map(a => {
    let sip = 0;
    for (const mk of months) {
      const empActuals = {};
      for (const r of (monthlyActuals[mk] || [])) {
        if (r.employee_id === a.employee_id)
          empActuals[r.component] = { target_val: r.target_val, actual_val: r.actual_val, weight: r.weight };
      }
      const mBudget = (monthlyBudgetMap[a.employee_id] ?? {})[mk] ?? (a.sip_budget_current || 0);
      sip += computeSIPEarned(mBudget, a.level, a.detail_area, empActuals, a.plan);
    }
    return { full_name: a.full_name, employee_id: a.employee_id, level: a.level, detail_area: a.detail_area, sip };
  });

  dashRenderMonthlyCW(monthlyCW, months);
  dashRenderKpiAchievementCards(_dashCache.kpiEmpMap);
  dashRenderKPITotals(kpiTotals);
  dashRenderTop3SIP(allSIPData);
}

// ── Dashboard helper: Level horizontal bar chart ──
function dashRenderLevelChart(catLevelMap) {
  const el = document.getElementById('dash-level-chart');
  if (!el) return;
  const CAT_ORDER = ['Manager','Supervisor'];
  const catRank = cat => { const i = CAT_ORDER.findIndex(o => cat.toLowerCase().includes(o.toLowerCase())); return i === -1 ? 99 : i; };
  const groups = Object.entries(catLevelMap)
    .map(([cat, levels]) => ({ cat, total: Object.values(levels).reduce((s,v)=>s+v,0), levels }))
    .sort((a, b) => { const r = catRank(a.cat) - catRank(b.cat); return r !== 0 ? r : b.total - a.total; });
  if (!groups.length) { el.innerHTML = '<div class="dash-no-data">No data</div>'; return; }
  const grandTotal = groups.reduce((s, g) => s + g.total, 0);
  const LEVEL_ORDER = ['Manager','Supervisor','Senior','Junior','Senior TAC','Junior TAC','Leader'];
  const levelRank = lv => { const i = LEVEL_ORDER.findIndex(o => lv.toLowerCase().includes(o.toLowerCase())); return i === -1 ? 99 : i; };
  const COLORS = ['#2563eb','#16a34a','#ea580c','#7c3aed','#0d9488','#ec4899','#0891b2','#f59e0b'];
  let colorIdx = 0;
  el.innerHTML = `<div class="dash-level-grid">${groups.map(({ cat, total, levels }) => {
    const levelRows = Object.entries(levels).sort((a, b) => levelRank(a[0]) - levelRank(b[0]))
      .map(([lv, n]) => {
        const pct = Math.round(n / grandTotal * 100);
        const col = COLORS[colorIdx++ % COLORS.length];
        return `<div class="dash-level-lbl">${lv}</div>
          <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pct}%;background:${col};"></div></div>
          <span class="dash-area-cnt">${n}</span>`;
      }).join('');
    return `<div class="dash-level-cat-hd">${cat}<span class="dash-area-badge">${total}</span></div>
      ${levelRows}`;
  }).join('')}</div>`;
}

// ── Dashboard helper: Position horizontal bar chart ──
function dashRenderPositionChart(counts) {
  const el = document.getElementById('dash-position-chart');
  if (!el) return;
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  if (!total) { el.innerHTML = '<div class="dash-no-data">No data</div>'; return; }
  const COLORS = ['#3b82f6','#16a34a','#ea580c','#7c3aed','#0d9488','#ec4899','#0891b2','#f59e0b'];
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([pos, n], i) => {
    const pct = Math.round(n / total * 100);
    return `<div class="dash-bar-row">
      <div class="dash-bar-label" title="${pos}">${pos}</div>
      <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pct}%;background:${COLORS[i % COLORS.length]};"></div></div>
      <div class="dash-bar-count">${n}</div>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="dash-bar-chart dash-bar-chart--position">${rows}</div>`;
}

// ── Dashboard helper: Area tree ──
function dashRenderAreaChart(areaCounts) {
  const el = document.getElementById('dash-area-chart');
  if (!el) return;
  const groups = Object.entries(areaCounts)
    .map(([g, details]) => ({ g, total: Object.values(details).reduce((s,v)=>s+v,0), details }))
    .sort((a, b) => b.total - a.total);
  if (!groups.length) { el.innerHTML = '<div class="dash-no-data">No data</div>'; return; }
  const grandTotal = groups.reduce((s, g) => s + g.total, 0);
  const COLORS = ['#2563eb','#16a34a','#ea580c','#7c3aed','#0d9488','#ec4899','#0891b2','#f59e0b'];
  let colorIdx = 0;
  el.innerHTML = `<div class="dash-level-grid">${groups.map(({ g, total, details }) => {
    const detailRows = Object.entries(details).sort((a, b) => b[1] - a[1])
      .map(([name, n]) => {
        const pct = Math.round(n / grandTotal * 100);
        const col = COLORS[colorIdx++ % COLORS.length];
        return `<div class="dash-level-lbl">${name}</div>
          <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pct}%;background:${col};"></div></div>
          <span class="dash-area-cnt">${n}</span>`;
      }).join('');
    return `<div class="dash-level-cat-hd">${g}<span class="dash-area-badge">${total}</span></div>
      ${detailRows}`;
  }).join('')}</div>`;
}

// ── Dashboard helper: Closed Won vs Consumption split ──
function dashRenderCWSplit(kpiEmpMap) {
  const el = document.getElementById('dash-cw-split');
  if (!el) return;
  const employees = kpiEmpMap?.['Closed Won/Consumption'];
  if (!employees?.length) { el.style.display = 'none'; return; }
  el.style.display = '';
  const isTAC = e => e.level === 'Senior TAC' || e.level === 'Junior TAC';
  const cwActual  = employees.filter(e => !isTAC(e)).reduce((s, e) => s + e.actual, 0);
  const conActual = employees.filter(e =>  isTAC(e)).reduce((s, e) => s + e.actual, 0);
  const maxVal = Math.max(cwActual, conActual, 1);
  const bars = [
    { label: 'Closed Won',        val: cwActual,  color: '#2563eb' },
    { label: 'Consumption (TAC)', val: conActual, color: '#ec4899' },
  ];
  const CHART_H = 90; // px, max bar height
  el.innerHTML = `
    <div class="cw-vbar-chart">
      ${bars.map(b => {
        const barH = Math.max(Math.round(b.val / maxVal * CHART_H), b.val > 0 ? 6 : 0);
        return `<div class="cw-vbar-col">
          <div class="cw-vbar-val" style="color:${b.color};">${b.val.toLocaleString('id-ID')}</div>
          <div class="cw-vbar-track" style="height:${CHART_H}px;">
            <div class="cw-vbar-fill" style="height:${barH}px;background:${b.color};"></div>
          </div>
          <div class="cw-vbar-lbl">${b.label}</div>
        </div>`;
      }).join('')}
    </div>`;
}

// ── Dashboard helper: Monthly new customers vertical bar chart ──
function dashRenderMonthlyCW(monthlyCW, selectedMonths) {
  const el = document.getElementById('dash-monthly-nc');
  if (!el) return;
  const months   = selectedMonths || MONTH_KEYS.slice(0, NOW_MONTH + 1);
  const isSingle = months.length === 1;
  const allVals  = months.flatMap(mk => [monthlyCW[mk]?.cw || 0, monthlyCW[mk]?.con || 0]);
  const maxVal   = Math.max(...allVals, 1);

  const barCols = months.map(mk => {
    const cw  = monthlyCW[mk]?.cw  || 0;
    const con = monthlyCW[mk]?.con || 0;
    const cwH  = Math.max(Math.round(cw  / maxVal * 100), cw  > 0 ? 4 : 0);
    const conH = Math.max(Math.round(con / maxVal * 100), con > 0 ? 4 : 0);
    const shortMon = mk.charAt(0).toUpperCase() + mk.slice(1, 3);
    return `<div class="dash-nc-group${isSingle ? ' dash-nc-group--single' : ''}">
      <div class="dash-nc-pair">
        <div class="dash-nc-col">
          ${cw > 0 ? `<div class="dash-nc-val" style="color:#2563eb;">${cw}</div>` : ''}
          <div class="dash-nc-bar" style="height:${cwH}%;background:#2563eb;"></div>
        </div>
        <div class="dash-nc-col">
          ${con > 0 ? `<div class="dash-nc-val" style="color:#ec4899;">${con}</div>` : ''}
          <div class="dash-nc-bar" style="height:${conH}%;background:#ec4899;"></div>
        </div>
      </div>
      <div class="dash-nc-lbl">${shortMon}</div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="dash-nc-legend">
      <span class="dash-nc-legend-dot" style="background:#2563eb;"></span>Closed Won
      <span class="dash-nc-legend-dot" style="background:#ec4899;margin-left:10px;"></span>Consumption (TAC)
    </div>
    <div class="dash-nc-bars">${barCols}</div>
  `;
}


// ── Dashboard helper: KPI Achievement Rank cards (one card per KPI, filtered by level) ──
const KPI_ACH_ORDER = [
  'Area Sales Leader',
  'Area Sales Leader - Direct',
  'Individual Sales Leader - Distributor',
  'Individual Sales Leader - Direct',
  'Individual Sales Non-Leader',
  'Individual Sales Non-Leader - Direct',
  'Area Sales TAC',
  'Key Customer',
  'Closed Won/Consumption'
];
function dashRenderKpiAchievementCards(kpiEmpMap) {
  const container = document.getElementById('dash-kpi-rank-container');
  if (!container) return;
  if (!kpiEmpMap || !Object.keys(kpiEmpMap).length) {
    container.innerHTML = '<div class="dash-no-data" style="padding:12px;">Belum ada data achievement</div>';
    return;
  }
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
  const comps = Object.keys(kpiEmpMap).sort((a, b) => {
    const ia = KPI_ACH_ORDER.indexOf(a), ib = KPI_ACH_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const KPI_ICON = {
    'Closed Won/Consumption': 'fa-users',
    'Key Customer': 'fa-users',
    'Area Sales Leader': 'fa-users',
    'Area Sales TAC': 'fa-users',
  };
  const displayTitle = comp => {
    if (comp === 'Area Sales Leader') return 'Area Sales Leader - Distributor';
    if (comp === 'Individual Sales Non-Leader') return 'Individual Sales Non-Leader - Distributor';
    return comp;
  };
  container.innerHTML = comps.map(comp => {
    const employees = kpiEmpMap[comp];
    const levels = [...new Set(employees.map(e => e.level).filter(Boolean))].sort();
    const categories = [...new Set(employees.map(e => e.category).filter(Boolean))].sort();
    const areas  = [...new Set(employees.map(e => e.detail_area).filter(Boolean))].sort();
    const cardId = `kpi-rank-${comp.replace(/[^a-z0-9]/gi,'-').toLowerCase()}`;
    const icon = KPI_ICON[comp] || 'fa-chart-line';
    const levelOptions = `<option value="">All Level</option>` +
      levels.map(l => `<option value="${l}">${l}</option>`).join('');
    const categoryOptions = `<option value="">All Category</option>` +
      categories.map(c => `<option value="${c}">${c}</option>`).join('');
    const areaOptions = `<option value="">All Area</option>` +
      areas.map((a, i) => `<option value="${i}">${a}</option>`).join('');
    return `<div class="infographic-card dash-kpi-rank-card" id="${cardId}">
      <div class="infographic-card-header">
        <i class="fa-solid ${icon}"></i> <span class="kpi-rank-card-title">${displayTitle(comp)}</span>
      </div>
      <div class="kpi-rank-filters">
        <select class="kpi-level-select">${levelOptions}</select>
        <select class="kpi-category-select">${categoryOptions}</select>
        <select class="kpi-area-select">${areaOptions}</select>
      </div>
      <div class="infographic-body dash-ach-body kpi-rank-body"></div>
    </div>`;
  }).join('');

  container.querySelectorAll('.dash-kpi-rank-card').forEach(card => {
    const levelSelect = card.querySelector('.kpi-level-select');
    const categorySelect = card.querySelector('.kpi-category-select');
    const areaSelect = card.querySelector('.kpi-area-select');
    const bodyEl = card.querySelector('.kpi-rank-body');
    const cardId = card.id;
    const comp = cardId.replace('kpi-rank-', '').replace(/-/g, ' ').split(/(?=[A-Z])/);
    const compKey = Object.keys(kpiEmpMap).find(key => 
      key.replace(/[^a-z0-9]/gi,'-').toLowerCase() === cardId.replace('kpi-rank-', '')
    );
    const areas = [...new Set(kpiEmpMap[compKey].map(e => e.detail_area).filter(Boolean))].sort();
    const medals = [
      '<i class="fa-solid fa-trophy" style="color:#f59e0b;"></i>',
      '<i class="fa-solid fa-trophy" style="color:#94a3b8;"></i>',
      '<i class="fa-solid fa-trophy" style="color:#c2825a;"></i>',
    ];

    const render = () => {
      const level = levelSelect.value;
      const category = categorySelect.value;
      const areaIdx = areaSelect.value;
      const area = areaIdx !== '' ? areas[parseInt(areaIdx)] : '';
      const employees = kpiEmpMap[compKey];
      const filtered = employees.filter(e =>
        (!level || e.level === level) &&
        (!category || e.category === category) &&
        (!area  || e.detail_area === area)
      );
      // For "Closed Won/Consumption", rank by actual value; otherwise rank by percentage
      const isClosedWon = compKey === 'Closed Won/Consumption';
      const ranked = [...filtered].sort((a, b) => 
        isClosedWon ? b.actual - a.actual : b.pct - a.pct
      );
      bodyEl.innerHTML = ranked.length ? ranked.map((item, i) => {
        const isTop = i < 3;
        const rankLabel = isTop ? medals[i] : `<span class="ach-rank-num">${i + 1}</span>`;
        // For "Closed Won/Consumption", display actual value; otherwise display percentage
        const displayVal = isClosedWon 
          ? item.actual.toLocaleString('id-ID')
          : item.pct.toFixed(2) + '%';
        const pct = item.pct;
        const valCol = pct >= 100 ? '#16a34a' : pct >= 85 ? '#f59e0b' : '#dc2626';
        return `<div class="ach-row${isTop ? ` ach-top${i+1}` : ''}">
          <div class="ach-rank">${rankLabel}</div>
          <div class="ach-info">
            <div class="ach-name">${item.full_name}</div>
            <div class="ach-sub">${item.detail_area}${item.level ? ` · ${item.level}` : ''}</div>
          </div>
          <div class="ach-pct" style="color:${valCol};">${displayVal}</div>
        </div>`;
      }).join('') : '<div class="dash-no-data" style="padding:10px 0;">Tidak ada data</div>';
    };

    render();
    levelSelect.addEventListener('change', render);
    categorySelect.addEventListener('change', render);
    areaSelect.addEventListener('change', render);
  });
}

// ── Dashboard helper: KPI totals ──
function dashRenderKPITotals(kpiTotals) {
  const el = document.getElementById('dash-kpi-totals');
  if (!el) return;
  const entries = Object.entries(kpiTotals)
    .filter(([comp]) => comp !== 'Area Sales TAC')
    .sort((a, b) => b[1].actual - a[1].actual);
  if (!entries.length) { el.innerHTML = '<div class="dash-no-data">Belum ada data bulan ini</div>'; return; }
  const maxA = Math.max(...entries.map(([,d]) => d.actual), 1);
  const KPI_COLORS = {
    'Individual Sales Leader':'#3b82f6', 'Area Sales Leader':'#16a34a',
    'Individual Sales Non-Leader':'#3b82f6', 'Area Sales TAC':'#ea580c',
    'Key Customer':'#7c3aed', 'Closed Won/Consumption':'#ec4899',
  };
  el.innerHTML = entries.map(([comp, data]) => {
    const pct   = Math.round(data.actual / maxA * 100);
    const color = KPI_COLORS[comp] || '#3b82f6';
    const short = comp.replace('Individual Sales ','Ind. Sales ').replace('Closed Won/Consumption','Closed Won/Consumption');
    return `<div class="dash-kpi-row">
      <div class="dash-kpi-lbl"><span>${short}</span><span class="dash-kpi-val">${data.actual.toLocaleString('id-ID')}</span></div>
      <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pct}%;background:${color};"></div></div>
    </div>`;
  }).join('');
}

// ── Dashboard helper: Top 3 SIP (grouped by Level) ──
const SIP_LEVEL_ORDER = ['Manager','Leader','Senior TAC','Junior TAC','Senior','Junior'];
function dashRenderTop3SIP(allSIPData) {
  const el = document.getElementById('dash-top3-sip');
  if (!el) return;
  if (!allSIPData.length || allSIPData.every(t => t.sip === 0)) {
    el.innerHTML = '<div class="dash-no-data">Belum ada data SIP bulan ini</div>';
    return;
  }
  const medals  = ['🥇','🥈','🥉'];
  const rankCls = ['dash-sip-r1','dash-sip-r2','dash-sip-r3'];

  // Group by level
  const byLevel = {};
  for (const item of allSIPData) {
    const lv = item.level || 'Other';
    if (!byLevel[lv]) byLevel[lv] = [];
    byLevel[lv].push(item);
  }

  const levels = SIP_LEVEL_ORDER.filter(lv => byLevel[lv]);
  // Append any levels not in the fixed order
  for (const lv of Object.keys(byLevel)) {
    if (!levels.includes(lv)) levels.push(lv);
  }

  el.innerHTML = `<div class="dash-sip-level-grid">${levels.map(lv => {
    const top3 = [...byLevel[lv]].sort((a, b) => b.sip - a.sip).slice(0, 3).filter(t => t.sip > 0);
    if (!top3.length) return '';
    const cards = top3.map((item, i) =>
      `<div class="dash-sip-card ${rankCls[i]}">
        <div class="dash-sip-medal">${medals[i]}</div>
        <div class="dash-sip-name">${item.full_name}</div>
        <div class="dash-sip-area">${item.detail_area}</div>
        <div class="dash-sip-amount">${formatRupiah(item.sip)}</div>
      </div>`
    ).join('');
    return `<div class="infographic-card">
      <div class="infographic-card-header"><i class="fa-solid fa-layer-group"></i> ${lv}</div>
      <div class="infographic-body">
        <div class="dash-top3-sip-grid">${cards}</div>
      </div>
    </div>`;
  }).join('')}</div>`;
}

