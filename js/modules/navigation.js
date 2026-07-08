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
  'audit-log':           'Audit Log',
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
  if (pageId === 'audit-log') initAuditLog();
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

