async function renderSettingsView(container) {
  container.innerHTML = `<div class="page-header"><h1 class="page-title">Settings</h1></div><div id="settings-body"><div class="loading-center"><div class="spinner"></div></div></div>`;
  try {
    const [folders, profiles, status, qualityDefs] = await Promise.all([
      API.getRootFolders(),
      API.getQProfiles(),
      API.getStatus(),
      API.getQualityDefs(),
    ]);
    renderSettingsBody(document.getElementById('settings-body'), folders, profiles, status, qualityDefs);
  } catch (err) {
    document.getElementById('settings-body').innerHTML = `<p class="text-danger">Failed to load settings: ${err.message}</p>`;
  }
}

function renderSettingsBody(body, folders, profiles, status, qualityDefs) {
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
          <div class="qprofile-row" style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
            <span style="font-weight:600;min-width:140px">${esc(p.name)}</span>
            <span class="badge" style="background:var(--accent-muted);color:var(--text)">${esc(qDefMap[p.cutoff] || String(p.cutoff))}</span>
            <span class="text-muted" style="font-size:13px">${p.upgradeAllowed ? '&#8679; upgrades on' : 'no upgrades'}</span>
            <button class="btn btn-sm btn-danger" style="margin-left:auto" onclick="deleteQProfile(${p.id}, '${esc(p.name)}')">Remove</button>
          </div>`).join('')}
      </div>

      <div id="new-qprofile-form" style="display:none;margin-top:14px;padding:14px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary)">
        <div style="display:grid;grid-template-columns:1fr 1fr auto auto;gap:10px;align-items:end">
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Profile name</label>
            <input type="text" class="form-input" id="qp-name" placeholder="e.g. FLAC Only" />
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Minimum quality (cutoff)</label>
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
      </div>

      <button class="btn btn-secondary btn-sm" style="margin-top:12px" id="btn-add-qprofile">+ Add Profile</button>
    </div>

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
  const name    = document.getElementById('qp-name').value.trim();
  const cutoff  = parseInt(document.getElementById('qp-cutoff').value, 10);
  const upgrade = document.getElementById('qp-upgrade').checked;
  if (!name) { toast('Profile name is required', 'error'); return; }
  try {
    await API.addQProfile({ name, cutoff, upgradeAllowed: upgrade, items: [] });
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
