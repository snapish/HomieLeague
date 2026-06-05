ALTER TABLE event_matches
ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS event_match_schedule_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES event_matches(id) ON DELETE CASCADE,
  proposed_by_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  proposed_start_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  responded_by_team_id UUID REFERENCES teams(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  CONSTRAINT event_match_schedule_proposals_status_valid CHECK (status IN ('pending', 'accepted', 'rejected')),
  CONSTRAINT event_match_schedule_proposals_response_valid CHECK (
    (status = 'pending' AND responded_by_team_id IS NULL AND responded_at IS NULL)
    OR (status IN ('accepted', 'rejected') AND responded_by_team_id IS NOT NULL AND responded_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS event_match_schedule_proposals_match_id_idx
  ON event_match_schedule_proposals(match_id);

CREATE INDEX IF NOT EXISTS event_match_schedule_proposals_pending_idx
  ON event_match_schedule_proposals(match_id, created_at DESC)
  WHERE status = 'pending';
