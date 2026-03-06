const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ideaflo';
const FILE_STORAGE_PATH = process.env.FILE_STORAGE_PATH || '/data/docs';
const PORT = process.env.PORT || 8000;

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: DATABASE_URL });

const upload = multer({ storage: multer.memoryStorage() });

async function initDb() {
  await fsp.mkdir(FILE_STORAGE_PATH, { recursive: true });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ideas (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      status VARCHAR(64) NOT NULL DEFAULT 'new',
      current_state TEXT NOT NULL DEFAULT '',
      future_steps TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
      filename VARCHAR(255) NOT NULL,
      stored_filename VARCHAR(255) NOT NULL,
      filepath VARCHAR(512) NOT NULL,
      content_type VARCHAR(255) NOT NULL DEFAULT 'application/octet-stream',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function toIdea(row) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    status: row.status,
    current_state: row.current_state,
    future_steps: row.future_steps,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toDoc(row) {
  return {
    id: row.id,
    idea_id: row.idea_id,
    filename: row.filename,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    uploaded_at: row.uploaded_at,
  };
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/ideas', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM ideas ORDER BY updated_at DESC');
    res.json(rows.map(toIdea));
  } catch (err) {
    next(err);
  }
});

app.post('/ideas', async (req, res, next) => {
  try {
    const payload = req.body || {};
    const { title, summary = '', status = 'new', current_state = '', future_steps = '' } = payload;

    if (!title || typeof title !== 'string') {
      return res.status(400).json({ detail: 'title is required' });
    }

    const { rows } = await pool.query(
      `INSERT INTO ideas (title, summary, status, current_state, future_steps)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [title, summary, status, current_state, future_steps]
    );

    res.status(201).json(toIdea(rows[0]));
  } catch (err) {
    next(err);
  }
});

app.get('/ideas/:ideaId', async (req, res, next) => {
  try {
    const ideaId = Number(req.params.ideaId);
    const { rows } = await pool.query('SELECT * FROM ideas WHERE id = $1', [ideaId]);
    if (!rows.length) {
      return res.status(404).json({ detail: 'Idea not found' });
    }
    res.json(toIdea(rows[0]));
  } catch (err) {
    next(err);
  }
});

app.put('/ideas/:ideaId', async (req, res, next) => {
  try {
    const ideaId = Number(req.params.ideaId);
    const payload = req.body || {};
    const { title, summary = '', status = 'new', current_state = '', future_steps = '' } = payload;

    const { rows } = await pool.query(
      `UPDATE ideas
       SET title = $1,
           summary = $2,
           status = $3,
           current_state = $4,
           future_steps = $5,
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [title, summary, status, current_state, future_steps, ideaId]
    );

    if (!rows.length) {
      return res.status(404).json({ detail: 'Idea not found' });
    }

    res.json(toIdea(rows[0]));
  } catch (err) {
    next(err);
  }
});

app.delete('/ideas/:ideaId', async (req, res, next) => {
  try {
    const ideaId = Number(req.params.ideaId);
    const { rowCount } = await pool.query('DELETE FROM ideas WHERE id = $1', [ideaId]);

    if (!rowCount) {
      return res.status(404).json({ detail: 'Idea not found' });
    }

    const ideaDir = path.join(FILE_STORAGE_PATH, String(ideaId));
    await fsp.rm(ideaDir, { recursive: true, force: true });

    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

app.get('/ideas/:ideaId/documents', async (req, res, next) => {
  try {
    const ideaId = Number(req.params.ideaId);
    const idea = await pool.query('SELECT id FROM ideas WHERE id = $1', [ideaId]);
    if (!idea.rows.length) {
      return res.status(404).json({ detail: 'Idea not found' });
    }

    const { rows } = await pool.query(
      'SELECT * FROM documents WHERE idea_id = $1 ORDER BY uploaded_at DESC',
      [ideaId]
    );

    res.json(rows.map(toDoc));
  } catch (err) {
    next(err);
  }
});

app.post('/ideas/:ideaId/documents', upload.single('uploaded_file'), async (req, res, next) => {
  try {
    const ideaId = Number(req.params.ideaId);
    const idea = await pool.query('SELECT id FROM ideas WHERE id = $1', [ideaId]);
    if (!idea.rows.length) {
      return res.status(404).json({ detail: 'Idea not found' });
    }

    if (!req.file) {
      return res.status(400).json({ detail: 'uploaded_file is required' });
    }

    const ideaDir = path.join(FILE_STORAGE_PATH, String(ideaId));
    await fsp.mkdir(ideaDir, { recursive: true });

    const originalName = req.file.originalname || 'unnamed';
    const ext = path.extname(originalName);
    const storedFilename = `${crypto.randomUUID().replace(/-/g, '')}${ext}`;
    const filePath = path.join(ideaDir, storedFilename);

    await fsp.writeFile(filePath, req.file.buffer);

    const { rows } = await pool.query(
      `INSERT INTO documents (idea_id, filename, stored_filename, filepath, content_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        ideaId,
        originalName,
        storedFilename,
        filePath,
        req.file.mimetype || 'application/octet-stream',
        req.file.size || 0,
      ]
    );

    res.status(201).json(toDoc(rows[0]));
  } catch (err) {
    next(err);
  }
});

app.get('/ideas/:ideaId/documents/:docId/download', async (req, res, next) => {
  try {
    const ideaId = Number(req.params.ideaId);
    const docId = Number(req.params.docId);

    const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1 AND idea_id = $2', [docId, ideaId]);
    if (!rows.length) {
      return res.status(404).json({ detail: 'Document not found' });
    }

    const doc = rows[0];
    if (!fs.existsSync(doc.filepath)) {
      return res.status(404).json({ detail: 'File missing on disk' });
    }

    res.download(doc.filepath, doc.filename);
  } catch (err) {
    next(err);
  }
});

app.delete('/ideas/:ideaId/documents/:docId', async (req, res, next) => {
  try {
    const ideaId = Number(req.params.ideaId);
    const docId = Number(req.params.docId);

    const { rows } = await pool.query('DELETE FROM documents WHERE id = $1 AND idea_id = $2 RETURNING *', [docId, ideaId]);
    if (!rows.length) {
      return res.status(404).json({ detail: 'Document not found' });
    }

    await fsp.rm(rows[0].filepath, { force: true });

    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ detail: 'Internal server error' });
});

async function start() {
  await initDb();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`IdeaFlo backend listening on ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
