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
    const res  = await fetch(API.USERS);
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
      ? (u.detail_area ? `<span style="font-size:12px;color:#4b5563;"><i class="fa-solid fa-map-marker-alt" style="color:#6b7280;margin-right:3px;"></i>${escHtml(u.detail_area)}</span>` : '<span style="color:#94a3b8">�</span>')
      : (u.associate_name ? escHtml(u.associate_name) : '<span style="color:#94a3b8">�</span>');
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
    const res  = await fetch(API.USERS);
    const json = await res.json();
    const user = json.data?.find(u => u.id === id);
    if (user) showUASForm(user);
  } catch { showToast('Gagal memuat data.', 'error'); }
};

// Delete
window.uasDeleteUser = async function(id, username) {
  if (!confirm(`Hapus akun "${username}"?`)) return;
  try {
    const res  = await fetch(`${API.USERS}?action=${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) { showToast('Akun berhasil dihapus.', 'success'); loadUASUsers(); }
    else showToast(json.message || 'Gagal menghapus.', 'error');
  } catch { showToast('Gagal menghapus.', 'error'); }
};

// -- UAS Form --------------------------------
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
      res = await fetch(`${API.USERS}?action=${editId}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
    } else {
      res = await fetch(API.USERS, {
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

