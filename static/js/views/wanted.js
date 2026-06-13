let _wantedPage = 1;
const _wantedPageSize = 25;
let _wantedFilter = '';
let _wantedDebounce = null;

async function renderWantedView(container) {
  _wantedPage = 1;
  _wantedFilter = '';
  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Wanted</h1>
      <button class="btn btn-primary btn-sm" id="btn-search-all-missing">Search All</button>
    </div>
    <div style="margin-bottom:14px">
      <input type="text" id="wanted-search" class="form-input" placeholder="Filter by title, album, or artist…" style="max-width:420px" />
    </div>
    <div class="table-wrap"><div id="wanted-content"><div class="loading-center"><div class="spinner"></div></div></div></div>
    <div id="wanted-pagination"></div>
  `;

  document.getElementById('wanted-search').addEventListener('input', e => {
    clearTimeout(_wantedDebounce);
    _wantedDebounce = setTimeout(() => {
      _wantedFilter = e.target.value.trim();
      _wantedPage = 1;
      loadMissing();
    }, 300);
  });

  document.getElementById('btn-search-all-missing').addEventListener('click', searchAllMissing);
  loadMissing();
}

async function searchAllMissing() {
  const btn = document.getElementById('btn-search-all-missing');
  if (btn) { btn.disabled = true; btn.textContent = 'Queuing…'; }
  try {
    const data = await API.getMissing(1, 999, _wantedFilter);
    const ids = (data.records || []).map(r => r.id);
    if (ids.length === 0) { toast('No missing tracks to search', 'info'); return; }
    await API.sendCommand({ name: 'TrackSearch', trackIds: ids });
    toast(`Queued search for ${ids.length} missing track${ids.length !== 1 ? 's' : ''}`, 'info');
    setTimeout(() => navigate('/queue'), 600);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Search All'; }
  }
}

async function loadMissing() {
  const content = document.getElementById('wanted-content');
  if (!content) return;
  content.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const data = await API.getMissing(_wantedPage, _wantedPageSize, _wantedFilter);
    const records = data?.records || [];
    const total = data?.totalRecords || 0;

    const badge = document.getElementById('badge-wanted');
    if (badge) { badge.textContent = total; badge.style.display = total > 0 ? '' : 'none'; }

    if (records.length === 0) {
      content.innerHTML = _wantedFilter
        ? `<div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-title">No Results</div><p>No tracks match "${esc(_wantedFilter)}".</p></div>`
        : `<div class="empty-state"><div class="empty-state-icon">✅</div><div class="empty-state-title">Nothing Missing</div><p>All monitored tracks have been downloaded.</p></div>`;
      const pag = document.getElementById('wanted-pagination');
      if (pag) pag.innerHTML = '';
      return;
    }

    const artistIds = [...new Set(records.map(r => r.artistId))];
    const albumIds  = [...new Set(records.map(r => r.albumId).filter(Boolean))];
    const artistMap = {}, albumMap = {};
    await Promise.all([
      ...artistIds.map(async id => { try { artistMap[id] = await API.getArtist(id); } catch {} }),
      ...albumIds.map(async id  => { try { albumMap[id]  = await API.getAlbum(id);  } catch {} }),
    ]);

    const start = (_wantedPage - 1) * _wantedPageSize + 1;
    content.innerHTML = `
      <table class="data-table">
        <thead><tr><th>#</th><th>Track</th><th>Artist</th><th>Album</th><th>Duration</th><th></th></tr></thead>
        <tbody>${records.map((t, i) => `
          <tr>
            <td class="text-muted">${start + i}</td>
            <td>${esc(t.title)}</td>
            <td class="text-muted">${esc(artistMap[t.artistId]?.artistName || '')}</td>
            <td class="text-muted">${esc(albumMap[t.albumId]?.title || '')}</td>
            <td class="text-muted">${formatDuration(t.duration)}</td>
            <td><button class="btn btn-sm btn-primary" data-track-id="${t.id}" data-track-title="${esc(t.title)}">Search</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;

    content.querySelectorAll('button[data-track-id]').forEach(btn => {
      btn.addEventListener('click', () => wantedSearchTrack(+btn.dataset.trackId, btn.dataset.trackTitle));
    });

    _renderWantedPagination(total);
  } catch (err) {
    if (content) content.innerHTML = `<p class="text-danger" style="padding:20px">Failed to load: ${err.message}</p>`;
  }
}

function _renderWantedPagination(total) {
  const pag = document.getElementById('wanted-pagination');
  if (!pag) return;
  const totalPages = Math.ceil(total / _wantedPageSize);
  if (totalPages <= 1) { pag.innerHTML = ''; return; }
  pag.innerHTML = `
    <div class="pagination-bar">
      <button class="btn btn-secondary btn-sm" id="pag-prev" ${_wantedPage <= 1 ? 'disabled' : ''}>← Prev</button>
      <span class="text-muted" style="font-size:13px">Page ${_wantedPage} of ${totalPages} &nbsp;·&nbsp; ${total} tracks</span>
      <button class="btn btn-secondary btn-sm" id="pag-next" ${_wantedPage >= totalPages ? 'disabled' : ''}>Next →</button>
    </div>
  `;
  const prev = document.getElementById('pag-prev');
  const next = document.getElementById('pag-next');
  if (prev) prev.addEventListener('click', () => { _wantedPage--; loadMissing(); });
  if (next) next.addEventListener('click', () => { _wantedPage++; loadMissing(); });
}

async function wantedSearchTrack(trackId, title) {
  try { await API.searchTrack(trackId); toast(`Searching for "${title}"…`, 'info'); }
  catch (e) { toast(e.message, 'error'); }
}
