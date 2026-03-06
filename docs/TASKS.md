# Task Checklist (Node.js + Express Rewrite)

## Core Rewrite

- [x] Replace FastAPI backend with Node.js + Express backend
- [x] Keep Idea CRUD scope and fields (`title`, `summary`, `status`, `current_state`, `future_steps`, timestamps)
- [x] Keep document upload/list/download/delete per idea
- [x] Keep files on filesystem volume
- [x] Keep document metadata in PostgreSQL

## Frontend + API Wiring

- [x] Keep static frontend UI and wire to backend API contract
- [x] Ensure upload field name matches backend (`uploaded_file`)

## Containers + Deployment

- [x] Keep local deployment via Docker Compose
- [x] Ensure compose works with backend + frontend + postgres
- [x] Keep GHCR image names and push-ready compose config

## Docs

- [x] `docs/README.md`
- [x] `docs/TASKS.md`
- [x] `docs/ARCHITECTURE.md`
- [x] `docs/API.md`
- [x] `docs/DEPLOYMENT.md`
- [x] `docs/TESTING.md`

## Process Tracking

- [x] Track rewrite in GitHub issue(s)
- [x] Commit changes to `main`
- [x] Push to GitHub
- [x] Update/close issue(s)
