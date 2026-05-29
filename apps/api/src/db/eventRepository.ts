import type { Pool, PoolClient } from "pg";
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

export async function getCurrentEventForUser(
  pool: Pool,
  userId: string,
  isAdmin: boolean
): Promise<{ team: TeamSummary | null; currentEvent: EventRow | null }> {
  const team = await getTeamSummaryForUser(pool, userId);
  const currentEvent = await queryCurrentEventRow(pool, team?.id ?? null, isAdmin);

  return {
    team,
    currentEvent
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
          true AS can_manage_current_event
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

function isDuplicateViolation(
  error: unknown
): error is { code: string; constraint?: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
