CREATE TABLE IF NOT EXISTS event_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  slot_number INTEGER NOT NULL,
  team_a_id UUID REFERENCES teams(id) ON DELETE RESTRICT,
  team_b_id UUID REFERENCES teams(id) ON DELETE RESTRICT,
  winner_team_id UUID REFERENCES teams(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT event_matches_round_number_valid CHECK (round_number >= 1),
  CONSTRAINT event_matches_slot_number_valid CHECK (slot_number >= 1),
  CONSTRAINT event_matches_status_valid CHECK (
    status IN ('pending', 'scheduling', 'scheduled', 'in_progress', 'result_pending', 'completed', 'disputed')
  ),
  CONSTRAINT event_matches_single_winner_present CHECK (
    winner_team_id IS NULL OR winner_team_id = team_a_id OR winner_team_id = team_b_id
  ),
  CONSTRAINT event_matches_distinct_teams CHECK (
    team_a_id IS NULL OR team_b_id IS NULL OR team_a_id <> team_b_id
  ),
  CONSTRAINT event_matches_event_round_slot_unique UNIQUE (event_id, round_number, slot_number)
);

CREATE INDEX IF NOT EXISTS event_matches_event_id_idx ON event_matches(event_id);
CREATE INDEX IF NOT EXISTS event_matches_status_idx ON event_matches(status);

CREATE OR REPLACE FUNCTION prevent_roster_changes_for_active_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_team_id UUID;
  has_locked_registration BOOLEAN;
BEGIN
  target_team_id := COALESCE(NEW.team_id, OLD.team_id);

  IF target_team_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM event_registrations er
    INNER JOIN events e ON e.id = er.event_id
    WHERE er.team_id = target_team_id
      AND e.status IN ('registration_closed', 'in_progress')
  )
  INTO has_locked_registration;

  IF has_locked_registration THEN
    RAISE EXCEPTION 'Team roster is locked while the current event is active'
      USING ERRCODE = '23514';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS team_members_roster_lock_trigger ON team_members;

CREATE TRIGGER team_members_roster_lock_trigger
BEFORE INSERT OR UPDATE OR DELETE ON team_members
FOR EACH ROW
EXECUTE FUNCTION prevent_roster_changes_for_active_event();
