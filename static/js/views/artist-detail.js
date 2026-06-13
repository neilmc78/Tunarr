let _currentArtistId = null;
let _trackSearchContext = null;

async function renderArtistDetailView(container, artistId) {
  _currentArtistId = artistId;
  container.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const [artist, albums] = await Promise.all([API.getArtist(artistId), API.getAlbums(artistId)]);
    renderArtistPage(container, artist, albums);
  } catch (err) {
    container.innerHTML = `<p class="text-danger">Failed to load artist: ${err.message}</p>`;
  }
}

function renderArtistPage(container, artist, albums) {
  const stats = artist.statistics || {};
  const imgUrl = (artist.images || []).find(i => i.coverType === 'cover' || i.coverType === 'poster')?.remoteUrl;
  container.innerHTML = `
    <a href="#/artists" class="text-muted" style="display:inline-flex;align-items:center;gap:6px;margin-bottom:16px;font-size:13px">← All Artists</a>
    <div class="artist-header">
      <div class="artist-header-art">${imgUrl ? `<img src="${imgUrl}" alt="${esc(artist.artistName)}" onerror="this.style.display='none'" />` : '🎤'}</div>
      <div class="artist-header-info">
        <div class="artist-header-name">${esc(artist.artistName)}</div>
        <div class="artist-header-meta">${esc(artist.artistType || '')} ${artist.disambiguation ? '· ' + esc(artist.disambiguation) : ''} · <span class="status-badge ${artist.status === 'ended' ? 'status-missing' : 'status-monitored'}">${artist.status}</span></div>
        ${artist.overview ? `<div class="artist-header-overview">${esc(artist.overview)}</div>` : ''}
        <div class="stat-chips">
          <span class="chip"><strong>${stats.albumCount || 0}</strong> albums</span>
          <span class="chip"><strong>${stats.trackFileCount || 0}</strong> / <strong>${stats.totalTrackCount || 0}</strong> tracks</span>
          <span class="chip"><strong>${Math.round(stats.percentOfTracks || 0)}%</strong> complete</span>
          ${stats.missingTrackCount > 0 ? `<span class="chip text-danger"><strong>${stats.missingTrackCount}</strong> missing</span>` : ''}
        </div>
        <div class="artist-header-actions" id="artist-actions">
          <button class="btn btn-primary btn-sm" id="btn-search-all">Search All Missing</button>
          <button class="btn btn-secondary btn-sm" id="btn-refresh-artist">Refresh</button>
          <label class="toggle" title="Monitored"><input type="checkbox" id="toggle-artist-monitored" ${artist.monitored ? 'checked' : ''} /><span class="toggle-slider"></span></label>
          <span class="text-muted" style="font-size:12px;align-self:center">Monitored</span>
          <button class="btn btn-danger btn-sm" id="btn-delete-artist" style="margin-left:auto">Delete Artist</button>
        </div>
        <div id="delete-confirm" style="display:none;align-items:center;gap:8px;flex-wrap:wrap;padding:10px;border:1px solid var(--danger,#e05252);border-radius:6px;background:rgba(224,82,82,.08)">
          <span style="font-size:13px">Delete <strong>${esc(artist.artistName)}</strong> from Tunarr?</span>
          <button class="btn btn-danger btn-sm" id="btn-confirm-delete-keep">Remove (keep files)</button>
          <button class="btn btn-danger btn-sm" id="btn-confirm-delete-files">Remove + delete files</button>
          <button class="btn btn-secondary btn-sm" id="btn-cancel-delete">Cancel</button>
        </div>
      </div>
    </div>
    <div id="albums-container">${albums.length === 0 ? '<div class="empty-state"><div class="empty-state-icon">💿</div><div class="empty-state-title">No Albums</div><p>Click Refresh to fetch albums from MusicBrainz.</p></div>' : ''}</div>
  `;

  document.getElementById('toggle-artist-monitored').addEventListener('change', async function() {
    await API.updateArtist(artist.id, { monitored: this.checked }).catch(e => toast(e.message, 'error'));
  });
  document.getElementById('btn-search-all').addEventListener('click', async () => {
    try { await API.searchArtistMissing(artist.id); toast('Searching for all missing tracks…', 'info'); }
    catch (e) { toast(e.message, 'error'); }
  });
  document.getElementById('btn-refresh-artist').addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh-artist');
    btn.disabled = true; btn.textContent = 'Refreshing…';
    try {
      await API.refreshArtist(artist.id); toast('Refresh queued', 'info');
      setTimeout(() => renderArtistDetailView(document.getElementById('view-container'), artist.id), 2000);
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = 'Refresh'; }
  });

  // ── Delete flow ────────────────────────────────────────────────
  document.getElementById('btn-delete-artist').addEventListener('click', () => {
    document.getElementById('artist-actions').style.display  = 'none';
    document.getElementById('delete-confirm').style.display  = 'flex';
  });
  document.getElementById('btn-cancel-delete').addEventListener('click', () => {
    document.getElementById('delete-confirm').style.display  = 'none';
    document.getElementById('artist-actions').style.display  = '';
  });
  const doDelete = async (deleteFiles) => {
    try {
      await API.deleteArtist(artist.id, deleteFiles);
      toast(`${artist.artistName} removed`, 'success');
      navigate('/artists');
    } catch (e) { toast(e.message, 'error'); }
  };
  document.getElementById('btn-confirm-delete-keep').addEventListener('click',  () => doDelete(false));
  document.getElementById('btn-confirm-delete-files').addEventListener('click', () => doDelete(true));

  const albumsContainer = document.getElementById('albums-container');
  albums.forEach(al => albumsContainer.appendChild(buildAlbumSection(al)));
}

function buildAlbumSection(album) {
  const section = document.createElement('div');
  section.className = 'album-section';
  section.id = `album-${album.id}`;
  const imgUrl = (album.images || []).find(i => i.coverType === 'cover' || i.coverType === 'poster')?.remoteUrl;
  const year = (album.releaseDate || '').slice(0, 4) || '?';
  const stats = album.statistics || {};
  const pct = Math.round(stats.percentOfTracks || 0);
  section.innerHTML = `
    <div class="album-header" id="album-hdr-${album.id}">
      <div class="album-art-thumb" id="album-thumb-${album.id}">${imgUrl ? `<img src="${imgUrl}" alt="${esc(album.title)}" loading="lazy" onerror="this.style.display='none'" />` : '💿'}</div>
      <div class="album-header-info"><div class="album-title">${esc(album.title)}</div><div class="album-meta">${esc(album.albumType)} · ${year} · ${stats.trackCount || 0} tracks</div></div>
      <div class="album-stats">
        <span class="text-muted" style="font-size:12px">${stats.trackFileCount || 0}/${stats.trackCount || 0} · ${pct}%</span>
        ${album.anyTracksMissing ? '<span class="status-badge status-missing">Missing</span>' : '<span class="status-badge status-downloaded">Complete</span>'}
        <label class="toggle" title="Monitor album" onclick="event.stopPropagation()"><input type="checkbox" class="album-monitor-toggle" data-album-id="${album.id}" ${album.monitored ? 'checked' : ''} /><span class="toggle-slider"></span></label>
        <button class="btn btn-sm btn-primary album-search-btn" data-album-id="${album.id}" onclick="event.stopPropagation()">Search</button>
      </div>
      <span class="album-expand">›</span>
    </div>
    <div class="track-table-wrap" id="tracks-${album.id}"><div class="loading-center" style="padding:20px"><div class="spinner"></div></div></div>
  `;
  // Lazy-load album art from TheAudioDB if not already cached
  if (!imgUrl) {
    API.getAlbumImage(album.id).then(data => {
      if (!data?.url) return;
      const thumb = document.getElementById(`album-thumb-${album.id}`);
      if (!thumb || thumb.querySelector('img')) return;
      const img = document.createElement('img');
      img.src = data.url; img.alt = album.title; img.loading = 'lazy';
      img.onerror = () => img.style.display = 'none';
      thumb.textContent = '';
      thumb.appendChild(img);
    }).catch(() => {});
  }

  const hdr  = section.querySelector(`#album-hdr-${album.id}`);
  const wrap = section.querySelector(`#tracks-${album.id}`);
  hdr.addEventListener('click', () => {
    const isOpen = hdr.classList.toggle('open');
    wrap.classList.toggle('open', isOpen);
    if (isOpen && !wrap.dataset.loaded) loadTracks(album, wrap);
  });
  section.querySelector('.album-monitor-toggle').addEventListener('change', async function() {
    await API.updateAlbum(album.id, { monitored: this.checked }).catch(e => toast(e.message, 'error'));
  });
  section.querySelector('.album-search-btn').addEventListener('click', async () => {
    try { await API.searchAlbum(album.id); toast(`Searching for missing tracks in "${album.title}"…`, 'info'); }
    catch (e) { toast(e.message, 'error'); }
  });
  return section;
}

async function loadTracks(album, wrap) {
  wrap.dataset.loaded = '1';
  try {
    let tracks = await API.getTracks(album.id);
    if (!tracks || tracks.length === 0) { await API.refreshAlbum(album.id); tracks = await API.getTracks(album.id); }
    if (!tracks || tracks.length === 0) { wrap.innerHTML = '<p class="text-muted" style="padding:16px">No tracks found. Try refreshing.</p>'; return; }
    renderTrackTable(wrap, album, tracks);
  } catch (err) {
    wrap.innerHTML = `<p class="text-danger" style="padding:16px">Failed to load tracks: ${err.message}</p>`;
  }
}

function renderTrackTable(wrap, album, tracks) {
  const table = document.createElement('table');
  table.className = 'track-table';
  table.innerHTML = `<thead><tr><th class="track-num">#</th><th>Title</th><th class="track-dur">Duration</th><th class="track-status">Status</th><th class="track-actions">Actions</th></tr></thead><tbody id="tbody-album-${album.id}"></tbody>`;
  const tbody = table.querySelector('tbody');
  tracks.forEach(t => tbody.appendChild(buildTrackRow(t)));
  wrap.innerHTML = '';
  wrap.appendChild(table);
}

function buildTrackRow(track) {
  const tr = document.createElement('tr');
  tr.id = `track-row-${track.id}`;
  const dur = formatDuration(track.duration);
  const status = track.hasFile
    ? '<span class="status-badge status-downloaded">Downloaded</span>'
    : track.monitored
      ? '<span class="status-badge status-missing">Missing</span>'
      : '<span class="status-badge" style="background:rgba(255,255,255,.05);color:var(--text-dim)">Unmonitored</span>';
  tr.innerHTML = `
    <td class="track-num">${esc(String(track.trackNumber || track.absoluteTrackNumber))}</td>
    <td class="track-title">${esc(track.title)}</td>
    <td class="track-dur">${dur}</td>
    <td class="track-status">${status}</td>
    <td class="track-actions">
      <label class="toggle" title="Monitor" style="vertical-align:middle"><input type="checkbox" class="track-monitor-chk" data-track-id="${track.id}" ${track.monitored ? 'checked' : ''} /><span class="toggle-slider"></span></label>
      ${!track.hasFile ? `<button class="btn btn-sm btn-primary track-search-btn" data-track-id="${track.id}" style="margin-left:6px">⬇</button>` : ''}
    </td>
  `;
  tr.querySelector('.track-monitor-chk').addEventListener('change', async function() {
    await API.updateTrack(track.id, { monitored: this.checked }).catch(e => toast(e.message, 'error'));
    track.monitored = this.checked;
    tr.replaceWith(buildTrackRow(track));
  });
  const searchBtn = tr.querySelector('.track-search-btn');
  if (searchBtn) searchBtn.addEventListener('click', () => openTrackSearchModal(track));
  return tr;
}

function initTrackSearchModal() {
  document.getElementById('track-modal-close').addEventListener('click', closeTrackSearchModal);
  document.getElementById('modal-track-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-track-overlay')) closeTrackSearchModal();
  });
}

function closeTrackSearchModal() {
  document.getElementById('modal-track-overlay').classList.add('hidden');
  _trackSearchContext = null;
}

async function openTrackSearchModal(track) {
  _trackSearchContext = track;
  const modal   = document.getElementById('modal-track-overlay');
  const title   = document.getElementById('track-search-title');
  const results = document.getElementById('track-search-results');
  title.textContent = `Search: "${track.title}"`;
  results.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  modal.classList.remove('hidden');
  let query = track.title;
  try { const a = await API.getArtist(track.artistId); if (a?.artistName) query = `${a.artistName} - ${track.title}`; } catch {}
  try {
    const data = await API.searchYT(query);
    if (!data || data.length === 0) { results.innerHTML = '<p class="text-muted" style="text-align:center;padding:20px">No results found on YouTube Music.</p>'; return; }
    results.innerHTML = '';
    data.forEach(r => results.appendChild(buildYTResult(r, track)));
  } catch (err) {
    results.innerHTML = `<p class="text-danger">Search failed: ${err.message}</p>`;
  }
}

function buildYTResult(result, track) {
  const dur   = formatDuration(result.duration || 0);
  const views = result.viewCount ? fmtViews(result.viewCount) : '';
  const item  = document.createElement('div');
  item.className = 'search-result-item';
  item.innerHTML = `
    <div class="search-result-thumb">${result.thumbnailUrl ? `<img src="${result.thumbnailUrl}" alt="" loading="lazy" onerror="this.style.display='none'" />` : '🎵'}</div>
    <div class="search-result-info"><div class="search-result-name">${esc(result.title)}</div><div class="search-result-sub">${esc(result.channel)} · ${dur} ${views ? '· ' + views + ' views' : ''}</div></div>
    <div class="search-result-actions"><button class="btn btn-primary btn-sm">Grab</button></div>
  `;
  item.querySelector('button').addEventListener('click', async () => {
    try {
      await fetch('/api/v3/queue/grab', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId: track.id, albumId: track.albumId, artistId: track.artistId, sourceUrl: result.url, title: result.title, protocol: 'ytdlp' }) })
        .then(async r => { if (!r.ok) throw new Error(await r.text()); });
      toast('Download queued!', 'success');
      closeTrackSearchModal();
    } catch (err) { toast('Failed to queue: ' + err.message, 'error'); }
  });
  return item;
}

function fmtViews(n) {
  if (n >= 1e9) return (n/1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
  return String(n);
}
