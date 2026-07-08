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
    const res  = await fetch(API.AUTH, {
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
  await fetch(`${API.AUTH}?action=logout`);
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
  await fetch(`${API.AUTH}?action=logout`);
  // Clear all cached data
  clearAllData();
  appState.currentUser = null;
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
    const res = await fetch(`${API.AUTH}?action=change-password`, {
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
    const res  = await fetch(API.USERS);
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
  } catch (_) { /* network error â€” silently use hardcoded defaults */ }
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