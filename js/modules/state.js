// ===========================
// STATE — Single Source of Truth
// ===========================
// All mutable shared state lives here as `let` variables.
// `window.appState` below is a getter/setter proxy over these variables,
// giving any module a clean, structured way to access shared state.
// Existing code that reads/writes the bare variable names continues to work
// unchanged — there is no migration burden.

// ── Data Collections ──────────────────────────────
let associates       = [];   // all loaded associates (cached)
let annualBudgetMap  = {};   // empId → annual SIP budget total
let deptHeads        = [];   // department heads (moved from sip-report.js)

// ── Auth / Session ─────────────────────────────────
let currentUser        = null;    // { username, fullName, role } — set on login
let currentRole        = 'admin'; // active role string (moved from init.js)
let currentAssociateId = null;    // associate id for sales_associate role (moved from init.js)
let currentDetailArea  = null;    // detail-area filter for head_admin/sales_admin (moved from init.js)

// ── UI State ───────────────────────────────────────
let currentPage = 'dashboard';
let editingId   = null;  // employee_id being edited in the add/edit modal
let deletingId  = null;  // employee_id pending deletion confirmation

// ── Cache Metadata ─────────────────────────────────
let _assocCacheTime = 0; // unix-ms timestamp of last associates fetch

// ===========================
// CONSTANTS
// ===========================
const TIERS_API    = API.SIP_TIERS;

const MONTH_KEYS  = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
const NOW_MONTH   = new Date().getMonth(); // 0-based
const NOW_KEY     = MONTH_KEYS[NOW_MONTH];

// ===========================
// APP STATE
// Single point of access to all shared application state.
// Each property is a getter/setter backed by the `let` variables above, so:
//   • appState.associates          ← always the same array as `associates`
//   • appState.currentRole = 'x'  ← also sets the bare `currentRole` variable
// Existing modules that use the bare variable names need zero changes.
// ===========================
window.appState = {
  // ── Data Collections ─────────────────────────────
  get associates()          { return associates; },
  set associates(v)         { associates = v; },

  get annualBudgetMap()     { return annualBudgetMap; },
  set annualBudgetMap(v)    { annualBudgetMap = v; },

  get deptHeads()           { return deptHeads; },
  set deptHeads(v)          { deptHeads = v; },

  // ── Auth / Session ────────────────────────────────
  /** Full user object set on successful login: { username, fullName, role } */
  get currentUser()         { return currentUser; },
  set currentUser(v)        { currentUser = v; },

  get currentRole()         { return currentRole; },
  set currentRole(v)        { currentRole = v; },

  get currentAssociateId()  { return currentAssociateId; },
  set currentAssociateId(v) { currentAssociateId = v; },

  get currentDetailArea()   { return currentDetailArea; },
  set currentDetailArea(v)  { currentDetailArea = v; },

  // ── UI State ──────────────────────────────────────
  get currentPage()         { return currentPage; },
  set currentPage(v)        { currentPage = v; },

  get editingId()           { return editingId; },
  set editingId(v)          { editingId = v; },

  get deletingId()          { return deletingId; },
  set deletingId(v)         { deletingId = v; },

  // ── Cache Metadata ────────────────────────────────
  get assocCacheTime()      { return _assocCacheTime; },
  set assocCacheTime(v)     { _assocCacheTime = v; },

  // ── Module Cache ──────────────────────────────────
  get dashboardCache()      { return _dashCache; },
  set dashboardCache(v)     { _dashCache = v; },

  get achievementBoardState() { return _abRankState; },
  set achievementBoardState(v) { _abRankState = v; },

  get calculatorState()     { return _calcState; },
  set calculatorState(v)    { _calcState = v; },
};

