CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  username TEXT NOT NULL,
  steam_id TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_steam_id_unique UNIQUE (steam_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_ci ON users (LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_ci ON users (LOWER(username));

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT auth_sessions_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions(expires_at);
