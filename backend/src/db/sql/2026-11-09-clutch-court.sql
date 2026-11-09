-- Clutch Court (2026-11-09). Additive and idempotent.
-- Apply to BOTH the dev DB (EuroleagueDev) and production (Supabase).
-- Mirrors backend/src/db/schema.ts (courts, horseGames, horseGamePlayers).
-- Spec: CLUTCH_COURT_SPEC.md §7

create table if not exists courts (
  id uuid primary key default gen_random_uuid(),
  code varchar(6) not null unique,
  owner_user_id uuid not null references users(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  last_active_at timestamptz
);
create index if not exists courts_owner_idx on courts (owner_user_id);

create table if not exists horse_games (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references courts(id),
  winner_user_id uuid references users(id),
  started_at timestamptz not null,
  ended_at timestamptz
);

create table if not exists horse_game_players (
  game_id uuid not null references horse_games(id),
  user_id uuid not null references users(id),
  final_letters varchar(5) not null default '',
  placement integer not null,
  primary key (game_id, user_id)
);

-- Production (Supabase) only: keep the Data API roles locked out (CLAUDE.md).
-- Harmless no-ops elsewhere are guarded by the role check.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on courts, horse_games, horse_game_players from anon, authenticated;
  end if;
end $$;
