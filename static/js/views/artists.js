let _selectMode = false;
const _selectedIds = new Set();
let _linkTargetArtistId = null;

function renderArtistsView(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Artists</h1>
      <div class="artists-hdr-btns" id="artists-hdr-btns"></div>
    </div>
    <div id="artist-grid-wrap"><div class="loading-center"><div class="spinner"></div></div></div>
  `;
  _selectMode = false;
  _selectedIds.clear();
  _renderHdrBtns();
  loadArtists();
}

function _renderHdrBtns() {
  const wrap = document.getElementById('artists-hdr-btns');
  if (!wrap) return;
  if (_selectMode) {
    const n = _selectedIds.size;
    wrap.innerHTML = `
      <button class="btn btn-primary" id="btn-add-artist">+ Add Artist</button>
      ${n > 0 ? `<button class="btn btn-danger" id="btn-delete-sel">Delete (${n})</button>` : ''}
      <button class="btn btn-secondary" id="btn-sel-all">Select All</button>
      <button class="btn btn-secondary" id="btn-sel-done">Done</button>
    `;
    document.getElementById('btn-add-artist').addEventListener('click', openAddArtistModal);
    if (n > 0) document.getElementById('btn-delete-sel').addEventListener('click', deleteSelectedArtists);
    document.getElementById('btn-sel-all').addEventListener('click', selectAllArtists);
    document.getElementById('btn-sel-done').addEventListener('click', exitSelectMode);
  } else {
    wrap.innerHTML = `
      <button class="btn btn-primary" id="btn-add-artist">+ Add Artist</button>
      <button class="btn btn-secondary" id="btn-select-mode">Select</button>
    `;
    document.getElementById('btn-add-artist').addEventListener('click', openAddArtistModal);
    document.getElementById('btn-select-mode').addEventListener('click', enterSelectMode);
  }
}

function enterSelectMode() {
  _selectMode = true;
  _selectedIds.clear();
  document.querySelector('.artist-grid')?.classList.add('select-mode');
  _renderHdrBtns();
}

function exitSelectMode() {
  _selectMode = false;
  _selectedIds.clear();
  document.querySelectorAll('.artist-card.selected').forEach(c => c.classList.remove('selected'));
  document.querySelector('.artist-grid')?.classList.remove('select-mode');
  _renderHdrBtns();
}

function selectAllArtists() {
  document.querySelectorAll('.artist-card').forEach(card => {
    const id = parseInt(card.dataset.artistId, 10);
    _selectedIds.add(id);
    card.classList.add('selected');
  });
  _renderHdrBtns();
}

async function deleteSelectedArtists() {
  const ids = [..._selectedIds];
  if (!ids.length) return;
  if (!confirm(`Remove ${ids.length} artist${ids.length > 1 ? 's' : ''} from Tunarr?\n\nFiles on disk will NOT be deleted.`)) return;
  try {
    await Promise.all(ids.map(id => API.deleteArtist(id, false)));
    toast(`${ids.length} artist${ids.length > 1 ? 's' : ''} removed`, 'success');
    exitSelectMode();
    loadArtists();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadArtists() {
  const wrap = document.getElementById('artist-grid-wrap');
  if (!wrap) return;
  try {
    const artists = await API.getArtists();
    if (!artists || artists.length === 0) {
      wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🎤</div><div class="empty-state-title">No Artists Yet</div><p>Click "Add Artist" to start building your music library.</p></div>`;
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'artist-grid' + (_selectMode ? ' select-mode' : '');
    artists.forEach(a => grid.appendChild(buildArtistCard(a)));
    wrap.innerHTML = '';
    wrap.appendChild(grid);
  } catch (err) {
    wrap.innerHTML = `<p class="text-danger">Failed to load artists: ${err.message}</p>`;
  }
}

function buildArtistCard(artist) {
  const card = document.createElement('div');
  card.className = 'artist-card';
  card.dataset.artistId = artist.id;
  if (_selectedIds.has(artist.id)) card.classList.add('selected');

  const stats  = artist.statistics || {};
  const pct    = Math.round(stats.percentOfTracks || 0);
  const imgUrl = (artist.images || []).find(i => i.coverType === 'poster' || i.coverType === 'cover')?.remoteUrl;

  card.innerHTML = `
    <div class="artist-card-art">
      ${imgUrl
        ? `<img src="${imgUrl}" alt="${esc(artist.artistName)}" loading="lazy" onerror="this.style.display='none'" />`
        : `<span class="artist-card-placeholder">🎤</span>`}
    </div>
    <div class="artist-card-info">
      <div class="artist-card-name" title="${esc(artist.artistName)}">${esc(artist.artistName)}</div>
      <div class="artist-card-meta">${stats.albumCount || 0} albums · ${stats.trackFileCount || 0}/${stats.totalTrackCount || 0} tracks</div>
      <div class="progress-wrap"><div class="progress-bar" style="width:${pct}%"></div></div>
    </div>
  `;

  // Lazy-fetch image from TheAudioDB if not already cached
  if (!imgUrl) {
    API.getArtistImage(artist.id).then(data => {
      if (!data?.url) return;
      const artDiv     = card.querySelector('.artist-card-art');
      const placeholder = artDiv.querySelector('.artist-card-placeholder');
      if (!placeholder) return;
      const img = document.createElement('img');
      img.src     = data.url;
      img.alt     = artist.artistName;
      img.loading = 'lazy';
      img.onerror = () => img.style.display = 'none';
      artDiv.replaceChild(img, placeholder);
    }).catch(() => {});
  }

  card.addEventListener('click', () => {
    if (_selectMode) {
      if (_selectedIds.has(artist.id)) {
        _selectedIds.delete(artist.id);
        card.classList.remove('selected');
      } else {
        _selectedIds.add(artist.id);
        card.classList.add('selected');
      }
      _renderHdrBtns();
    } else {
      navigate(`/artist/${artist.id}`);
    }
  });

  return card;
}

function openAddArtistModal() {
  _linkTargetArtistId = null;
  const title = document.getElementById('modal-artist-title');
  if (title) title.textContent = 'Add Artist';
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('artist-search-input').value = '';
  document.getElementById('artist-search-results').innerHTML = '';
  setTimeout(() => document.getElementById('artist-search-input').focus(), 50);
}

function openLinkArtistModal(artistId) {
  _linkTargetArtistId = artistId;
  const title = document.getElementById('modal-artist-title');
  if (title) title.textContent = 'Link to MusicBrainz';
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('artist-search-input').value = '';
  document.getElementById('artist-search-results').innerHTML = '';
  setTimeout(() => document.getElementById('artist-search-input').focus(), 50);
}

function closeAddArtistModal() {
  _linkTargetArtistId = null;
  document.getElementById('modal-overlay').classList.add('hidden');
}

function initAddArtistModal() {
  document.getElementById('modal-close').addEventListener('click', closeAddArtistModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeAddArtistModal();
  });
  const input = document.getElementById('artist-search-input');
  const btn   = document.getElementById('artist-search-btn');
  btn.addEventListener('click', doArtistSearch);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doArtistSearch(); });
}

async function doArtistSearch() {
  const input   = document.getElementById('artist-search-input');
  const results = document.getElementById('artist-search-results');
  const term = input.value.trim();
  if (!term) return;
  results.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const data = await API.searchArtists(term);
    if (!data || data.length === 0) { results.innerHTML = '<p class="text-muted" style="text-align:center;padding:20px">No results found.</p>'; return; }
    results.innerHTML = '';
    const linkId = _linkTargetArtistId;
    data.forEach(a => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.innerHTML = `
        <div class="search-result-thumb">🎤</div>
        <div class="search-result-info">
          <div class="search-result-name">${esc(a.artistName)}</div>
          <div class="search-result-sub">${esc(a.artistType || '')} ${a.disambiguation ? '· ' + esc(a.disambiguation) : ''}</div>
        </div>
        <div class="search-result-actions"><button class="btn btn-primary btn-sm">${linkId ? 'Link' : 'Add'}</button></div>
      `;
      item.querySelector('button').addEventListener('click', () => linkId ? linkArtistToMB(a, linkId) : addArtist(a));
      results.appendChild(item);
    });
  } catch (err) {
    results.innerHTML = `<p class="text-danger">Search failed: ${err.message}</p>`;
  }
}

async function addArtist(a) {
  const folders = await API.getRootFolders().catch(() => []);
  const rootPath = folders[0]?.path || '';
  try {
    await API.addArtist({ musicBrainzId: a.musicBrainzId, artistName: a.artistName, monitored: true, albumFolder: true, rootFolderPath: rootPath, addOptions: { addType: 'manual' } });
    toast('Artist added: ' + a.artistName, 'success');
    closeAddArtistModal();
    loadArtists();
  } catch (err) {
    toast('Failed to add artist: ' + err.message, 'error');
  }
}

async function linkArtistToMB(a, artistId) {
  try {
    await API.linkArtist(artistId, a.musicBrainzId);
    toast(`Linked to MusicBrainz: ${a.artistName}`, 'success');
    closeAddArtistModal();
    // Reload the artist detail page if we're still on it
    const container = document.getElementById('view-container');
    if (container) renderArtistDetailView(container, artistId);
  } catch (err) {
    toast('Link failed: ' + err.message, 'error');
  }
}
