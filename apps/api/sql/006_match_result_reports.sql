CREATE TABLE IF NOT EXISTS event_match_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES event_matches(id) ON DELETE CASCADE,
  reporter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reporter_team_id UUID REFERENCES teams(id) ON DELETE RESTRICT,
  reported_winner_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  is_admin_override BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT event_match_reports_reporter_scope_valid CHECK (
    (is_admin_override = true AND reporter_team_id IS NULL) OR
    (is_admin_override = false AND reporter_team_id IS NOT NULL)
  ),
  CONSTRAINT event_match_reports_unique_team_report UNIQUE (match_id, reporter_team_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS event_match_reports_admin_override_unique_idx
  ON event_match_reports(match_id)
  WHERE is_admin_override = true;

CREATE INDEX IF NOT EXISTS event_match_reports_match_id_idx ON event_match_reports(match_id);
