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
  '/artists':                          renderArtistsView,
  '/artist/:id':                       (c, p) => renderArtistDetailView(c, parseInt(p.id)),
  '/artist/:artistId/album/:albumId':  (c, p) => renderAlbumTracksView(c, parseInt(p.artistId), parseInt(p.albumId)),
  '/queue':                            renderQueueView,
  '/wanted':                           renderWantedView,
  '/history':                          renderHistoryView,
  '/requests':                         renderRequestsView,
  '/settings':                         renderSettingsView,
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

  // Auto-collapse on small screens unless user has explicitly expanded it
  const savedPref = localStorage.getItem('tunarr_sidebar_collapsed');
  const isMobile  = window.innerWidth <= 640;
  const shouldCollapse = savedPref === '1' || (isMobile && savedPref !== '0');

  if (shouldCollapse) {
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

let _badgeInterval = null;

async function initApp() {
  const auth = await checkAuth();
  const sidebar = document.getElementById('sidebar');
  const mainContent = document.getElementById('main-content');

  if (!auth.authenticated) {
    sidebar.style.display = 'none';
    renderLoginPage(mainContent);
    return;
  }

  sidebar.style.display = '';

  // Restore view-container if the login page replaced it
  if (!document.getElementById('view-container')) {
    mainContent.innerHTML = '<div id="view-container"></div>';
  }

  const userChip = document.getElementById('sidebar-user-chip');
  if (userChip) {
    userChip.querySelector('.sidebar-username').textContent = auth.username;
    userChip.style.display = '';
  }

  // Hide Settings nav for non-admins
  const navSettings = document.getElementById('nav-settings');
  if (navSettings) navSettings.style.display = auth.role === 'admin' ? '' : 'none';

  initSidebar();
  initAddArtistModal();
  initTrackSearchModal();
  window.removeEventListener('hashchange', onHashChange);
  window.addEventListener('hashchange', onHashChange);
  onHashChange();

  if (_badgeInterval) clearInterval(_badgeInterval);
  refreshBadges();
  _badgeInterval = setInterval(refreshBadges, 15000);
}

async function refreshBadges() {
  try {
    const fetches = [
      API.getQueue().catch(() => null),
      API.getMissing(1, 1).catch(() => null),
    ];
    if (isAdmin()) fetches.push(API.getPendingCount().catch(() => null));
    const [queueData, wantedData, requestsData] = await Promise.all(fetches);

    const badge_q = document.getElementById('badge-queue');
    const badge_w = document.getElementById('badge-wanted');
    const badge_r = document.getElementById('badge-requests');
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
    if (badge_r && requestsData) {
      const count = requestsData.count || 0;
      badge_r.textContent = count;
      badge_r.style.display = count > 0 ? '' : 'none';
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

document.addEventListener('DOMContentLoaded', initApp);
