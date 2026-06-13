function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDuration(ms) {
  if (!ms) return '—';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

let _currentView = null;

const routes = {
  '/artists':    renderArtistsView,
  '/artist/:id': (c, p) => renderArtistDetailView(c, parseInt(p.id)),
  '/queue':      renderQueueView,
  '/wanted':     renderWantedView,
  '/history':    renderHistoryView,
  '/settings':   renderSettingsView,
};

function navigate(path) { window.location.hash = path; }

function parseRoute(hash) {
  const path = hash.replace(/^#/, '') || '/artists';
  for (const [pattern, handler] of Object.entries(routes)) {
    const params = matchPattern(pattern, path);
    if (params !== null) return { handler, params, path };
  }
  return null;
}

function matchPattern(pattern, path) {
  const patParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i].startsWith(':')) params[patParts[i].slice(1)] = pathParts[i];
    else if (patParts[i] !== pathParts[i]) return null;
  }
  return params;
}

function setActiveNav(path) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const view = path.split('/')[1] || 'artists';
  const navEl = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (navEl) navEl.classList.add('active');
}

function onHashChange() {
  if (_currentView === 'queue') teardownQueueView();
  const hash = window.location.hash || '#/artists';
  const matched = parseRoute(hash);
  const container = document.getElementById('view-container');
  setActiveNav(hash.replace('#', ''));
  if (!matched) { navigate('/artists'); return; }
  _currentView = matched.path.split('/')[1];
  matched.handler(container, matched.params);
}

function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggle  = document.getElementById('sidebar-toggle');
  if (!sidebar || !toggle) return;
  if (localStorage.getItem('tunarr_sidebar_collapsed') === '1') {
    sidebar.classList.add('collapsed');
    toggle.textContent = '»';
    toggle.title = 'Expand sidebar';
  }
  toggle.addEventListener('click', () => {
    const collapsed = sidebar.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '»' : '«';
    toggle.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    localStorage.setItem('tunarr_sidebar_collapsed', collapsed ? '1' : '0');
  });
}

function init() {
  initSidebar();
  initAddArtistModal();
  initTrackSearchModal();
  window.addEventListener('hashchange', onHashChange);
  onHashChange();
  refreshBadges();
  setInterval(refreshBadges, 15000);
}

async function refreshBadges() {
  try {
    const [queueData, wantedData] = await Promise.all([
      API.getQueue().catch(() => null),
      API.getMissing(1, 1).catch(() => null),
    ]);
    const badge_q = document.getElementById('badge-queue');
    const badge_w = document.getElementById('badge-wanted');
    if (badge_q && queueData) {
      const active = (queueData.records || []).filter(r => r.status !== 'completed').length;
      badge_q.textContent = active;
      badge_q.style.display = active > 0 ? '' : 'none';
    }
    if (badge_w && wantedData) {
      const count = wantedData.totalRecords || 0;
      badge_w.textContent = count;
      badge_w.style.display = count > 0 ? '' : 'none';
    }
  } catch {}
}

API.grabDirect = async (trackId, albumId, artistId, sourceUrl, title) => {
  const resp = await fetch('/api/v3/queue/grab', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackId, albumId, artistId, sourceUrl, title, protocol: 'ytdlp' }),
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
};

document.addEventListener('DOMContentLoaded', init);
