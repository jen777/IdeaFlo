const API_BASE = 'https://ideaflo-api.apps.vershynin.if.ua';

let selectedIdeaId = null;
let authHeader = localStorage.getItem('ideaflo_auth') || '';

const ideasList = document.getElementById('ideas-list');
const docsList = document.getElementById('docs-list');
const detailPanel = document.getElementById('detail-panel');
const authStatus = document.getElementById('auth-status');

function setAuthStatus() {
  authStatus.textContent = authHeader ? 'Authenticated' : 'Not authenticated';
}
setAuthStatus();

function withAuthHeaders(headers = {}) {
  const h = { ...headers };
  if (authHeader) h.Authorization = authHeader;
  return h;
}

async function api(path, options = {}) {
  const opts = { ...options, headers: withAuthHeaders(options.headers || {}) };
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Unauthorized. Please login.');
    }
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res;
}

async function verifyLogin(username, password) {
  const hdr = 'Basic ' + btoa(`${username}:${password}`);
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error('Invalid login/password');
  authHeader = hdr;
  localStorage.setItem('ideaflo_auth', authHeader);
  setAuthStatus();
}

async function loadIdeas() {
  if (!authHeader) {
    ideasList.textContent = 'Please login first.';
    return;
  }
  const ideas = await api('/ideas');
  ideasList.innerHTML = '';

  if (!ideas.length) {
    ideasList.textContent = 'No ideas yet.';
    return;
  }

  ideas.forEach((idea) => {
    const div = document.createElement('div');
    div.className = 'idea-item';
    div.innerHTML = `
      <strong>${idea.title}</strong>
      <div>${idea.summary || ''}</div>
      <div class="small">Status: ${idea.status}</div>
      <button data-id="${idea.id}">Open</button>
    `;
    div.querySelector('button').onclick = () => selectIdea(idea.id);
    ideasList.appendChild(div);
  });
}

async function selectIdea(id) {
  const idea = await api(`/ideas/${id}`);
  selectedIdeaId = id;
  detailPanel.hidden = false;

  const form = document.getElementById('update-idea-form');
  form.id.value = idea.id;
  form.title.value = idea.title;
  form.summary.value = idea.summary;
  form.status.value = idea.status;
  form.current_state.value = idea.current_state;
  form.future_steps.value = idea.future_steps;

  await loadDocuments();
}

async function downloadDocument(docId, filename) {
  const res = await fetch(`${API_BASE}/ideas/${selectedIdeaId}/documents/${docId}/download`, {
    headers: withAuthHeaders(),
  });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function loadDocuments() {
  if (!selectedIdeaId) return;
  const docs = await api(`/ideas/${selectedIdeaId}/documents`);
  docsList.innerHTML = '';
  if (!docs.length) {
    docsList.textContent = 'No documents uploaded.';
    return;
  }

  docs.forEach((doc) => {
    const div = document.createElement('div');
    div.className = 'doc-item';
    div.innerHTML = `
      <strong>${doc.filename}</strong>
      <div class="small">${doc.size_bytes} bytes</div>
      <div class="row">
        <button class="download">Download</button>
        <button class="danger delete">Delete</button>
      </div>
    `;
    div.querySelector('.download').onclick = async () => {
      await downloadDocument(doc.id, doc.filename);
    };
    div.querySelector('.delete').onclick = async () => {
      if (!confirm('Delete this document?')) return;
      await api(`/ideas/${selectedIdeaId}/documents/${doc.id}`, { method: 'DELETE' });
      await loadDocuments();
    };
    docsList.appendChild(div);
  });
}

document.getElementById('login-form').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    await verifyLogin(form.username.value, form.password.value);
    form.password.value = '';
    await loadIdeas();
  } catch (err) {
    alert(err.message);
  }
};

document.getElementById('logout-btn').onclick = () => {
  authHeader = '';
  localStorage.removeItem('ideaflo_auth');
  selectedIdeaId = null;
  detailPanel.hidden = true;
  docsList.innerHTML = '';
  setAuthStatus();
  ideasList.textContent = 'Please login first.';
};

document.getElementById('create-idea-form').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.target;
  const payload = Object.fromEntries(new FormData(form).entries());
  await api('/ideas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  form.reset();
  form.status.value = 'new';
  await loadIdeas();
};

document.getElementById('update-idea-form').onsubmit = async (e) => {
  e.preventDefault();
  if (!selectedIdeaId) return;
  const payload = Object.fromEntries(new FormData(e.target).entries());
  delete payload.id;
  await api(`/ideas/${selectedIdeaId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await loadIdeas();
  alert('Idea updated');
};

document.getElementById('delete-idea-btn').onclick = async () => {
  if (!selectedIdeaId) return;
  if (!confirm('Delete this idea and all docs?')) return;
  await api(`/ideas/${selectedIdeaId}`, { method: 'DELETE' });
  selectedIdeaId = null;
  detailPanel.hidden = true;
  docsList.innerHTML = '';
  await loadIdeas();
};

document.getElementById('upload-form').onsubmit = async (e) => {
  e.preventDefault();
  if (!selectedIdeaId) return;
  const formData = new FormData();
  const fileInput = e.target.querySelector('input[type="file"]');
  if (!fileInput.files[0]) return;
  formData.append('uploaded_file', fileInput.files[0]);
  await api(`/ideas/${selectedIdeaId}/documents`, {
    method: 'POST',
    body: formData,
  });
  fileInput.value = '';
  await loadDocuments();
};

if (authHeader) {
  loadIdeas().catch((err) => {
    ideasList.innerHTML = `Error loading ideas: ${err.message}`;
  });
} else {
  ideasList.textContent = 'Please login first.';
}
