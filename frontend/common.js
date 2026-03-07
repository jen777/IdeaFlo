const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:8000'
  : `${window.location.protocol}//${window.location.hostname}:8000`;

function token() { return localStorage.getItem('ideaflo_token') || ''; }
function authHeaders(extra={}) {
  const t = token();
  return t ? { ...extra, Authorization: `Bearer ${t}` } : { ...extra };
}

async function api(path, options = {}) {
  const opts = { ...options, headers: authHeaders(options.headers || {}) };
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!res.ok) {
    let msg = `Request failed: ${res.status}`;
    try { const j = await res.json(); msg = j.error || msg; } catch {}
    if (res.status === 401) {
      localStorage.removeItem('ideaflo_token');
      if (!location.pathname.endsWith('/login.html')) location.href = '/login.html';
    }
    throw new Error(msg);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res;
}

function requireAuth() {
  if (!token()) {
    location.href = '/login.html';
    return false;
  }
  return true;
}

function navHtml(active='') {
  return `
  <nav class="topnav">
    <a href="/ideas.html" ${active==='ideas'?'class="active"':''}>Ideas</a>
    <a href="/create-idea.html" ${active==='create'?'class="active"':''}>Create Idea</a>
    <a href="/users.html" ${active==='users'?'class="active"':''}>Users</a>
    <button id="logout-btn" class="danger small-btn">Logout</button>
  </nav>`;
}

function wireLogout() {
  const btn = document.getElementById('logout-btn');
  if (!btn) return;
  btn.onclick = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    localStorage.removeItem('ideaflo_token');
    location.href = '/login.html';
  };
}
