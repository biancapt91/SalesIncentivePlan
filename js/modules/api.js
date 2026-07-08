// ===========================
// API CALLS
// ===========================
async function apiGet() {
  const res = await fetch(API.ASSOCIATES);
  const json = await res.json();
  if (!json.success) throw new Error(json.message);
  return json.data;
}

async function apiPost(data) {
  const res = await fetch(API.ASSOCIATES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return await res.json();
}

async function apiPut(id, data) {
  const res = await fetch(`${API.ASSOCIATES}?id=${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return await res.json();
}

async function apiDelete(id) {
  const res = await fetch(`${API.ASSOCIATES}?id=${encodeURIComponent(id)}`, {
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

