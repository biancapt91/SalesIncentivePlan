// ===========================
// ASSOCIATE FILTER
// ===========================
function populateAssociateFilters() {
  const unique = (key) => [...new Set(associates.map(a => a[key]).filter(Boolean))].sort();
  const fill = (id, values) => {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML = `<option value="">${sel.options[0].text}</option>` +
      values.map(v => `<option value="${v}"${v === cur ? ' selected' : ''}>${v}</option>`).join('');
  };
  fill('filterLevel',      unique('level'));
  fill('filterCategory',   unique('category'));
  fill('filterPlan',       unique('plan'));
  fill('filterGroupArea',  unique('group_area'));
  fill('filterDetailArea', unique('detail_area'));
}

function getAssociateFiltered() {
  const q          = document.getElementById('searchAssociate').value.toLowerCase().trim();
  const level      = document.getElementById('filterLevel').value;
  const category   = document.getElementById('filterCategory').value;
  const plan       = document.getElementById('filterPlan').value;
  const groupArea  = document.getElementById('filterGroupArea').value;
  const detailArea = document.getElementById('filterDetailArea').value;
  return associates.filter(a => {
    if (q && !(
      a.full_name.toLowerCase().includes(q) ||
      a.employee_id.toLowerCase().includes(q) ||
      a.position.toLowerCase().includes(q) ||
      (a.level || '').toLowerCase().includes(q) ||
      (a.category || '').toLowerCase().includes(q) ||
      (a.plan    || '').toLowerCase().includes(q) ||
      a.detail_area.toLowerCase().includes(q) ||
      a.group_area.toLowerCase().includes(q)
    )) return false;
    if (level      && a.level       !== level)      return false;
    if (category   && a.category    !== category)   return false;
    if (plan       && a.plan        !== plan)        return false;
    if (groupArea  && a.group_area  !== groupArea)   return false;
    if (detailArea && a.detail_area !== detailArea)  return false;
    return true;
  });
}

function resetAssociateFilters() {
  document.getElementById('searchAssociate').value = '';
  ['filterLevel','filterCategory','filterPlan','filterGroupArea','filterDetailArea']
    .forEach(id => document.getElementById(id).value = '');
  renderAssociateTable(associates);
}

['searchAssociate','filterLevel','filterCategory','filterPlan','filterGroupArea','filterDetailArea']
  .forEach(id => document.getElementById(id).addEventListener('input', () => {
    renderAssociateTable(getAssociateFiltered());
  }));

// ===========================
// ASSOCIATE TABLE RENDER
// ===========================
function renderAssociateTable(data) {
  const tbody = document.getElementById('associateTableBody');
  const count = document.getElementById('tableCount');
  count.textContent = `Showing ${data.length} records`;
  const _assocNumTh = document.querySelector('#associateTable thead th:first-child');
  if (_assocNumTh) _assocNumTh.style.display = currentRole === 'sales_associate' ? 'none' : '';

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" class="no-data">
      <i class="fa-solid fa-inbox" style="font-size:24px;display:block;margin-bottom:8px;"></i>
      Tidak ada data ditemukan
    </td></tr>`;
    return;
  }

  const _assocNumStyle = currentRole === 'sales_associate' ? 'display:none' : '';
  tbody.innerHTML = data.map((a, i) => {
    const isResigned = !!a.resign_date;
    const rowStyle   = isResigned ? 'opacity:.55;' : '';
    const resignedBadge = isResigned
      ? `<span class="badge badge-red" style="font-size:10px;margin-left:4px;"><i class="fa-solid fa-user-slash"></i> Resigned</span>`
      : '';
    return `
    <tr style="${rowStyle}">
      <td style="${_assocNumStyle}">${i + 1}</td>
      <td><code style="background:#f1f5f9;padding:2px 7px;border-radius:4px;font-size:12px;">${a.employee_id}</code></td>
      <td><strong>${a.full_name}</strong>${resignedBadge}</td>
      <td>${a.position}</td>
      <td>${a.level ? `<span class="badge ${getLevelBadge(a.level)}">${a.level}</span>` : '<span style="color:#94a3b8">—</span>'}</td>
      <td>${a.category || '<span style="color:#94a3b8">—</span>'}</td>
      <td>${a.plan ? `<span class="badge ${getPlanBadge(a.plan)}">${a.plan}</span>` : '<span style="color:#94a3b8">—</span>'}</td>
      <td>${a.detail_area}</td>
      <td class="money-col">${formatRupiah(a.salary)}</td>
      <td class="money-col">${formatRupiah(a.sip_budget_current || 0)}</td>
      <td>
        <div class="actions">
          <button class="btn-icon detail" title="Detail" onclick="openDetailModal('${a.employee_id}')">
            <i class="fa-solid fa-eye"></i>
          </button>
          ${currentRole === 'admin' ? `
          <button class="btn-icon delete" title="Delete" onclick="openDeleteModal('${a.employee_id}')">
            <i class="fa-solid fa-trash"></i>
          </button>` : ''}
        </div>
      </td>
    </tr>
  `;
  }).join('');
}

// ===========================
// ADD MODAL
// ===========================
document.getElementById('btnAddAssociate').addEventListener('click', () => {
  editingId = null;
  document.getElementById('modalTitle').textContent = 'Add Associate';
  document.getElementById('associateForm').reset();
  document.getElementById('formId').value          = '';
  document.getElementById('formEmployeeId').value  = generateUID();
  document.getElementById('formBudgetMonthly').value = '';
  populateManagerPicker(null);
  openModal('modalOverlay');
});

// ===========================
// SAVE
// ===========================
document.getElementById('btnSave').addEventListener('click', async () => {
  const form = document.getElementById('associateForm');
  if (!form.checkValidity()) { form.reportValidity(); return; }

  const btnSave = document.getElementById('btnSave');
  btnSave.disabled = true;
  btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

  try {
    const payload = {
      employee_id: document.getElementById('formEmployeeId').value.trim(),
      full_name:   document.getElementById('formFullName').value.trim(),
      position:    document.getElementById('formPosition').value,
      level:       document.getElementById('formLevel').value.trim(),
      category:    document.getElementById('formCategory').value.trim(),
      plan:        document.getElementById('formPlan').value.trim(),
      detail_area: document.getElementById('formDetailArea').value.trim(),
      group_area:  document.getElementById('formGroupArea').value.trim(),
      reporting_manager_id: document.getElementById('formReportingManager').value || null,
      salary:      document.getElementById('formSalary').value,
      target_nc:           document.getElementById('formTargetNC')?.value ?? 0,
      current_sip_percent: parseFloat(document.getElementById('formCurrentSIP').value) || 0,
      join_date:           document.getElementById('formJoinDate')?.value || null,
    };
    const monthlyBudget = parseFloat(document.getElementById('formBudgetMonthly').value) || 0;
    MONTH_KEYS.forEach(m => { payload['sip_budget_' + m] = monthlyBudget; });

    let result;
    if (editingId) {
      result = await apiPut(editingId, payload);
    } else {
      result = await apiPost(payload);
    }

    if (result.success) {
      // Auto-create initial Employment History record when adding a new associate
      if (!editingId) {
        const effectiveDate = payload.join_date || new Date().toISOString().slice(0, 10);
        await fetch(HIST_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employee_id:    payload.employee_id,
            position:       payload.position,
            level:          payload.level,
            category:       payload.category,
            plan:           payload.plan,
            salary:         parseFloat(payload.salary) || 0,
            sip_budget:     monthlyBudget,
            effective_date: effectiveDate,
            notes:          'Initial record',
          })
        });
      }
      closeModal('modalOverlay');
      showToast(result.message);
      await loadAssociates(true);
      populateAssociateFilters();
      renderAssociateTable(getAssociateFiltered());
      renderDashboard();
    } else {
      showToast(result.message, 'error');
    }
  } catch (e) {
    showToast('An error occurred: ' + e.message, 'error');
  } finally {
    btnSave.disabled = false;
    btnSave.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save';
  }
});

// ===========================
// DELETE MODAL
// ===========================
function openDeleteModal(empId) {
  const a = associates.find(x => x.employee_id === empId);
  if (!a) return;
  deletingId = empId;
  document.getElementById('deleteName').textContent = `${a.full_name} (${a.employee_id})`;
  openModal('deleteOverlay');
}

document.getElementById('btnDeleteConfirm').addEventListener('click', async () => {
  const btnDel = document.getElementById('btnDeleteConfirm');
  btnDel.disabled = true;
  btnDel.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';

  try {
    const result = await apiDelete(deletingId);
    deletingId = null;
    closeModal('deleteOverlay');
    if (result.success) {
      showToast(result.message);
      await loadAssociates(true);
      populateAssociateFilters();
      renderAssociateTable(getAssociateFiltered());
      renderDashboard();
    } else {
      showToast(result.message, 'error');
    }
  } catch (e) {
    showToast('An error occurred: ' + e.message, 'error');
  } finally {
    btnDel.disabled = false;
    btnDel.innerHTML = '<i class="fa-solid fa-trash"></i> Delete';
  }
});

// ===========================
// SIP MONTHLY BUDGET TABLE
// ===========================
async function renderSIPMonthly(historyData) {
  const tbody = document.getElementById('sipMonthlyBody');
  if (!tbody) return;

  const assoc         = associates.find(x => x.employee_id === detailEmpId);
  const defaultSalary = assoc ? assoc.salary : 0;

  // Fetch DB weights for this associate
  let dbWeights = {}; // component label → weight value
  if (assoc) {
    try {
      const year = new Date().getFullYear();
      const res  = await fetch(`api/kpi_targets.php?employee_id=${encodeURIComponent(detailEmpId)}&year=${year}`);
      const json = await res.json();
      if (json.success) json.data.forEach(r => { dbWeights[r.component] = r.weight; });
    } catch(e) { /* silently use defaults */ }
  }

  if (historyData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="no-data">Add an employment history record first.</td></tr>`;
    updateDetailCalcFields(defaultSalary * 12, 0);
    renderSIPKpiTable([], 0, assoc, dbWeights);
    return;
  }

  // Sort ascending by effective_date so we can look up "last applicable"
  const sorted = [...historyData].sort((a, b) => a.effective_date.localeCompare(b.effective_date));
  const year   = new Date().getFullYear();

  let rows         = '';
  let totalSIP     = 0;
  let annualSalary = 0;

  for (let m = 0; m < 12; m++) {
    const lastDay  = new Date(year, m + 1, 0).getDate();
    const monthEnd = `${year}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const monthStart = `${year}-${String(m + 1).padStart(2, '0')}-01`;

    // Latest history entry with effective_date <= end of this month
    let applicable = null;
    for (const h of sorted) {
      if (h.effective_date <= monthEnd) applicable = h;
    }

    const resignDate = assoc && assoc.resign_date ? assoc.resign_date : null;
    const resignMonthStart = resignDate ? resignDate.substring(0, 7) + '-01' : null;
    // Month is fully after resign → budget = 0
    const isAfterResign  = resignMonthStart && monthStart > resignMonthStart;
    // Month is the resign month itself → prorate up to resign date
    const isResignMonth  = resignDate && resignDate >= monthStart && resignDate <= monthEnd;

    let budget      = (applicable && !isAfterResign) ? applicable.sip_budget : 0;
    const salary    = applicable ? applicable.salary   : defaultSalary;
    const position  = applicable ? applicable.position : null;
    const isCurrent = m === NOW_MONTH;

    // Proration notes accumulate (join at end)
    const prorationParts = [];

    // Proration 1 – new position starts mid-month
    if (budget > 0 && applicable && applicable.effective_date > monthStart && applicable.effective_date <= monthEnd) {
      const totalWork = countWorkingDays(monthStart, monthEnd);
      const fromWork  = countWorkingDays(applicable.effective_date, monthEnd);
      if (totalWork > 0) {
        budget = Math.round((fromWork / totalWork) * budget);
        prorationParts.push(`<span title="Posisi baru: ${fromWork}/${totalWork} hari kerja" style="font-size:10px;color:#7c3aed;cursor:help;">(${fromWork}/${totalWork} WD)</span>`);
      }
    }

    // Proration 2 – resign happens within this month
    if (budget > 0 && isResignMonth) {
      const totalWork   = countWorkingDays(monthStart, monthEnd);
      const workedDays  = countWorkingDays(monthStart, getPreviousDate(resignDate));
      if (totalWork > 0) {
        budget = Math.round((workedDays / totalWork) * budget);
        prorationParts.push(`<span title="Resign: ${workedDays}/${totalWork} hari kerja" style="font-size:10px;color:#dc2626;cursor:help;">(resign ${workedDays}/${totalWork} WD)</span>`);
      }
    }

    const prorationNote = prorationParts.length ? ' ' + prorationParts.join(' ') : '';

    // SIP Budget hierarchy breakdown
    const cw           = budget * SIP_CW_PCT / 100;
    const sales        = budget * SIP_SALES_PCT / 100;
    const monthlySales = sales  * SIP_MONTHLY_SALES_PCT / 100;
    const quarter      = sales  * SIP_QUARTER_PCT / 100;

    totalSIP     += budget;
    annualSalary += salary;

    const fmt = v => v > 0 ? formatRupiah(v) : '<span style="color:#94a3b8">—</span>';

    const resignBadge = isAfterResign
      ? ' <span class="badge badge-red" style="font-size:10px;">Resigned</span>'
      : isResignMonth
        ? ' <span class="badge badge-red" style="font-size:10px;">Resign Month</span>'
        : '';
    rows += `<tr${isCurrent ? ' class="sip-current-month"' : ''}${isAfterResign ? ' style="opacity:.45;"' : ''}>
      <td><strong>${MONTH_NAMES[m]}</strong>${isCurrent ? ' <span class="badge badge-blue" style="font-size:10px;">Current</span>' : ''}${resignBadge}</td>
      <td>${position ?? '<span style="color:#94a3b8">\u2014</span>'}</td>
      <td style="text-align:right;">${fmt(budget)}${prorationNote}</td>
      <td style="text-align:right;background:#fdf4ff;">${fmt(cw)}</td>
      <td style="text-align:right;background:#f0fdf4;">${fmt(monthlySales)}</td>
      <td style="text-align:right;background:#fff7ed;">${fmt(quarter)}</td>
    </tr>`;
  }

  rows += `<tr class="sip-total-row">
    <td colspan="2"><strong>Total</strong></td>
    <td style="text-align:right;"><strong>${formatRupiah(totalSIP)}</strong></td>
    <td style="text-align:right;background:#fdf4ff;"><strong>${formatRupiah(totalSIP * SIP_CW_PCT / 100)}</strong></td>
    <td style="text-align:right;background:#f0fdf4;"><strong>${formatRupiah(totalSIP * SIP_SALES_PCT / 100 * SIP_MONTHLY_SALES_PCT / 100)}</strong></td>
    <td style="text-align:right;background:#fff7ed;"><strong>${formatRupiah(totalSIP * SIP_SALES_PCT / 100 * SIP_QUARTER_PCT / 100)}</strong></td>
  </tr>`;

  tbody.innerHTML = rows;
  updateDetailCalcFields(annualSalary, totalSIP);
  renderSIPKpiTable(sorted, year, assoc, dbWeights);
  renderSIPQuarterKpiTable(sorted, year, assoc, dbWeights);
}

function renderSIPQuarterKpiTable(sorted, year, assoc, dbWeights = {}) {
  const thead = document.getElementById('sipQuarterKpiHead');
  const tbody = document.getElementById('sipQuarterKpiBody');
  if (!thead || !tbody) return;

  const level     = assoc ? assoc.level : null;
  const baseItems = level ? (KPI_TARGETS[level] || []) : [];

  if (!baseItems.length) {
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td colspan="2" class="no-data">No KPI defined for this level.</td></tr>';
    return;
  }

  if (!sorted.length) {
    const cols = baseItems.length + 2;
    thead.innerHTML = '';
    tbody.innerHTML = `<tr><td colspan="${cols}" class="no-data">Add an employment history record first.</td></tr>`;
    return;
  }

  const quarterMonths = [
    ['jan', 'feb', 'mar'],
    ['apr', 'may', 'jun'],
    ['jul', 'aug', 'sep'],
    ['oct', 'nov', 'dec'],
  ];
  const quarterLabels = ['Q1 (Jan–Mar)', 'Q2 (Apr–Jun)', 'Q3 (Jul–Sep)', 'Q4 (Oct–Dec)'];

  const kpiHeaders = baseItems.filter(it => it.label !== 'Closed Won/Consumption').map(it => {
    const col = KPI_COLORS[it.label] || {};
    const s   = col.bg ? `background:${col.bg};border-bottom:3px solid ${col.border};` : '';
    return `<th style="text-align:right;${s}">${it.label}</th>`;
  }).join('');
  thead.innerHTML = `<tr><th>Quarter</th>${kpiHeaders}<th style="text-align:right;">Total</th></tr>`;

  const rows = quarterMonths.map((months, qi) => {
    let rowTotal = 0;
    const cells = baseItems.filter(it => it.label !== 'Closed Won/Consumption').map((it) => {
      const col = KPI_COLORS[it.label] || {};
      const bg  = col.bg ? `background:${col.bg};` : '';
      const effectiveWt = (dbWeights[it.label] != null) ? dbWeights[it.label] : it.pct;
      const baseKpi = KPI_TARGETS[level] || [];

      let amount = 0;
      for (const mk of months) {
        const monthIdx = MONTH_KEYS.indexOf(mk);
        const lastDay  = new Date(year, monthIdx + 1, 0).getDate();
        const monthEnd = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        const monthStart = `${year}-${String(monthIdx + 1).padStart(2, '0')}-01`;

        let applicable = null;
        for (const h of sorted) {
          if (h.effective_date <= monthEnd) applicable = h;
        }

        const resignDate = assoc && assoc.resign_date ? assoc.resign_date : null;
        const resignMonthStart = resignDate ? resignDate.substring(0, 7) + '-01' : null;
        const isAfterResign = resignMonthStart && monthStart > resignMonthStart;
        const isResignMonth = resignDate && resignDate >= monthStart && resignDate <= monthEnd;

        let budget = (applicable && !isAfterResign) ? applicable.sip_budget : 0;

        if (budget > 0 && applicable && applicable.effective_date > monthStart && applicable.effective_date <= monthEnd) {
          const totalWork = countWorkingDays(monthStart, monthEnd);
          const fromWork  = countWorkingDays(applicable.effective_date, monthEnd);
          if (totalWork > 0) budget = Math.round((fromWork / totalWork) * budget);
        }

        if (budget > 0 && isResignMonth) {
          const totalWork  = countWorkingDays(monthStart, monthEnd);
          const workedDays = countWorkingDays(monthStart, getPreviousDate(assoc.resign_date));
          if (totalWork > 0) budget = Math.round((workedDays / totalWork) * budget);
        }

        if (it.label === 'Closed Won/Consumption') {
          amount += budget * SIP_CW_PCT / 100;
        } else {
          let weightFactor = 0;
          if (it._sub) {
            const parentKpi   = baseKpi.find(x => x.label === it._parent);
            const parentPct   = parentKpi ? parentKpi.pct : 0;
            const subSplitPct = it._sub === 'Distributor' ? JABODETABEK_DIST_PCT : JABODETABEK_DIR_PCT;
            weightFactor = (parentPct / 100) * (subSplitPct / 100);
          } else {
            weightFactor = effectiveWt / 100;
          }
          amount += budget * SIP_QUARTER_PCT / 100 * weightFactor;
        }
      }

      rowTotal += amount;
      const fmt = amount > 0 ? formatRupiah(amount) : '<span style="color:#94a3b8">—</span>';
      return `<td style="text-align:right;${bg}">${fmt}</td>`;
    }).join('');

    return `<tr>
      <td><strong>${quarterLabels[qi]}</strong></td>
      ${cells}
      <td style="text-align:right;"><strong>${formatRupiah(rowTotal)}</strong></td>
    </tr>`;
  }).join('');

  tbody.innerHTML = rows;
}

function renderSIPKpiTable(sorted, year, assoc, dbWeights = {}) {
  const thead = document.getElementById('sipKpiHead');
  const tbody = document.getElementById('sipKpiBody');
  if (!thead || !tbody) return;

  const level     = assoc ? assoc.level : null;
  const baseItems = level ? (KPI_TARGETS[level] || []) : [];

  if (!baseItems.length) {
    thead.innerHTML = '';
    tbody.innerHTML = `<tr><td colspan="2" class="no-data">No KPI defined for this level.</td></tr>`;
    return;
  }

  if (!sorted.length) {
    const cols = baseItems.length + 2;
    thead.innerHTML = '';
    tbody.innerHTML = `<tr><td colspan="${cols}" class="no-data">Add an employment history record first.</td></tr>`;
    return;
  }

  // Build header
  const kpiHeaders = baseItems.map(it => {
    const col = KPI_COLORS[it.label] || {};
    const s   = col.bg ? `background:${col.bg};border-bottom:3px solid ${col.border};` : '';
    return `<th style="text-align:right;${s}">${it.label}</th>`;
  }).join('');
  thead.innerHTML = `<tr><th>Month</th>${kpiHeaders}<th style="text-align:right;">Total</th></tr>`;

  const kpiTotals = baseItems.map(() => 0);
  let grandTotal  = 0;
  let rows        = '';

  const resignMonthStart = assoc && assoc.resign_date ? assoc.resign_date.substring(0, 7) + '-01' : null;

  for (let m = 0; m < 12; m++) {
    const lastDay  = new Date(year, m + 1, 0).getDate();
    const monthEnd = `${year}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const monthStart = `${year}-${String(m + 1).padStart(2, '0')}-01`;
    let applicable = null;
    for (const h of sorted) {
      if (h.effective_date <= monthEnd) applicable = h;
    }

    // Month fully after resign → 0; resign month itself → prorate
    const isAfterResign  = resignMonthStart && monthStart > resignMonthStart;
    const isResignMonth  = assoc && assoc.resign_date && assoc.resign_date >= monthStart && assoc.resign_date <= monthEnd;

    let budget      = (applicable && !isAfterResign) ? applicable.sip_budget : 0;
    const isCurrent = m === NOW_MONTH;

    const kpiProrationParts = [];

    // Proration 1 – new position starts mid-month
    if (budget > 0 && applicable && applicable.effective_date > monthStart && applicable.effective_date <= monthEnd) {
      const totalWork = countWorkingDays(monthStart, monthEnd);
      const fromWork  = countWorkingDays(applicable.effective_date, monthEnd);
      if (totalWork > 0) {
        budget = Math.round((fromWork / totalWork) * budget);
        kpiProrationParts.push(`<span style="font-size:10px;color:#7c3aed;">(${fromWork}/${totalWork} WD)</span>`);
      }
    }

    // Proration 2 – resign happens within this month
    if (budget > 0 && isResignMonth) {
      const totalWork  = countWorkingDays(monthStart, monthEnd);
      const workedDays = countWorkingDays(monthStart, getPreviousDate(assoc.resign_date));
      if (totalWork > 0) {
        budget = Math.round((workedDays / totalWork) * budget);
        kpiProrationParts.push(`<span style="font-size:10px;color:#dc2626;">(resign ${workedDays}/${totalWork} WD)</span>`);
      }
    }

    const prorationNote = kpiProrationParts.length ? ' ' + kpiProrationParts.join(' ') : '';

    let rowTotal = 0;
    const cells = baseItems.map((it, idx) => {
      const col           = KPI_COLORS[it.label] || {};
      const bg            = col.bg ? `background:${col.bg};` : '';
      const effectiveWt   = (dbWeights[it.label] != null) ? dbWeights[it.label] : it.pct;
      const amount = it.label === 'Closed Won/Consumption'
        ? budget * SIP_CW_PCT / 100
        : (effectiveWt / 100) * (budget * SIP_MONTHLY_SALES_PCT / 100);
      kpiTotals[idx] += amount;
      rowTotal        += amount;
      const fmt = amount > 0 ? formatRupiah(amount) : '<span style="color:#94a3b8">—</span>';
      return `<td style="text-align:right;${bg}">${fmt}</td>`;
    }).join('');

    grandTotal += rowTotal;
    const rowTotalFmt = rowTotal > 0 ? `<strong>${formatRupiah(rowTotal)}</strong>` : '<span style="color:#94a3b8">—</span>';
    const kpiResignBadge = isAfterResign
      ? ' <span class="badge badge-red" style="font-size:10px;">Resigned</span>'
      : isResignMonth
        ? ' <span class="badge badge-red" style="font-size:10px;">Resign Month</span>'
        : '';
    rows += `<tr${isCurrent ? ' class="sip-current-month"' : ''}${isAfterResign ? ' style="opacity:.45;"' : ''}>
      <td><strong>${MONTH_NAMES[m]}</strong>${isCurrent ? ' <span class="badge badge-blue" style="font-size:10px;">Current</span>' : ''}${kpiResignBadge}${prorationNote}</td>
      ${cells}
      <td style="text-align:right;">${rowTotalFmt}</td>
    </tr>`;
  }

  // Total row
  const totalCells = baseItems.map((it, idx) => {
    const col = KPI_COLORS[it.label] || {};
    const bg  = col.bg ? `background:${col.bg};` : '';
    return `<td style="text-align:right;${bg}"><strong>${formatRupiah(kpiTotals[idx])}</strong></td>`;
  }).join('');
  rows += `<tr class="sip-total-row">
    <td><strong>Total</strong></td>
    ${totalCells}
    <td style="text-align:right;"><strong>${formatRupiah(grandTotal)}</strong></td>
  </tr>`;

  tbody.innerHTML = rows;
}

function updateDetailCalcFields(annualSalary, totalSIP) {
  _lastDetailAS = annualSalary;
  _lastDetailTotalSIP = totalSIP;
  const portion = (annualSalary + totalSIP) > 0
    ? ((totalSIP / (annualSalary + totalSIP)) * 100).toFixed(2)
    : '0.00';
  const elAS   = document.getElementById('detailAnnualSalary');
  const elASIP = document.getElementById('detailAnnualSIPBudget');
  const elComp = document.getElementById('detailComparisio');
  const elSP   = document.getElementById('detailSIPPortion');
  if (elAS)   elAS.textContent   = formatRupiah(annualSalary);
  if (elASIP) elASIP.textContent = formatRupiah(totalSIP);
  if (elComp) elComp.textContent = portion + '%';
  if (elSP)   elSP.textContent   = portion + '%';
}

// ===========================
// MODAL HELPERS
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.getElementById('modalClose').addEventListener('click',      () => closeModal('modalOverlay'));
document.getElementById('btnCancel').addEventListener('click',       () => closeModal('modalOverlay'));
document.getElementById('deleteClose').addEventListener('click',     () => closeModal('deleteOverlay'));
document.getElementById('btnDeleteCancel').addEventListener('click', () => closeModal('deleteOverlay'));
document.getElementById('detailClose').addEventListener('click',     () => closeModal('detailOverlay'));
document.getElementById('detailCloseBtn').addEventListener('click',  () => closeModal('detailOverlay'));
document.getElementById('resignClose').addEventListener('click',     () => closeModal('resignOverlay'));
document.getElementById('btnResignCancel').addEventListener('click', () => closeModal('resignOverlay'));

// Unlock request modal
document.getElementById('unlockRequestClose').addEventListener('click',   () => closeModal('unlockRequestOverlay'));
document.getElementById('unlockRequestCancelBtn').addEventListener('click', () => closeModal('unlockRequestOverlay'));
document.getElementById('btnSubmitUnlockRequest').addEventListener('click', () => submitUnlockRequest());

// Unlock review modal
document.getElementById('unlockReviewClose').addEventListener('click',   () => closeModal('unlockReviewOverlay'));
document.getElementById('btnCloseUnlockReview').addEventListener('click', () => closeModal('unlockReviewOverlay'));

// Close pending requests dropdown when clicking outside the button wrapper
document.addEventListener('click', function(e) {
  const wrap = document.getElementById('sipPendingBtnWrap');
  if (!wrap) return;
  if (!wrap.contains(e.target)) {
    const dd = document.getElementById('sipPendingDropdown');
    if (dd) dd.style.display = 'none';
  }
});

['modalOverlay', 'deleteOverlay', 'detailOverlay', 'resignOverlay',
 'unlockRequestOverlay', 'unlockReviewOverlay'].forEach(id => {
  document.getElementById(id).addEventListener('click', function (e) {
    if (e.target === this) closeModal(id);
  });
});

// ===========================
// DETAIL MODAL
// ===========================
const HIST_API = 'api/employment_history.php';
let detailEmpId = null;
let _lastDetailAS = 0, _lastDetailTotalSIP = 0;

async function openDetailModal(empId) {
  const a = associates.find(x => x.employee_id === empId);
  if (!a) return;
  detailEmpId = empId;

  document.getElementById('detailTitle').innerHTML =
    `<i class="fa-solid fa-id-card"></i> ${a.full_name} <span style="font-weight:400;font-size:13px;color:#64748b;">(${a.employee_id})</span>`;

  // Render info grid
  renderDetailInfoView(a);

  // Show/hide add history button based on role
  const btnAddHistEl = document.getElementById('btnAddHistory');
  if (btnAddHistEl) btnAddHistEl.style.display = currentRole === 'admin' ? '' : 'none';

  // Show/hide edit button based on role
  const btnDetailEditEl = document.getElementById('btnDetailEdit');
  if (btnDetailEditEl) {
    btnDetailEditEl.style.display = currentRole === 'admin' ? '' : 'none';
    btnDetailEditEl.onclick = () => renderDetailInfoEdit(a);
  }

  // Show/hide resign / reactivate buttons
  const isResigned = !!a.resign_date;
  const btnResign     = document.getElementById('btnDetailResign');
  const btnReactivate = document.getElementById('btnDetailReactivate');
  if (currentRole === 'admin') {
    if (btnResign)     { btnResign.style.display     = isResigned ? 'none' : ''; btnResign.onclick     = () => openResignModal(empId); }
    if (btnReactivate) { btnReactivate.style.display = isResigned ? ''     : 'none'; btnReactivate.onclick = () => confirmReactivate(empId); }
  } else {
    if (btnResign)     btnResign.style.display     = 'none';
    if (btnReactivate) btnReactivate.style.display = 'none';
  }

  // Reset history form
  document.getElementById('historyForm').style.display = 'none';
  document.getElementById('hFormPosition').value  = '';
  document.getElementById('hFormLevel').value     = '';
  document.getElementById('hFormCategory').value  = '';
  document.getElementById('hFormPlan').value      = '';
  document.getElementById('hFormSalary').value    = '';
  document.getElementById('hFormSIPBudget').value = '';
  document.getElementById('hFormDate').value      = '';
  document.getElementById('hFormNotes').value     = '';

  openModal('detailOverlay');
  renderKPI(a.level, empId, a.detail_area);
  await loadHistory(empId);
}

// ── Detail info card: view mode ──
function renderDetailInfoView(a) {
  const budgetCurrent = a.sip_budget_current || 0;
  const sipPctDisplay = a.current_sip_percent > 0 ? a.current_sip_percent + '%' : '<span style="color:#94a3b8">—</span>';
  const spinner = '<i class="fa-solid fa-spinner fa-spin" style="font-size:11px;color:#94a3b8;"></i>';
  const resignBadge = a.resign_date
    ? `<span class="badge badge-red" style="margin-left:6px;font-size:11px;"><i class="fa-solid fa-user-slash" style="margin-right:3px;"></i>Resigned ${formatDisplayDate(a.resign_date)}</span>`
    : '';
  document.getElementById('detailInfoGrid').innerHTML = `
    <div class="detail-info-item" style="grid-column:1/-1;display:flex;align-items:center;gap:6px;padding-bottom:8px;border-bottom:1px solid var(--border);">
      ${!a.resign_date ? `<span class="badge badge-green"><i class="fa-solid fa-circle-dot" style="margin-right:3px;"></i>Active</span>` : ''}
      ${a.resign_date ? `<span class="badge badge-red"><i class="fa-solid fa-user-slash" style="margin-right:3px;"></i>Resigned · ${formatDisplayDate(a.resign_date)}</span>` : ''}
    </div>
    <div class="detail-info-item"><span class="dil">ID</span><span class="div">${a.employee_id}</span></div>
    <div class="detail-info-item"><span class="dil">Full Name</span><span class="div">${a.full_name}</span></div>
    <div class="detail-info-item"><span class="dil">Initial Position</span><span class="div">${a.position}</span></div>
    <div class="detail-info-item"><span class="dil">Level</span><span class="div">${a.level || '—'}</span></div>
    <div class="detail-info-item"><span class="dil">Category</span><span class="div">${a.category || '—'}</span></div>
    <div class="detail-info-item"><span class="dil">Plan</span><span class="div">${a.plan || '—'}</span></div>
    <div class="detail-info-item"><span class="dil">Detail Area</span><span class="div">${a.detail_area}</span></div>
    <div class="detail-info-item"><span class="dil">Group Area</span><span class="div">${a.group_area}</span></div>
    <div class="detail-info-item"><span class="dil">Reporting Manager</span><span class="div">${a.reporting_manager_name ? escHtml(a.reporting_manager_name) : '<span style="color:#94a3b8">\u2014</span>'}</span></div>
    ${canSeeMoney() ? `
    <div class="detail-info-item"><span class="dil">Monthly Salary</span><span class="div">${formatRupiah(a.salary)}</span></div>
    <div class="detail-info-item"><span class="dil">SIP Budget (${MONTH_NAMES[NOW_MONTH]})</span><span class="div">${formatRupiah(budgetCurrent)}</span></div>
    <div class="detail-info-item"><span class="dil">Annual Salary</span><span class="div" id="detailAnnualSalary">${spinner}</span></div>
    <div class="detail-info-item"><span class="dil">Annual SIP Budget</span><span class="div" id="detailAnnualSIPBudget">${spinner}</span></div>
    <div class="detail-info-item"><span class="dil">Comparisio</span><span class="div" id="detailComparisio">${spinner}</span></div>
    <div class="detail-info-item"><span class="dil">Current SIP%</span><span class="div">${sipPctDisplay}</span></div>` : ''}
    <div class="detail-info-item" style="grid-column: 1 / -1; border-top: 1px solid var(--border); padding-top: 10px; align-items:center; margin-top: 4px;"><span class="dil" style=" color:#22c55e;">Join Date</span><span class="div">${a.join_date ? formatDisplayDate(a.join_date) : '<span style="color:#94a3b8">—</span>'}</span></div>
  `;
}

// ── Detail info card: edit mode ──
function renderDetailInfoEdit(a) {
  const esc = s => String(s ?? '').replace(/"/g, '&quot;');
  const budgetCurrent = a.sip_budget_current || 0;
  const levelOpts  = ['Manager','Leader','Senior','Senior TAC','Junior TAC','Junior']
    .map(l => `<option value="${l}"${a.level === l ? ' selected' : ''}>${l}</option>`).join('');
  const catOpts    = ['Digital Sales','Manager','Sales','Supervisor','TAC','Technical']
    .map(c => `<option value="${c}"${a.category === c ? ' selected' : ''}>${c}</option>`).join('');
  const planOpts   = ['3','2','2L','2T','1','1T']
    .map(p => `<option value="${p}"${String(a.plan) === p ? ' selected' : ''}>${p}</option>`).join('');

  document.getElementById('detailInfoGrid').innerHTML = `
    <div class="detail-info-item"><span class="dil">ID</span><span class="div">${esc(a.employee_id)}</span></div>
    <div class="detail-info-item"><span class="dil">Full Name</span><input class="detail-edit-input" id="dEdit-fullName" value="${esc(a.full_name)}" /></div>
    <div class="detail-info-item"><span class="dil">Initial Position</span><input class="detail-edit-input" id="dEdit-position" value="${esc(a.position)}" /></div>
    <div class="detail-info-item"><span class="dil">Level</span><select class="detail-edit-input" id="dEdit-level"><option value="">—</option>${levelOpts}</select></div>
    <div class="detail-info-item"><span class="dil">Category</span><select class="detail-edit-input" id="dEdit-category"><option value="">—</option>${catOpts}</select></div>
    <div class="detail-info-item"><span class="dil">Plan</span><select class="detail-edit-input" id="dEdit-plan"><option value="">—</option>${planOpts}</select></div>
    <div class="detail-info-item"><span class="dil">Detail Area</span><input class="detail-edit-input" id="dEdit-detailArea" value="${esc(a.detail_area)}" /></div>
    <div class="detail-info-item"><span class="dil">Group Area</span><input class="detail-edit-input" id="dEdit-groupArea" value="${esc(a.group_area)}" /></div>
    <div class="detail-info-item"><span class="dil">Reporting Manager</span>
      <select class="detail-edit-input" id="dEdit-reportingManager">
        <option value="">\u2014 No Manager \u2014</option>
        ${(() => {
          const dhOpts = deptHeads.map(d => `<option value="${escHtml(d.employee_id)}" ${a.reporting_manager_id === d.employee_id ? 'selected' : ''}>${escHtml(d.full_name)} (${escHtml(d.employee_id)})</option>`).join('');
          const assocOpts = associates.filter(x => !x.resign_date && x.employee_id !== a.employee_id).map(m => `<option value="${escHtml(m.employee_id)}" ${a.reporting_manager_id === m.employee_id ? 'selected' : ''}>${escHtml(m.full_name)} (${escHtml(m.employee_id)})</option>`).join('');
          return (dhOpts ? `<optgroup label="Department Head">${dhOpts}</optgroup>` : '') + (assocOpts ? `<optgroup label="Associates">${assocOpts}</optgroup>` : '');
        })()}
      </select>
    </div>
    <div class="detail-info-item"><span class="dil">Monthly Salary</span><input class="detail-edit-input" id="dEdit-salary" type="number" min="0" value="${a.salary}" /></div>
    <div class="detail-info-item"><span class="dil">SIP Budget (${MONTH_NAMES[NOW_MONTH]})</span><span class="div">${formatRupiah(budgetCurrent)}</span></div>
    <div class="detail-info-item"><span class="dil">Current SIP%</span><input class="detail-edit-input" id="dEdit-currentSIP" type="number" min="0" max="200" step="0.01" value="${a.current_sip_percent || 0}" /></div>
    <div class="detail-info-item" style="grid-column: 1 / -1; border-top: 1px solid var(--border); padding-top: 10px; margin-top: 4px;"><span class="dil">Join Date</span><input class="detail-edit-input" id="dEdit-joinDate" type="date" value="${esc(a.join_date || '')}" style="width:auto;" /></div>
    <div class="detail-info-item" style="display:inline-block;justify-content:flex-end;gap:8px;padding-top:6px;border-top:1px solid var(--border);">
      <button class="btn btn-secondary btn-sm" style="width:auto;" onclick="cancelDetailEdit('${esc(a.employee_id)}')"><i class="fa-solid fa-xmark"></i> Cancel</button>
      <button class="btn btn-primary btn-sm" id="btnDetailSave" style="width:auto;" onclick="saveDetailInlineEdit('${esc(a.employee_id)}')"><i class="fa-solid fa-floppy-disk"></i> Save</button>
    </div>
  `;
  document.getElementById('dEdit-fullName').focus();
}

// ── Inline save ──
async function saveDetailInlineEdit(empId) {
  const a = associates.find(x => x.employee_id === empId);
  if (!a) return;

  const fullName   = document.getElementById('dEdit-fullName').value.trim();
  const position   = document.getElementById('dEdit-position').value.trim();
  const detailArea = document.getElementById('dEdit-detailArea').value.trim();
  const groupArea  = document.getElementById('dEdit-groupArea').value.trim();
  const salary     = document.getElementById('dEdit-salary').value;

  if (!fullName || !position || !detailArea || !groupArea || !salary) {
    showToast('Full Name, Position, Detail Area, Group Area, and Salary are required.', 'error');
    return;
  }

  const payload = {
    employee_id:         empId,
    full_name:           fullName,
    position,
    level:               document.getElementById('dEdit-level').value,
    category:            document.getElementById('dEdit-category').value,
    plan:                document.getElementById('dEdit-plan').value,
    detail_area:         detailArea,
    group_area:          groupArea,
    reporting_manager_id: document.getElementById('dEdit-reportingManager').value || null,
    salary:              parseFloat(salary),
    target_nc:           a.target_nc,
    current_sip_percent: parseFloat(document.getElementById('dEdit-currentSIP').value) || 0,
    join_date: document.getElementById('dEdit-joinDate').value || null,
  };
  MONTH_KEYS.forEach(m => { payload['sip_budget_' + m] = a['sip_budget_' + m] || 0; });

  const btn = document.getElementById('btnDetailSave');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    const result = await apiPut(empId, payload);
    if (result.success) {
      showToast(result.message);
      await loadAssociates(true);
      populateAssociateFilters();
      renderAssociateTable(getAssociateFiltered());
      renderDashboard();
      await openDetailModal(empId);
    } else {
      showToast(result.message, 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save';
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save';
  }
}

// ── Cancel inline edit ──
function cancelDetailEdit(empId) {
  const a = associates.find(x => x.employee_id === empId);
  if (!a) return;
  renderDetailInfoView(a);
  updateDetailCalcFields(_lastDetailAS, _lastDetailTotalSIP);
}

// ===========================
// RESIGN / REACTIVATE
// ===========================
let resigningEmpId = null;

function openResignModal(empId) {
  const a = associates.find(x => x.employee_id === empId);
  if (!a) return;
  resigningEmpId = empId;
  document.getElementById('resignName').textContent = a.full_name;
  document.getElementById('resignDateInput').value  = new Date().toISOString().slice(0, 10);
  openModal('resignOverlay');
}

document.getElementById('btnResignConfirm').addEventListener('click', async () => {
  const date = document.getElementById('resignDateInput').value;
  if (!date) { showToast('Tanggal resign wajib diisi.', 'error'); return; }

  const btn = document.getElementById('btnResignConfirm');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    const res  = await fetch(`${API_URL}?id=${encodeURIComponent(resigningEmpId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resign', resign_date: date })
    });
    const json = await res.json();
    if (json.success) {
      closeModal('resignOverlay');
      showToast(json.message);
      await loadAssociates();
      populateAssociateFilters();
      renderAssociateTable(getAssociateFiltered());
      renderDashboard();
      await openDetailModal(resigningEmpId);
    } else {
      showToast(json.message, 'error');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-user-slash"></i> Konfirmasi Resign';
  }
});

async function confirmReactivate(empId) {
  if (!confirm('Aktifkan kembali associate ini?')) return;
  try {
    const res  = await fetch(`${API_URL}?id=${encodeURIComponent(empId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reactivate' })
    });
    const json = await res.json();
    if (json.success) {
      showToast(json.message);
      await loadAssociates();
      populateAssociateFilters();
      renderAssociateTable(getAssociateFiltered());
      renderDashboard();
      await openDetailModal(empId);
    } else {
      showToast(json.message, 'error');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

async function loadHistory(empId) {
  const tbody = document.getElementById('historyTableBody');
  tbody.innerHTML = `<tr><td colspan="6" class="no-data"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</td></tr>`;
  try {
    const res  = await fetch(`${HIST_API}?employee_id=${encodeURIComponent(empId)}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    renderHistory(json.data);
    renderSIPMonthly(json.data);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="no-data">Failed to load data: ${e.message}</td></tr>`;
  }
}

function renderHistory(data) {
  const tbody = document.getElementById('historyTableBody');
  const _histNumTh = document.querySelector('#historyTable thead th:first-child');
  if (_histNumTh) _histNumTh.style.display = currentRole === 'sales_associate' ? 'none' : '';
  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="no-data">No employment history yet.</td></tr>`;
    return;
  }
  const _histNumStyle = currentRole === 'sales_associate' ? 'display:none' : '';
  tbody.innerHTML = data.map((h, i) => `
    <tr id="hist-row-${h.id}">
      <td style="${_histNumStyle}">${i + 1}</td>
      <td>${h.position}</td>
      <td>${h.level ? `<span class="badge ${getLevelBadge(h.level)}">${h.level}</span>` : '<span style="color:#94a3b8">—</span>'}</td>
      <td>${h.category || '<span style="color:#94a3b8">—</span>'}</td>
      <td>${h.plan ? `<span class="badge ${getPlanBadge(h.plan)}">${h.plan}</span>` : '<span style="color:#94a3b8">—</span>'}</td>
      <td class="money-col">${formatRupiah(h.salary)}</td>
      <td class="money-col">${formatRupiah(h.sip_budget)}</td>
      <td>${formatDisplayDate(h.effective_date)}</td>
      <td>${h.notes || '<span style="color:#94a3b8">—</span>'}</td>
      <td>
        <div class="actions">
          ${currentRole === 'admin' ? `
          <button class="btn-icon edit" title="Edit" onclick="editHistoryRow(${h.id}, '${h.position.replace(/'/g,"\\'")}', '${(h.level||'').replace(/'/g,"\\'")}', '${(h.category||'').replace(/'/g,"\\'")}', '${(h.plan||'').replace(/'/g,"\\'")}', ${h.salary}, ${h.sip_budget}, '${h.effective_date}', '${(h.notes||'').replace(/'/g,"\\'")}')">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn-icon delete" title="Delete" onclick="deleteHistory(${h.id})">
            <i class="fa-solid fa-trash"></i>
          </button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

function editHistoryRow(id, position, level, category, plan, salary, sipBudget, effectiveDate, notes) {
  const row = document.getElementById(`hist-row-${id}`);
  if (!row) return;
  const numTd = row.cells[0];
  const numStyle = numTd.style.display;
  const lvlOptions = ['','Manager','Leader','Senior','Senior TAC','Junior TAC','Junior']
    .map(v => `<option value="${v}" ${v===level?'selected':''}>${v||'-- Level --'}</option>`).join('');
  const catOptions = ['','Digital Sales','Manager','Sales','Supervisor','TAC','Technical']
    .map(v => `<option value="${v}" ${v===category?'selected':''}>${v||'-- Category --'}</option>`).join('');
  const planOptions = ['','3','2','2L','2T','1','1T']
    .map(v => `<option value="${v}" ${v===plan?'selected':''}>${v||'-- Plan --'}</option>`).join('');
  row.innerHTML = `
    <td style="${numStyle}">${numTd.textContent}</td>
    <td><input class="detail-edit-input" id="hEdit-pos-${id}" value="${position.replace(/"/g,'&quot;')}" /></td>
    <td><select class="detail-edit-input" id="hEdit-lv-${id}">${lvlOptions}</select></td>
    <td><select class="detail-edit-input" id="hEdit-cat-${id}">${catOptions}</select></td>
    <td><select class="detail-edit-input" id="hEdit-plan-${id}">${planOptions}</select></td>
    <td><input class="detail-edit-input" id="hEdit-sal-${id}" type="number" min="0" value="${salary}" /></td>
    <td><input class="detail-edit-input" id="hEdit-sip-${id}" type="number" min="0" value="${sipBudget}" /></td>
    <td><input class="detail-edit-input" id="hEdit-date-${id}" type="date" value="${effectiveDate}" /></td>
    <td><input class="detail-edit-input" id="hEdit-notes-${id}" value="${(notes||'').replace(/"/g,'&quot;')}" /></td>
    <td>
      <div class="actions">
        <button class="btn-icon" title="Save" style="color:var(--primary);" onclick="saveHistoryRow(${id})">
          <i class="fa-solid fa-floppy-disk"></i>
        </button>
        <button class="btn-icon" title="Cancel" onclick="loadHistory(detailEmpId)">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    </td>
  `;
  document.getElementById(`hEdit-pos-${id}`).focus();
}

// ── Shared: after any history add/edit/delete, sync detail info + KPI + SIP tables ──
async function _syncDetailAfterHistoryChange(histData) {
  // PATCH associate from the most-recent history entry
  if (histData.length > 0) {
    const latest = [...histData].sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0];
    await fetch(`${API_URL}?id=${detailEmpId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:   'update_info',
        position: latest.position,
        level:    latest.level,
        category: latest.category,
        plan:     latest.plan,
        salary:   parseFloat(latest.salary) || 0
      })
    });
  }
  // Reload associates (force=true to bypass cache) and re-render detail info card
  await loadAssociates(true);
  const freshAssoc = associates.find(x => x.employee_id === detailEmpId);
  if (freshAssoc) {
    renderDetailInfoView(freshAssoc);
    updateDetailCalcFields(_lastDetailAS, _lastDetailTotalSIP);
    const btnDetailEditEl = document.getElementById('btnDetailEdit');
    if (btnDetailEditEl) btnDetailEditEl.onclick = () => renderDetailInfoEdit(freshAssoc);
    // Re-render KPI with the level from the most-recent history entry
    const latestLevel = histData.length > 0
      ? [...histData].sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0].level
      : freshAssoc.level;
    await renderKPI(latestLevel || freshAssoc.level, detailEmpId, freshAssoc.detail_area);
  }
}

async function saveHistoryRow(id) {
  const position  = document.getElementById(`hEdit-pos-${id}`).value.trim();
  const level     = document.getElementById(`hEdit-lv-${id}`).value;
  const category  = document.getElementById(`hEdit-cat-${id}`).value;
  const plan      = document.getElementById(`hEdit-plan-${id}`).value;
  const salary    = document.getElementById(`hEdit-sal-${id}`).value;
  const sipBudget = document.getElementById(`hEdit-sip-${id}`).value;
  const date      = document.getElementById(`hEdit-date-${id}`).value;
  const notes     = document.getElementById(`hEdit-notes-${id}`).value.trim();

  if (!position || !date) {
    showToast('Position dan Effective Date wajib diisi.', 'error');
    return;
  }

  const saveBtn = document.querySelector(`#hist-row-${id} .btn-icon`);
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }

  try {
    const res  = await fetch(`${HIST_API}?id=${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position, level, category, plan, salary: parseFloat(salary)||0, sip_budget: parseFloat(sipBudget)||0, effective_date: date, notes })
    });
    const json = await res.json();
    if (json.success) {
      showToast(json.message);
      const histRes  = await fetch(`${HIST_API}?employee_id=${detailEmpId}`);
      const histJson = await histRes.json();
      const histData = histJson.success ? histJson.data : [];
      renderHistory(histData);
      await renderSIPMonthly(histData);
      await _syncDetailAfterHistoryChange(histData);
    } else {
      showToast(json.message, 'error');
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i>'; }
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i>'; }
  }
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d} ${MONTH_NAMES[parseInt(m,10)-1]} ${y}`;
}

// Toggle add history form
document.getElementById('btnAddHistory').addEventListener('click', () => {
  const form = document.getElementById('historyForm');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('btnCancelHistory').addEventListener('click', () => {
  document.getElementById('historyForm').style.display = 'none';
});

document.getElementById('btnSaveHistory').addEventListener('click', async () => {
  const position  = document.getElementById('hFormPosition').value.trim();
  const salary    = document.getElementById('hFormSalary').value;
  const sipBudget = document.getElementById('hFormSIPBudget').value;
  const date      = document.getElementById('hFormDate').value;
  const notes     = document.getElementById('hFormNotes').value.trim();

  if (!position || !salary || !sipBudget || !date) {
    showToast('Position, Salary, SIP Budget, and Effective Date are required.', 'error');
    return;
  }

  const btn = document.getElementById('btnSaveHistory');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    const res  = await fetch(HIST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: detailEmpId, position,
        level:    document.getElementById('hFormLevel').value,
        category: document.getElementById('hFormCategory').value,
        plan:     document.getElementById('hFormPlan').value,
        salary, sip_budget: sipBudget, effective_date: date, notes
      })
    });
    const json = await res.json();
    if (json.success) {
      document.getElementById('historyForm').style.display  = 'none';
      document.getElementById('hFormPosition').value  = '';
      document.getElementById('hFormLevel').value     = '';
      document.getElementById('hFormCategory').value  = '';
      document.getElementById('hFormPlan').value      = '';
      document.getElementById('hFormSalary').value    = '';
      document.getElementById('hFormSIPBudget').value = '';
      document.getElementById('hFormDate').value      = '';
      document.getElementById('hFormNotes').value     = '';
      showToast(json.message);
      const histResA  = await fetch(`${HIST_API}?employee_id=${encodeURIComponent(detailEmpId)}`);
      const histJsonA = await histResA.json();
      const histDataA = histJsonA.success ? histJsonA.data : [];
      renderHistory(histDataA);
      await renderSIPMonthly(histDataA);
      await _syncDetailAfterHistoryChange(histDataA);
    } else {
      showToast(json.message, 'error');
    }
  } catch (e) {
    showToast('Failed to save: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save';
  }
});

async function deleteHistory(id) {
  if (!confirm('Delete this history record?')) return;
  try {
    const res  = await fetch(`${HIST_API}?id=${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) { showToast(json.message, 'error'); return; }
    showToast(json.message);

    // Fetch fresh history after deletion
    const histRes  = await fetch(`${HIST_API}?employee_id=${encodeURIComponent(detailEmpId)}`);
    const histJson = await histRes.json();
    const histData = histJson.success ? histJson.data : [];

    renderHistory(histData);
    await renderSIPMonthly(histData);
    await _syncDetailAfterHistoryChange(histData);
  } catch (e) {
    showToast('Failed to delete: ' + e.message, 'error');
  }
}

// ===========================
// NAVIGATION — hook summary
// ===========================
const _origNavigateTo = navigateTo;

