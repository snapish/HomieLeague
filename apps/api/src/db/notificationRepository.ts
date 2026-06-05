import type { NotificationKind } from "@homieleague/shared";
import type { Pool } from "pg";

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

export async function listNotificationsForUser(
  pool: Pool,
  userId: string,
  limit = 40
): Promise<{ notifications: NotificationRow[]; unreadCount: number }> {
  const [notificationsResult, unreadResult] = await Promise.all([
    pool.query<NotificationRow>(
      `
        SELECT id, kind, title, message, metadata, read_at, created_at
        FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [userId, limit]
    ),
    pool.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM notifications
        WHERE user_id = $1
          AND read_at IS NULL
      `,
      [userId]
    )
  ]);

  return {
    notifications: notificationsResult.rows,
    unreadCount: Number(unreadResult.rows[0]?.count ?? "0")
  };
}

export async function markNotificationsRead(
  pool: Pool,
  userId: string,
  options: { markAll: boolean; notificationIds: string[] }
): Promise<number> {
  if (options.markAll) {
    await pool.query(
      `
        UPDATE notifications
        SET read_at = NOW()
        WHERE user_id = $1
          AND read_at IS NULL
      `,
      [userId]
    );
  } else if (options.notificationIds.length > 0) {
    await pool.query(
      `
        UPDATE notifications
        SET read_at = NOW()
        WHERE user_id = $1
          AND id = ANY($2::uuid[])
          AND read_at IS NULL
      `,
      [userId, options.notificationIds]
    );
  }

  const unreadResult = await pool.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM notifications
      WHERE user_id = $1
        AND read_at IS NULL
    `,
    [userId]
  );

  return Number(unreadResult.rows[0]?.count ?? "0");
}

export async function createNotifications(
  pool: Pool,
  userIds: string[],
  payload: { kind: NotificationKind; title: string; message: string; metadata?: Record<string, unknown> }
): Promise<void> {
  const uniqueUserIds = Array.from(new Set(userIds));
  if (uniqueUserIds.length === 0) {
    return;
  }

  await pool.query(
    `
      INSERT INTO notifications (user_id, kind, title, message, metadata)
      SELECT uid, $2, $3, $4, $5::jsonb
      FROM unnest($1::uuid[]) AS uid
    `,
    [uniqueUserIds, payload.kind, payload.title, payload.message, JSON.stringify(payload.metadata ?? {})]
  );
}

export async function createTeamInviteNotifications(
  pool: Pool,
  teamId: string,
  joinedUserId: string,
  joinedUsername: string,
  teamName: string
): Promise<void> {
  const recipientsResult = await pool.query<{ user_id: string }>(
    `
      SELECT user_id
      FROM team_members
      WHERE team_id = $1
        AND user_id <> $2
    `,
    [teamId, joinedUserId]
  );

  const recipientIds = recipientsResult.rows.map((row) => row.user_id);
  await createNotifications(pool, recipientIds, {
    kind: "team_invite",
    title: "Team invite accepted",
    message: `${joinedUsername} joined ${teamName}.`,
    metadata: {
      teamId,
      joinedUserId
    }
  });
}

export async function createMatchCreatedNotifications(pool: Pool, eventId: string, eventTitle: string): Promise<void> {
  const recipientsResult = await pool.query<{ user_id: string }>(
    `
      SELECT DISTINCT tm.user_id
      FROM event_matches em
      INNER JOIN team_members tm
        ON tm.team_id = em.team_a_id
        OR tm.team_id = em.team_b_id
      WHERE em.event_id = $1
        AND em.team_a_id IS NOT NULL
        AND em.team_b_id IS NOT NULL
    `,
    [eventId]
  );

  await createNotifications(
    pool,
    recipientsResult.rows.map((row) => row.user_id),
    {
      kind: "match_created",
      title: "New match assigned",
      message: `A match was created for ${eventTitle}.`,
      metadata: { eventId }
    }
  );
}

export async function createScheduleProposedNotifications(
  pool: Pool,
  matchId: string,
  proposedByTeamId: string,
  proposedAtIso: string
): Promise<void> {
  const recipientsResult = await pool.query<{ user_id: string }>(
    `
      SELECT tm.user_id
      FROM event_matches em
      INNER JOIN team_members tm
        ON (tm.team_id = em.team_a_id OR tm.team_id = em.team_b_id)
      WHERE em.id = $1
        AND tm.team_id <> $2
    `,
    [matchId, proposedByTeamId]
  );

  await createNotifications(
    pool,
    recipientsResult.rows.map((row) => row.user_id),
    {
      kind: "schedule_proposed",
      title: "Match schedule proposed",
      message: `A new match time was proposed for ${new Date(proposedAtIso).toLocaleString()}.`,
      metadata: { matchId, proposedByTeamId, proposedAt: proposedAtIso }
    }
  );
}

export async function createScheduleAcceptedNotifications(
  pool: Pool,
  matchId: string,
  proposedByTeamId: string,
  proposedAtIso: string
): Promise<void> {
  const recipientsResult = await pool.query<{ user_id: string }>(
    `
      SELECT tm.user_id
      FROM team_members tm
      WHERE tm.team_id = $1
    `,
    [proposedByTeamId]
  );

  await createNotifications(
    pool,
    recipientsResult.rows.map((row) => row.user_id),
    {
      kind: "schedule_accepted",
      title: "Match schedule accepted",
      message: `Your proposed match time (${new Date(proposedAtIso).toLocaleString()}) was accepted.`,
      metadata: { matchId, proposedByTeamId, proposedAt: proposedAtIso }
    }
  );
}

export async function createResultDisputedNotifications(
  pool: Pool,
  matchId: string,
  adminUserId: string | null
): Promise<void> {
  const teamUsersResult = await pool.query<{ user_id: string }>(
    `
      SELECT DISTINCT tm.user_id
      FROM event_matches em
      INNER JOIN team_members tm
        ON tm.team_id = em.team_a_id
        OR tm.team_id = em.team_b_id
      WHERE em.id = $1
    `,
    [matchId]
  );

  const recipientIds = teamUsersResult.rows.map((row) => row.user_id);
  if (adminUserId) {
    recipientIds.push(adminUserId);
  }

  await createNotifications(pool, recipientIds, {
    kind: "result_disputed",
    title: "Match result disputed",
    message: "Teams submitted conflicting results. Admin review is required.",
    metadata: { matchId }
  });
}

export async function createResultOverrideNotifications(
  pool: Pool,
  matchId: string,
  winnerTeamId: string
): Promise<void> {
  const recipientsResult = await pool.query<{ user_id: string }>(
    `
      SELECT DISTINCT tm.user_id
      FROM event_matches em
      INNER JOIN team_members tm
        ON tm.team_id = em.team_a_id
        OR tm.team_id = em.team_b_id
      WHERE em.id = $1
    `,
    [matchId]
  );

  await createNotifications(
    pool,
    recipientsResult.rows.map((row) => row.user_id),
    {
      kind: "result_override",
      title: "Match result overridden",
      message: "An admin finalized the match result.",
      metadata: { matchId, winnerTeamId }
    }
  );
}
