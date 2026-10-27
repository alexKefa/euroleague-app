-- Album Series 2 "Moments" (2026-10-27). Additive and idempotent.
-- Apply to BOTH the dev DB (EuroleagueDev) and production (EuroleagueProd).
-- Mirrors backend/src/db/schema.ts (collectibles.series, collectibleMoments, momentBonuses).

alter table collectibles add column if not exists series smallint not null default 1;

create table if not exists collectible_moments (
  collectible_id uuid primary key references collectibles(id),
  player_id uuid not null references players(id),
  game_id uuid not null references games(id),
  season varchar(9) not null,
  round integer not null,
  role varchar(10) not null,
  points integer,
  pir integer,
  rebounds integer,
  assists integer,
  minutes real
);
create unique index if not exists collectible_moments_round_player_unique
  on collectible_moments (season, round, player_id);

create table if not exists moment_bonuses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  collectible_id uuid not null references collectibles(id),
  reason varchar(20) not null,
  granted_at timestamptz not null default now(),
  seen_at timestamptz
);
create unique index if not exists moment_bonuses_user_collectible_unique
  on moment_bonuses (user_id, collectible_id);
