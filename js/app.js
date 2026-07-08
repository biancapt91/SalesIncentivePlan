// ===========================
// STATE
// ===========================
let associates  = [];
let annualBudgetMap = {};
let _assocCacheTime = 0;
let editingId   = null;
let deletingId  = null;
let currentPage = 'dashboard';

// ===========================
// CONSTANTS
// ===========================
const TIERS_API    = 'api/sip_tiers.php';

const MONTH_KEYS  = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
const NOW_MONTH   = new Date().getMonth(); // 0-based
const NOW_KEY     = MONTH_KEYS[NOW_MONTH];

// ===========================
// HELPERS
// ===========================
const nativeNumberToLocaleString = Number.prototype.toLocaleString;

Number.prototype.toLocaleString = function(locales, options) {
  return nativeNumberToLocaleString.call(this, locales, {
    ...(options || {}),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

function formatRupiah(amount) {
  return 'Rp ' + Number(amount).toLocaleString('id-ID');
}

function formatActual(value) {
  return Number(value).toLocaleString('id-ID', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function generateUID() {
  const existing = associates.map(a => {
    const n = parseInt(a.employee_id.replace(/\D/g, ''), 10);
    return isNaN(n) ? 0 : n;
  });
  const next = (existing.length ? Math.max(...existing) : 0) + 1;
  return 'EMP-' + String(next).padStart(3, '0');
}

// Count working days between start and end (both inclusive, YYYY-MM-DD strings).
// Excludes Saturdays and Sundays only.
function countWorkingDays(start, end) {
  let count = 0;
  const cur     = new Date(start + 'T00:00:00');
  const endDate = new Date(end   + 'T00:00:00');
  while (cur <= endDate) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function toLocalDate(dateStr) {
  return new Date(`${dateStr}T00:00:00`);
}

function formatDateISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getPreviousDate(dateStr) {
  const d = toLocalDate(dateStr);
  d.setDate(d.getDate() - 1);
  return formatDateISO(d);
}

function formatDate(d) {
  const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function getPlanBadge(plan) {
  const map = {
    '3':  'badge-red',
    '2':  'badge-orange',
    '2L': 'badge-orange',
    '2T': 'badge-teal',
    '1':  'badge-green',
    '1T': 'badge-cyan',
  };
  return map[String(plan)] || 'badge-blue';
}

function getLevelBadge(level) {
  const map = {
    'Manager':    'badge-red',
    'Leader':     'badge-orange',
    'Senior TAC': 'badge-teal',
    'Junior TAC': 'badge-cyan',
    'Senior':     'badge-purple',
    'Junior':     'badge-green',
  };
  return map[level] || 'badge-blue';
}

const KPI_TARGETS = {
  'Manager': [
    { label: 'Individual Sales Leader',   pct: 25 },
    { label: 'Area Sales Leader',         pct: 60 },
    { label: 'Closed Won/Consumption',    pct: 15 },
  ],
  'Leader': [
    { label: 'Individual Sales Leader',   pct: 25 },
    { label: 'Area Sales Leader',         pct: 60 },
    { label: 'Closed Won/Consumption',    pct: 15 },
  ],
  'Senior': [
    { label: 'Individual Sales Non-Leader', pct: 85 },
    { label: 'Closed Won/Consumption',      pct: 15 },
  ],
  'Senior TAC': [
    { label: 'Area Sales TAC',            pct: 40 },
    { label: 'Key Customer',              pct: 45 },
    { label: 'Closed Won/Consumption',    pct: 15 },
  ],
  'Junior TAC': [
    { label: 'Area Sales TAC',            pct: 40 },
    { label: 'Key Customer',              pct: 45 },
    { label: 'Closed Won/Consumption',    pct: 15 },
  ],
  'Junior': [
    { label: 'Individual Sales Non-Leader', pct: 85 },
    { label: 'Closed Won/Consumption',      pct: 15 },
  ],
};

// ── Jabodetabek Distributor / Direct split ──
const JABODETABEK_KEYWORDS     = ['jabodetabek', 'jakarta', 'bogor', 'depok', 'tangerang', 'bekasi'];
const JABODETABEK_DIST_PCT     = 85;
const JABODETABEK_DIR_PCT      = 15;
const JABODETABEK_SPLIT_LABELS = new Set([
  'Individual Sales Leader',
  'Area Sales Leader',
  'Individual Sales Non-Leader',
]);

// ── SIP Budget hierarchy (from diagram) ──
const SIP_SALES_PCT          = 85;  // % of monthly → Sales branch
const SIP_CW_PCT             = 15;  // % of monthly → Closed Won/Consumption
const SIP_MONTHLY_SALES_PCT  = 80;  // % of Sales   → Monthly Sales sub-bucket
const SIP_QUARTER_PCT        = 20;  // % of Sales   → Quarter sub-bucket

// ── Tiered SIP amounts per plan (sales KPIs only) ──
const SIP_TIERS = {
  '3':  { base: 3_000_000, inc85_100: 200_000,             inc101_110: 300_000,             max: 10_000_000 },
  '2L': { base: 2_000_000, inc85_100: 100_000,             inc101_110: 125_000,             max:  5_500_000 },
  '2':  { base: 1_000_000, inc85_100:  50_000,             inc101_110:  87_500,             max:  3_000_000 },
  '2T': { base: 1_000_000, inc85_100:  33_333.3333333333,  inc101_110:  41_666.6666666667,  max:  2_200_000 },
  '1T': { base:   500_000, inc85_100:   8_333.33333333333, inc101_110:  12_500,             max:    900_000 },
  '1':  { base:   750_000, inc85_100:  20_833.3333333333,  inc101_110:  31_250,             max:  1_500_000 },
};

/**
 * Returns the raw SIP earned for a sales KPI based on achievement %.
 * < 85%        → 0
 * 85% – 100%   → base + (pct − 85) × inc85_100          (integer steps from 85)
 * 101% – 110%  → value_at_100% + (pct − 100) × inc101_110 (integer steps from 100)
 * > 110%       → max
 */
function tieredSIP(achievementPct, plan) {
  const t   = SIP_TIERS[plan];
  const pct = achievementPct; // use exact value for linear interpolation between tiers
  if (!t || pct < 85)  return 0;
  if (pct > 110)       return t.max;
  if (pct <= 100)      return t.base + (pct - 85) * t.inc85_100;
  // value at 100% = base + 15 × inc85_100, then add inc101_110 per point above 100
  return t.base + 15 * t.inc85_100 + (pct - 100) * t.inc101_110;
}

function isJabodetabek(detailArea) {
  const lower = (detailArea || '').toLowerCase();
  return JABODETABEK_KEYWORDS.some(k => lower.includes(k));
}

function getKpiItems(level, detailArea) {
  const base = KPI_TARGETS[level];
  if (!base) return null;
  if ((level === 'Manager' || level === 'Leader' || level === 'Senior' || level === 'Junior') && isJabodetabek(detailArea)) {
    return base.flatMap(it => {
      if (JABODETABEK_SPLIT_LABELS.has(it.label)) {
        return [
          { label: it.label, pct: it.pct, _isParentHeader: true },
          { label: `${it.label} - Distributor`, pct: JABODETABEK_DIST_PCT, _parent: it.label, _sub: 'Distributor' },
          { label: `${it.label} - Direct`,      pct: JABODETABEK_DIR_PCT,  _parent: it.label, _sub: 'Direct'      },
        ];
      }
      return [{ ...it }];
    });
  }
  return base;
}

// ── KPI row color map (accent color per component) ──
const KPI_COLORS = {
  'Individual Sales Leader':     { bg: '#eff6ff', border: '#3b82f6' }, // blue
  'Area Sales Leader':           { bg: '#f0fdf4', border: '#22c55e' }, // green
  'Individual Sales Non-Leader': { bg: '#eff6ff', border: '#3b82f6' }, // blue
  'Area Sales TAC':              { bg: '#fff7ed', border: '#f97316' }, // orange
  'Key Customer':                { bg: '#faf5ff', border: '#a855f7' }, // purple
  'Closed Won/Consumption':      { bg: '#fdf4ff', border: '#c026d3' }, // pink
};

function getKpiColor(label) {
  // For sub-rows like "Area Sales Leader - Distributor", match the parent
  for (const [key, val] of Object.entries(KPI_COLORS)) {
    if (label === key || label.startsWith(key + ' - ')) return val;
  }
  return null;
}

async function renderKPI(level, empId, detailArea) {
  const section = document.getElementById('kpiSection');
  const body    = document.getElementById('kpiBody');
  const items   = getKpiItems(level, detailArea);
  if (!items) { section.style.display = 'none'; return; }
  section.style.display = '';

  const year = new Date().getFullYear();
  body.innerHTML = '<div style="padding:16px;color:#94a3b8;font-size:13px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>';

  let existing = {};
  try {
    const res  = await fetch(`api/kpi_targets.php?employee_id=${encodeURIComponent(empId)}&year=${year}`);
    const json = await res.json();
    if (json.success) json.data.forEach(r => { existing[r.component] = r; });
  } catch(e) { /* silently use defaults */ }

  const mHeaders = MONTH_KEYS.map(m => `<th class="kpi-month-th">${m.charAt(0).toUpperCase()+m.slice(1)}</th>`).join('');

  const _kpiNumStyle = currentRole === 'sales_associate' ? ' style="display:none"' : '';
  let prevParent = null;
  let rowNum = 0;
  const rows = items.map((it) => {
    // Parent header row (non-editable, just shows label + total weight)
    if (it._isParentHeader) {
      rowNum++;
      const emptyCells = MONTH_KEYS.map(() => `<td></td>`).join('');
      const col = getKpiColor(it.label);
      const rowStyle = col ? `style="background:${col.bg};border-left:4px solid ${col.border};"` : '';
      return `<tr class="kpi-parent-header" ${rowStyle}>
        <td${_kpiNumStyle}>${rowNum}</td>
        <td class="kpi-label" style="font-weight:600;">${it.label}</td>
        <td class="kpi-pct"><span class="kpi-val">${it.pct}%</span></td>
        ${emptyCells}
        <td></td>
        <td></td>
      </tr>`;
    }
    const row    = existing[it.label] || {};
    const weight = it._sub ? it.pct : ((row.weight != null && Object.keys(row).length > 0) ? row.weight : it.pct);
    const monthVals = MONTH_KEYS.map(k => row[k] != null ? row[k] : 0);
    const annual = monthVals.reduce((s, v) => s + v, 0);
    const cells  = monthVals.map(v => {
      return `<td class="kpi-month-td"><span class="kpi-val">${v > 0 ? v.toLocaleString('id-ID') : '—'}</span></td>`;
    }).join('');
    const annualCell = annual > 0
      ? `<td style="text-align:right;font-weight:600;">${annual.toLocaleString('id-ID')}</td>`
      : `<td style="text-align:center;color:var(--text-muted);">—</td>`;
    const isFirstSub = it._sub && it._parent !== prevParent;
    if (it._sub) prevParent = it._parent; else prevParent = null;
    const rowClass   = it._sub ? `kpi-sub-row${isFirstSub ? ' kpi-sub-first' : ''}` : '';
    const numCell    = it._sub ? `<td${_kpiNumStyle}></td>` : `<td${_kpiNumStyle}>${++rowNum}</td>`;
    const displayLabel = it._sub
      ? `<span class="kpi-sub-arrow">↳</span> ${it._sub}`
      : it.label;
    const col = getKpiColor(it.label);
    const rowStyle = col ? `style="background:${col.bg};border-left:4px solid ${col.border};"` : '';
    return `<tr data-component="${it.label}"${rowClass ? ` class="${rowClass}"` : ''} ${rowStyle}>
      ${numCell}
      <td class="kpi-label">${displayLabel}</td>
      <td class="kpi-pct"><span class="kpi-val">${weight}%</span></td>
      ${cells}
      ${annualCell}
      ${(currentRole === 'admin' || currentRole === 'head_admin') ? `<td><button class="btn-icon edit kpi-edit-btn" title="Edit" onclick="kpiEditRow(this,'${empId}',${year},'${it.label.replace(/'/g,"\\'")}')"><i class="fa-solid fa-pen"></i></button></td>` : '<td></td>'}
    </tr>`;
  }).join('');

  body.innerHTML = `
    <div class="table-responsive">
      <table class="data-table kpi-table">
        <thead>
          <tr>
            <th${_kpiNumStyle}>#</th><th>Key Performance Indicator</th><th>Weight</th>
            ${mHeaders}
            <th style="text-align:right;">Annual Target</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function kpiEditRow(btn, empId, year, component) {
  const tr    = btn.closest('tr');
  const cells = tr.querySelectorAll('.kpi-month-td');
  const isEditing = tr.classList.contains('kpi-editing');

  if (isEditing) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    const pctTd  = tr.querySelector('.kpi-pct');
    const weight = parseFloat(pctTd.querySelector('input')?.value) || 0;
    const payload = { employee_id: empId, year, component, weight };
    cells.forEach((td, i) => {
      payload[MONTH_KEYS[i]] = parseFloat(td.querySelector('input').value) || 0;
    });
    try {
      const res  = await fetch('api/kpi_targets.php', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      pctTd.innerHTML = `<span class="kpi-val">${weight}%</span>`;
      let annual = 0;
      cells.forEach((td, i) => {
        const v = payload[MONTH_KEYS[i]];
        annual += v;
        td.innerHTML = `<span class="kpi-val">${v > 0 ? v.toLocaleString('id-ID') : '—'}</span>`;
      });
      // Update Annual Target cell (second-to-last td in row)
      const annualTd = tr.querySelector('td:nth-last-child(2)');
      if (annualTd) {
        annualTd.style.textAlign = 'right';
        annualTd.style.fontWeight = '600';
        annualTd.style.color = '';
        annualTd.innerHTML = annual > 0 ? annual.toLocaleString('id-ID') : '<span style="text-align:center;color:var(--text-muted)">—</span>';
      }
      tr.classList.remove('kpi-editing');
      btn.innerHTML = '<i class="fa-solid fa-pen"></i>';
      btn.title = 'Edit';
      showToast('Target Achievement saved', 'success');
    } catch(e) {
      showToast('Failed to save: ' + e.message, 'error');
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i>';
    } finally {
      btn.disabled = false;
    }
  } else {
    const pctTd  = tr.querySelector('.kpi-pct');
    const curPct = parseFloat(pctTd.querySelector('.kpi-val')?.textContent) || 0;
    pctTd.innerHTML = `<input type="number" class="kpi-input kpi-pct-input" value="${curPct}" min="0" max="100" step="0.1" />`;
    cells.forEach(td => {
      const raw = (td.querySelector('.kpi-val').textContent || '0').replace(/\./g,'').replace(',','.');
      const num = parseFloat(raw) || 0;
      td.innerHTML = `<input type="number" class="kpi-input" value="${num}" min="0" step="any" />`;
    });
    tr.classList.add('kpi-editing');
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i>';
    btn.title = 'Save';
    tr.querySelector('.kpi-pct-input')?.focus();
  }
}

function getPositionBadge(pos) {
  const map = {
    'Sales Executive':          'badge-blue',
    'Senior Sales Executive':   'badge-purple',
    'Sales Supervisor':         'badge-green',
    'Sales Manager':            'badge-green',
    'Area Sales Manager':       'badge-green',
    'Regional Sales Manager':   'badge-green',
  };
  const cls = map[pos] || 'badge-blue';
  return `<span class="badge ${cls}">${pos}</span>`;
}

function showToast(msg, type = 'success') {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'toast';
  t.textContent = msg;
  t.style.cssText = `
    position:fixed; bottom:24px; right:24px; z-index:9999;
    padding:12px 20px; border-radius:8px; font-size:13.5px; font-weight:500;
    color:#fff; box-shadow:0 4px 16px rgba(0,0,0,.2);
    background:${type === 'success' ? '#16a34a' : '#dc2626'};
    animation: fadeIn .25s ease;
  `;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ===========================
// API CALLS
// ===========================
async function apiGet() {
  const res = await fetch(API_URL);
  const json = await res.json();
  if (!json.success) throw new Error(json.message);
  return json.data;
}

async function apiPost(data) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return await res.json();
}

async function apiPut(id, data) {
  const res = await fetch(`${API_URL}?id=${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return await res.json();
}

async function apiDelete(id) {
  const res = await fetch(`${API_URL}?id=${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
  return await res.json();
}

async function loadAssociates(force = false) {
  if (!force && associates.length && (Date.now() - _assocCacheTime) < 60000) return;
  try {
    const year = new Date().getFullYear();
    [associates, annualBudgetMap] = await Promise.all([
      apiGet(),
      fetch(`${HIST_API}?year=${year}&summary=1`)
        .then(r => r.json())
        .then(j => j.success ? j.data : {})
        .catch(() => ({})),
    ]);
    _assocCacheTime = Date.now();
  } catch (e) {
    associates = [];
    annualBudgetMap = {};
    showToast('Failed to load data from database: ' + e.message, 'error');
  }
}

// set table header to current month name
  const thBudget = document.getElementById('thSIPBudget');
  if (thBudget) thBudget.textContent = `SIP Budget (${MONTH_NAMES[NOW_MONTH]})`;

// Inject money-col CSS rule once
(function() {
  const s = document.createElement('style');
  s.textContent = 'body.role-no-money .money-col { display: none !important; }';
  document.head.appendChild(s);
})();

// Helper: returns true if current role can see monetary data
function canSeeMoney() {
  return currentRole !== 'head_admin' && currentRole !== 'sales_admin';
}

// ===========================
// CLEAR ALL DATA CACHE
// ===========================
function clearAllData() {
  associates = [];
  deptHeads = [];
  annualBudgetMap = {};
  _assocCacheTime = 0;
  _dashCache = null;
  _abRankState = null;
  _calcState = null;
}

// ===========================
// NAVIGATION
// ===========================
const navLinks  = document.querySelectorAll('.nav-link');
const pages     = document.querySelectorAll('.page');
const pageTitle = document.getElementById('pageTitle');

const pageTitles = {
  'dashboard':           'Dashboard',
  'associate':           'Associate',
  'department-head':     'Department Head',
  'new-customer':        'Achievement Board',
  'actual-achievement':  'Actual Achievement Form',
  'summary':             'Summary',
  'sip-payment':        'SIP Payment',
  'calculator':          'Calculator',
  'org-structure':       'Organizational Structure',
  'sip-report':          'SIP Report',
};

async function navigateTo(pageId) {
  currentPage = pageId;
  navLinks.forEach(l => l.classList.toggle('active', l.dataset.page === pageId));
  pages.forEach(p => p.classList.toggle('active', p.id === 'page-' + pageId));
  pageTitle.textContent = pageTitles[pageId] || pageId;

  if (pageId === 'associate' || pageId === 'dashboard') {
    await loadAssociates();
    if (pageId === 'associate') {
      await loadDeptHeads();
      // Sales Associate: show their own rows plus subordinates when present
      const isAreaRole = currentRole === 'head_admin' || currentRole === 'sales_admin';
      let tableData;
      if (currentRole === 'sales_associate' && currentAssociateId) {
        const viewableIds = getViewableEmployeeIds();
        tableData = associates.filter(a => viewableIds.includes(a.employee_id));
      } else if (isAreaRole && currentDetailArea) {
        const _areaList = currentDetailArea.split(',').map(s => s.trim());
        tableData = associates.filter(a => _areaList.includes(a.detail_area));
      } else {
        tableData = associates;
      }
      populateAssociateFilters();
      renderAssociateTable(tableData);
      // Hide add/import buttons and filter toolbar for non-admin
      const btnAdd = document.getElementById('btnAddAssociate');
      if (btnAdd) btnAdd.style.display = currentRole === 'admin' ? '' : 'none';
      const assocToolbar = document.querySelector('#page-associate .toolbar');
      if (assocToolbar) assocToolbar.style.display = (currentRole === 'sales_associate' || isAreaRole) ? 'none' : '';
    }
    if (pageId === 'dashboard') renderDashboard();
  }
  if (pageId === 'department-head') {
    await loadDeptHeads();
    renderDepartmentHeadPage();
  }
  if (pageId === 'actual-achievement') {
    await loadAssociates();
    renderActualAchievementPage();
  }
  if (pageId === 'summary') renderSummary();
  if (pageId === 'calculator') initCalculator();
  if (pageId === 'org-structure') renderOrgStructure();
  if (pageId === 'sip-report') initSIPReport();
  if (pageId === 'new-customer') {
    await loadAssociates();
    initAchievementBoard();
  }
}

navLinks.forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(link.dataset.page);
    if (window.innerWidth <= 768) {
      document.getElementById('sidebar').classList.remove('mobile-open');
    }
  });
});

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
        ? `<div class="ab-kpi-q-need" style="color:#16a34a;">✓ Target Achieved</div>`
        : `<div class="ab-kpi-q-need">Need <strong>${needMore.toLocaleString('id-ID')}</strong> more</div>`;
      if (isCW) {
        return `<div class="ab-kpi-q-card">
          <div class="ab-kpi-q-label">${qLabel}</div>
          <div class="ab-kpi-q-pct" style="color:${pctColor};">${met ? '✓ Met' : '✗ Not Met'}</div>
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
      const pctText  = notSet ? '—' : (met ? '✓ Met' : `${pctVal.toFixed(2)}%`);
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
  const medal     = rank === 1 ? '🥇 ' : rank === 2 ? '🥈 ' : rank === 3 ? '🥉 ' : '';

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
      const label = isAchieved ? '✓ Target Achieved' : '✗ Target Not Achieved';
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
            ? '<span style="font-size:11px;font-weight:700;color:#16a34a;">✓ Met</span>'
            : '<span style="font-size:11px;font-weight:700;color:#dc2626;">✗ Not Met</span>');
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

// ===========================
// CALCULATOR
// ===========================
let _abRankState = null; // { empId, allAchData }
let _calcState = null; // { assoc, level, area, budget, kpiItems, dbTargets, monthKey }

function initCalculator() {
  const assocSel = document.getElementById('calc-associate');
  const monthSel = document.getElementById('calc-month');
  if (!assocSel) return;

  // Populate month selector (Jan → current month)
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
  assocSel.innerHTML = '<option value="">— select associate —</option>';
  
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
  tableWrap.innerHTML = '<div style="padding:16px;color:#94a3b8;font-size:13px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading targets…</div>';

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
      fetch(`api/kpi_targets.php?employee_id=${encodeURIComponent(empId)}&year=${year}`),
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
  document.getElementById('calc-pill-level').textContent  = level || '—';
  document.getElementById('calc-pill-area').textContent   = area  || '—';
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
    const label = it._sub ? `<span class="kpi-sub-arrow">↳</span> ${it._sub}` : it.label;

    let wfDisp;
    if (isCW) {
      wfDisp = `<span style="color:#7c3aed;font-weight:600;font-size:12px;">15% × SIP Budget</span>`;
    } else if (dbWeight === 0) {
      wfDisp = `<span style="color:var(--text-muted);font-size:12px;">0% (excluded)</span>`;
    } else if (it._sub) {
      const parentPct = baseKpi.find(x => x.label === it._parent)?.pct || 0;
      const subPct    = it._sub === 'Distributor' ? JABODETABEK_DIST_PCT : JABODETABEK_DIR_PCT;
      wfDisp = `<span style="color:var(--text-muted);font-size:12px;">80% × ${parentPct}%×${subPct}%</span>`;
    } else {
      wfDisp = `<span style="color:var(--text-muted);font-size:12px;">80% × ${dbWeight}%</span>`;
    }

    const targetDisp = target > 0
      ? target.toLocaleString('id-ID')
      : `<span style="color:#94a3b8">—</span>`;

    return `<tr style="${bg}">
      <td style="${numStyle}">${rowNum}</td>
      <td>${label}</td>
      <td style="text-align:right;">${targetDisp}</td>
      <td style="text-align:right;"><input type="number" class="calc-inp" data-idx="${idx}" min="0" placeholder="0" /></td>
      <td id="calc-ach-${idx}" style="text-align:center;">—</td>
      <td id="calc-tiered-${idx}" style="text-align:center;">—</td>
      <td style="text-align:center;">${wfDisp}</td>
      <td id="calc-earned-${idx}" style="text-align:right;font-weight:600;"><span style="color:#94a3b8">—</span></td>
    </tr>`;
  }).join('');

  tableWrap.innerHTML = `
    <div style="padding:12px 16px 8px;background:#f8fafc;border-bottom:1px solid var(--border);font-size:13px;color:var(--text-secondary);">
      <strong style="color:var(--text-primary);">${monthName} ${year}</strong>
      &nbsp;·&nbsp; MONTHLY Budget: <strong>${formatRupiah(budget)}</strong>
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
      achEl.innerHTML    = '<span style="color:#94a3b8">—</span>';
      tieredEl.innerHTML = '<span style="color:#94a3b8">—</span>';
      earnedEl.innerHTML = '<span style="color:#94a3b8">—</span>';
      continue;
    }

    const achPct = actual / target * 100;
    const pctCls = achPct >= 100 ? 'actual-pct-met' : achPct >= 85 ? 'actual-pct-partial' : 'actual-pct-low';
    achEl.innerHTML = `<span class="${pctCls}">${achPct.toFixed(2)}%</span>`;

    let earned = 0;

    if (isCW) {
      const met = actual >= target;
      tieredEl.innerHTML = target > 0
        ? (met ? '<span class="actual-pct-met">Met ✓</span>' : '<span class="actual-pct-low">Not Met</span>')
        : '<span style="color:#94a3b8">—</span>';
      earned = met ? Math.round(budget * SIP_CW_PCT / 100) : 0;
    } else if (dbWeight === 0) {
      tieredEl.innerHTML = '<span style="color:var(--text-muted)">—</span>';
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

// ===========================
// ORGANIZATIONAL STRUCTURE
// ===========================
async function renderOrgStructure() {
  const container = document.getElementById('orgStructureContainer');
  if (!container) return;

  // Show loading
  container.innerHTML = `
    <div style="text-align:center;color:#94a3b8;padding:40px 20px;">
      <i class="fa-solid fa-spinner fa-spin" style="font-size:24px;margin-bottom:12px;"></i>
      <div>Loading organizational structure...</div>
    </div>`;

  // Load data
  await Promise.all([loadAssociates(), loadDeptHeads()]);

  // Filter out resigned associates (those with resign_date set)
  const activeAssociates = associates.filter(a => !a.resign_date);

  // Combine active associates and department heads
  const allPeople = [
    ...activeAssociates.map(a => ({
      id: a.employee_id,
      name: a.full_name,
      position: a.level || 'Associate',
      detail_area: a.detail_area || '',
      reporting_to: a.reporting_manager_id,
      type: 'associate'
    })),
    ...deptHeads.map(d => ({
      id: d.employee_id,
      name: d.full_name,
      position: d.position || 'Department Head',
      detail_area: '',
      reporting_to: d.reporting_manager_id,
      type: 'dept_head'
    }))
  ];

  console.log('[OrgStructure] Total people:', allPeople.length);
  console.log('[OrgStructure] Active Associates:', activeAssociates.length, 'Department Heads:', deptHeads.length);
  console.log('[OrgStructure] Filtered out resigned:', associates.length - activeAssociates.length);
  console.log('[OrgStructure] Sample data:', allPeople.slice(0, 5));

  // Build tree structure
  function buildTree(parentId) {
    const children = allPeople.filter(p => p.reporting_to === parentId);
    console.log(`[OrgStructure] Building tree for parent '${parentId}': found ${children.length} children`);
    
    // Sort by detail area first, then by level, then alphabetically by name.
    const detailAreaKey = (value) => (value || '').trim().toLowerCase();
    const levelPriority = (position) => {
      const pos = (position || '').toLowerCase();
      if (pos.includes('manager')) return 1;
      if (pos.includes('leader')) return 2;
      if (pos.includes('senior')) return 3;
      if (pos.includes('junior')) return 4;
      return 5;
    };

    return children
      .sort((a, b) => {
        const areaA = detailAreaKey(a.detail_area || '');
        const areaB = detailAreaKey(b.detail_area || '');
        const areaDiff = (areaA === '' ? 1 : 0) - (areaB === '' ? 1 : 0) || areaA.localeCompare(areaB, 'id');
        if (areaDiff !== 0) return areaDiff;

        const priorityA = levelPriority(a.position);
        const priorityB = levelPriority(b.position);
        if (priorityA !== priorityB) return priorityA - priorityB;

        return a.name.localeCompare(b.name, 'id');
      })
      .map(person => ({
        ...person,
        children: buildTree(person.id)
      }));
  }

  // Find root (Voon San Wong or anyone with no manager)
  const roots = allPeople.filter(p => !p.reporting_to || p.reporting_to === '');
  
  console.log('[OrgStructure] Root nodes:', roots.length, roots.map(r => ({name: r.name, id: r.id, reporting_to: r.reporting_to})));
  console.log('[OrgStructure] People reporting to "1":', allPeople.filter(p => p.reporting_to === '1').length);
  console.log('[OrgStructure] People reporting to null:', allPeople.filter(p => p.reporting_to === null).length);
  console.log('[OrgStructure] People reporting to empty string:', allPeople.filter(p => p.reporting_to === '').length);

  if (roots.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;color:#94a3b8;padding:40px 20px;">
        <i class="fa-solid fa-circle-info" style="font-size:24px;margin-bottom:12px;"></i>
        <div>No organizational structure found</div>
      </div>`;
    return;
  }

  // Build complete tree for each root
  const rootTrees = roots.map(root => ({
    ...root,
    children: buildTree(root.id)
  }));

  function groupChildrenByDetailArea(children) {
    const groups = new Map();
    children.forEach(child => {
      const key = (child.detail_area || '').trim() || 'Unassigned';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(child);
    });

    return [...groups.entries()].map(([area, items]) => ({ area, items }));
  }

  function renderChildrenList(children, allChildrenAreLeaves) {
    if (!allChildrenAreLeaves) {
      return `<ul>${children.map(child => renderNode(child)).join('')}</ul>`;
    }

    const grouped = groupChildrenByDetailArea(children);
    const listClass = 'leaf-list grouped-children';

    if (grouped.length <= 1) {
      return `<ul class="${listClass}">${children.map(child => renderLeafNode(child)).join('')}</ul>`;
    }

    return `<ul class="${listClass}">${grouped.map(group => `
      <li class="child-group">
        <div class="child-group-label">${escHtml(group.area)}</div>
        <ul class="leaf-group-items">
          ${group.items.map(child => renderLeafNode(child)).join('')}
        </ul>
      </li>
    `).join('')}</ul>`;
  }

  // Render tree as HTML with connecting lines
  function renderNode(node) {
    const hasChildren = node.children && node.children.length > 0;
    const bgColor = node.type === 'dept_head' ? '#1e6ba8' : '#1e6ba8';
    const icon = node.type === 'dept_head' ? 'fa-user-tie' : 'fa-user';
    
    // Check if all children are leaf nodes (no grandchildren)
    const allChildrenAreLeaves = hasChildren && node.children.every(child => !child.children || child.children.length === 0);
    
    // Show detail area only for associates
    const detailAreaHtml = (node.type === 'associate' && node.detail_area) 
      ? `<div style="font-size:8px;color:rgba(255,255,255,0.7);margin-top:1px;">${escHtml(node.detail_area)}</div>` 
      : '';
    
    return `
      <li>
        <div class="org-card" style="background:${bgColor};">
          <i class="fa-solid ${icon}" style="color:#fff;font-size:11px;margin-bottom:4px;"></i>
          <div style="font-weight:600;font-size:10px;color:#fff;line-height:1.3;">${escHtml(node.name)}</div>
          <div style="font-size:9px;color:rgba(255,255,255,0.8);margin-top:2px;line-height:1.2;">${escHtml(node.position)}</div>
          ${detailAreaHtml}
          <div style="font-size:8px;color:rgba(255,255,255,0.6);margin-top:2px;">${escHtml(node.id)}</div>
        </div>
        ${hasChildren ? renderChildrenList(node.children, allChildrenAreLeaves) : ''}
      </li>`;
  }

  // Render leaf nodes in vertical list format
  function renderLeafNode(node) {
    const icon = node.type === 'dept_head' ? 'fa-user-tie' : 'fa-user';
    // Show detail area only for associates
    const detailAreaText = (node.type === 'associate' && node.detail_area) 
      ? ` · ${escHtml(node.detail_area)}` 
      : '';
    return `
      <li class="leaf-item">
        <div class="org-card-leaf">
          <i class="fa-solid ${icon}" style="color:#1e6ba8;font-size:10px;"></i>
          <div style="flex:1;">
            <div style="font-weight:600;font-size:10px;color:#1e293b;line-height:1.3;">${escHtml(node.name)}</div>
            <div style="font-size:8px;color:#64748b;margin-top:1px;">${escHtml(node.position)}${detailAreaText} · ${escHtml(node.id)}</div>
          </div>
        </div>
      </li>`;
  }

  // CSS for org chart
  const orgStyles = `
    <style>
      #orgStructureContainer { padding: 0 !important; overflow-x: auto; }
      .org-tree { margin: 0; padding: 0; position: absolute; display: inline-block; align-items: center; transform: scale(1.0); transform-origin: top center; width: 100%; }
      .org-tree ul { padding-top: 12px; position: relative; }
      .org-tree li { 
        float: left; 
        text-align: center; 
        list-style-type: none; 
        position: relative; 
        padding: 12px 3px 0 1px;
      }
      .org-tree li::before, .org-tree li::after {
        content: '';
        position: absolute;
        top: 0;
        right: 50%;
        border-top: 1px solid #94a3b8;
        width: 50%;
        height: 12px;
      }
      .org-tree li::after {
        right: auto;
        left: 50%;
        border-left: 1px solid #94a3b8;
      }
      .org-tree li:only-child::after, .org-tree li:only-child::before {
        display: none;
      }
      .org-tree li:only-child {
        padding-top: 0;
      }
      .org-tree li:first-child::before, .org-tree li:last-child::after {
        border: 0 none;
      }
      .org-tree li:last-child::before {
        border-right: 1px solid #94a3b8;
        border-radius: 0 3px 0 0;
      }
      .org-tree li:first-child::after {
        border-radius: 3px 0 0 0;
      }
      .org-tree ul ul::before {
        content: '';
        position: absolute;
        top: 0;
        left: 50%;
        border-left: 1px solid #94a3b8;
        width: 0;
        height: 12px;
      }
      .org-card {
        border: 1px solid #1e6ba8;
        padding: 8px 10px;
        text-align: center;
        display: inline-block;
        border-radius: 4px;
        min-width: 85px;
        max-width: 130px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        position: relative;
        background: #1e6ba8;
      }
      .org-tree > ul > li > .org-card {
        margin-top: 12px;
      }
      
      /* Leaf list - vertical layout for bottom-level nodes */
      .leaf-list {
        padding-top: 12px !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        gap: 4px !important;
      }
      .grouped-children {
        padding-top: 12px !important;
        display: flex !important;
        flex-wrap: wrap !important;
        justify-content: center !important;
        align-items: flex-start !important;
        gap: 10px !important;
      }
      .grouped-children > li {
        float: none !important;
        padding: 0 !important;
      }
      .grouped-children > li::before,
      .grouped-children > li::after {
        display: none !important;
      }
      .child-group {
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        min-width: 180px;
        max-width: 240px;
      }
      .child-group-label {
        font-size: 9px;
        font-weight: 700;
        color: #1f2937;
        background: #e2e8f0;
        border: 1px solid #cbd5e1;
        border-radius: 999px;
        padding: 2px 7px;
        margin-bottom: 4px;
      }
      .child-group-items,
      .leaf-group-items {
        display: flex !important;
        flex-direction: column !important;
        align-items: stretch !important;
        gap: 4px !important;
        padding-top: 0 !important;
        margin: 0 !important;
      }
      .child-group-items {
        width: 100%;
      }
      .leaf-group-items .leaf-item {
        width: 100%;
      }
      .leaf-list::before {
        content: '';
        position: absolute;
        top: 0;
        left: 50%;
        border-left: 1px solid #94a3b8;
        width: 0;
        height: 12px;
      }
      .leaf-item {
        float: none !important;
        padding: 0 !important;
        width: 160px;
      }
      .leaf-item::before, .leaf-item::after {
        display: none !important;
      }
      .org-card-leaf {
        background: #f8fafc;
        border: 1px solid #cbd5e1;
        border-left: 2px solid #1e6ba8;
        padding: 6px 10px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        text-align: left;
        width: 100%;
      }
    </style>`;

  // Render all root nodes
  const html = `
    ${orgStyles}
    <div class="org-tree">
      <ul>
        ${rootTrees.map(root => renderNode(root)).join('')}
      </ul>
    </div>`;
  
  container.innerHTML = html;
  console.log('[OrgStructure] Rendered successfully with', rootTrees.length, 'root trees');
}

// ===========================
// SIDEBAR TOGGLE
// ===========================
document.getElementById('toggleBtn').addEventListener('click', () => {
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.toggle('mobile-open');
  } else {
    document.body.classList.toggle('sidebar-collapsed');
  }
});

// ===========================
// TOPBAR DATE
// ===========================
document.getElementById('topbarDate').textContent = formatDate(new Date());

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
    const medals = ['🥇','🥈','🥉'];

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
// SIP REPORT PAGE
// ===========================
const SIP_REPORT_API = 'api/sip_report.php';
const HIST_API_SR    = 'api/employment_history.php';
const UNLOCK_API     = 'api/sip_unlock_request.php';

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
      badge.innerHTML = '<span class="badge badge-green" style="font-size:13px;padding:5px 14px;">✓ PAID</span>';
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
const DEPT_HEAD_API = 'api/department_heads.php';
let deptHeads = [];

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
document.getElementById('btnSubmitUnlockRequest').addEventListener('click', submitUnlockRequest);

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

// ===========================
// NEW CUSTOMER ACHIEVEMENT
// ===========================
const NC_API = 'api/new_customer.php';

// ===========================
// ACTUAL ACHIEVEMENT FORM
// ===========================
const ACTUAL_API = 'api/kpi_actuals.php';

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
      fetch(`api/kpi_targets.php?employee_id=${encodeURIComponent(empId)}&year=${year}`),
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

// ===========================
// AUTH
// ===========================
const loginOverlay = document.getElementById('loginOverlay');
const loginForm    = document.getElementById('loginForm');
const loginError   = document.getElementById('loginError');
const loginSubmit  = document.getElementById('loginSubmit');
const loginSpinner = document.getElementById('loginSpinner');
const loginBtnText = document.getElementById('loginBtnText');
const loginEye     = document.getElementById('loginEye');
const loginEyeIcon = document.getElementById('loginEyeIcon');
const loginPwInput = document.getElementById('loginPassword');

// Toggle password visibility
loginEye.addEventListener('click', () => {
  const visible = loginPwInput.type === 'text';
  loginPwInput.type = visible ? 'password' : 'text';
  loginEyeIcon.className = visible ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
});

function showLoginError(msg) {
  loginError.textContent = msg;
  loginError.style.display = 'block';
}
function hideLoginError() {
  loginError.style.display = 'none';
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideLoginError();
  const username = document.getElementById('loginUsername').value.trim();
  const password = loginPwInput.value;
  if (!username || !password) { showLoginError('Username dan password wajib diisi.'); return; }

  loginSubmit.disabled = true;
  loginBtnText.textContent = 'Signing in...';
  loginSpinner.style.display = 'inline-block';

  try {
    const res  = await fetch('api/auth.php', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    });
    const json = await res.json();
    if (json.success) {
      // Clear old data first
      clearAllData();
      loginOverlay.classList.add('hidden');
      loginForm.reset();
      // Apply role restrictions
      document.getElementById('topbarUsername').textContent = json.fullName || 'Admin';
      applyRole(json.role || 'admin', json.associateId || null, json.detailArea || null);
      // Force reload all data for new user
      await loadAssociates(true);
      await loadDeptHeads();
      await initSIPTiers();
      const roleAfterLogin = json.role || 'admin';
      if (roleAfterLogin === 'sales_associate') {
        navigateTo('summary');
      } else if (roleAfterLogin === 'head_admin' || roleAfterLogin === 'sales_admin') {
        navigateTo('associate');
      } else {
        navigateTo('dashboard');
      }
    } else {
      showLoginError(json.message || 'Login gagal.');
    }
  } catch {
    showLoginError('Gagal terhubung ke server.');
  } finally {
    loginSubmit.disabled = false;
    loginBtnText.textContent = 'Sign In';
    loginSpinner.style.display = 'none';
  }
});

document.getElementById('btnLogout').addEventListener('click', async () => {
  await fetch('api/auth.php?action=logout');
  // Clear all cached data
  clearAllData();
  loginOverlay.classList.remove('hidden');
  document.getElementById('loginUsername').value = '';
  loginPwInput.value = '';
  hideLoginError();
  // Reset role to admin defaults on logout
  applyRole('admin', null);
});

// ===========================
// USER PROFILE DROPDOWN
// ===========================
const userProfileWrap = document.getElementById('userProfileWrap');
const btnUserProfile = document.getElementById('btnUserProfile');
const userProfileDropdown = document.getElementById('userProfileDropdown');

btnUserProfile.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = !userProfileDropdown.classList.contains('hidden');
  userProfileDropdown.classList.toggle('hidden', isOpen);
  btnUserProfile.classList.toggle('active', !isOpen);
});

// Prevent dropdown from closing when clicking inside it
userProfileDropdown.addEventListener('click', (e) => {
  e.stopPropagation();
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!userProfileWrap.contains(e.target)) {
    userProfileDropdown.classList.add('hidden');
    btnUserProfile.classList.remove('active');
  }
});

document.getElementById('btnProfileChangePassword').addEventListener('click', (e) => {
  e.stopPropagation();
  userProfileDropdown.classList.add('hidden');
  btnUserProfile.classList.remove('active');
  openChangePassword();
});

document.getElementById('btnProfileLogout').addEventListener('click', async (e) => {
  e.stopPropagation();
  userProfileDropdown.classList.add('hidden');
  btnUserProfile.classList.remove('active');
  await fetch('api/auth.php?action=logout');
  // Clear all cached data
  clearAllData();
  loginOverlay.classList.remove('hidden');
  document.getElementById('loginUsername').value = '';
  loginPwInput.value = '';
  hideLoginError();
  // Reset role to admin defaults on logout
  applyRole('admin', null);
});

document.getElementById('btnProfileChangePassword').addEventListener('click', (e) => {
  e.stopPropagation();
  userProfileDropdown.classList.add('hidden');
  btnUserProfile.classList.remove('active');
  openChangePassword();
});

document.getElementById('btnProfileUserAccountSetting').addEventListener('click', (e) => {
  e.stopPropagation();
  userProfileDropdown.classList.add('hidden');
  btnUserProfile.classList.remove('active');
  openUAS();
});

document.getElementById('btnProfileTiersSetting').addEventListener('click', (e) => {
  e.stopPropagation();
  userProfileDropdown.classList.add('hidden');
  btnUserProfile.classList.remove('active');
  openTiersSetting();
});

document.getElementById('btnProfileLogout').addEventListener('click', async (e) => {
  e.stopPropagation();
  userProfileDropdown.classList.add('hidden');
  btnUserProfile.classList.remove('active');
  await fetch('api/auth.php?action=logout');
  // Clear all cached data
  clearAllData();
  loginOverlay.classList.remove('hidden');
  document.getElementById('loginUsername').value = '';
  loginPwInput.value = '';
  hideLoginError();
  // Reset role to admin defaults on logout
  applyRole('admin', null);
});

// ===========================
// CHANGE PASSWORD FEATURE
// ===========================
const cpwOverlay         = document.getElementById('cpwOverlay');
const cpwForm            = document.getElementById('cpwForm');
const cpwCurrentPassword = document.getElementById('cpwCurrentPassword');
const cpwNewPassword     = document.getElementById('cpwNewPassword');
const cpwConfirmPassword = document.getElementById('cpwConfirmPassword');
const cpwFormError       = document.getElementById('cpwFormError');

function openChangePassword() {
  cpwOverlay.classList.remove('hidden');
  cpwForm.reset();
  hideChangePasswordError();
}

function closeChangePassword() {
  cpwOverlay.classList.add('hidden');
  cpwForm.reset();
  hideChangePasswordError();
}

function showChangePasswordError(msg) {
  cpwFormError.textContent = msg;
  cpwFormError.classList.remove('hidden');
}

function hideChangePasswordError() {
  cpwFormError.classList.add('hidden');
  cpwFormError.textContent = '';
}

document.getElementById('cpwClose').addEventListener('click', closeChangePassword);
document.getElementById('cpwCancelBtn').addEventListener('click', closeChangePassword);

// Close modal when clicking outside
cpwOverlay.addEventListener('click', (e) => {
  if (e.target === cpwOverlay) closeChangePassword();
});

// Password visibility toggles
document.getElementById('cpwEyeCurrent').addEventListener('click', (e) => {
  e.preventDefault();
  const input = document.getElementById('cpwCurrentPassword');
  const icon = document.getElementById('cpwEyeCurrentIcon');
  const visible = input.type === 'text';
  input.type = visible ? 'password' : 'text';
  icon.className = visible ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
});

document.getElementById('cpwEyeNew').addEventListener('click', (e) => {
  e.preventDefault();
  const input = document.getElementById('cpwNewPassword');
  const icon = document.getElementById('cpwEyeNewIcon');
  const visible = input.type === 'text';
  input.type = visible ? 'password' : 'text';
  icon.className = visible ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
});

document.getElementById('cpwEyeConfirm').addEventListener('click', (e) => {
  e.preventDefault();
  const input = document.getElementById('cpwConfirmPassword');
  const icon = document.getElementById('cpwEyeConfirmIcon');
  const visible = input.type === 'text';
  input.type = visible ? 'password' : 'text';
  icon.className = visible ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
});

// Form submission
cpwForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideChangePasswordError();

  const currentPassword = cpwCurrentPassword.value;
  const newPassword = cpwNewPassword.value;
  const confirmPassword = cpwConfirmPassword.value;

  if (!currentPassword || !newPassword || !confirmPassword) {
    showChangePasswordError('Semua field wajib diisi.');
    return;
  }

  if (newPassword !== confirmPassword) {
    showChangePasswordError('Password baru dan konfirmasi tidak cocok.');
    return;
  }

  if (newPassword.length < 6) {
    showChangePasswordError('Password minimal 6 karakter.');
    return;
  }

  const submitBtn = document.getElementById('cpwSubmitBtn');
  const spinner = document.getElementById('cpwSubmitSpinner');
  submitBtn.disabled = true;
  spinner.classList.remove('hidden');

  try {
    const res = await fetch('api/auth.php?action=change-password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword,
        newPassword,
        confirmPassword,
      }),
    });

    const json = await res.json();

    if (json.success) {
      showToast('Password berhasil diubah.', 'success');
      closeChangePassword();
    } else {
      showChangePasswordError(json.message || 'Gagal mengubah password.');
    }
  } catch (err) {
    showChangePasswordError('Gagal terhubung ke server.');
  } finally {
    submitBtn.disabled = false;
    spinner.classList.add('hidden');
  }
});

// ===========================
// POV (VIEW AS) FEATURE
// ===========================
let _povActive        = false;
let _povRealName      = '';
let _povRealRole      = 'admin';
let _povRealAssocId   = null;
let _povRealDetailArea = null;

const povWrap     = document.getElementById('povWrap');
const btnViewAs   = document.getElementById('btnViewAs');
const povDropdown = document.getElementById('povDropdown');
const povUserList = document.getElementById('povUserList');
const povBanner   = document.getElementById('povBanner');
const povBannerName = document.getElementById('povBannerName');
const povBannerRole = document.getElementById('povBannerRole');
const btnExitPov  = document.getElementById('btnExitPov');

btnViewAs.addEventListener('click', async (e) => {
  e.stopPropagation();
  const isOpen = !povDropdown.classList.contains('hidden');
  povDropdown.classList.toggle('hidden', isOpen);
  btnViewAs.classList.toggle('open', !isOpen);
  if (!isOpen) await loadPovUsers();
});

document.addEventListener('click', () => {
  povDropdown.classList.add('hidden');
  btnViewAs.classList.remove('open');
});
povDropdown.addEventListener('click', e => e.stopPropagation());

let _povUsers = [];

async function loadPovUsers() {
  povUserList.innerHTML = '<span class="pov-dd-empty">Loading...</span>';
  try {
    const res  = await fetch('api/users.php');
    const json = await res.json();

    if (!json.success) throw new Error(json.message);

    _povUsers = json.data;

    if (!_povUsers.length) {
      povUserList.innerHTML = '<span class="pov-dd-empty">Tidak ada akun lain.</span>';
      return;
    }

    const roleOrder = ['supervisor', 'sales_associate', 'head_admin', 'sales_admin'];
    const roleLabels = {
      admin: 'Administrator',
      supervisor: 'Supervisor',
      sales_associate: 'Sales Associate',
      head_admin: 'Head Admin',
      sales_admin: 'Sales Admin',
    };

    const sortedUsers = [..._povUsers]
      .filter(u => roleOrder.includes(u.role))
      .sort((a, b) => {
        const roleDiff = roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role);
        if (roleDiff !== 0) return roleDiff;
        return String(a.full_name || '').localeCompare(String(b.full_name || ''), 'id', { sensitivity: 'base' });
      });

    povUserList.innerHTML = sortedUsers.map((u, idx) => `
      <button class="pov-dd-item" data-pov-idx="${_povUsers.indexOf(u)}">
        <span class="pov-dd-name">${escHtml(u.full_name)}</span>
        <span class="pov-dd-username">${roleLabels[u.role] || u.role}</span>
      </button>
    `).join('');
  } catch (e) {
    povUserList.innerHTML = `<span class="pov-dd-empty">Gagal memuat: ${escHtml(e.message)}</span>`;
  }
}

povUserList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-pov-idx]');
  if (!btn) return;
  const u = _povUsers[parseInt(btn.dataset.povIdx, 10)];
  if (u) enterPOV(u);
});

function enterPOV(u) {
  // Save real admin state
  _povActive         = true;
  _povRealName       = document.getElementById('topbarUsername').textContent;
  _povRealRole       = currentRole;
  _povRealAssocId    = currentAssociateId;
  _povRealDetailArea = currentDetailArea;

  // Close dropdown
  povDropdown.classList.add('hidden');
  btnViewAs.classList.remove('open');

  // Show banner
  const roleLabels = {
    admin: 'Administrator', supervisor: 'Supervisor',
    sales_associate: 'Sales Associate', head_admin: 'Head Admin', sales_admin: 'Sales Admin',
  };
  povBannerName.textContent = u.full_name;
  povBannerRole.textContent = roleLabels[u.role] || u.role;
  povBanner.classList.remove('hidden');

  // Update topbar name
  document.getElementById('topbarUsername').textContent = u.full_name + ' (POV)';

  // Apply that user's role/restrictions
  applyRole(u.role, u.associate_id || null, u.detail_area || null);

  // Navigate to default page for that role
  if (u.role === 'sales_associate') {
    navigateTo('summary');
  } else if (u.role === 'head_admin' || u.role === 'sales_admin') {
    navigateTo('associate');
  } else {
    navigateTo('dashboard');
  }
}

function exitPOV() {
  _povActive = false;
  povBanner.classList.add('hidden');
  document.getElementById('topbarUsername').textContent = _povRealName;
  applyRole(_povRealRole, _povRealAssocId, _povRealDetailArea);
  navigateTo('dashboard');
}

btnExitPov.addEventListener('click', exitPOV);

// ===========================
// SIP TIERS SETTING
// ===========================

// Plan display labels and key order
const TIER_PLAN_LABELS = { '3': 'Plan 3', '2L': 'Plan 2L', '2': 'Plan 2', '2T': 'Plan 2T', '1T': 'Plan 1T', '1': 'Plan 1' };

/** Load tiers from DB on startup and overwrite hardcoded SIP_TIERS values */
async function initSIPTiers() {
  try {
    const res  = await fetch(TIERS_API);
    const json = await res.json();
    if (json.success && json.data) {
      for (const [plan, t] of Object.entries(json.data)) {
        if (SIP_TIERS[plan]) {
          SIP_TIERS[plan].base        = t.base;
          SIP_TIERS[plan].inc85_100   = t.inc85_100;
          SIP_TIERS[plan].inc101_110  = t.inc101_110;
          SIP_TIERS[plan].max         = t.max;
        }
      }
    }
  } catch (_) { /* network error — silently use hardcoded defaults */ }
}

/** Open the Tiers setting modal, pre-filling inputs from current SIP_TIERS */
function openTiersSetting() {
  const tbody = document.getElementById('tiersTableBody');
  tbody.innerHTML = Object.keys(SIP_TIERS).map(plan => {
    const t     = SIP_TIERS[plan];
    const label = TIER_PLAN_LABELS[plan] || plan;
    const fld   = (key, val) =>
      `<input type="number" min="0" step="any" style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;text-align:right;"
              id="tier_${plan}_${key}" value="${val}">`;
    return `
      <tr>
        <td style="font-weight:600;color:#1e3a5f;text-align:center;">${label}</td>
        <td>${fld('base', t.base)}</td>
        <td>${fld('inc85_100', t.inc85_100)}</td>
        <td>${fld('inc101_110', t.inc101_110)}</td>
        <td>${fld('max', t.max)}</td>
      </tr>`;
  }).join('');
  openModal('tiersOverlay');
}

/** Save changed tier values to DB and update SIP_TIERS in memory */
async function saveTiers() {
  const tiers = {};
  for (const plan of Object.keys(SIP_TIERS)) {
    const get = id => document.getElementById(`tier_${plan}_${id}`);
    const vals = {
      base:       parseFloat(get('base')?.value       ?? '0'),
      inc85_100:  parseFloat(get('inc85_100')?.value  ?? '0'),
      inc101_110: parseFloat(get('inc101_110')?.value ?? '0'),
      max:        parseFloat(get('max')?.value        ?? '0'),
    };
    if (Object.values(vals).some(v => isNaN(v) || v < 0)) {
      showToast(`Nilai tidak valid pada ${TIER_PLAN_LABELS[plan] || plan}.`, 'error');
      return;
    }
    tiers[plan] = vals;
  }

  const btn = document.getElementById('btnSaveTiers');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan…';
  try {
    const res  = await fetch(TIERS_API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ tiers }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message || 'Gagal menyimpan.');
    // Update in-memory SIP_TIERS so computations use new values immediately
    for (const [plan, t] of Object.entries(tiers)) {
      if (SIP_TIERS[plan]) Object.assign(SIP_TIERS[plan], t);
    }
    closeModal('tiersOverlay');
    showToast(json.message, 'success');
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan';
  }
}

// ===========================
// USER ACCOUNT SETTING MODAL
// ===========================
const uasOverlay   = document.getElementById('uasOverlay');
const uasFormWrap  = document.getElementById('uasFormWrap');
const uasListWrap  = document.querySelector('.uas-list-wrap');
const uasTableBody = document.getElementById('uasTableBody');
const uasForm      = document.getElementById('uasForm');

async function openUAS() {
  uasOverlay.classList.remove('hidden');
  showUASList();
  await loadDeptHeads();
  await loadUASUsers();
}
function closeUAS() {
  uasOverlay.classList.add('hidden');
}

// Note: btnUserAccountSetting moved to user profile dropdown (btnProfileUserAccountSetting)
document.getElementById('uasClose').addEventListener('click', closeUAS);
uasOverlay.addEventListener('click', (e) => { if (e.target === uasOverlay) closeUAS(); });

function showUASList() {
  uasListWrap.classList.remove('hidden');
  uasFormWrap.classList.add('hidden');
}
function showUASForm(editData = null) {
  uasListWrap.classList.add('hidden');
  uasFormWrap.classList.remove('hidden');
  resetUASForm(editData);
}

document.getElementById('uasBackBtn').addEventListener('click', showUASList);
document.getElementById('uasCancelForm').addEventListener('click', showUASList);

async function loadUASUsers() {
  uasTableBody.innerHTML = '<tr><td colspan="5" class="uas-empty">Memuat...</td></tr>';
  try {
    const res  = await fetch('api/users.php');
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    renderUASTable(json.data);
  } catch (e) {
    uasTableBody.innerHTML = `<tr><td colspan="5" class="uas-empty">Gagal memuat: ${e.message}</td></tr>`;
  }
}

function roleBadge(role) {
  const map = {
    admin:           ['admin',       'Administrator'],
    supervisor:      ['supervisor',  'Supervisor'],
    sales_associate: ['sales',       'Sales Associate'],
    head_admin:      ['head-admin',  'Head Admin'],
    sales_admin:     ['sales-admin', 'Sales Admin'],
  };
  const [cls, label] = map[role] || ['admin', role];
  return `<span class="uas-role-badge ${cls}">${label}</span>`;
}

function renderUASTable(users) {
  if (!users.length) {
    uasTableBody.innerHTML = '<tr><td colspan="5" class="uas-empty">Belum ada akun tambahan.</td></tr>';
    return;
  }
  uasTableBody.innerHTML = users.map(u => {
    const isAreaRole = u.role === 'head_admin' || u.role === 'sales_admin';
    const assocCell  = isAreaRole
      ? (u.detail_area ? `<span style="font-size:12px;color:#4b5563;"><i class="fa-solid fa-map-marker-alt" style="color:#6b7280;margin-right:3px;"></i>${escHtml(u.detail_area)}</span>` : '<span style="color:#94a3b8">—</span>')
      : (u.associate_name ? escHtml(u.associate_name) : '<span style="color:#94a3b8">—</span>');
    return `
    <tr>
      <td><strong>${escHtml(u.username)}</strong></td>
      <td>${escHtml(u.full_name)}</td>
      <td>${roleBadge(u.role)}</td>
      <td>${assocCell}</td>
      <td style="text-align:center;">
        <button class="uas-action-btn edit" title="Edit" data-id="${u.id}" onclick="uasEditUser(${u.id})">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
        <button class="uas-action-btn delete" title="Hapus" onclick="uasDeleteUser(${u.id}, '${escHtml(u.username)}')">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    </tr>
  `;
  }).join('');
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Add button
document.getElementById('btnAddUser').addEventListener('click', () => showUASForm(null));

// Edit
window.uasEditUser = async function(id) {
  try {
    const res  = await fetch('api/users.php');
    const json = await res.json();
    const user = json.data?.find(u => u.id === id);
    if (user) showUASForm(user);
  } catch { showToast('Gagal memuat data.', 'error'); }
};

// Delete
window.uasDeleteUser = async function(id, username) {
  if (!confirm(`Hapus akun "${username}"?`)) return;
  try {
    const res  = await fetch(`api/users.php?action=${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) { showToast('Akun berhasil dihapus.', 'success'); loadUASUsers(); }
    else showToast(json.message || 'Gagal menghapus.', 'error');
  } catch { showToast('Gagal menghapus.', 'error'); }
};

// ── UAS Form ────────────────────────────────
const uasSourceRadios    = document.querySelectorAll('input[name="uasSource"]');
const uasAssocPickerGrp  = document.getElementById('uasAssocPickerGroup');
const uasAssocPicker     = document.getElementById('uasAssocPicker');
const uasNameInput       = document.getElementById('uasName');
const uasPasswordHint    = document.getElementById('uasPasswordHint');
const uasRoleDesc        = document.getElementById('uasRoleDesc');
const uasRoleSelect      = document.getElementById('uasRole');
const uasFormError       = document.getElementById('uasFormError');
const uasDetailAreaGrp   = document.getElementById('uasDetailAreaGroup');
const uasDetailAreaSel   = document.getElementById('uasDetailArea');

function populateDetailAreaPicker() {
  const areas       = [...new Set(associates.map(a => a.detail_area).filter(Boolean))].sort();
  const curSelected = [...uasDetailAreaSel.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value);
  uasDetailAreaSel.innerHTML = areas.map(a => `<label class="uas-area-check-item"><input type="checkbox" value="${escHtml(a)}" ${curSelected.includes(a) ? 'checked' : ''}><span>${escHtml(a)}</span></label>`).join('');
}

const ROLE_DESCS = {
  sales_associate: {
    cls: 'sales',
    text: '<i class="fa-solid fa-circle-info"></i> <strong>Sales Associate:</strong> Hanya melihat informasi yang berkaitan dengan associate tersebut. Tidak dapat mengubah atau menambahkan data. Menu Dashboard tidak ditampilkan.',
  },
  supervisor: {
    cls: 'supervisor',
    text: '<i class="fa-solid fa-circle-info"></i> <strong>Supervisor:</strong> Dapat melihat seluruh menu dan isinya. Tidak dapat mengubah atau menambahkan data.',
  },
  head_admin: {
    cls: 'head-admin',
    text: '<i class="fa-solid fa-circle-info"></i> <strong>Head Admin:</strong> Akses menu Associate dan Actual Achievement. Data dibatasi sesuai Detail Area yang dipilih. Dapat mengedit Target dan Actual.',
  },
  sales_admin: {
    cls: 'sales-admin',
    text: '<i class="fa-solid fa-circle-info"></i> <strong>Sales Admin:</strong> Akses menu Associate dan Actual Achievement. Data dibatasi sesuai Detail Area yang dipilih. Hanya dapat menambahkan/mengedit Actual.',
  },
};

function populateAssocPicker() {
  const assocOpts = associates.map(a => `<option value="${escHtml(a.employee_id)}">${escHtml(a.full_name)}</option>`).join('');
  const deptOpts  = (deptHeads || []).map(d => `<option value="${escHtml(d.employee_id)}" data-kind="department-head">${escHtml(d.full_name)} (${escHtml(d.position || 'Department Head')})</option>`).join('');

  uasAssocPicker.innerHTML = '<option value="">-- Select Associate / Department Head --</option>' +
    (deptOpts ? `<optgroup label="Department Head">${deptOpts}</optgroup>` : '') +
    (assocOpts ? `<optgroup label="Associates">${assocOpts}</optgroup>` : '');
}

function resetUASForm(editData) {
  uasForm.reset();
  document.getElementById('uasEditId').value = editData?.id ?? '';
  document.getElementById('uasFormTitle').textContent = editData ? 'Edit Account' : 'Add New Account';
  document.getElementById('uasSubmitText').textContent = editData ? 'Save Changes' : 'Save Account';
  hideUASFormError();
  populateAssocPicker();
  populateDetailAreaPicker();

  // Password hint
  uasPasswordHint.style.display = editData ? 'block' : 'none';

  // Source group: hide for edit
  document.getElementById('uasSourceGroup').style.display = editData ? 'none' : '';

  if (editData) {
    document.getElementById('uasUsername').value = editData.username ?? '';
    uasNameInput.value    = editData.full_name   ?? '';
    uasRoleSelect.value   = editData.role        ?? '';
    uasAssocPicker.value  = editData.associate_id ?? '';
    // Pre-select multiple detail areas (stored as comma-separated)
    const savedAreas = (editData.detail_area ?? '').split(',').map(s => s.trim()).filter(Boolean);
    uasDetailAreaSel.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = savedAreas.includes(cb.value); });
    // In edit mode: show assoc picker only if role is sales_associate
    const isAreaRole = editData.role === 'head_admin' || editData.role === 'sales_admin';
    uasAssocPickerGrp.style.display  = editData.role === 'sales_associate' ? '' : 'none';
    uasDetailAreaGrp.style.display   = isAreaRole ? '' : 'none';
    uasNameInput.readOnly = false;
  } else {
    // Default source = associate
    document.querySelector('input[name="uasSource"][value="associate"]').checked = true;
    uasAssocPickerGrp.style.display = '';
    uasDetailAreaGrp.style.display  = 'none';
    uasNameInput.readOnly = true;
  }

  updateRoleDesc();
}

function updateRoleDesc() {
  const role = uasRoleSelect.value;
  if (ROLE_DESCS[role]) {
    uasRoleDesc.innerHTML   = ROLE_DESCS[role].text;
    uasRoleDesc.className   = `uas-role-desc ${ROLE_DESCS[role].cls}`;
  } else {
    uasRoleDesc.className = 'uas-role-desc hidden';
  }
}

uasRoleSelect.addEventListener('change', () => {
  updateRoleDesc();
  const isEdit     = !!document.getElementById('uasEditId').value;
  const role       = uasRoleSelect.value;
  const isAreaRole = role === 'head_admin' || role === 'sales_admin';
  if (isEdit) {
    uasAssocPickerGrp.style.display = role === 'sales_associate' ? '' : 'none';
  }
  uasDetailAreaGrp.style.display = isAreaRole ? '' : 'none';
  // For area roles in add mode: hide associate picker (manual name entry)
  if (!isEdit && isAreaRole) {
    uasAssocPickerGrp.style.display = 'none';
    uasNameInput.readOnly = false;
  } else if (!isEdit && !isAreaRole) {
    const isAssocSrc = document.querySelector('input[name="uasSource"]:checked')?.value === 'associate';
    uasAssocPickerGrp.style.display = isAssocSrc ? '' : 'none';
    uasNameInput.readOnly = isAssocSrc;
  }
});

uasSourceRadios.forEach(r => r.addEventListener('change', () => {
  const role    = uasRoleSelect.value;
  const isAreaRole = role === 'head_admin' || role === 'sales_admin';
  if (isAreaRole) return; // area roles don't use source radio
  const isAssoc = document.querySelector('input[name="uasSource"]:checked').value === 'associate';
  uasAssocPickerGrp.style.display = isAssoc ? '' : 'none';
  uasNameInput.readOnly = isAssoc;
  if (!isAssoc) { uasAssocPicker.value = ''; uasNameInput.readOnly = false; }
  if (isAssoc)  { syncNameFromAssoc(); }
}));

uasAssocPicker.addEventListener('change', syncNameFromAssoc);

function syncNameFromAssoc() {
  const isAssoc = document.querySelector('input[name="uasSource"]:checked')?.value === 'associate';
  if (!isAssoc) return;

  const selectedId = uasAssocPicker.value;
  const assoc = associates.find(a => a.employee_id === selectedId);
  const dept  = (deptHeads || []).find(d => d.employee_id === selectedId);
  const selected = assoc || dept;

  if (selected) {
    uasNameInput.value = selected.full_name;
    document.getElementById('uasUsername').value = selected.employee_id;
  } else {
    uasNameInput.value = '';
    document.getElementById('uasUsername').value = '';
  }
}

function showUASFormError(msg) {
  uasFormError.textContent = msg;
  uasFormError.classList.remove('hidden');
}
function hideUASFormError() {
  uasFormError.classList.add('hidden');
}

uasForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideUASFormError();

  const editId      = document.getElementById('uasEditId').value;
  const isEdit      = !!editId;
  const username    = document.getElementById('uasUsername').value.trim();
  const password    = document.getElementById('uasPassword').value;
  const full_name   = uasNameInput.value.trim();
  const role        = uasRoleSelect.value;
  const associate_id   = uasAssocPicker.value.trim() || null;
  const selectedAreas   = [...uasDetailAreaSel.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value);
  const detail_area     = selectedAreas.length > 0 ? selectedAreas.join(',') : null;
  const isAssocSrc  = document.querySelector('input[name="uasSource"]:checked')?.value === 'associate';

  if (!username || !full_name || !role) { showUASFormError('Semua field wajib diisi.'); return; }
  if (!isEdit && !password)            { showUASFormError('Password wajib diisi.'); return; }
  if (role === 'sales_associate' && !associate_id) {
    showUASFormError('Pilih associate untuk role Sales Associate.'); return;
  }
  if ((role === 'head_admin' || role === 'sales_admin') && !detail_area) {
    showUASFormError('Pilih minimal satu Detail Area untuk role ini.'); return;
  }

  const payload = { username, password, full_name, role, associate_id, detail_area };

  const submitBtn = document.getElementById('uasSubmitBtn');
  const spinner   = document.getElementById('uasSubmitSpinner');
  submitBtn.disabled = true;
  spinner.classList.remove('hidden');

  try {
    let res;
    if (isEdit) {
      res = await fetch(`api/users.php?action=${editId}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
    } else {
      res = await fetch('api/users.php', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
    }
    const json = await res.json();
    if (json.success) {
      showToast(isEdit ? 'Akun berhasil diperbarui.' : 'Akun berhasil ditambahkan.', 'success');
      showUASList();
      loadUASUsers();
    } else {
      showUASFormError(json.message || 'Terjadi kesalahan.');
    }
  } catch {
    showUASFormError('Gagal terhubung ke server.');
  } finally {
    submitBtn.disabled = false;
    spinner.classList.add('hidden');
  }
});

// Password toggle in UAS form
document.getElementById('uasEye').addEventListener('click', () => {
  const pw = document.getElementById('uasPassword');
  const visible = pw.type === 'text';
  pw.type = visible ? 'password' : 'text';
  document.getElementById('uasEyeIcon').className = visible ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
});

// ===========================
// ROLE-BASED ACCESS CONTROL
// ===========================
let currentRole        = 'admin';
let currentAssociateId = null;
let currentDetailArea  = null;

function applyRole(role, associateId, detailArea = null) {
  currentRole        = role;
  currentAssociateId = associateId;
  currentDetailArea  = detailArea;

  const isAdmin      = role === 'admin';
  const isSuperv     = role === 'supervisor';
  const isSales      = role === 'sales_associate';
  const isHeadAdmin  = role === 'head_admin';
  const isSalesAdmin = role === 'sales_admin';
  const isAreaRole   = isHeadAdmin || isSalesAdmin;
  const canEdit      = isAdmin;   // only admin can add/edit/delete associate records

  // Hide/show add/edit/delete buttons (any element with data-admin-only)
  document.querySelectorAll('[data-admin-only]').forEach(el => {
    el.style.display = canEdit ? '' : 'none';
  });

  // Show/hide admin items in user profile dropdown
  const btnProfileUserAccountSetting = document.getElementById('btnProfileUserAccountSetting');
  const btnProfileTiersSetting = document.getElementById('btnProfileTiersSetting');
  if (btnProfileUserAccountSetting) btnProfileUserAccountSetting.style.display = canEdit ? '' : 'none';
  if (btnProfileTiersSetting) btnProfileTiersSetting.style.display = canEdit ? '' : 'none';

  // Dashboard nav: keep visible for sales_associate, hide only for area roles
  const dashLink = document.querySelector('.nav-link[data-page="dashboard"]')?.closest('li');
  if (dashLink) dashLink.style.display = isAreaRole ? 'none' : '';

  // For head_admin / sales_admin: show ONLY Associate and Actual Achievement
  const restrictedPages = new Set(['dashboard', 'department-head', 'new-customer', 'summary', 'sip-payment', 'calculator', 'sip-report']);
  document.querySelectorAll('.nav-link[data-page]').forEach(link => {
    const li = link.closest('li');
    if (!li) return;
    if (isAreaRole) {
      li.style.display = restrictedPages.has(link.dataset.page) ? 'none' : '';
    } else if (isSales) {
      const salesHidden = new Set(['department-head', 'sip-report']);
      li.style.display = salesHidden.has(link.dataset.page) ? 'none' : '';
    } else {
      // department-head and sip-report menus only visible for admin
      const adminOnly = new Set(['department-head', 'sip-report']);
      li.style.display = (adminOnly.has(link.dataset.page) && !isAdmin) ? 'none' : '';
    }
  });

  // View As (POV) button: only admin sees it, and not while in POV mode
  const povWrapEl = document.getElementById('povWrap');
  if (povWrapEl) povWrapEl.style.display = (isAdmin && !_povActive) ? '' : 'none';

  // Hide all money-related columns/sections for head_admin and sales_admin
  document.body.classList.toggle('role-no-money', isAreaRole);

  // Also hide SIP Budget section in detail modal for area roles
  const sipMonthlySection  = document.getElementById('sipMonthlySection');
  const sipKpiSection      = document.getElementById('sipKpiSection');
  const sipQuarterKpiSection = document.getElementById('sipQuarterKpiSection');
  if (sipMonthlySection) sipMonthlySection.style.display = isAreaRole ? 'none' : '';
  if (sipKpiSection)     sipKpiSection.style.display     = isAreaRole ? 'none' : '';
  if (sipQuarterKpiSection) sipQuarterKpiSection.style.display = isAreaRole ? 'none' : '';
}

// ===========================
// SUBORDINATE ACCESS CONTROL
// ===========================
// Get all direct and indirect subordinates of current user
function getSubordinateIds() {
  if (!currentAssociateId) return [];
  
  const subordinates = new Set();
  
  // Recursive function to find all subordinates
  function findSubordinates(managerId) {
    const directReports = associates.filter(a => a.reporting_manager_id === managerId);
    directReports.forEach(emp => {
      subordinates.add(emp.employee_id);
      findSubordinates(emp.employee_id); // Recursively find their subordinates
    });
    
    // Also check department heads
    const deptReports = deptHeads.filter(d => d.reporting_manager_id === managerId);
    deptReports.forEach(emp => {
      subordinates.add(emp.employee_id);
      findSubordinates(emp.employee_id);
    });
  }
  
  findSubordinates(currentAssociateId);
  return Array.from(subordinates);
}

// Check if current user can view a specific employee's data
function canViewEmployee(empId) {
  // Admin and area roles can view all
  if (currentRole === 'admin' || currentRole === 'head_admin' || currentRole === 'sales_admin') {
    return true;
  }
  
  // Sales associate can view their own data and their subordinates
  if (currentRole === 'sales_associate') {
    return empId === currentAssociateId || getSubordinateIds().includes(empId);
  }
  
  return false;
}

// Get all employee IDs that current user can view
function getViewableEmployeeIds() {
  if (currentRole === 'admin' || currentRole === 'supervisor' || currentRole === 'head_admin' || currentRole === 'sales_admin') {
    return associates.map(a => a.employee_id);
  }
  
  if (currentRole === 'sales_associate' && currentAssociateId) {
    return [currentAssociateId, ...getSubordinateIds()];
  }
  
  return [];
}


// ===========================
// INIT
// ===========================
(async () => {
  // Check if already logged in; if so, hide overlay and load app
  try {
    const res  = await fetch('api/auth.php?action=check');
    const json = await res.json();
    if (json.loggedIn) {
      loginOverlay.classList.add('hidden');
      document.getElementById('topbarUsername').textContent = json.fullName || 'Admin';
      applyRole(json.role || 'admin', json.associateId || null, json.detailArea || null);
      // Force reload all data
      await loadAssociates(true);
      await loadDeptHeads();
      await initSIPTiers();
      const roleOnLoad = json.role || 'admin';
      if (roleOnLoad === 'sales_associate') {
        navigateTo('summary');
      } else if (roleOnLoad === 'head_admin' || roleOnLoad === 'sales_admin') {
        navigateTo('associate');
      } else {
        renderDashboard();
      }
    }
  } catch {
    // Server unreachable — login overlay stays visible
  }
})();