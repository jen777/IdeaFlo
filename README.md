# IdeaFlo MVP

IdeaFlo is a small MVP to manage ideas and attached documents/reports.

## Features

- Idea CRUD (title, summary, status, current_state, future_steps, timestamps)
- Document upload/list/download/delete per idea
- Documents stored on filesystem volume
- Document metadata stored in PostgreSQL
- Local deployment with Docker Compose

## Stack

- **Backend:** Node.js + Express + pg + multer
- **Frontend:** Static HTML/JS app served by Nginx
- **Infra:** Docker Compose + PostgreSQL

## Repo + Tracking

- GitHub repo: https://github.com/jen777/IdeaFlo
- Node.js rewrite tracking issue: https://github.com/jen777/IdeaFlo/issues/5

## Documentation

- [docs/README.md](./docs/README.md)
- [docs/TASKS.md](./docs/TASKS.md)
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [docs/API.md](./docs/API.md)
- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)
- [docs/TESTING.md](./docs/TESTING.md)

## Quick Start

1. Copy env file:

```bash
cp .env.example .env
```

2. Start services:

```bash
docker compose up --build -d
```

3. Open app:

- Frontend: http://localhost:8080
- Backend API: http://localhost:8000
- Health: http://localhost:8000/health

## Smoke Test

### UI smoke test

1. In UI, create an idea.
2. Open the idea and edit fields, save.
3. Upload a file under Documents.
4. Download uploaded file.
5. Delete document.
6. Delete idea.

### API smoke test

```bash
curl -s http://localhost:8000/health
curl -s -X POST http://localhost:8000/ideas \
  -H 'Content-Type: application/json' \
  -d '{"title":"Test Idea","summary":"MVP test","status":"new","current_state":"draft","future_steps":"validate"}'
curl -s http://localhost:8000/ideas
```

## Build + Push to GHCR

Authenticate Docker to GHCR:

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u jen777 --password-stdin
```

Build and push:

```bash
docker compose build
docker compose push
```

Published image names:

- `ghcr.io/jen777/ideaflo-backend:latest`
- `ghcr.io/jen777/ideaflo-frontend:latest`

## Deployment Verification (2026-03-06)

Verified on VM with Docker Compose:

- `docker compose push` completed successfully for backend/frontend GHCR images.
- `docker compose ps` shows all services healthy/up:
  - backend on `:8000`
  - frontend on `:8080`
  - postgres healthy

Example status observed:

```text
ideaflo-backend-1   Up  (0.0.0.0:8000->8000)
ideaflo-frontend-1  Up  (0.0.0.0:8080->80)
ideaflo-postgres-1  Up (healthy)
```
