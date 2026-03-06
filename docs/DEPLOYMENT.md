# Deployment

## Local (Docker Compose)

1. Copy environment file:

```bash
cp .env.example .env
```

2. Build and run:

```bash
docker compose up --build -d
```

3. Verify:

- Frontend: `http://localhost:8080`
- Backend: `http://localhost:8000`
- Health: `http://localhost:8000/health`

4. Stop:

```bash
docker compose down
```

## GHCR Push-Ready Config

Compose keeps image names:

- `ghcr.io/jen777/ideaflo-backend:latest`
- `ghcr.io/jen777/ideaflo-frontend:latest`

Push flow:

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u jen777 --password-stdin
docker compose build
docker compose push
```
