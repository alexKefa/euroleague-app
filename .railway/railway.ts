import { defineRailway, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const euroleagueApp = service("euroleague-app", {
    replicas: { "europe-west4-drams3a": 1 },
    // Explicit Dockerfile build — Railpack's auto-detection found nothing
    // to build in this monorepo (no root package.json), and a plain shell
    // buildCommand runs with no Node preinstalled ("npm: not found").
    // The Dockerfile builds both frontend and backend and serves the
    // built Angular app from the Express backend on one origin; see
    // backend/src/index.ts and ./Dockerfile.
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    env: {
      DATABASE_URL: preserve(),
      JWT_ACCESS_SECRET: preserve(),
      JWT_REFRESH_SECRET: preserve(),
      NODE_ENV: preserve(),
    },
  });

  return project("euroleague-app", {
    resources: [euroleagueApp],
  });
});
