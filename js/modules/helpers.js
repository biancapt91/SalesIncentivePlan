// ===========================
// HELPERS
// ===========================
function formatNumber(value, options = {}) {
    return Number(value).toLocaleString('id-ID', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        ...options
    });
}

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

// -- Jabodetabek Distributor / Direct split --
const JABODETABEK_KEYWORDS     = ['jabodetabek', 'jakarta', 'bogor', 'depok', 'tangerang', 'bekasi'];
const JABODETABEK_DIST_PCT     = 85;
const JABODETABEK_DIR_PCT      = 15;
const JABODETABEK_SPLIT_LABELS = new Set([
  'Individual Sales Leader',
  'Area Sales Leader',
  'Individual Sales Non-Leader',
]);

// -- SIP Budget hierarchy (from diagram) --
const SIP_SALES_PCT          = 85;  // % of monthly ? Sales branch
const SIP_CW_PCT             = 15;  // % of monthly ? Closed Won/Consumption
const SIP_MONTHLY_SALES_PCT  = 80;  // % of Sales   ? Monthly Sales sub-bucket
const SIP_QUARTER_PCT        = 20;  // % of Sales   ? Quarter sub-bucket

// -- Tiered SIP amounts per plan (sales KPIs only) --
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
 * < 85%        ? 0
 * 85% – 100%   ? base + (pct - 85) × inc85_100          (integer steps from 85)
 * 101% – 110%  ? value_at_100% + (pct - 100) × inc101_110 (integer steps from 100)
 * > 110%       ? max
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

// -- KPI row color map (accent color per component) --
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
    const res  = await fetch(`${API.KPI_TARGETS}?employee_id=${encodeURIComponent(empId)}&year=${year}`);
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
      ? `<span class="kpi-sub-arrow">?</span> ${it._sub}`
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
      const res  = await fetch(API.KPI_TARGETS, {
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

