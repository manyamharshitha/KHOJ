
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

export async function createRun(listingData) {
  const response = await fetch(`${API_BASE}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(listingData),
  });
  return response.json();
}

export async function getRun(runId) {
  const response = await fetch(`${API_BASE}/api/runs/${runId}`);
  return response.json();
}
```

## Available Backend Endpoints

- `GET /api/health` - Server status
- `GET /api/auth/config` - Auth config
- `POST /api/runs` - Create call run
- `GET /api/runs/:id` - Get run details
- `POST /api/listings/parse` - Parse listings
- `POST /api/sources/fetch` - Fetch sources

See `backend/postman/khoj.postman_collection.json` for full API documentation.
