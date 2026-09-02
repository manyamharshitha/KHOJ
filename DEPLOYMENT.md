# Khoj Frontend - Backend Integration Guide

## Vercel Deployment Fix

The build error was because Vercel couldn't find `package.json` at the root. The `vercel.json` file at the project root now tells Vercel to:
1. Build from the `frontend/` folder
2. Use the `frontend/dist` folder as output
3. Recognize it as a Vite project

## Environment Variables for Vercel

Add these environment variables in your Vercel project settings:

```
VITE_API_BASE_URL=https://your-backend-url.com
VITE_FIREBASE_API_KEY=your-firebase-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
```

## Local Development

For local development, create a `.env.local` file in the `frontend/` folder:

```
VITE_API_BASE_URL=http://localhost:8080
VITE_FIREBASE_API_KEY=your-key
VITE_FIREBASE_AUTH_DOMAIN=your-domain
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
```

Then run: `npm run dev`

## Connecting Frontend to Backend API

To use the backend API in your React components:

```javascript
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
