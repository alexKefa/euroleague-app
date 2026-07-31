# euroleague-app backend

Express + TypeScript + Drizzle ORM, deployed to Railway, backed by Neon Postgres.

## Setup

```bash
npm install
cp .env.example .env   # then fill in DATABASE_URL, JWT secrets, etc.
npm run dev
```

Health check: `GET http://localhost:4000/api/health`

## Structure

```
src/
  db/
    client.ts     Drizzle client (Neon connection)
    schema.ts     Drizzle schema — added in step 2
  index.ts         Express app entry point
drizzle.config.ts  drizzle-kit config for migrations
```

## Next steps

1. Define the schema in `src/db/schema.ts` (users, teams, games, stats, favorites, device_tokens)
2. Run `npm run db:generate` then `npm run db:push` to apply it to Neon
3. Build the EuroLeague sync module against `EUROLEAGUE_API_BASE_URL`
