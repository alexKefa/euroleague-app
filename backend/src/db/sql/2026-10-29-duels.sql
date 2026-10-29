-- Four Quarters duels (2026-10-29). Additive and idempotent.
-- Apply to BOTH the dev DB (EuroleagueDev) and production (Supabase).
-- Mirrors backend/src/db/schema.ts (duels, duelMoves, duelRatings).
-- Spec: docs/superpowers/specs/2026-10-29-four-quarters-duels-design.md

create table if not exists duels (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references leagues(id),
  challenger_user_id uuid not null references users(id),
  opponent_user_id uuid references users(id),
  status varchar(20) not null default 'open',
  finish_reason varchar(20),
  categories jsonb,
  challenger_lineup jsonb not null,
  opponent_lineup jsonb,
  quarter smallint not null default 0,
  quarter_deadline timestamptz,
  challenger_score real not null default 0,
  opponent_score real not null default 0,
  challenger_miss_streak smallint not null default 0,
  opponent_miss_streak smallint not null default 0,
  winner_user_id uuid references users(id),
  challenger_rating_delta integer,
  opponent_rating_delta integer,
  prize_paid boolean not null default false,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz not null
);
create index if not exists duels_challenger_status_idx on duels (challenger_user_id, status);
create index if not exists duels_opponent_status_idx on duels (opponent_user_id, status);
create index if not exists duels_status_deadline_idx on duels (status, quarter_deadline);
create index if not exists duels_status_expires_idx on duels (status, expires_at);

create table if not exists duel_moves (
  duel_id uuid not null references duels(id),
  quarter smallint not null,
  user_id uuid not null references users(id),
  slot smallint not null,
  score real not null,
  auto boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists duel_moves_quarter_user_unique on duel_moves (duel_id, quarter, user_id);
create unique index if not exists duel_moves_slot_user_unique on duel_moves (duel_id, user_id, slot);

create table if not exists duel_ratings (
  user_id uuid not null references users(id),
  season varchar(7) not null,
  rating integer not null,
  games integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  primary key (user_id, season)
);
create index if not exists duel_ratings_season_rating_idx on duel_ratings (season, rating desc);

-- supabase only: revoke all on duels, duel_moves, duel_ratings from anon, authenticated;
