import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { loadEnvironment } from "../config/loadEnv.js";
import { createSession, createUser, findSessionUserByTokenHash, revokeSessionByTokenHash } from "../db/authRepository.js";
import {
  createCurrentEvent,
  EventManageForbiddenError,
  EventMatchStateError,
  registerCurrentTeamForCurrentEvent,
  reportCurrentEventMatchResult,
  startCurrentEvent,
  updateCurrentEventMatchStatus
} from "../db/eventRepository.js";
import {
  createTeamForUser,
  joinTeamByInviteCode,
  TeamAdminRequiredError,
  TeamRosterLockedError,
  transferTeamAdmin,
  leaveCurrentTeam,
  type TeamSummary
} from "../db/teamRepository.js";
import { generateSessionToken, hashPassword, hashSessionToken, verifyPassword } from "../auth/security.js";

loadEnvironment();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for tests");
}

const pool = new Pool({ connectionString: databaseUrl });

beforeAll(async () => {
  await pool.query("SELECT 1");
});

beforeEach(async () => {
  await resetDatabase(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("Step 5 security-sensitive flows", () => {
  it("hashes/verifies passwords and revokes sessions defensively", async () => {
    const password = "SuperSecurePassword!123";
    const hash = await hashPassword(password);

    await expect(verifyPassword(password, hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);

    const user = await createTestUser(pool, "session-user");
    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);

    await createSession(pool, user.id, tokenHash, new Date(Date.now() + 60_000));
    await expect(findSessionUserByTokenHash(pool, tokenHash)).resolves.not.toBeNull();

    await revokeSessionByTokenHash(pool, tokenHash);
    await expect(findSessionUserByTokenHash(pool, tokenHash)).resolves.toBeNull();
  });

  it("blocks non-admin users from starting the current event", async () => {
    const creator = await createTestUser(pool, "creator");

    await createCurrentEvent(
      pool,
      {
        title: "Security Event",
        game: "CS2",
        timezone: "UTC",
        registrationOpensAt: new Date(Date.now() - 60_000).toISOString(),
        registrationClosesAt: new Date(Date.now() + 60_000).toISOString(),
        startsAt: new Date(Date.now() + 300_000).toISOString()
      },
      creator.id
    );

    await expect(startCurrentEvent(pool, false)).rejects.toBeInstanceOf(EventManageForbiddenError);
  });

  it("enforces team-admin permissions for admin transfer", async () => {
    const adminUser = await createTestUser(pool, "team-admin");
    const memberUser = await createTestUser(pool, "team-member");

    const team = await createTeamForUser(pool, adminUser.id, `Team-${randomUUID().slice(0, 8)}`);
    await joinTeamByInviteCode(pool, memberUser.id, team.invite_code);

    await expect(transferTeamAdmin(pool, memberUser.id, adminUser.id)).rejects.toBeInstanceOf(
      TeamAdminRequiredError
    );
  });
});

describe("Step 5 tournament-critical invariants", () => {
  it("locks team roster changes after event start", async () => {
    const adminAccount = await createTestUser(pool, "platform-admin");

    const teamAUsers = await createTeamWithFivePlayers(pool, "alpha");
    const teamBUsers = await createTeamWithFivePlayers(pool, "bravo");

    await createCurrentEvent(
      pool,
      {
        title: "Roster Lock Event",
        game: "CS2",
        timezone: "UTC",
        registrationOpensAt: new Date(Date.now() - 60_000).toISOString(),
        registrationClosesAt: new Date(Date.now() + 60_000).toISOString(),
        startsAt: new Date(Date.now() + 300_000).toISOString()
      },
      adminAccount.id
    );

    await registerCurrentTeamForCurrentEvent(pool, teamAUsers.admin.id, false);
    await registerCurrentTeamForCurrentEvent(pool, teamBUsers.admin.id, false);
    await startCurrentEvent(pool, true);

    await expect(leaveCurrentTeam(pool, teamAUsers.firstMemberId)).rejects.toBeInstanceOf(TeamRosterLockedError);
  });

  it("requires dual-team confirmation unless admin override finalizes result", async () => {
    const adminAccount = await createTestUser(pool, "platform-admin-2");

    const teamA = await createTeamWithFivePlayers(pool, "delta");
    const teamB = await createTeamWithFivePlayers(pool, "echo");

    const currentEvent = await createCurrentEvent(
      pool,
      {
        title: "Result Confirmation Event",
        game: "CS2",
        timezone: "UTC",
        registrationOpensAt: new Date(Date.now() - 60_000).toISOString(),
        registrationClosesAt: new Date(Date.now() + 60_000).toISOString(),
        startsAt: new Date(Date.now() + 300_000).toISOString()
      },
      adminAccount.id
    );

    await registerCurrentTeamForCurrentEvent(pool, teamA.admin.id, false);
    await registerCurrentTeamForCurrentEvent(pool, teamB.admin.id, false);
    await startCurrentEvent(pool, true);

    const matchId = await getFirstMatchId(pool, currentEvent.id);
    await updateCurrentEventMatchStatus(pool, matchId, "scheduled", true);
    await updateCurrentEventMatchStatus(pool, matchId, "in_progress", true);

    const firstReport = await reportCurrentEventMatchResult(
      pool,
      matchId,
      teamA.summary.id,
      teamA.admin.id,
      false,
      false
    );
    expect(firstReport.finalized).toBe(false);
    expect(firstReport.awaitingOpponent).toBe(true);
    expect(firstReport.conflict).toBe(false);

    const secondReport = await reportCurrentEventMatchResult(
      pool,
      matchId,
      teamB.summary.id,
      teamB.admin.id,
      false,
      false
    );
    expect(secondReport.finalized).toBe(false);
    expect(secondReport.conflict).toBe(true);

    const afterConflict = await pool.query<{ status: string; winner_team_id: string | null }>(
      `
        SELECT status, winner_team_id
        FROM event_matches
        WHERE id = $1
      `,
      [matchId]
    );
    expect(afterConflict.rows[0]?.status).toBe("in_progress");
    expect(afterConflict.rows[0]?.winner_team_id).toBeNull();

    const overrideResult = await reportCurrentEventMatchResult(
      pool,
      matchId,
      teamA.summary.id,
      adminAccount.id,
      true,
      true
    );
    expect(overrideResult.finalized).toBe(true);

    const afterOverride = await pool.query<{ status: string; winner_team_id: string | null }>(
      `
        SELECT status, winner_team_id
        FROM event_matches
        WHERE id = $1
      `,
      [matchId]
    );
    expect(afterOverride.rows[0]?.status).toBe("completed");
    expect(afterOverride.rows[0]?.winner_team_id).toBe(teamA.summary.id);

    await expect(
      reportCurrentEventMatchResult(pool, matchId, teamA.summary.id, teamA.admin.id, false, false)
    ).rejects.toBeInstanceOf(EventMatchStateError);
  });
});

async function createTeamWithFivePlayers(pool: Pool, label: string): Promise<{
  summary: TeamSummary;
  admin: { id: string };
  firstMemberId: string;
  members: Array<{ id: string }>;
}> {
  const admin = await createTestUser(pool, `${label}-admin`);
  const member1 = await createTestUser(pool, `${label}-member1`);
  const member2 = await createTestUser(pool, `${label}-member2`);
  const member3 = await createTestUser(pool, `${label}-member3`);
  const member4 = await createTestUser(pool, `${label}-member4`);

  const summary = await createTeamForUser(pool, admin.id, `Team-${label}-${randomUUID().slice(0, 6)}`);
  await joinTeamByInviteCode(pool, member1.id, summary.invite_code);
  await joinTeamByInviteCode(pool, member2.id, summary.invite_code);
  await joinTeamByInviteCode(pool, member3.id, summary.invite_code);
  await joinTeamByInviteCode(pool, member4.id, summary.invite_code);

  return {
    summary,
    admin: { id: admin.id },
    firstMemberId: member1.id,
    members: [{ id: member1.id }, { id: member2.id }, { id: member3.id }, { id: member4.id }]
  };
}

async function createTestUser(pool: Pool, prefix: string): Promise<{ id: string; username: string }> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const username = `${prefix}_${suffix}`;
  const user = await createUser(pool, {
    email: `${username}@test.local`,
    username,
    steamId: buildSteamId(),
    passwordHash: "test-hash"
  });

  return { id: user.id, username: user.username };
}

async function getFirstMatchId(pool: Pool, eventId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM event_matches
      WHERE event_id = $1
      ORDER BY round_number ASC, slot_number ASC
      LIMIT 1
    `,
    [eventId]
  );

  const match = result.rows[0];
  if (!match) {
    throw new Error("Expected at least one match");
  }

  return match.id;
}

async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query(
    `
      TRUNCATE TABLE
        notifications,
        event_match_reports,
        event_match_schedule_proposals,
        event_matches,
        event_registrations,
        team_members,
        teams,
        auth_sessions,
        events,
        users
      RESTART IDENTITY
      CASCADE
    `
  );
}

function buildSteamId(): string {
  const digits = randomUUID().replaceAll("-", "").replace(/[^0-9]/g, "");
  const padded = `${digits}00000000000000000`;
  return padded.slice(0, 17);
}
