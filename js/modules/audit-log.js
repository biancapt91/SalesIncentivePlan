// ===========================
// AUDIT LOG PAGE
// ===========================
(function () {
  const AUDIT_API = API.AUDIT_LOG;

  let _auditPage  = 1;
  let _auditLimit = 50;
  let _auditTotal = 0;

  const ACTION_COLORS = {
    LOGIN:        { bg: '#dcfce7', color: '#16a34a' },
    LOGIN_FAILED: { bg: '#fee2e2', color: '#dc2626' },
    LOGOUT:       { bg: '#f3f4f6', color: '#6b7280' },
    VIEW:         { bg: '#dbeafe', color: '#2563eb' },
    CREATE:       { bg: '#d1fae5', color: '#059669' },
    UPDATE:       { bg: '#fef3c7', color: '#d97706' },
    DELETE:       { bg: '#fee2e2', color: '#dc2626' },
  };

  function actionBadge(action) {
    const c = ACTION_COLORS[action] || { bg: '#e2e8f0', color: '#475569' };
    return `<span style="background:${c.bg};color:${c.color};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;white-space:nowrap;">${action}</span>`;
  }

  function fmtDatetime(str) {
    if (!str) return '—';
    const d = new Date(str.replace(' ', 'T'));
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  async function loadStats() {
    try {
      const r = await fetch(AUDIT_API + '?action=stats');
      if (!r.ok) return;
      const j = await r.json();
      if (j.success) {
        const el = (id) => document.getElementById(id);
        if (el('audit-stat-total'))  el('audit-stat-total').textContent  = j.total.toLocaleString('id-ID');
        if (el('audit-stat-today'))  el('audit-stat-today').textContent  = j.today.toLocaleString('id-ID');
        if (el('audit-stat-logins')) el('audit-stat-logins').textContent = j.logins.toLocaleString('id-ID');
      }
    } catch (_) {}
  }

  async function loadTable(page = 1) {
    _auditPage = page;
    const body = document.getElementById('audit-table-body');
    if (!body) return;

    const username = (document.getElementById('audit-filter-user')?.value || '').trim();
    const action   = document.getElementById('audit-filter-action')?.value  || 'ALL';
    const resource = document.getElementById('audit-filter-resource')?.value || 'ALL';
    const date     = document.getElementById('audit-filter-date')?.value    || '';

    const params = new URLSearchParams({
      page:          page,
      limit:         _auditLimit,
      username:      username,
      action_filter: action,
      resource:      resource,
      date:          date,
    });

    body.innerHTML = `<tr><td colspan="9" class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i> Memuat…</td></tr>`;

    try {
      const r = await fetch(`${AUDIT_API}?${params}`);
      if (!r.ok) {
        body.innerHTML = `<tr><td colspan="9" class="empty-state" style="color:#dc2626;">Gagal memuat data.</td></tr>`;
        return;
      }
      const j = await r.json();
      if (!j.success) {
        body.innerHTML = `<tr><td colspan="9" class="empty-state" style="color:#dc2626;">${j.message || 'Error'}</td></tr>`;
        return;
      }

      _auditTotal = j.total;

      if (!j.data || j.data.length === 0) {
        body.innerHTML = `<tr><td colspan="9" class="empty-state">Tidak ada data yang sesuai filter.</td></tr>`;
      } else {
        const startIdx = (page - 1) * _auditLimit;
        body.innerHTML = j.data.map((row, i) => `
          <tr>
            <td style="text-align:center;color:#94a3b8;">${startIdx + i + 1}</td>
            <td><strong>${escapeHtml(row.username)}</strong></td>
            <td>${escapeHtml(row.full_name || '—')}</td>
            <td style="text-align:center;">${actionBadge(row.action)}</td>
            <td style="color:#64748b;font-size:12px;">${escapeHtml(row.resource || '—')}</td>
            <td style="font-size:12px;color:#475569;">${escapeHtml(row.resource_id || '—')}</td>
            <td style="font-size:12px;max-width:250px;white-space:normal;">${escapeHtml(row.details || '—')}</td>
            <td style="font-size:11px;color:#94a3b8;">${escapeHtml(row.ip_address || '—')}</td>
            <td style="font-size:12px;white-space:nowrap;">${fmtDatetime(row.created_at)}</td>
          </tr>
        `).join('');
      }

      renderPagination(j.totalPages, page);
      const infoEl = document.getElementById('audit-pagination-info');
      if (infoEl) {
        const from = _auditTotal === 0 ? 0 : (page - 1) * _auditLimit + 1;
        const to   = Math.min(page * _auditLimit, _auditTotal);
        infoEl.textContent = `Menampilkan ${from}–${to} dari ${_auditTotal.toLocaleString('id-ID')} entri`;
      }
    } catch (err) {
      body.innerHTML = `<tr><td colspan="9" class="empty-state" style="color:#dc2626;">Error: ${escapeHtml(String(err))}</td></tr>`;
    }
  }

  function renderPagination(totalPages, currentP) {
    const wrap = document.getElementById('audit-pagination-btns');
    if (!wrap) return;
    if (totalPages <= 1) { wrap.innerHTML = ''; return; }

    const btns = [];
    const addBtn = (label, p, disabled = false, active = false) => {
      btns.push(
        `<button class="btn ${active ? 'btn-primary' : 'btn-secondary'}" style="padding:4px 10px;font-size:13px;"
           onclick="window._auditGoPage(${p})" ${disabled ? 'disabled' : ''}>${label}</button>`
      );
    };

    addBtn('«', 1,          currentP === 1);
    addBtn('‹', currentP - 1, currentP === 1);

    const start = Math.max(1, currentP - 2);
    const end   = Math.min(totalPages, currentP + 2);
    for (let p = start; p <= end; p++) {
      addBtn(p, p, false, p === currentP);
    }

    addBtn('›', currentP + 1, currentP === totalPages);
    addBtn('»', totalPages,   currentP === totalPages);

    wrap.innerHTML = btns.join('');
  }

  // Expose for inline onclick handlers
  window._auditGoPage = function(p) { loadTable(p); };

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function bindEvents() {
    const filterBtn = document.getElementById('audit-filter-btn');
    const resetBtn  = document.getElementById('audit-reset-btn');
    if (filterBtn && !filterBtn._auditBound) {
      filterBtn._auditBound = true;
      filterBtn.addEventListener('click', () => loadTable(1));
    }
    if (resetBtn && !resetBtn._auditBound) {
      resetBtn._auditBound = true;
      resetBtn.addEventListener('click', () => {
        const el = (id) => document.getElementById(id);
        if (el('audit-filter-user'))     el('audit-filter-user').value     = '';
        if (el('audit-filter-action'))   el('audit-filter-action').value   = 'ALL';
        if (el('audit-filter-resource')) el('audit-filter-resource').value = 'ALL';
        if (el('audit-filter-date'))     el('audit-filter-date').value     = '';
        loadTable(1);
      });
    }
    // Allow pressing Enter in the username field to filter
    const userInput = document.getElementById('audit-filter-user');
    if (userInput && !userInput._auditBound) {
      userInput._auditBound = true;
      userInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadTable(1); });
    }
  }

  window.initAuditLog = function () {
    bindEvents();
    loadStats();
    loadTable(1);
  };
})();

