// ===========================
// ROLE-BASED ACCESS CONTROL
// ===========================
// currentRole, currentAssociateId, currentDetailArea are declared in state.js
// and exposed via window.appState. They are referenced here as bare globals —
// that works because state.js is loaded first and they share the same scope.

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

  // Audit Log nav: admin only
  const navAuditLi = document.getElementById('nav-audit-log-li');
  if (navAuditLi) navAuditLi.style.display = isAdmin ? '' : 'none';

  // Dashboard nav: keep visible for sales_associate, hide only for area roles
  const dashLink = document.querySelector('.nav-link[data-page="dashboard"]')?.closest('li');
  if (dashLink) dashLink.style.display = isAreaRole ? 'none' : '';

  // For head_admin / sales_admin: show ONLY Associate and Actual Achievement
  const restrictedPages = new Set(['dashboard', 'department-head', 'new-customer', 'summary', 'sip-payment', 'calculator', 'sip-report', 'audit-log']);
  document.querySelectorAll('.nav-link[data-page]').forEach(link => {
    const li = link.closest('li');
    if (!li) return;
    if (isAreaRole) {
      li.style.display = restrictedPages.has(link.dataset.page) ? 'none' : '';
    } else if (isSales) {
      const salesHidden = new Set(['department-head', 'sip-report', 'audit-log']);
      li.style.display = salesHidden.has(link.dataset.page) ? 'none' : '';
    } else {
      // department-head, sip-report, and audit-log menus only visible for admin
      const adminOnly = new Set(['department-head', 'sip-report', 'audit-log']);
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
    const res  = await fetch(`${API.AUTH}?action=check`);
    const json = await res.json();
    if (json.loggedIn) {
      loginOverlay.classList.add('hidden');
      // Restore session user into appState so all modules can access it
      appState.currentUser = {
        username: json.username  || 'admin',
        fullName: json.fullName  || 'Admin',
        role:     json.role      || 'admin',
      };
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
