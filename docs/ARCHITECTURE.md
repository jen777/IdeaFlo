# Architecture

## Components

1. **Frontend (Nginx static app)**
   - Serves `index.html`, `app.js`, `styles.css`
   - Calls backend REST API over HTTP

2. **Backend (Node.js + Express)**
   - REST API for ideas and documents
   - Uses `pg` connection pool to PostgreSQL
   - Uses `multer` for multipart upload handling
   - Stores uploaded files on mounted filesystem volume

3. **PostgreSQL**
   - Stores idea records and document metadata
   - Enforces relation: `documents.idea_id -> ideas.id` with `ON DELETE CASCADE`

## Data Model

### ideas
- `id` (PK)
- `title`
- `summary`
- `status`
- `current_state`
- `future_steps`
- `created_at`
- `updated_at`

### documents
- `id` (PK)
- `idea_id` (FK -> ideas.id)
- `filename`
- `stored_filename`
- `filepath`
- `content_type`
- `size_bytes`
- `uploaded_at`

## Request Flow Example (Document Upload)

1. Frontend sends `POST /ideas/:ideaId/documents` with multipart field `uploaded_file`
2. Backend validates idea existence
3. Backend writes file to `FILE_STORAGE_PATH/<ideaId>/<generated-name>`
4. Backend inserts metadata row into `documents`
5. Backend returns document metadata JSON
