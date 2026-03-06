# Testing

## Quick smoke test (API)

```bash
curl -s http://localhost:8000/health

curl -s -X POST http://localhost:8000/ideas \
  -H 'Content-Type: application/json' \
  -d '{"title":"Test Idea","summary":"MVP test","status":"new","current_state":"draft","future_steps":"validate"}'

curl -s http://localhost:8000/ideas
```

## Document smoke test

```bash
IDEA_ID=$(curl -s -X POST http://localhost:8000/ideas \
  -H 'Content-Type: application/json' \
  -d '{"title":"Docs Test"}' | jq -r .id)

echo "hello" > /tmp/ideaflo-smoke.txt

curl -s -X POST "http://localhost:8000/ideas/${IDEA_ID}/documents" \
  -F uploaded_file=@/tmp/ideaflo-smoke.txt

curl -s "http://localhost:8000/ideas/${IDEA_ID}/documents"
```

## UI smoke test

1. Open frontend at `http://localhost:8080`
2. Create an idea
3. Edit/save idea
4. Upload file
5. Download file
6. Delete file
7. Delete idea
