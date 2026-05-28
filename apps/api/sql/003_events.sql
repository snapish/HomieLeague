CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  game TEXT NOT NULL,
  timezone TEXT NOT NULL,
  registration_opens_at TIMESTAMPTZ NOT NULL,
  registration_closes_at TIMESTAMPTZ NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_title_length CHECK (char_length(btrim(title)) BETWEEN 3 AND 80),
  CONSTRAINT events_game_length CHECK (char_length(btrim(game)) BETWEEN 2 AND 40),
  CONSTRAINT events_timezone_length CHECK (char_length(btrim(timezone)) BETWEEN 3 AND 64),
  CONSTRAINT events_status_valid CHECK (status IN ('draft', 'registration_open', 'registration_closed', 'in_progress', 'completed')),
  CONSTRAINT events_time_order_valid CHECK (registration_opens_at < registration_closes_at AND registration_closes_at < starts_at)
);

CREATE INDEX IF NOT EXISTS events_status_idx ON events(status);
CREATE INDEX IF NOT EXISTS events_starts_at_idx ON events(starts_at);

CREATE TABLE IF NOT EXISTS event_registrations (
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  registered_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT event_registrations_pk PRIMARY KEY (event_id, team_id)
);

CREATE INDEX IF NOT EXISTS event_registrations_event_id_idx ON event_registrations(event_id);
CREATE INDEX IF NOT EXISTS event_registrations_team_id_idx ON event_registrations(team_id);
