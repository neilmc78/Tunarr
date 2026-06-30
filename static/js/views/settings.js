async function renderSettingsView(container) {
  container.innerHTML = `<div class="page-header"><h1 class="page-title">Settings</h1></div><div id="settings-body"><div class="loading-center"><div class="spinner"></div></div></div>`;
  try {
    const reqs = [API.getRootFolders(), API.getQProfiles(), API.getStatus(), API.getQualityDefs()];
    if (isAdmin()) reqs.push(API.listUsers());
    const [folders, profiles, status, qualityDefs, users] = await Promise.all(reqs);
    renderSettingsBody(document.getElementById('settings-body'), folders, profiles, status, qualityDefs, users || []);
  } catch (err) {
    document.getElementById('settings-body').innerHTML = `<p class="text-danger">Failed to load settings: ${err.message}</p>`;
  }
}

function renderSettingsBody(body, folders, profiles, status, qualityDefs, users) {
  const qDefMap = {};
  (qualityDefs || []).forEach(q => { qDefMap[q.id] = q.name; });

  const qDefOptions = (qualityDefs || []).slice(1).map(q =>
    `<option value="${q.id}">${esc(q.name)}</option>`
  ).join('');

  body.innerHTML = `
    <!-- ── Library Folders ──────────────────────────────────────────── -->
    <div class="settings-section">
      <h3>Music Library Folders</h3>
      <ul class="root-folder-list" id="root-folder-list">
        ${folders.length === 0 ? '<li class="text-muted">No folders configured.</li>' : ''}
        ${folders.map(f => `
          <li class="root-folder-item">
            <span class="root-folder-path">${esc(f.path)}</span>
            <span class="text-muted" style="font-size:12px">${fmtBytes(f.freeSpace)} free</span>
            <button class="btn btn-sm btn-danger" onclick="deleteRootFolder(${f.id})">Remove</button>
          </li>`).join('')}
      </ul>
      <div class="flex gap-2">
        <input type="text" class="form-input" id="new-folder-path" placeholder="/mnt/music" style="max-width:320px" />
        <button class="btn btn-primary btn-sm" id="btn-add-folder">Add Folder</button>
      </div>
      <div style="margin-top:14px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" id="btn-scan-library">&#128193; Scan Library</button>
        <span id="scan-status" class="text-muted" style="font-size:13px"></span>
      </div>
      <p class="text-muted" style="font-size:12px;margin-top:6px">
        Scan reads ID3/FLAC tags from existing audio files and imports them into Tunarr.
      </p>
    </div>

    <!-- ── Quality Profiles ─────────────────────────────────────────── -->
    <div class="settings-section">
      <h3>Quality Profiles</h3>
      <div id="qprofile-list">
        ${profiles.length === 0 ? '<p class="text-muted">No profiles configured.</p>' : ''}
        ${profiles.map(p => `
          <div class="qprofile-row" style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);flex-wrap:wrap">
            <span style="font-weight:600;min-width:140px">${esc(p.name)}</span>
            <span class="badge" style="background:var(--accent-muted);color:var(--text)">${esc(qDefMap[p.cutoff] || String(p.cutoff))}</span>
            <span class="text-muted" style="font-size:13px">${p.upgradeAllowed ? '&#8679; upgrades on' : 'no upgrades'}</span>
            ${p.extraArgs ? `<code style="font-size:11px;background:var(--bg-tertiary);padding:2px 6px;border-radius:4px;color:var(--text-muted)">${esc(p.extraArgs)}</code>` : ''}
            <button class="btn btn-sm btn-danger" style="margin-left:auto" onclick="deleteQProfile(${p.id}, '${esc(p.name)}')">Remove</button>
          </div>`).join('')}
      </div>

      <div id="new-qprofile-form" style="display:none;margin-top:14px;padding:14px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary)">
        <div style="display:grid;grid-template-columns:1fr 1fr auto auto;gap:10px;align-items:end;margin-bottom:10px">
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Profile name</label>
            <input type="text" class="form-input" id="qp-name" placeholder="e.g. FLAC Only" />
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Quality (cutoff)</label>
            <select class="form-input" id="qp-cutoff" style="width:100%">${qDefOptions}</select>
          </div>
          <div style="padding-bottom:2px">
            <label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="checkbox" id="qp-upgrade" checked> Allow upgrades
            </label>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-primary btn-sm" id="btn-save-qprofile">Save</button>
            <button class="btn btn-secondary btn-sm" id="btn-cancel-qprofile">Cancel</button>
          </div>
        </div>
        <div>
          <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Extra yt-dlp args <span style="font-weight:400;opacity:.7">(optional — e.g. <code>--cookies-from-browser firefox</code>)</span></label>
          <input type="text" class="form-input" id="qp-extra-args" placeholder="--cookies-from-browser firefox" style="width:100%;max-width:500px;font-family:monospace;font-size:13px" />
        </div>
      </div>

      <button class="btn btn-secondary btn-sm" style="margin-top:12px" id="btn-add-qprofile">+ Add Profile</button>
    </div>

    <!-- ── Users (admin only) ─────────────────────────────────────── -->
    ${isAdmin() ? `
    <div class="settings-section">
      <h3>Users</h3>
      <ul class="root-folder-list" id="users-list">
        ${(users || []).map(u => `
          <li class="root-folder-item">
            <span class="root-folder-path">${esc(u.username)}</span>
            <span class="badge" style="background:${u.role === 'admin' ? 'var(--accent)' : 'var(--bg-tertiary)'};color:var(--text)">${u.role}</span>
            ${u.username !== (authUser()?.username) ? `<button class="btn btn-sm btn-danger" onclick="deleteUserAccount(${u.id}, '${esc(u.username)}')">Remove</button>` : '<span class="text-muted" style="font-size:12px">you</span>'}
          </li>`).join('')}
      </ul>
      <div id="new-user-form-wrap">
        <button class="btn btn-secondary btn-sm" id="btn-show-add-user" style="margin-top:8px">+ Add User</button>
        <div id="new-user-form" style="display:none;margin-top:10px;display:none;gap:8px;align-items:flex-end;flex-wrap:wrap">
          <input type="text" class="form-input" id="new-user-name" placeholder="Username" style="max-width:180px" autocomplete="off" />
          <input type="password" class="form-input" id="new-user-pw" placeholder="Password" style="max-width:180px" autocomplete="new-password" />
          <button class="btn btn-primary btn-sm" id="btn-save-user">Add</button>
          <button class="btn btn-secondary btn-sm" id="btn-cancel-user">Cancel</button>
        </div>
      </div>
    </div>` : ''}

    <!-- ── System ───────────────────────────────────────────────────── -->
    <div class="settings-section">
      <h3>System</h3>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:13px">
        <span class="text-muted">Version</span><span>${esc(status.version || '—')}</span>
        <span class="text-muted">yt-dlp</span><span>${esc(status.ytdlpVersion || '—')}</span>
        <span class="text-muted">OS</span><span>${esc(status.osName || '')} ${esc(status.osVersion || '')}</span>
        <span class="text-muted">Started</span><span>${fmtDateLocal(status.startedAt)}</span>
      </div>
    </div>
  `;

  // ── User management ────────────────────────────────────────────────────
  if (isAdmin()) {
    const showAddUser = document.getElementById('btn-show-add-user');
    const userForm    = document.getElementById('new-user-form');
    if (showAddUser && userForm) {
      showAddUser.addEventListener('click', () => {
        userForm.style.display = 'flex';
        showAddUser.style.display = 'none';
        document.getElementById('new-user-name').focus();
      });
      document.getElementById('btn-cancel-user').addEventListener('click', () => {
        userForm.style.display = 'none';
        showAddUser.style.display = '';
      });
      document.getElementById('btn-save-user').addEventListener('click', addUserAccount);
      document.getElementById('new-user-name').addEventListener('keydown', e => { if (e.key === 'Enter') addUserAccount(); });
      document.getElementById('new-user-pw').addEventListener('keydown',   e => { if (e.key === 'Enter') addUserAccount(); });
    }
  }

  // ── Folder handlers ────────────────────────────────────────────────────
  document.getElementById('btn-add-folder').addEventListener('click', addRootFolder);
  document.getElementById('new-folder-path').addEventListener('keydown', e => { if (e.key === 'Enter') addRootFolder(); });

  // ── Scan library ───────────────────────────────────────────────────────
  document.getElementById('btn-scan-library').addEventListener('click', runLibraryScan);

  // ── Quality profile handlers ───────────────────────────────────────────
  document.getElementById('btn-add-qprofile').addEventListener('click', () => {
    document.getElementById('new-qprofile-form').style.display = 'block';
    document.getElementById('btn-add-qprofile').style.display = 'none';
    document.getElementById('qp-name').focus();
  });
  document.getElementById('btn-cancel-qprofile').addEventListener('click', cancelQProfileForm);
  document.getElementById('btn-save-qprofile').addEventListener('click', saveQProfile);
}

// ── User management helpers ───────────────────────────────────────────────
async function addUserAccount() {
  const username = (document.getElementById('new-user-name')?.value || '').trim();
  const password = document.getElementById('new-user-pw')?.value || '';
  if (!username || !password) { toast('Username and password required', 'error'); return; }
  try {
    await API.authRegister(username, password);
    toast(`User "${username}" added`, 'success');
    renderSettingsView(document.getElementById('view-container'));
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteUserAccount(id, username) {
  if (!confirm(`Remove user "${username}"?`)) return;
  try {
    await API.deleteUser(id);
    toast(`User "${username}" removed`, 'success');
    renderSettingsView(document.getElementById('view-container'));
  } catch (e) { toast(e.message, 'error'); }
}

// ── Root folder helpers ────────────────────────────────────────────────────
async function addRootFolder() {
  const input = document.getElementById('new-folder-path');
  const path = input.value.trim();
  if (!path) return;
  try {
    await API.addRootFolder(path);
    toast('Root folder added', 'success');
    input.value = '';
    renderSettingsView(document.getElementById('view-container'));
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteRootFolder(id) {
  if (!confirm('Remove this folder from Tunarr? (Files will NOT be deleted.)')) return;
  try {
    await API.deleteRootFolder(id);
    toast('Folder removed', 'success');
    renderSettingsView(document.getElementById('view-container'));
  } catch (e) { toast(e.message, 'error'); }
}

// ── Library scan ──────────────────────────────────────────────────────────
async function runLibraryScan() {
  const btn = document.getElementById('btn-scan-library');
  const statusEl = document.getElementById('scan-status');
  btn.disabled = true;
  statusEl.textContent = 'Starting scan…';
  try {
    const cmd = await API.scanLibrary();
    statusEl.textContent = 'Scanning — this may take a while for large libraries…';
    const interval = setInterval(async () => {
      try {
        const c = await API.getCommand(cmd.id);
        if (c.status === 'completed' || c.status === 'failed') {
          clearInterval(interval);
          btn.disabled = false;
          statusEl.textContent = c.message || c.status;
          if (c.status === 'completed') toast('Library scan complete', 'success');
          else toast('Scan failed: ' + c.message, 'error');
        }
      } catch {
        clearInterval(interval);
        btn.disabled = false;
        statusEl.textContent = 'Error checking scan status';
      }
    }, 2000);
  } catch (e) {
    btn.disabled = false;
    statusEl.textContent = 'Error: ' + e.message;
    toast(e.message, 'error');
  }
}

// ── Quality profile helpers ───────────────────────────────────────────────
function cancelQProfileForm() {
  document.getElementById('new-qprofile-form').style.display = 'none';
  document.getElementById('btn-add-qprofile').style.display = '';
}

async function saveQProfile() {
  const name      = document.getElementById('qp-name').value.trim();
  const cutoff    = parseInt(document.getElementById('qp-cutoff').value, 10);
  const upgrade   = document.getElementById('qp-upgrade').checked;
  const extraArgs = (document.getElementById('qp-extra-args')?.value || '').trim();
  if (!name) { toast('Profile name is required', 'error'); return; }
  try {
    await API.addQProfile({ name, cutoff, upgradeAllowed: upgrade, items: [], extraArgs });
    toast(`Profile "${name}" created`, 'success');
    renderSettingsView(document.getElementById('view-container'));
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteQProfile(id, name) {
  if (!confirm(`Remove profile "${name}"?`)) return;
  try {
    await API.deleteQProfile(id);
    toast('Profile removed', 'success');
    renderSettingsView(document.getElementById('view-container'));
  } catch (e) { toast(e.message, 'error'); }
}

// ── Utilities ─────────────────────────────────────────────────────────────
function fmtBytes(bytes) {
  if (!bytes) return '?';
  if (bytes >= 1e12) return (bytes / 1e12).toFixed(1) + ' TB';
  if (bytes >= 1e9)  return (bytes / 1e9).toFixed(1)  + ' GB';
  if (bytes >= 1e6)  return (bytes / 1e6).toFixed(1)  + ' MB';
  return bytes + ' B';
}

function fmtDateLocal(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
