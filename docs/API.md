# API Reference

Base URL: `http://localhost:8000`

## Health

- `GET /health`
- Response: `{ "status": "ok" }`

## Ideas

### List ideas
- `GET /ideas`

### Create idea
- `POST /ideas`
- JSON body:

```json
{
  "title": "Idea title",
  "summary": "Summary",
  "status": "new",
  "current_state": "Draft",
  "future_steps": "Validate with users"
}
```

### Get idea
- `GET /ideas/{ideaId}`

### Update idea
- `PUT /ideas/{ideaId}`
- JSON body same as create

### Delete idea
- `DELETE /ideas/{ideaId}`
- Also removes idea documents from disk

## Documents

### List documents for idea
- `GET /ideas/{ideaId}/documents`

### Upload document
- `POST /ideas/{ideaId}/documents`
- Multipart form field name: `uploaded_file`

### Download document
- `GET /ideas/{ideaId}/documents/{docId}/download`

### Delete document
- `DELETE /ideas/{ideaId}/documents/{docId}`
