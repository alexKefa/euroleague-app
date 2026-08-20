// Relative, not absolute — the dev server's proxy.conf.json forwards /api
// to the Express backend, so the browser only ever talks to one origin.
// That's what makes the ngrok tunnel (and the eventual Railway deploy)
// work without touching CORS or the refresh cookie's SameSite setting.
export const API_BASE_URL = "/api";
