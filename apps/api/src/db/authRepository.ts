import type { Pool } from "pg";

export interface UserRow {
  id: string;
  email: string;
  username: string;
  steam_id: string;
  password_hash: string;
  created_at: string;
}

export interface SessionWithUserRow {
  user_id: string;
  email: string;
  username: string;
  steam_id: string;
}

export interface CreateUserInput {
  email: string;
  username: string;
  steamId: string;
  passwordHash: string;
}

export type DuplicateField = "email" | "username" | "steamId";

export class DuplicateUserError extends Error {
  readonly field: DuplicateField;

  constructor(field: DuplicateField) {
    super(`Duplicate ${field}`);
    this.field = field;
  }
}

export async function createUser(pool: Pool, input: CreateUserInput): Promise<UserRow> {
  try {
    const result = await pool.query<UserRow>(
      `
        INSERT INTO users (email, username, steam_id, password_hash)
        VALUES ($1, $2, $3, $4)
        RETURNING id, email, username, steam_id, password_hash, created_at
      `,
      [input.email, input.username, input.steamId, input.passwordHash]
    );
    const created = result.rows[0];
    if (!created) {
      throw new Error("User insert did not return a row");
    }
    return created;
  } catch (error: unknown) {
    if (isDuplicateViolation(error)) {
      const field = duplicateFieldFromConstraint(error.constraint);
      if (field) {
        throw new DuplicateUserError(field);
      }
    }
    throw error;
  }
}

export async function findUserByIdentifier(pool: Pool, identifier: string): Promise<UserRow | null> {
  const normalized = identifier.trim().toLowerCase();
  const result = await pool.query<UserRow>(
    `
      SELECT id, email, username, steam_id, password_hash, created_at
      FROM users
      WHERE LOWER(email) = $1 OR LOWER(username) = $1
      LIMIT 1
    `,
    [normalized]
  );

  return result.rows[0] ?? null;
}

export async function createSession(
  pool: Pool,
  userId: string,
  tokenHash: string,
  expiresAt: Date
): Promise<void> {
  await pool.query(
    `
      INSERT INTO auth_sessions (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
    `,
    [userId, tokenHash, expiresAt.toISOString()]
  );
}

export async function findSessionUserByTokenHash(
  pool: Pool,
  tokenHash: string
): Promise<SessionWithUserRow | null> {
  const result = await pool.query<SessionWithUserRow>(
    `
      SELECT u.id AS user_id, u.email, u.username, u.steam_id
      FROM auth_sessions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
      LIMIT 1
    `,
    [tokenHash]
  );

  return result.rows[0] ?? null;
}

export async function revokeSessionByTokenHash(pool: Pool, tokenHash: string): Promise<void> {
  await pool.query(
    `
      UPDATE auth_sessions
      SET revoked_at = NOW()
      WHERE token_hash = $1
        AND revoked_at IS NULL
    `,
    [tokenHash]
  );
}

function isDuplicateViolation(
  error: unknown
): error is { code: string; constraint?: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function duplicateFieldFromConstraint(constraint: string | undefined): DuplicateField | null {
  if (constraint === "users_email_unique_ci") {
    return "email";
  }
  if (constraint === "users_username_unique_ci") {
    return "username";
  }
  if (constraint === "users_steam_id_unique") {
    return "steamId";
  }
  return null;
}
