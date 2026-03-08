const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8000;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://ideaflo:ideaflo@postgres:5432/ideaflo';
const FILE_STORAGE_PATH = process.env.FILE_STORAGE_PATH || '/app/data';
const ADMIN_USERNAME = process.env.AUTH_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.AUTH_PASSWORD || 'admin123';
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 72);

fs.mkdirSync(FILE_STORAGE_PATH, { recursive: true });
const pool = new Pool({ connectionString: DATABASE_URL });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, FILE_STORAGE_PATH),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
});
const upload = multer({ storage });

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function newApiToken() {
  return `ifl_${crypto.randomBytes(32).toString('hex')}`;
}

function parseBearer(header = '') {
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

function parseApiToken(req) {
  const fromHeader = req.headers['x-api-token'];
  if (fromHeader) return String(fromHeader);
  const auth = req.headers.authorization || '';
  if (auth.startsWith('ApiToken ')) return auth.slice('ApiToken '.length).trim();
  return null;
}

function isWriteMethod(method) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

function normalizeScope(input) {
  const v = String(input || '').toLowerCase().trim();
  if (v === 'read' || v === 'write') return v;
  return 'write';
}

async function authMiddleware(req, res, next) {
  if (req.path === '/health' || req.path === '/auth/login') return next();

  const bearer = parseBearer(req.headers.authorization || '');
  if (bearer) {
    const { rows } = await pool.query(
      `SELECT s.id, s.user_id, s.expires_at, u.username
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = $1`,
      [bearer]
    );
    if (rows.length) {
      const s = rows[0];
      if (new Date(s.expires_at) >= new Date()) {
        req.authUser = { id: s.user_id, username: s.username, token: bearer, authType: 'session' };
        return next();
      }
      await pool.query('DELETE FROM sessions WHERE id=$1', [s.id]);
    }
  }

  const rawApiToken = parseApiToken(req);
  if (rawApiToken) {
    const tokenHash = sha256(rawApiToken);
    const { rows } = await pool.query(
      `SELECT t.id, t.user_id, t.name, t.scope, t.expires_at, t.revoked_at, u.username
       FROM api_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1`,
      [tokenHash]
    );

    if (rows.length) {
      const t = rows[0];
      if (t.revoked_at) return res.status(401).json({ error: 'Token revoked' });
      if (t.expires_at && new Date(t.expires_at) < new Date()) return res.status(401).json({ error: 'Token expired' });
      if (normalizeScope(t.scope) === 'read' && isWriteMethod(req.method)) {
        return res.status(403).json({ error: 'Token scope does not allow write operations' });
      }
      await pool.query('UPDATE api_tokens SET last_used_at=NOW() WHERE id=$1', [t.id]);
      req.authUser = {
        id: t.user_id,
        username: t.username,
        authType: 'api_token',
        tokenName: t.name,
        tokenScope: normalizeScope(t.scope),
      };
      return next();
    }
  }

  return res.status(401).json({ error: 'Unauthorized' });
}

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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      token_prefix TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      scope TEXT NOT NULL DEFAULT 'write',
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );
  `);

  // Migration safety for older tables
  await pool.query(`ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'write'`);
  await pool.query(`ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`);

  const admin = await pool.query('SELECT id FROM users WHERE username=$1', [ADMIN_USERNAME]);
  if (!admin.rows.length) {
    await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [
      ADMIN_USERNAME,
      hashPassword(ADMIN_PASSWORD),
    ]);
    console.log(`Bootstrapped admin user: ${ADMIN_USERNAME}`);
  }
}

app.use(authMiddleware);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username/password required' });
  const { rows } = await pool.query('SELECT id, username, password_hash FROM users WHERE username=$1', [username]);
  if (!rows.length || !verifyPassword(password, rows[0].password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  await pool.query('INSERT INTO sessions (user_id, token, expires_at) VALUES ($1,$2,$3)', [rows[0].id, token, expiresAt]);
  res.json({ token, user: { id: rows[0].id, username: rows[0].username }, expires_at: expiresAt.toISOString() });
});

app.post('/auth/logout', async (req, res) => {
  if (req.authUser.authType === 'session') {
    await pool.query('DELETE FROM sessions WHERE token=$1', [req.authUser.token]);
  }
  res.status(204).send();
});

app.get('/auth/me', async (req, res) => {
  res.json({ user: req.authUser });
});

// User management
app.get('/users', async (_req, res) => {
  const { rows } = await pool.query('SELECT id, username, created_at FROM users ORDER BY username');
  res.json(rows);
});

app.post('/users', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username/password required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id, username, created_at',
      [username.trim(), hashPassword(password)]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (String(e.message).toLowerCase().includes('unique')) return res.status(409).json({ error: 'username exists' });
    throw e;
  }
});

app.delete('/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.authUser.id) return res.status(400).json({ error: 'Cannot delete current user' });
  const { rowCount } = await pool.query('DELETE FROM users WHERE id=$1', [id]);
  if (!rowCount) return res.status(404).json({ error: 'not found' });
  await pool.query('DELETE FROM sessions WHERE user_id=$1', [id]);
  await pool.query('DELETE FROM api_tokens WHERE user_id=$1', [id]);
  res.status(204).send();
});

// API token management (per-user)
app.get('/api-tokens', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, token_prefix, scope, expires_at, created_at, last_used_at, revoked_at
     FROM api_tokens WHERE user_id=$1 ORDER BY created_at DESC`,
    [req.authUser.id]
  );
  res.json(rows);
});

app.post('/api-tokens', async (req, res) => {
  const { name, scope, expires_at } = req.body || {};
  const cleanName = (name || '').trim();
  const cleanScope = normalizeScope(scope);
  if (!cleanName) return res.status(400).json({ error: 'name is required' });

  let expiresAt = null;
  if (expires_at) {
    const d = new Date(expires_at);
    if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'invalid expires_at' });
    expiresAt = d;
  }

  const plainToken = newApiToken();
  const prefix = plainToken.slice(0, 12);
  const tokenHash = sha256(plainToken);

  const { rows } = await pool.query(
    `INSERT INTO api_tokens (user_id, name, token_prefix, token_hash, scope, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, name, token_prefix, scope, expires_at, created_at`,
    [req.authUser.id, cleanName, prefix, tokenHash, cleanScope, expiresAt]
  );

  // Show plain token only once on creation
  res.status(201).json({ ...rows[0], token: plainToken });
});

app.delete('/api-tokens/:id', async (req, res) => {
  const { rowCount } = await pool.query(
    'UPDATE api_tokens SET revoked_at=NOW() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL',
    [req.params.id, req.authUser.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'not found' });
  res.status(204).send();
});

// Ideas
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

// Documents
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
