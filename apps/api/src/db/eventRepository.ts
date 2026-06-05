import type { Pool, PoolClient } from "pg";
import type { MatchScheduleProposalStatus, MatchStatus } from "@homieleague/shared";
import type { TeamSummary } from "./teamRepository.js";
import { getTeamSummaryForUser } from "./teamRepository.js";

export type EventStatus = "draft" | "registration_open" | "registration_closed" | "in_progress" | "completed";

export interface EventRow {
  id: string;
  title: string;
  game: string;
  timezone: string;
  registration_opens_at: string;
  registration_closes_at: string;
  starts_at: string;
  status: EventStatus;
  registration_count: number;
  is_registered_for_your_team: boolean;
  can_register_your_team: boolean;
  can_manage_current_event: boolean;
  can_start_current_event: boolean;
}

export interface EventMatchRow {
  id: string;
  round_number: number;
  slot_number: number;
  status: MatchStatus;
  team_a_id: string | null;
  team_a_name: string | null;
  team_b_id: string | null;
  team_b_name: string | null;
  scheduled_start_at: string | null;
  winner_team_id: string | null;
  can_manage_lifecycle: boolean;
  can_transition_to_scheduled: boolean;
  can_transition_to_in_progress: boolean;
  can_propose_schedule: boolean;
  can_respond_to_schedule_proposal: boolean;
  can_report_result: boolean;
  your_reported_winner_team_id: string | null;
  is_awaiting_opponent_confirmation: boolean;
  has_result_conflict: boolean;
  latest_schedule_proposal_id: string | null;
  latest_schedule_proposal_proposed_by_team_id: string | null;
  latest_schedule_proposal_proposed_by_team_name: string | null;
  latest_schedule_proposal_proposed_start_at: string | null;
  latest_schedule_proposal_status: MatchScheduleProposalStatus | null;
  latest_schedule_proposal_responded_by_team_id: string | null;
}

export interface CreateEventInput {
  title: string;
  game: string;
  timezone: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  startsAt: string;
}

export class ActiveEventExistsError extends Error {}
export class EventNotFoundError extends Error {}
export class EventRegistrationClosedError extends Error {}
export class EventTeamNotReadyError extends Error {}
export class EventTeamNotEligibleError extends Error {}
export class EventTeamAlreadyRegisteredError extends Error {}
export class EventManageForbiddenError extends Error {}
export class EventStartStateError extends Error {}
export class EventInsufficientTeamsError extends Error {}
export class EventMatchNotFoundError extends Error {}
export class EventMatchForbiddenError extends Error {}
export class EventMatchStateError extends Error {}
export class EventMatchScheduleProposalNotFoundError extends Error {}

export async function getCurrentEventForUser(
  pool: Pool,
  userId: string,
  isAdmin: boolean
): Promise<{ team: TeamSummary | null; currentEvent: EventRow | null; matches: EventMatchRow[] }> {
  const team = await getTeamSummaryForUser(pool, userId);
  const currentEvent = await queryCurrentEventRow(pool, team?.id ?? null, isAdmin);
  const matches = currentEvent
    ? await queryCurrentEventMatches(pool, currentEvent.id, team?.id ?? null, team?.your_role ?? null, isAdmin)
    : [];

  return {
    team,
    currentEvent,
    matches
  };
}

export async function createCurrentEvent(
  pool: Pool,
  input: CreateEventInput,
  creatorUserId: string
): Promise<EventRow> {
  const existing = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM events
      WHERE status <> 'completed'
      LIMIT 1
    `
  );

  if (existing.rows[0]) {
    throw new ActiveEventExistsError("An active event already exists");
  }

  let result;
  try {
    result = await pool.query<EventRow>(
      `
        INSERT INTO events (
          title,
          game,
          timezone,
          registration_opens_at,
          registration_closes_at,
          starts_at,
          status,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'registration_open', $7)
        RETURNING
          id,
          title,
          game,
          timezone,
          registration_opens_at,
          registration_closes_at,
          starts_at,
          status,
          0::int AS registration_count,
          false AS is_registered_for_your_team,
          true AS can_register_your_team,
            true AS can_manage_current_event,
            true AS can_start_current_event
      `,
      [
        input.title,
        input.game,
        input.timezone,
        input.registrationOpensAt,
        input.registrationClosesAt,
        input.startsAt,
        creatorUserId
      ]
    );
  } catch (error: unknown) {
    if (
      isDuplicateViolation(error) &&
      error.constraint === "events_single_active_event_idx"
    ) {
      throw new ActiveEventExistsError("An active event already exists");
    }
    throw error;
  }

  const created = result.rows[0];
  if (!created) {
    throw new Error("Event insert did not return a row");
  }

  return created;
}

export async function registerCurrentTeamForCurrentEvent(
  pool: Pool,
  userId: string,
  isAdmin: boolean
): Promise<EventRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const team = await getTeamSummaryForUser(pool, userId);
    if (!team) {
      throw new EventTeamNotEligibleError("User is not on a team");
    }

    if (team.your_role !== "admin") {
      throw new EventTeamNotEligibleError("Only the team admin can register the team");
    }

    if (team.member_count !== 5) {
      throw new EventTeamNotReadyError("Team must have five members before registration");
    }

    const eventResult = await client.query<{ id: string; status: EventStatus }>(
      `
        SELECT id, status
        FROM events
        WHERE status <> 'completed'
        LIMIT 1
      `
    );

    const event = eventResult.rows[0];
    if (!event) {
      throw new EventNotFoundError("Event not found");
    }

    if (event.status !== "registration_open") {
      throw new EventRegistrationClosedError("Event registration is not open");
    }

    const existingRegistration = await client.query<{ team_id: string }>(
      `
        SELECT team_id
        FROM event_registrations
        WHERE event_id = $1
          AND team_id = $2
        LIMIT 1
      `,
      [event.id, team.id]
    );

    if (existingRegistration.rows[0]) {
      throw new EventTeamAlreadyRegisteredError("Team is already registered for this event");
    }

    await client.query(
      `
        INSERT INTO event_registrations (event_id, team_id, registered_by)
        VALUES ($1, $2, $3)
      `,
      [event.id, team.id, userId]
    );

    const refreshed = await queryCurrentEventRow(client, team.id, isAdmin);

    if (!refreshed) {
      throw new Error("Event refresh did not return a row");
    }

    await client.query("COMMIT");
    return refreshed;
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    if (
      error instanceof EventNotFoundError ||
      error instanceof EventRegistrationClosedError ||
      error instanceof EventTeamNotReadyError ||
      error instanceof EventTeamNotEligibleError ||
      error instanceof EventTeamAlreadyRegisteredError
    ) {
      throw error;
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function completeCurrentEvent(pool: Pool, isAdmin: boolean): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const eventResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM events
        WHERE status <> 'completed'
        ORDER BY created_at DESC
        LIMIT 1
      `
    );

    const currentEvent = eventResult.rows[0];
    if (!currentEvent) {
      throw new EventNotFoundError("Event not found");
    }

    if (!isAdmin) {
      throw new EventManageForbiddenError("Only the admin account can complete the current event");
    }

    await client.query(
      `
        UPDATE events
        SET status = 'completed', updated_at = NOW()
        WHERE id = $1
      `,
      [currentEvent.id]
    );

    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    if (error instanceof EventNotFoundError || error instanceof EventManageForbiddenError) {
      throw error;
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function startCurrentEvent(
  pool: Pool,
  isAdmin: boolean
): Promise<{ createdMatches: number }> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const eventResult = await client.query<{ id: string; status: EventStatus }>(
      `
        SELECT id, status
        FROM events
        WHERE status <> 'completed'
        ORDER BY created_at DESC
        LIMIT 1
      `
    );

    const currentEvent = eventResult.rows[0];
    if (!currentEvent) {
      throw new EventNotFoundError("Event not found");
    }

    if (!isAdmin) {
      throw new EventManageForbiddenError("Only the admin account can start the current event");
    }

    if (currentEvent.status !== "registration_open") {
      throw new EventStartStateError("Current event is not in a startable state");
    }

    const registrationsResult = await client.query<{ team_id: string }>(
      `
        SELECT team_id
        FROM event_registrations
        WHERE event_id = $1
        ORDER BY created_at ASC, team_id ASC
      `,
      [currentEvent.id]
    );

    const registeredTeamIds = registrationsResult.rows.map((row) => row.team_id);
    if (registeredTeamIds.length < 2) {
      throw new EventInsufficientTeamsError("At least two teams are required to start the current event");
    }

    const bracketSize = nextPowerOfTwo(registeredTeamIds.length);
    const paddedTeamIds = [
      ...registeredTeamIds,
      ...Array.from({ length: bracketSize - registeredTeamIds.length }, () => null as string | null)
    ];
    const firstRoundMatchCount = bracketSize / 2;

    for (let index = 0; index < firstRoundMatchCount; index += 1) {
      const teamAId = paddedTeamIds[index * 2] ?? null;
      const teamBId = paddedTeamIds[index * 2 + 1] ?? null;

      await client.query(
        `
          INSERT INTO event_matches (
            event_id,
            round_number,
            slot_number,
            team_a_id,
            team_b_id,
            status
          )
          VALUES ($1, 1, $2, $3, $4, 'pending')
        `,
        [currentEvent.id, index + 1, teamAId, teamBId]
      );
    }

    await client.query(
      `
        UPDATE events
        SET status = 'in_progress', updated_at = NOW()
        WHERE id = $1
      `,
      [currentEvent.id]
    );

    await client.query("COMMIT");
    return { createdMatches: firstRoundMatchCount };
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    if (
      error instanceof EventNotFoundError ||
      error instanceof EventManageForbiddenError ||
      error instanceof EventStartStateError ||
      error instanceof EventInsufficientTeamsError
    ) {
      throw error;
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function updateCurrentEventMatchStatus(
  pool: Pool,
  matchId: string,
  targetStatus: "scheduled" | "in_progress",
  isAdmin: boolean
): Promise<void> {
  if (!isAdmin) {
    throw new EventMatchForbiddenError("Only the admin account can manage match lifecycle");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const match = await queryMatchForUpdate(client, matchId);
    if (!match) {
      throw new EventMatchNotFoundError("Match not found");
    }

    if (!match.team_a_id || !match.team_b_id) {
      throw new EventMatchStateError("Cannot transition bye matches manually");
    }

    const transitionAllowed =
      ((match.status === "pending" || match.status === "scheduling") && targetStatus === "scheduled") ||
      (match.status === "scheduled" && targetStatus === "in_progress");

    if (!transitionAllowed) {
      throw new EventMatchStateError("Invalid match status transition");
    }

    await client.query(
      `
        UPDATE event_matches
        SET status = $2, updated_at = NOW()
        WHERE id = $1
      `,
      [matchId, targetStatus]
    );

    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    if (
      error instanceof EventMatchForbiddenError ||
      error instanceof EventMatchNotFoundError ||
      error instanceof EventMatchStateError
    ) {
      throw error;
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function proposeCurrentEventMatchSchedule(
  pool: Pool,
  matchId: string,
  proposedStartAtIso: string,
  userId: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const match = await queryMatchForUpdate(client, matchId);
    if (!match) {
      throw new EventMatchNotFoundError("Match not found");
    }

    if (!match.team_a_id || !match.team_b_id) {
      throw new EventMatchStateError("Cannot schedule bye matches");
    }

    if (match.status !== "pending" && match.status !== "scheduling") {
      throw new EventMatchStateError("Match is not in a schedulable state");
    }

    const membership = await queryUserTeamMembership(client, userId);
    if (!membership || membership.role !== "admin") {
      throw new EventMatchForbiddenError("Only team admins can propose match times");
    }

    if (membership.team_id !== match.team_a_id && membership.team_id !== match.team_b_id) {
      throw new EventMatchForbiddenError("Only participating teams can propose match times");
    }

    await client.query(
      `
        INSERT INTO event_match_schedule_proposals (
          match_id,
          proposed_by_team_id,
          proposed_start_at,
          status
        )
        VALUES ($1, $2, $3, 'pending')
      `,
      [matchId, membership.team_id, proposedStartAtIso]
    );

    await client.query(
      `
        UPDATE event_matches
        SET status = 'scheduling',
            updated_at = NOW()
        WHERE id = $1
          AND status = 'pending'
      `,
      [matchId]
    );

    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    if (
      error instanceof EventMatchNotFoundError ||
      error instanceof EventMatchForbiddenError ||
      error instanceof EventMatchStateError
    ) {
      throw error;
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function respondToCurrentEventMatchSchedule(
  pool: Pool,
  matchId: string,
  proposalId: string,
  decision: "accept" | "reject",
  userId: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const match = await queryMatchForUpdate(client, matchId);
    if (!match) {
      throw new EventMatchNotFoundError("Match not found");
    }

    if (!match.team_a_id || !match.team_b_id) {
      throw new EventMatchStateError("Cannot schedule bye matches");
    }

    const membership = await queryUserTeamMembership(client, userId);
    if (!membership || membership.role !== "admin") {
      throw new EventMatchForbiddenError("Only team admins can respond to match schedules");
    }

    if (membership.team_id !== match.team_a_id && membership.team_id !== match.team_b_id) {
      throw new EventMatchForbiddenError("Only participating teams can respond to match schedules");
    }

    const proposal = await queryPendingScheduleProposalForUpdate(client, matchId, proposalId);
    if (!proposal) {
      throw new EventMatchScheduleProposalNotFoundError("Schedule proposal not found");
    }

    if (proposal.proposed_by_team_id === membership.team_id) {
      throw new EventMatchForbiddenError("Proposing team cannot respond to its own proposal");
    }

    const nextStatus = decision === "accept" ? "accepted" : "rejected";
    await client.query(
      `
        UPDATE event_match_schedule_proposals
        SET status = $3,
            responded_by_team_id = $4,
            responded_at = NOW()
        WHERE id = $1
          AND match_id = $2
      `,
      [proposalId, matchId, nextStatus, membership.team_id]
    );

    if (decision === "accept") {
      await client.query(
        `
          UPDATE event_match_schedule_proposals
          SET status = 'rejected',
              responded_by_team_id = $2,
              responded_at = NOW()
          WHERE match_id = $1
            AND id <> $3
            AND status = 'pending'
        `,
        [matchId, membership.team_id, proposalId]
      );

      await client.query(
        `
          UPDATE event_matches
          SET status = 'scheduled',
              scheduled_start_at = $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [matchId, proposal.proposed_start_at]
      );
    }

    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    if (
      error instanceof EventMatchNotFoundError ||
      error instanceof EventMatchForbiddenError ||
      error instanceof EventMatchStateError ||
      error instanceof EventMatchScheduleProposalNotFoundError
    ) {
      throw error;
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function reportCurrentEventMatchResult(
  pool: Pool,
  matchId: string,
  winnerTeamId: string,
  userId: string,
  isAdmin: boolean,
  adminOverride: boolean
): Promise<{ finalized: boolean; awaitingOpponent: boolean; conflict: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const match = await queryMatchForUpdate(client, matchId);
    if (!match) {
      throw new EventMatchNotFoundError("Match not found");
    }

    if (!match.team_a_id || !match.team_b_id) {
      throw new EventMatchStateError("Cannot report results for bye matches");
    }

    const allowedWinnerIds = [match.team_a_id, match.team_b_id];
    if (!allowedWinnerIds.includes(winnerTeamId)) {
      throw new EventMatchStateError("Reported winner must be a participating team");
    }

    if (adminOverride) {
      if (!isAdmin) {
        throw new EventMatchForbiddenError("Only the admin account can override match results");
      }

      await client.query(
        `
          INSERT INTO event_match_reports (
            match_id,
            reporter_user_id,
            reporter_team_id,
            reported_winner_team_id,
            is_admin_override
          )
          VALUES ($1, $2, NULL, $3, true)
          ON CONFLICT (match_id)
          WHERE is_admin_override = true
          DO UPDATE SET
            reporter_user_id = EXCLUDED.reporter_user_id,
            reported_winner_team_id = EXCLUDED.reported_winner_team_id,
            updated_at = NOW()
        `,
        [matchId, userId, winnerTeamId]
      );

      await client.query(
        `
          UPDATE event_matches
          SET winner_team_id = $2,
              status = 'completed',
              updated_at = NOW()
          WHERE id = $1
        `,
        [matchId, winnerTeamId]
      );

      await client.query("COMMIT");
      return { finalized: true, awaitingOpponent: false, conflict: false };
    }

    if (match.status !== "in_progress") {
      throw new EventMatchStateError("Match must be in progress before reporting a result");
    }

    const membership = await queryUserTeamMembership(client, userId);
    if (!membership || membership.role !== "admin") {
      throw new EventMatchForbiddenError("Only team admins can report match results");
    }

    if (membership.team_id !== match.team_a_id && membership.team_id !== match.team_b_id) {
      throw new EventMatchForbiddenError("Only participating teams can report match results");
    }

    await client.query(
      `
        INSERT INTO event_match_reports (
          match_id,
          reporter_user_id,
          reporter_team_id,
          reported_winner_team_id,
          is_admin_override
        )
        VALUES ($1, $2, $3, $4, false)
        ON CONFLICT (match_id, reporter_team_id)
        DO UPDATE SET
          reporter_user_id = EXCLUDED.reporter_user_id,
          reported_winner_team_id = EXCLUDED.reported_winner_team_id,
          is_admin_override = false,
          updated_at = NOW()
      `,
      [matchId, userId, membership.team_id, winnerTeamId]
    );

    const reportsResult = await client.query<{
      reporter_team_id: string;
      reported_winner_team_id: string;
    }>(
      `
        SELECT reporter_team_id, reported_winner_team_id
        FROM event_match_reports
        WHERE match_id = $1
          AND is_admin_override = false
      `,
      [matchId]
    );

    const reportByTeam = new Map<string, string>();
    for (const row of reportsResult.rows) {
      reportByTeam.set(row.reporter_team_id, row.reported_winner_team_id);
    }

    const teamAReport = reportByTeam.get(match.team_a_id) ?? null;
    const teamBReport = reportByTeam.get(match.team_b_id) ?? null;

    if (teamAReport && teamBReport && teamAReport === teamBReport) {
      await client.query(
        `
          UPDATE event_matches
          SET winner_team_id = $2,
              status = 'completed',
              updated_at = NOW()
          WHERE id = $1
        `,
        [matchId, teamAReport]
      );

      await client.query("COMMIT");
      return { finalized: true, awaitingOpponent: false, conflict: false };
    }

    await client.query("COMMIT");
    return {
      finalized: false,
      awaitingOpponent: !(teamAReport && teamBReport),
      conflict: Boolean(teamAReport && teamBReport && teamAReport !== teamBReport)
    };
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    if (
      error instanceof EventMatchNotFoundError ||
      error instanceof EventMatchForbiddenError ||
      error instanceof EventMatchStateError
    ) {
      throw error;
    }
    throw error;
  } finally {
    client.release();
  }
}

async function queryCurrentEventRow(
  poolLike: Pool | PoolClient,
  teamId: string | null,
  isAdmin: boolean
): Promise<EventRow | null> {
  const result = await poolLike.query<EventRow>(
    `
      SELECT
        e.id,
        e.title,
        e.game,
        e.timezone,
        e.registration_opens_at,
        e.registration_closes_at,
        e.starts_at,
        e.status,
        COUNT(er.team_id)::int AS registration_count,
        COALESCE(your_registration.team_id IS NOT NULL, false) AS is_registered_for_your_team,
        ($2::boolean) AS can_manage_current_event,
        CASE
          WHEN $2::boolean
            AND e.status = 'registration_open'
            AND e.registration_opens_at <= NOW()
            AND e.registration_closes_at >= NOW()
          THEN true
          ELSE false
        END AS can_start_current_event,
        CASE
          WHEN $1::uuid IS NULL THEN false
          WHEN team_state.member_count = 5
            AND team_state.your_role = 'admin'
            AND e.status = 'registration_open'
            AND e.registration_opens_at <= NOW()
            AND e.registration_closes_at >= NOW()
            AND your_registration.team_id IS NULL
          THEN true
          ELSE false
        END AS can_register_your_team
      FROM events e
      LEFT JOIN event_registrations er ON er.event_id = e.id
      LEFT JOIN event_registrations your_registration
        ON your_registration.event_id = e.id
       AND your_registration.team_id = $1
      LEFT JOIN LATERAL (
        SELECT tm.role AS your_role, COUNT(*)::int AS member_count
        FROM team_members tm
        WHERE tm.team_id = $1
        GROUP BY tm.role
        LIMIT 1
      ) team_state ON true
      WHERE e.status <> 'completed'
      GROUP BY e.id, your_registration.team_id, team_state.member_count, team_state.your_role
      ORDER BY e.created_at DESC
      LIMIT 1
    `,
    [teamId, isAdmin]
  );

  return result.rows[0] ?? null;
}

async function queryCurrentEventMatches(
  poolLike: Pool | PoolClient,
  eventId: string,
  teamId: string | null,
  teamRole: "admin" | "member" | null,
  isAdmin: boolean
): Promise<EventMatchRow[]> {
  const result = await poolLike.query<EventMatchRow>(
    `
      SELECT
        em.id,
        em.round_number,
        em.slot_number,
        em.status,
        em.team_a_id,
        team_a.name AS team_a_name,
        em.team_b_id,
        team_b.name AS team_b_name,
        em.scheduled_start_at,
        em.winner_team_id,
        ($3::boolean) AS can_manage_lifecycle,
        ($3::boolean AND em.status IN ('pending', 'scheduling') AND em.team_a_id IS NOT NULL AND em.team_b_id IS NOT NULL)
          AS can_transition_to_scheduled,
        ($3::boolean AND em.status = 'scheduled' AND em.team_a_id IS NOT NULL AND em.team_b_id IS NOT NULL)
          AS can_transition_to_in_progress,
        (
          $1::uuid IS NOT NULL
          AND $2::text = 'admin'
          AND em.status IN ('pending', 'scheduling')
          AND ($1::uuid = em.team_a_id OR $1::uuid = em.team_b_id)
        ) AS can_propose_schedule,
        (
          $1::uuid IS NOT NULL
          AND $2::text = 'admin'
          AND pending_schedule.id IS NOT NULL
          AND pending_schedule.proposed_by_team_id <> $1::uuid
          AND ($1::uuid = em.team_a_id OR $1::uuid = em.team_b_id)
        ) AS can_respond_to_schedule_proposal,
        (
          $1::uuid IS NOT NULL
          AND $2::text = 'admin'
          AND em.status = 'in_progress'
          AND ($1::uuid = em.team_a_id OR $1::uuid = em.team_b_id)
        ) AS can_report_result,
        your_report.reported_winner_team_id AS your_reported_winner_team_id,
        (
          your_report.reported_winner_team_id IS NOT NULL
          AND opponent_report.reported_winner_team_id IS NULL
        ) AS is_awaiting_opponent_confirmation,
        (
          your_report.reported_winner_team_id IS NOT NULL
          AND opponent_report.reported_winner_team_id IS NOT NULL
          AND your_report.reported_winner_team_id <> opponent_report.reported_winner_team_id
        ) AS has_result_conflict,
        latest_schedule.id AS latest_schedule_proposal_id,
        latest_schedule.proposed_by_team_id AS latest_schedule_proposal_proposed_by_team_id,
        latest_proposer.name AS latest_schedule_proposal_proposed_by_team_name,
        latest_schedule.proposed_start_at AS latest_schedule_proposal_proposed_start_at,
        latest_schedule.status AS latest_schedule_proposal_status,
        latest_schedule.responded_by_team_id AS latest_schedule_proposal_responded_by_team_id
      FROM event_matches em
      LEFT JOIN teams team_a ON team_a.id = em.team_a_id
      LEFT JOIN teams team_b ON team_b.id = em.team_b_id
      LEFT JOIN LATERAL (
        SELECT id, proposed_by_team_id, proposed_start_at, status, responded_by_team_id
        FROM event_match_schedule_proposals
        WHERE match_id = em.id
        ORDER BY created_at DESC
        LIMIT 1
      ) latest_schedule ON true
      LEFT JOIN teams latest_proposer ON latest_proposer.id = latest_schedule.proposed_by_team_id
      LEFT JOIN LATERAL (
        SELECT id, proposed_by_team_id
        FROM event_match_schedule_proposals
        WHERE match_id = em.id
          AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      ) pending_schedule ON true
      LEFT JOIN LATERAL (
        SELECT reported_winner_team_id
        FROM event_match_reports
        WHERE match_id = em.id
          AND reporter_team_id = $1
          AND is_admin_override = false
        LIMIT 1
      ) your_report ON true
      LEFT JOIN LATERAL (
        SELECT reported_winner_team_id
        FROM event_match_reports
        WHERE match_id = em.id
          AND reporter_team_id IS NOT NULL
          AND reporter_team_id <> $1
          AND is_admin_override = false
        LIMIT 1
      ) opponent_report ON true
      WHERE em.event_id = $4
      ORDER BY em.round_number ASC, em.slot_number ASC
    `,
    [teamId, teamRole, isAdmin, eventId]
  );

  return result.rows;
}

async function queryMatchForUpdate(
  client: PoolClient,
  matchId: string
): Promise<{
  id: string;
  status: MatchStatus;
  team_a_id: string | null;
  team_b_id: string | null;
} | null> {
  const result = await client.query<{
    id: string;
    status: MatchStatus;
    team_a_id: string | null;
    team_b_id: string | null;
  }>(
    `
      SELECT em.id, em.status, em.team_a_id, em.team_b_id
      FROM event_matches em
      INNER JOIN events e ON e.id = em.event_id
      WHERE em.id = $1
        AND e.status <> 'completed'
      LIMIT 1
      FOR UPDATE
    `,
    [matchId]
  );

  return result.rows[0] ?? null;
}

async function queryUserTeamMembership(
  client: PoolClient,
  userId: string
): Promise<{ team_id: string; role: "admin" | "member" } | null> {
  const result = await client.query<{ team_id: string; role: "admin" | "member" }>(
    `
      SELECT team_id, role
      FROM team_members
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId]
  );

  return result.rows[0] ?? null;
}

async function queryPendingScheduleProposalForUpdate(
  client: PoolClient,
  matchId: string,
  proposalId: string
): Promise<{ proposed_by_team_id: string; proposed_start_at: string } | null> {
  const result = await client.query<{ proposed_by_team_id: string; proposed_start_at: string }>(
    `
      SELECT proposed_by_team_id, proposed_start_at
      FROM event_match_schedule_proposals
      WHERE id = $1
        AND match_id = $2
        AND status = 'pending'
      LIMIT 1
      FOR UPDATE
    `,
    [proposalId, matchId]
  );

  return result.rows[0] ?? null;
}

function isDuplicateViolation(
  error: unknown
): error is { code: string; constraint?: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function nextPowerOfTwo(value: number): number {
  let candidate = 1;
  while (candidate < value) {
    candidate *= 2;
  }

  return candidate;
}
