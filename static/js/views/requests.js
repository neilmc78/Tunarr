async function renderRequestsView(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Artist Requests</h1>
    </div>
    <div class="table-wrap"><div id="requests-content"><div class="loading-center"><div class="spinner"></div></div></div></div>
  `;
  loadRequests();
}

async function loadRequests() {
  const content = document.getElementById('requests-content');
  if (!content) return;
  content.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const reqs = await API.getRequests();
    if (!reqs || reqs.length === 0) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-title">No Requests</div><p>${isAdmin() ? 'No artist requests have been submitted yet.' : 'You haven\'t requested any artists yet.'}</p></div>`;
      return;
    }
    const admin = isAdmin();
    content.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Artist</th>
            <th>Requested By</th>
            <th>Date</th>
            <th>Status</th>
            ${admin ? '<th>Actions</th>' : ''}
          </tr>
        </thead>
        <tbody id="requests-tbody"></tbody>
      </table>
    `;
    const tbody = document.getElementById('requests-tbody');
    reqs.forEach(req => tbody.appendChild(buildRequestRow(req, admin)));
  } catch (err) {
    if (content) content.innerHTML = `<p class="text-danger" style="padding:20px">Failed to load requests: ${err.message}</p>`;
  }
}

function buildRequestRow(req, admin) {
  const tr = document.createElement('tr');
  tr.id = `req-row-${req.id}`;
  const date = req.createdAt ? new Date(req.createdAt).toLocaleDateString() : '—';
  const statusBadge = {
    pending:  '<span class="status-badge status-missing">Pending</span>',
    approved: '<span class="status-badge status-downloaded">Approved</span>',
    rejected: '<span class="status-badge" style="background:rgba(255,255,255,.05);color:var(--text-dim)">Rejected</span>',
  }[req.status] || `<span class="status-badge">${esc(req.status)}</span>`;

  tr.innerHTML = `
    <td>
      <div style="font-weight:500">${esc(req.artistName)}</div>
      ${req.artistType || req.disambiguation ? `<div class="text-muted" style="font-size:12px">${esc(req.artistType || '')}${req.disambiguation ? ' · ' + esc(req.disambiguation) : ''}</div>` : ''}
    </td>
    <td class="text-muted">${esc(req.requestedBy)}</td>
    <td class="text-muted" style="white-space:nowrap">${date}</td>
    <td>${statusBadge}</td>
    ${admin ? `<td class="request-actions" id="req-actions-${req.id}"></td>` : ''}
  `;

  if (admin) {
    const actionsCell = tr.querySelector(`#req-actions-${req.id}`);
    if (req.status === 'pending') {
      const approveBtn = document.createElement('button');
      approveBtn.className = 'btn btn-sm btn-primary';
      approveBtn.textContent = 'Approve';
      approveBtn.addEventListener('click', () => approveRequest(req));

      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'btn btn-sm btn-secondary';
      rejectBtn.textContent = 'Reject';
      rejectBtn.style.marginLeft = '6px';
      rejectBtn.addEventListener('click', () => rejectRequest(req.id));

      actionsCell.appendChild(approveBtn);
      actionsCell.appendChild(rejectBtn);
    } else {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn-sm btn-danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => deleteRequest(req.id));
      actionsCell.appendChild(deleteBtn);
    }
  }

  return tr;
}

async function approveRequest(req) {
  const actionsCell = document.getElementById(`req-actions-${req.id}`);
  if (actionsCell) {
    actionsCell.innerHTML = '<span class="text-muted" style="font-size:12px">Adding artist…</span>';
  }
  try {
    const folders = await API.getRootFolders().catch(() => []);
    const rootPath = folders[0]?.path || '';
    await API.addArtist({
      musicBrainzId: req.musicBrainzId,
      artistName: req.artistName,
      monitored: true,
      albumFolder: true,
      rootFolderPath: rootPath,
      addOptions: { addType: 'manual' },
    });
    await API.updateRequest(req.id, { status: 'approved' });
    toast(`${req.artistName} added to library`, 'success');
    refreshBadges();
    loadRequests();
  } catch (err) {
    toast(`Failed to approve: ${err.message}`, 'error');
    loadRequests();
  }
}

async function rejectRequest(reqId) {
  try {
    await API.updateRequest(reqId, { status: 'rejected' });
    toast('Request rejected', 'info');
    refreshBadges();
    loadRequests();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteRequest(reqId) {
  try {
    await API.deleteRequest(reqId);
    toast('Request deleted', 'info');
    refreshBadges();
    loadRequests();
  } catch (err) {
    toast(err.message, 'error');
  }
}
