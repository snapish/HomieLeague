CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT teams_name_length CHECK (char_length(btrim(name)) BETWEEN 3 AND 40),
  CONSTRAINT teams_invite_code_format CHECK (invite_code ~ '^[A-Z0-9]{8}$'),
  CONSTRAINT teams_invite_code_unique UNIQUE (invite_code)
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT team_members_pk PRIMARY KEY (team_id, user_id),
  CONSTRAINT team_members_role_valid CHECK (role IN ('admin', 'member')),
  CONSTRAINT team_members_user_single_team_unique UNIQUE (user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS teams_name_unique_ci ON teams (LOWER(name));

CREATE UNIQUE INDEX IF NOT EXISTS team_members_single_admin_per_team_idx
  ON team_members(team_id)
  WHERE role = 'admin';

CREATE INDEX IF NOT EXISTS team_members_team_id_idx ON team_members(team_id);

CREATE OR REPLACE FUNCTION enforce_team_member_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  member_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO member_count
  FROM team_members
  WHERE team_id = NEW.team_id;

  IF member_count >= 5 THEN
    RAISE EXCEPTION 'Team already has maximum members'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS team_members_member_limit_trigger ON team_members;

CREATE TRIGGER team_members_member_limit_trigger
BEFORE INSERT ON team_members
FOR EACH ROW
EXECUTE FUNCTION enforce_team_member_limit();
