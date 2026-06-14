/* Auth state — loaded before app.js */
let _authState = null;

async function checkAuth() {
  const resp = await fetch('/api/v3/auth/status');
  _authState = await resp.json();
  return _authState;
}

function isAdmin() {
  return _authState?.role === 'admin';
}

function authUser() {
  return _authState;
}

function renderLoginPage(container) {
  const isSetup = !_authState?.initialized;
  container.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-logo">🎵 Tunarr</div>
        <h2 class="login-title">${isSetup ? 'Create Admin Account' : 'Sign In'}</h2>
        ${isSetup ? '<p class="login-sub">You\'re the first user — you\'ll be granted admin access.</p>' : ''}
        <div id="login-error" class="login-error" style="display:none"></div>
        <form id="login-form" autocomplete="on">
          <div class="form-group">
            <label class="form-label">Username</label>
            <input type="text" id="login-username" class="form-input" required
              autocomplete="username" spellcheck="false" />
          </div>
          <div class="form-group">
            <label class="form-label">Password</label>
            <input type="password" id="login-password" class="form-input" required
              autocomplete="${isSetup ? 'new-password' : 'current-password'}" />
          </div>
          ${isSetup ? `
          <div class="form-group">
            <label class="form-label">Confirm Password</label>
            <input type="password" id="login-confirm" class="form-input" required
              autocomplete="new-password" />
          </div>` : ''}
          <button type="submit" class="btn btn-primary login-btn">
            ${isSetup ? 'Create Account &amp; Sign In' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl    = document.getElementById('login-error');
    errEl.style.display = 'none';

    if (isSetup) {
      const confirm = document.getElementById('login-confirm').value;
      if (password !== confirm) {
        errEl.textContent = 'Passwords do not match.';
        errEl.style.display = '';
        return;
      }
    }

    try {
      const endpoint = isSetup ? '/api/v3/auth/register' : '/api/v3/auth/login';
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || 'Authentication failed');
      }
      // Reload the app with fresh auth state
      await initApp();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = '';
    }
  });

  setTimeout(() => document.getElementById('login-username')?.focus(), 50);
}

async function logout() {
  await fetch('/api/v3/auth/logout', { method: 'POST' }).catch(() => {});
  _authState = null;
  await initApp();
}
