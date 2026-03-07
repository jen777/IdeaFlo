const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8000;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://ideaflo:ideaflo@postgres:5432/ideaflo';
const FILE_STORAGE_PATH = process.env.FILE_STORAGE_PATH || '/app/data';
const AUTH_USERNAME = process.env.AUTH_USERNAME || 'admin';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'admin123';

fs.mkdirSync(FILE_STORAGE_PATH, { recursive: true });
const pool = new Pool({ connectionString: DATABASE_URL });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, FILE_STORAGE_PATH),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
});
const upload = multer({ storage });

function parseBasicAuth(header = '') {
  if (!header.startsWith('Basic ')) return null;
  const b64 = header.slice(6);
  try {
    const raw = Buffer.from(b64, 'base64').toString('utf8');
    const idx = raw.indexOf(':');
    if (idx === -1) return null;
    return { username: raw.slice(0, idx), password: raw.slice(idx + 1) };
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  if (req.path === '/health' || req.path === '/auth/login') return next();
  const parsed = parseBasicAuth(req.headers.authorization || '');
  if (!parsed || parsed.username !== AUTH_USERNAME || parsed.password !== AUTH_PASSWORD) {
    res.setHeader('WWW-Authenticate', 'Basic realm="IdeaFlo"');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.use(authMiddleware);

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ideas (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT DEFAULT '',
      status TEXT DEFAULT 'new',
      current_state TEXT DEFAULT '',
      future_steps TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT DEFAULT 'application/octet-stream',
      size_bytes BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === AUTH_USERNAME && password === AUTH_PASSWORD) {
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Invalid credentials' });
});

app.get('/ideas', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM ideas ORDER BY updated_at DESC');
  res.json(rows);
});

app.post('/ideas', async (req, res) => {
  const { title, summary = '', status = 'new', current_state = '', future_steps = '' } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });
  const { rows } = await pool.query(
    `INSERT INTO ideas (title, summary, status, current_state, future_steps)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [title.trim(), summary, status, current_state, future_steps]
  );
  res.status(201).json(rows[0]);
});

app.get('/ideas/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM ideas WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

app.put('/ideas/:id', async (req, res) => {
  const { title, summary = '', status = 'new', current_state = '', future_steps = '' } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });
  const { rows } = await pool.query(
    `UPDATE ideas SET title=$1, summary=$2, status=$3, current_state=$4, future_steps=$5, updated_at=NOW()
     WHERE id=$6 RETURNING *`,
    [title.trim(), summary, status, current_state, future_steps, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

app.delete('/ideas/:id', async (req, res) => {
  const docs = await pool.query('SELECT storage_path FROM documents WHERE idea_id=$1', [req.params.id]);
  docs.rows.forEach(r => { try { fs.unlinkSync(r.storage_path); } catch {} });
  const { rowCount } = await pool.query('DELETE FROM ideas WHERE id=$1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'not found' });
  res.status(204).send();
});

app.get('/ideas/:id/documents', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM documents WHERE idea_id=$1 ORDER BY created_at DESC', [req.params.id]);
  res.json(rows);
});

app.post('/ideas/:id/documents', upload.single('uploaded_file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'uploaded_file is required' });
  const idea = await pool.query('SELECT id FROM ideas WHERE id=$1', [req.params.id]);
  if (!idea.rows.length) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(404).json({ error: 'idea not found' });
  }
  const { rows } = await pool.query(
    `INSERT INTO documents (idea_id, filename, storage_path, mime_type, size_bytes)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.params.id, req.file.originalname, req.file.path, req.file.mimetype || 'application/octet-stream', req.file.size]
  );
  res.status(201).json(rows[0]);
});

app.get('/ideas/:ideaId/documents/:docId/download', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM documents WHERE id=$1 AND idea_id=$2', [req.params.docId, req.params.ideaId]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  const doc = rows[0];
  if (!fs.existsSync(doc.storage_path)) return res.status(404).json({ error: 'file missing' });
  res.download(doc.storage_path, doc.filename);
});

app.delete('/ideas/:ideaId/documents/:docId', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM documents WHERE id=$1 AND idea_id=$2', [req.params.docId, req.params.ideaId]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  const doc = rows[0];
  try { fs.unlinkSync(doc.storage_path); } catch {}
  await pool.query('DELETE FROM documents WHERE id=$1', [req.params.docId]);
  res.status(204).send();
});

(async () => {
  await initDb();
  app.listen(PORT, () => console.log(`IdeaFlo backend listening on ${PORT}`));
})();
