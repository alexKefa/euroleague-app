-- Daily Question (docs/superpowers/specs/2026-10-13-daily-question-design.md).
-- Hand-applied to both production and the dev Neon project (no migrations).
CREATE TABLE IF NOT EXISTS daily_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  day date NOT NULL,
  template varchar(16) NOT NULL,
  stat varchar(16) NOT NULL,
  player_a_id uuid NOT NULL REFERENCES players(id),
  player_b_id uuid NOT NULL REFERENCES players(id),
  value_a integer NOT NULL,
  value_b integer NOT NULL,
  served_at timestamptz NOT NULL,
  answered_at timestamptz,
  choice varchar(1),
  correct boolean,
  response_ms integer,
  streak integer NOT NULL,
  points_awarded integer,
  resolved_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS daily_questions_user_day_unique ON daily_questions (user_id, day);
