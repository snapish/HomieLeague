import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export type TeamMemberRole = "admin" | "member";

export interface TeamMemberRow {
  user_id: string;
  username: string;
  steam_id: string;
  role: TeamMemberRole;
  joined_at: string;
}

export interface TeamSummary {
  id: string;
  name: string;
  invite_code: string;
  member_count: number;
  your_role: TeamMemberRole;
  members: TeamMemberRow[];
}

interface UserTeamRow {
  id: string;
  name: string;
  invite_code: string;
  your_role: TeamMemberRole;
}

export class AlreadyOnTeamError extends Error {}
export class TeamNameInUseError extends Error {}
export class TeamNotFoundError extends Error {}
export class TeamFullError extends Error {}
export class AdminTransferRequiredError extends Error {}
export class NotOnTeamError extends Error {}
export class TeamAdminRequiredError extends Error {}
export class TeamMemberNotFoundError extends Error {}
export class CannotRemoveTeamAdminError extends Error {}

export async function getTeamSummaryForUser(pool: Pool, userId: string): Promise<TeamSummary | null> {
  const client = await pool.connect();
  try {
    return await getTeamSummaryForUserWithClient(client, userId);
  } finally {
    client.release();
  }
}

export async function createTeamForUser(pool: Pool, userId: string, teamName: string): Promise<TeamSummary> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await assertUserHasNoTeam(client, userId);

    let createdTeamId: string | null = null;
    for (let attempt = 0; attempt < 5 && !createdTeamId; attempt += 1) {
      const inviteCode = generateInviteCode();
      try {
        const result = await client.query<{ id: string }>(
          `
            INSERT INTO teams (name, invite_code, created_by)
            VALUES ($1, $2, $3)
            RETURNING id
          `,
          [teamName, inviteCode, userId]
        );

        createdTeamId = result.rows[0]?.id ?? null;
      } catch (error: unknown) {
        if (isDuplicateViolation(error) && error.constraint === "teams_invite_code_unique") {
          continue;
        }

        if (isDuplicateViolation(error) && error.constraint === "teams_name_unique_ci") {
          throw new TeamNameInUseError("Team name is already in use");
        }

        throw error;
      }
    }

    if (!createdTeamId) {
      throw new Error("Unable to generate unique invite code");
    }

    await client.query(
      `
        INSERT INTO team_members (team_id, user_id, role)
        VALUES ($1, $2, 'admin')
      `,
      [createdTeamId, userId]
    );

    const summary = await getTeamSummaryForUserWithClient(client, userId);
    if (!summary) {
      throw new Error("Team summary missing after create");
    }

    await client.query("COMMIT");
    return summary;
  } catch (error: unknown) {
    await client.query("ROLLBACK");

    if (error instanceof AlreadyOnTeamError || error instanceof TeamNameInUseError) {
      throw error;
    }

    if (isDuplicateViolation(error) && error.constraint === "team_members_user_single_team_unique") {
      throw new AlreadyOnTeamError("User already belongs to a team");
    }

    throw error;
  } finally {
    client.release();
  }
}

export async function joinTeamByInviteCode(
  pool: Pool,
  userId: string,
  inviteCode: string
): Promise<TeamSummary> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await assertUserHasNoTeam(client, userId);

    const normalizedInviteCode = inviteCode.trim().toUpperCase();
    const teamResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM teams
        WHERE invite_code = $1
        LIMIT 1
      `,
      [normalizedInviteCode]
    );

    const targetTeam = teamResult.rows[0];
    if (!targetTeam) {
      throw new TeamNotFoundError("Team not found for invite code");
    }

    try {
      await client.query(
        `
          INSERT INTO team_members (team_id, user_id, role)
          VALUES ($1, $2, 'member')
        `,
        [targetTeam.id, userId]
      );
    } catch (error: unknown) {
      if (isCheckViolation(error)) {
        throw new TeamFullError("Team has reached the member limit");
      }
      if (isDuplicateViolation(error) && error.constraint === "team_members_user_single_team_unique") {
        throw new AlreadyOnTeamError("User already belongs to a team");
      }
      throw error;
    }

    const summary = await getTeamSummaryForUserWithClient(client, userId);
    if (!summary) {
      throw new Error("Team summary missing after join");
    }

    await client.query("COMMIT");
    return summary;
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    if (
      error instanceof TeamNotFoundError ||
      error instanceof TeamFullError ||
      error instanceof AlreadyOnTeamError
    ) {
      throw error;
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function leaveCurrentTeam(pool: Pool, userId: string): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const membershipResult = await client.query<{ team_id: string; role: TeamMemberRole }>(
      `
        SELECT team_id, role
        FROM team_members
        WHERE user_id = $1
        LIMIT 1
      `,
      [userId]
    );

    const membership = membershipResult.rows[0];
    if (!membership) {
      throw new NotOnTeamError("User is not on a team");
    }

    const countResult = await client.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM team_members
        WHERE team_id = $1
      `,
      [membership.team_id]
    );

    const currentCount = Number(countResult.rows[0]?.count ?? "0");

    if (membership.role === "admin" && currentCount > 1) {
      throw new AdminTransferRequiredError("Admin must transfer ownership before leaving");
    }

    await client.query(
      `
        DELETE FROM team_members
        WHERE team_id = $1 AND user_id = $2
      `,
      [membership.team_id, userId]
    );

    if (currentCount === 1) {
      await client.query(
        `
          DELETE FROM teams
          WHERE id = $1
        `,
        [membership.team_id]
      );
    }

    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    if (error instanceof AdminTransferRequiredError || error instanceof NotOnTeamError) {
      throw error;
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function rotateTeamInviteCode(pool: Pool, userId: string): Promise<TeamSummary> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const membership = await requireTeamAdminMembership(client, userId);

    let updated = false;
    for (let attempt = 0; attempt < 5 && !updated; attempt += 1) {
      const inviteCode = generateInviteCode();
      try {
        await client.query(
          `
            UPDATE teams
            SET invite_code = $1, updated_at = NOW()
            WHERE id = $2
          `,
          [inviteCode, membership.team_id]
        );
        updated = true;
      } catch (error: unknown) {
        if (isDuplicateViolation(error) && error.constraint === "teams_invite_code_unique") {
          continue;
        }
        throw error;
      }
    }

    if (!updated) {
      throw new Error("Unable to rotate team invite code");
    }

    const summary = await getTeamSummaryForUserWithClient(client, userId);
    if (!summary) {
      throw new Error("Team summary missing after invite rotation");
    }

    await client.query("COMMIT");
    return summary;
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    if (error instanceof TeamAdminRequiredError || error instanceof NotOnTeamError) {
      throw error;
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function transferTeamAdmin(
  pool: Pool,
  userId: string,
  newAdminUserId: string
): Promise<TeamSummary> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const membership = await requireTeamAdminMembership(client, userId);

    if (newAdminUserId === userId) {
      throw new TeamMemberNotFoundError("Cannot transfer admin to self");
    }

    const targetMembershipResult = await client.query<{ user_id: string; role: TeamMemberRole }>(
      `
        SELECT user_id, role
        FROM team_members
        WHERE team_id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [membership.team_id, newAdminUserId]
    );

    const targetMembership = targetMembershipResult.rows[0];
    if (!targetMembership || targetMembership.role !== "member") {
      throw new TeamMemberNotFoundError("Target member not found");
    }

    await client.query(
      `
        UPDATE team_members
        SET role = 'member'
        WHERE team_id = $1
          AND user_id = $2
      `,
      [membership.team_id, userId]
    );

    await client.query(
      `
        UPDATE team_members
        SET role = 'admin'
        WHERE team_id = $1
          AND user_id = $2
      `,
      [membership.team_id, newAdminUserId]
    );

    const summary = await getTeamSummaryForUserWithClient(client, userId);
    if (!summary) {
      throw new Error("Team summary missing after admin transfer");
    }

    await client.query("COMMIT");
    return summary;
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    if (
      error instanceof TeamAdminRequiredError ||
      error instanceof NotOnTeamError ||
      error instanceof TeamMemberNotFoundError
    ) {
      throw error;
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function removeTeamMember(
  pool: Pool,
  userId: string,
  memberUserId: string
): Promise<TeamSummary> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const membership = await requireTeamAdminMembership(client, userId);

    const targetMembershipResult = await client.query<{ user_id: string; role: TeamMemberRole }>(
      `
        SELECT user_id, role
        FROM team_members
        WHERE team_id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [membership.team_id, memberUserId]
    );

    const targetMembership = targetMembershipResult.rows[0];
    if (!targetMembership) {
      throw new TeamMemberNotFoundError("Team member not found");
    }

    if (targetMembership.role === "admin") {
      throw new CannotRemoveTeamAdminError("Cannot remove the team admin");
    }

    await client.query(
      `
        DELETE FROM team_members
        WHERE team_id = $1
          AND user_id = $2
      `,
      [membership.team_id, memberUserId]
    );

    const summary = await getTeamSummaryForUserWithClient(client, userId);
    if (!summary) {
      throw new Error("Team summary missing after member removal");
    }

    await client.query("COMMIT");
    return summary;
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    if (
      error instanceof TeamAdminRequiredError ||
      error instanceof NotOnTeamError ||
      error instanceof TeamMemberNotFoundError ||
      error instanceof CannotRemoveTeamAdminError
    ) {
      throw error;
    }
    throw error;
  } finally {
    client.release();
  }
}

async function assertUserHasNoTeam(client: PoolClient, userId: string): Promise<void> {
  const result = await client.query<{ team_id: string }>(
    `
      SELECT team_id
      FROM team_members
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId]
  );

  if (result.rows[0]) {
    throw new AlreadyOnTeamError("User already belongs to a team");
  }
}

async function requireTeamAdminMembership(
  client: PoolClient,
  userId: string
): Promise<{ team_id: string }> {
  const result = await client.query<{ team_id: string; role: TeamMemberRole }>(
    `
      SELECT team_id, role
      FROM team_members
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId]
  );

  const membership = result.rows[0];
  if (!membership) {
    throw new NotOnTeamError("User is not on a team");
  }

  if (membership.role !== "admin") {
    throw new TeamAdminRequiredError("Admin privileges required");
  }

  return { team_id: membership.team_id };
}

async function getTeamSummaryForUserWithClient(
  client: PoolClient,
  userId: string
): Promise<TeamSummary | null> {
  const teamResult = await client.query<UserTeamRow>(
    `
      SELECT t.id, t.name, t.invite_code, tm.role AS your_role
      FROM team_members tm
      INNER JOIN teams t ON t.id = tm.team_id
      WHERE tm.user_id = $1
      LIMIT 1
    `,
    [userId]
  );

  const teamRow = teamResult.rows[0];
  if (!teamRow) {
    return null;
  }

  const membersResult = await client.query<TeamMemberRow>(
    `
      SELECT tm.user_id, u.username, u.steam_id, tm.role, tm.joined_at
      FROM team_members tm
      INNER JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = $1
      ORDER BY CASE WHEN tm.role = 'admin' THEN 0 ELSE 1 END, tm.joined_at ASC
    `,
    [teamRow.id]
  );

  return {
    id: teamRow.id,
    name: teamRow.name,
    invite_code: teamRow.invite_code,
    member_count: membersResult.rows.length,
    your_role: teamRow.your_role,
    members: membersResult.rows
  };
}

function generateInviteCode(): string {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let code = "";

  for (let index = 0; index < 8; index += 1) {
    const randomValue = bytes[index] ?? 0;
    code += charset[randomValue % charset.length] ?? "A";
  }

  return code;
}

function isDuplicateViolation(
  error: unknown
): error is { code: string; constraint?: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function isCheckViolation(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23514";
}
