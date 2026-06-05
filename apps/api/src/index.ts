import cors from "cors";
import express from "express";
import helmet from "helmet";
import { SERVICE_NAME } from "@homieleague/shared";
import type {
  AuthSessionResponse,
  AuthSuccessResponse,
  ApiErrorResponse,
  CompleteCurrentEventRequest,
  CompleteCurrentEventResponse,
  StartCurrentEventRequest,
  StartCurrentEventResponse,
  CurrentEventResponse,
  CreateEventRequest,
  CreateTeamRequest,
  HealthResponse,
  JoinTeamRequest,
  LoginRequest,
  EventSummary,
  EventMatchSummary,
  CreateEventResponse,
  RegisterCurrentEventRequest,
  RegisterEventResponse,
  ProposeMatchScheduleRequest,
  RespondMatchScheduleRequest,
  UpdateMatchStatusRequest,
  ReportMatchResultRequest,
  PlayerDashboardResponse,
  PlayerTeamSummary,
  NotificationsResponse,
  NotificationSummary,
  MarkNotificationsReadResponse,
  RemoveTeamMemberRequest,
  TeamActionSuccessResponse,
  TransferTeamAdminRequest,
  SignupRequest
} from "@homieleague/shared";
import { z } from "zod";
import { getDbPool } from "./db/client.js";
import {
  createSession,
  createUser,
  DuplicateUserError,
  findSessionUserByTokenHash,
  findUserByIdentifier,
  revokeSessionByTokenHash
} from "./db/authRepository.js";
import {
  AdminTransferRequiredError,
  AlreadyOnTeamError,
  CannotRemoveTeamAdminError,
  createTeamForUser,
  getTeamSummaryForUser,
  joinTeamByInviteCode,
  leaveCurrentTeam,
  removeTeamMember,
  NotOnTeamError,
  rotateTeamInviteCode,
  TeamAdminRequiredError,
  TeamFullError,
  TeamMemberNotFoundError,
  TeamNotFoundError,
  TeamRosterLockedError,
  transferTeamAdmin
} from "./db/teamRepository.js";
import {
  ActiveEventExistsError,
  completeCurrentEvent,
  createCurrentEvent,
  EventInsufficientTeamsError,
  EventMatchForbiddenError,
  EventMatchNotFoundError,
  EventMatchScheduleProposalNotFoundError,
  EventMatchStateError,
  EventManageForbiddenError,
  EventNotFoundError,
  EventRegistrationClosedError,
  EventStartStateError,
  EventTeamAlreadyRegisteredError,
  EventTeamNotEligibleError,
  EventTeamNotReadyError,
  proposeCurrentEventMatchSchedule,
  reportCurrentEventMatchResult,
  respondToCurrentEventMatchSchedule,
  startCurrentEvent,
  updateCurrentEventMatchStatus,
  type EventMatchRow,
  type EventRow,
  getCurrentEventForUser,
  registerCurrentTeamForCurrentEvent
} from "./db/eventRepository.js";
import {
  createMatchCreatedNotifications,
  createResultDisputedNotifications,
  createResultOverrideNotifications,
  createScheduleAcceptedNotifications,
  createScheduleProposedNotifications,
  createTeamInviteNotifications,
  listNotificationsForUser,
  markNotificationsRead,
  type NotificationRow
} from "./db/notificationRepository.js";
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword
} from "./auth/security.js";
import { loadEnvironment } from "./config/loadEnv.js";

loadEnvironment();

const app = express();
const port = Number(process.env.PORT ?? 3000);
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const sessionLifetimeHours = Number(process.env.SESSION_LIFETIME_HOURS ?? 24);
const adminEmail = requireEnv("ADMIN_EMAIL").trim().toLowerCase();
const adminUsername = requireEnv("ADMIN_USERNAME").trim();
const adminSteamId = requireEnv("ADMIN_STEAM_ID").trim();
const adminPassword = requireEnv("ADMIN_PASSWORD").trim();

const signupSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/),
    steamId: z.string().trim().regex(/^\d{17}$/),
    password: z.string().min(12).max(128)
  })
  .strict();

const loginSchema = z
  .object({
    identifier: z.string().trim().min(3).max(254),
    password: z.string().min(12).max(128)
  })
  .strict();

const createTeamSchema = z
  .object({
    name: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9 _-]+$/)
  })
  .strict();

const joinTeamSchema = z
  .object({
    inviteCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8}$/)
  })
  .strict();

const transferTeamAdminSchema = z
  .object({
    newAdminUserId: z.string().uuid()
  })
  .strict();

const removeTeamMemberSchema = z
  .object({
    memberUserId: z.string().uuid()
  })
  .strict();

const createEventSchema = z
  .object({
    title: z.string().trim().min(3).max(80),
    game: z.string().trim().min(2).max(40),
    timezone: z.string().trim().min(3).max(64),
    registrationOpensAt: z.string().datetime({ offset: true }),
    registrationClosesAt: z.string().datetime({ offset: true }),
    startsAt: z.string().datetime({ offset: true })
  })
  .strict();

const registerEventSchema = z
  .object({
    confirm: z.literal(true)
  })
  .strict();

const completeCurrentEventSchema = z
  .object({
    confirm: z.literal(true)
  })
  .strict();

const startCurrentEventSchema = z
  .object({
    confirm: z.literal(true)
  })
  .strict();

const updateMatchStatusSchema = z
  .object({
    status: z.enum(["scheduled", "in_progress"])
  })
  .strict();

const reportMatchResultSchema = z
  .object({
    winnerTeamId: z.string().uuid(),
    adminOverride: z.boolean().optional()
  })
  .strict();

const proposeMatchScheduleSchema = z
  .object({
    proposedStartAt: z.string().datetime({ offset: true })
  })
  .strict();

const respondMatchScheduleSchema = z
  .object({
    proposalId: z.string().uuid(),
    decision: z.enum(["accept", "reject"])
  })
  .strict();

const markNotificationsReadSchema = z
  .object({
    markAll: z.boolean().optional(),
    notificationIds: z.array(z.string().uuid()).min(1).optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.markAll !== true && (!value.notificationIds || value.notificationIds.length === 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide markAll=true or at least one notificationId"
      });
    }
  });

app.disable("x-powered-by");
app.use(helmet());
app.use(
  cors({
    origin: webOrigin,
    methods: ["GET", "POST"],
    credentials: true
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  const payload: HealthResponse = {
    ok: true,
    service: SERVICE_NAME,
    timestamp: new Date().toISOString()
  };

  res.status(200).json(payload);
});

app.post("/api/auth/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Invalid signup payload",
      issues: parsed.error.issues.map((issue) => issue.path.join(".") || issue.message)
    };
    res.status(400).json(payload);
    return;
  }

  const request: SignupRequest = parsed.data;

  try {
    const pool = getDbPool();
    const passwordHash = await hashPassword(request.password);
    const user = await createUser(pool, {
      email: request.email,
      username: request.username,
      steamId: request.steamId,
      passwordHash
    });

    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const expiresAt = new Date(Date.now() + sessionLifetimeHours * 60 * 60 * 1000);
    await createSession(pool, user.id, tokenHash, expiresAt);

    const payload: AuthSuccessResponse = {
      ok: true,
      message: "Account created successfully",
      user: mapAuthenticatedUser(user),
      sessionToken,
      expiresAt: expiresAt.toISOString()
    };
    res.status(201).json(payload);
  } catch (error: unknown) {
    if (error instanceof DuplicateUserError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: `${error.field} is already in use`
      };
      res.status(409).json(payload);
      return;
    }

    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to create account"
    };
    res.status(500).json(payload);
  }
});

app.post("/api/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Invalid login payload",
      issues: parsed.error.issues.map((issue) => issue.path.join(".") || issue.message)
    };
    res.status(400).json(payload);
    return;
  }

  const request: LoginRequest = parsed.data;

  try {
    const pool = getDbPool();
    const user = await findUserByIdentifier(pool, request.identifier);
    if (!user) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Invalid credentials"
      };
      res.status(401).json(payload);
      return;
    }

    const matches = await verifyPassword(request.password, user.password_hash);
    if (!matches) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Invalid credentials"
      };
      res.status(401).json(payload);
      return;
    }

    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const expiresAt = new Date(Date.now() + sessionLifetimeHours * 60 * 60 * 1000);
    await createSession(pool, user.id, tokenHash, expiresAt);

    const payload: AuthSuccessResponse = {
      ok: true,
      message: "Logged in successfully",
      user: mapAuthenticatedUser(user),
      sessionToken,
      expiresAt: expiresAt.toISOString()
    };
    res.status(200).json(payload);
  } catch {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to log in"
    };
    res.status(500).json(payload);
  }
});

app.post("/api/auth/logout", async (req, res) => {
  const token = extractBearerToken(req.header("authorization"));
  if (!token) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Missing bearer token"
    };
    res.status(401).json(payload);
    return;
  }

  try {
    const pool = getDbPool();
    const tokenHash = hashSessionToken(token);
    await revokeSessionByTokenHash(pool, tokenHash);

    res.status(200).json({
      ok: true,
      message: "Logged out"
    });
  } catch {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to log out"
    };
    res.status(500).json(payload);
  }
});

app.get("/api/auth/me", async (req, res) => {
  const token = extractBearerToken(req.header("authorization"));
  if (!token) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Missing bearer token"
    };
    res.status(401).json(payload);
    return;
  }

  try {
    const pool = getDbPool();
    const tokenHash = hashSessionToken(token);
    const sessionUser = await findSessionUserByTokenHash(pool, tokenHash);

    if (!sessionUser) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Invalid or expired session"
      };
      res.status(401).json(payload);
      return;
    }

    const payload: AuthSessionResponse = {
      ok: true,
      message: "Session is valid",
      user: mapAuthenticatedUser(sessionUser)
    };
    res.status(200).json(payload);
  } catch {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to validate session"
    };
    res.status(500).json(payload);
  }
});

app.get("/api/player/dashboard", async (req, res) => {
  try {
    const pool = getDbPool();
    const sessionUser = await requireSessionUser(req.header("authorization"));

    if (!sessionUser) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Invalid or expired session"
      };
      res.status(401).json(payload);
      return;
    }

    const teamSummary = await getTeamSummaryForUser(pool, sessionUser.user_id);
    const payload: PlayerDashboardResponse = {
      ok: true,
      message: "Dashboard loaded",
      user: mapAuthenticatedUser(sessionUser),
      team: mapTeamSummary(teamSummary)
    };

    res.status(200).json(payload);
  } catch {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to load dashboard"
    };
    res.status(500).json(payload);
  }
});

app.post("/api/player/team", async (req, res) => {
  const parsed = createTeamSchema.safeParse(req.body);
  if (!parsed.success) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Invalid team creation payload",
      issues: parsed.error.issues.map((issue) => issue.path.join(".") || issue.message)
    };
    res.status(400).json(payload);
    return;
  }

  try {
    const sessionUser = await requireSessionUser(req.header("authorization"));
    if (!sessionUser) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Invalid or expired session"
      };
      res.status(401).json(payload);
      return;
    }

    const request: CreateTeamRequest = parsed.data;
    const pool = getDbPool();
    const teamSummary = await createTeamForUser(pool, sessionUser.user_id, request.name);
    const team = requireTeamSummary(teamSummary);

    res.status(201).json({
      ok: true,
      message: "Team created",
      team
    });
  } catch (error: unknown) {
    if (error instanceof AlreadyOnTeamError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "You are already on a team"
      };
      res.status(409).json(payload);
      return;
    }

    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to create team"
    };
    res.status(500).json(payload);
  }
});

app.post("/api/player/team/join", async (req, res) => {
  const parsed = joinTeamSchema.safeParse(req.body);
  if (!parsed.success) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Invalid team join payload",
      issues: parsed.error.issues.map((issue) => issue.path.join(".") || issue.message)
    };
    res.status(400).json(payload);
    return;
  }

  try {
    const sessionUser = await requireSessionUser(req.header("authorization"));
    if (!sessionUser) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Invalid or expired session"
      };
      res.status(401).json(payload);
      return;
    }

    const request: JoinTeamRequest = parsed.data;
    const pool = getDbPool();
    const teamSummary = await joinTeamByInviteCode(pool, sessionUser.user_id, request.inviteCode);
    const team = requireTeamSummary(teamSummary);
    await createTeamInviteNotifications(
      pool,
      team.id,
      sessionUser.user_id,
      sessionUser.username,
      team.name
    );

    res.status(200).json({
      ok: true,
      message: "Joined team",
      team
    });
  } catch (error: unknown) {
    if (error instanceof TeamNotFoundError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Invite code not found"
      };
      res.status(404).json(payload);
      return;
    }

    if (error instanceof TeamFullError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Team is full"
      };
      res.status(409).json(payload);
      return;
    }

    if (error instanceof TeamRosterLockedError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Team roster is locked for the active event"
      };
      res.status(409).json(payload);
      return;
    }

    if (error instanceof AlreadyOnTeamError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "You are already on a team"
      };
      res.status(409).json(payload);
      return;
    }

    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to join team"
    };
    res.status(500).json(payload);
  }
});

app.post("/api/player/team/invite/rotate", async (req, res) => {
  try {
    const sessionUser = await requireSessionUser(req.header("authorization"));
    if (!sessionUser) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Invalid or expired session"
      };
      res.status(401).json(payload);
      return;
    }

    const pool = getDbPool();
    const teamSummary = await rotateTeamInviteCode(pool, sessionUser.user_id);
    const team = requireTeamSummary(teamSummary);

    const payload: TeamActionSuccessResponse = {
      ok: true,
      message: "Invite code rotated",
      team
    };
    res.status(200).json(payload);
  } catch (error: unknown) {
    if (error instanceof TeamAdminRequiredError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Admin privileges required"
      };
      res.status(403).json(payload);
      return;
    }

    if (error instanceof NotOnTeamError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "You are not on a team"
      };
      res.status(404).json(payload);
      return;
    }

    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to rotate invite code"
    };
    res.status(500).json(payload);
  }
});

app.post("/api/player/team/admin/transfer", async (req, res) => {
  const parsed = transferTeamAdminSchema.safeParse(req.body);
  if (!parsed.success) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Invalid admin transfer payload",
      issues: parsed.error.issues.map((issue) => issue.path.join(".") || issue.message)
    };
    res.status(400).json(payload);
    return;
  }

  try {
    const sessionUser = await requireSessionUser(req.header("authorization"));
    if (!sessionUser) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Invalid or expired session"
      };
      res.status(401).json(payload);
      return;
    }

    const request: TransferTeamAdminRequest = parsed.data;
    const pool = getDbPool();
    const teamSummary = await transferTeamAdmin(pool, sessionUser.user_id, request.newAdminUserId);
    const team = requireTeamSummary(teamSummary);

    const payload: TeamActionSuccessResponse = {
      ok: true,
      message: "Admin transferred",
      team
    };
    res.status(200).json(payload);
  } catch (error: unknown) {
    if (error instanceof TeamAdminRequiredError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Admin privileges required"
      };
      res.status(403).json(payload);
      return;
    }

    if (error instanceof TeamMemberNotFoundError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Target team member not found"
      };
      res.status(404).json(payload);
      return;
    }

    if (error instanceof TeamRosterLockedError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Team roster is locked for the active event"
      };
      res.status(409).json(payload);
      return;
    }

    if (error instanceof NotOnTeamError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "You are not on a team"
      };
      res.status(404).json(payload);
      return;
    }

    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to transfer admin"
    };
    res.status(500).json(payload);
  }
});

app.post("/api/player/team/members/remove", async (req, res) => {
  const parsed = removeTeamMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Invalid member removal payload",
      issues: parsed.error.issues.map((issue) => issue.path.join(".") || issue.message)
    };
    res.status(400).json(payload);
    return;
  }

  try {
    const sessionUser = await requireSessionUser(req.header("authorization"));
    if (!sessionUser) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Invalid or expired session"
      };
      res.status(401).json(payload);
      return;
    }

    const request: RemoveTeamMemberRequest = parsed.data;
    const pool = getDbPool();
    const teamSummary = await removeTeamMember(pool, sessionUser.user_id, request.memberUserId);
    const team = requireTeamSummary(teamSummary);

    const payload: TeamActionSuccessResponse = {
      ok: true,
      message: "Team member removed",
      team
    };
    res.status(200).json(payload);
  } catch (error: unknown) {
    if (error instanceof TeamAdminRequiredError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Admin privileges required"
      };
      res.status(403).json(payload);
      return;
    }

    if (error instanceof CannotRemoveTeamAdminError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Cannot remove the team admin"
      };
      res.status(409).json(payload);
      return;
    }

    if (error instanceof TeamMemberNotFoundError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Target team member not found"
      };
      res.status(404).json(payload);
      return;
    }

    if (error instanceof TeamRosterLockedError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Team roster is locked for the active event"
      };
      res.status(409).json(payload);
      return;
    }

    if (error instanceof NotOnTeamError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "You are not on a team"
      };
      res.status(404).json(payload);
      return;
    }

    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to remove team member"
    };
    res.status(500).json(payload);
  }
});

app.post("/api/player/team/leave", async (req, res) => {
  try {
    const sessionUser = await requireSessionUser(req.header("authorization"));
    if (!sessionUser) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Invalid or expired session"
      };
      res.status(401).json(payload);
      return;
    }

    const pool = getDbPool();
    await leaveCurrentTeam(pool, sessionUser.user_id);

    res.status(200).json({
      ok: true,
      message: "Left team"
    });
  } catch (error: unknown) {
    if (error instanceof AdminTransferRequiredError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Team admin must transfer ownership before leaving"
      };
      res.status(409).json(payload);
      return;
    }

    if (error instanceof NotOnTeamError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "You are not on a team"
      };
      res.status(404).json(payload);
      return;
    }

    if (error instanceof TeamRosterLockedError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Team roster is locked for the active event"
      };
      res.status(409).json(payload);
      return;
    }

    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to leave team"
    };
    res.status(500).json(payload);
  }
});

app.get("/api/events", async (req, res) => {
  try {
    const sessionUser = await requireSessionUser(req.header("authorization"));
    if (!sessionUser) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Invalid or expired session"
      };
      res.status(401).json(payload);
      return;
    }

    const pool = getDbPool();
    const result = await getCurrentEventForUser(pool, sessionUser.user_id, sessionUser.isAdmin);
    const payload: CurrentEventResponse = {
      ok: true,
      message: "Current event loaded",
      team: mapTeamSummary(result.team),
      currentEvent: result.currentEvent ? mapEventRow(result.currentEvent) : null,
      matches: result.matches.map(mapEventMatchRow)
    };

    res.status(200).json(payload);
  } catch {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to load events"
    };
    res.status(500).json(payload);
  }
});

app.post("/api/events", async (req, res) => {
  const parsed = createEventSchema.safeParse(req.body);
  if (!parsed.success) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Invalid event payload",
      issues: parsed.error.issues.map((issue) => issue.path.join(".") || issue.message)
    };
    res.status(400).json(payload);
    return;
  }

  const request: CreateEventRequest = parsed.data;
  if (new Date(request.registrationOpensAt) >= new Date(request.registrationClosesAt) || new Date(request.registrationClosesAt) >= new Date(request.startsAt)) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Event dates must be in chronological order"
    };
    res.status(400).json(payload);
    return;
  }

  try {
    const adminGuard = await requireAdminSessionUser(req.header("authorization"));
    if (!adminGuard.ok) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: adminGuard.message
      };
      res.status(adminGuard.status).json(payload);
      return;
    }

    const pool = getDbPool();
    const createdEvent = await createCurrentEvent(pool, request, adminGuard.sessionUser.user_id);
    const payload: CreateEventResponse = {
      ok: true,
      message: "Current event created",
      event: mapEventRow(createdEvent)
    };

    res.status(201).json(payload);
  } catch (error: unknown) {
    if (error instanceof ActiveEventExistsError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "A current event already exists. Complete it before creating another."
      };
      res.status(409).json(payload);
      return;
    }

    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to create event"
    };
    res.status(500).json(payload);
  }
});

app.post("/api/events/register", async (req, res) => {
  const parsed = registerEventSchema.safeParse(req.body);
  if (!parsed.success) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Invalid event registration payload",
      issues: parsed.error.issues.map((issue) => issue.path.join(".") || issue.message)
    };
    res.status(400).json(payload);
    return;
  }

  try {
    const sessionUser = await requireSessionUser(req.header("authorization"));
    if (!sessionUser) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Invalid or expired session"
      };
      res.status(401).json(payload);
      return;
    }

    const request: RegisterCurrentEventRequest = parsed.data;
    if (!request.confirm) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Registration confirmation is required"
      };
      res.status(400).json(payload);
      return;
    }

    const pool = getDbPool();
    const updatedEvent = await registerCurrentTeamForCurrentEvent(
      pool,
      sessionUser.user_id,
      sessionUser.isAdmin
    );
    const payload: RegisterEventResponse = {
      ok: true,
      message: "Team registered for current event",
      event: mapEventRow(updatedEvent)
    };

    res.status(200).json(payload);
  } catch (error: unknown) {
    if (error instanceof EventNotFoundError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Event not found"
      };
      res.status(404).json(payload);
      return;
    }

    if (error instanceof EventRegistrationClosedError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Event registration is closed"
      };
      res.status(409).json(payload);
      return;
    }

    if (error instanceof EventTeamNotReadyError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Your team must have five members before registering"
      };
      res.status(409).json(payload);
      return;
    }

    if (error instanceof EventTeamNotEligibleError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: error.message
      };
      res.status(403).json(payload);
      return;
    }

    if (error instanceof EventTeamAlreadyRegisteredError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Your team is already registered"
      };
      res.status(409).json(payload);
      return;
    }

    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to register team for event"
    };
    res.status(500).json(payload);
  }
});

app.post("/api/events/current/start", async (req, res) => {
  const parsed = startCurrentEventSchema.safeParse(req.body);
  if (!parsed.success) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Invalid current event start payload",
      issues: parsed.error.issues.map((issue) => issue.path.join(".") || issue.message)
    };
    res.status(400).json(payload);
    return;
  }

  try {
    const adminGuard = await requireAdminSessionUser(req.header("authorization"));
    if (!adminGuard.ok) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: adminGuard.message
      };
      res.status(adminGuard.status).json(payload);
      return;
    }

    const request: StartCurrentEventRequest = parsed.data;
    if (!request.confirm) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Start confirmation is required"
      };
      res.status(400).json(payload);
      return;
    }

    const pool = getDbPool();
    const result = await startCurrentEvent(pool, adminGuard.sessionUser.isAdmin);
    const refreshed = await getCurrentEventForUser(
      pool,
      adminGuard.sessionUser.user_id,
      adminGuard.sessionUser.isAdmin
    );

    const payload: StartCurrentEventResponse = {
      ok: true,
      message: `Current event started. ${result.createdMatches} first-round match${result.createdMatches === 1 ? "" : "es"} created.`,
      currentEvent: refreshed.currentEvent ? mapEventRow(refreshed.currentEvent) : null,
      createdMatches: result.createdMatches,
      matches: refreshed.matches.map(mapEventMatchRow)
    };
    if (refreshed.currentEvent) {
      await createMatchCreatedNotifications(pool, refreshed.currentEvent.id, refreshed.currentEvent.title);
    }
    res.status(200).json(payload);
  } catch (error: unknown) {
    if (error instanceof EventNotFoundError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "No active event to start"
      };
      res.status(404).json(payload);
      return;
    }

    if (error instanceof EventStartStateError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Current event has already started or cannot be started"
      };
      res.status(409).json(payload);
      return;
    }

    if (error instanceof EventInsufficientTeamsError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "At least two registered teams are required before starting"
      };
      res.status(409).json(payload);
      return;
    }

    if (error instanceof EventManageForbiddenError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Only the admin account can start the current event"
      };
      res.status(403).json(payload);
      return;
    }

    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to start current event"
    };
    res.status(500).json(payload);
  }
});

app.post("/api/events/matches/:matchId/schedule/propose", async (req, res) => {
  const parsed = proposeMatchScheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Invalid schedule proposal payload",
      issues: parsed.error.issues.map((issue) => issue.path.join(".") || issue.message)
    };
    res.status(400).json(payload);
    return;
  }

  const matchIdResult = z.string().uuid().safeParse(req.params.matchId);
  if (!matchIdResult.success) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Invalid match id"
    };
    res.status(400).json(payload);
    return;
  }

  try {
    const sessionUser = await requireSessionUser(req.header("authorization"));
    if (!sessionUser) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Invalid or expired session"
      };
      res.status(401).json(payload);
      return;
    }

    const request: ProposeMatchScheduleRequest = parsed.data;
    const pool = getDbPool();
    await proposeCurrentEventMatchSchedule(
      pool,
      matchIdResult.data,
      request.proposedStartAt,
      sessionUser.user_id
    );
    const postProposalEvent = await getCurrentEventForUser(pool, sessionUser.user_id, sessionUser.isAdmin);
    const proposedMatch = postProposalEvent.matches.find((match) => match.id === matchIdResult.data);
    if (
      proposedMatch?.latest_schedule_proposal_proposed_by_team_id &&
      proposedMatch.latest_schedule_proposal_proposed_start_at
    ) {
      await createScheduleProposedNotifications(
        pool,
        matchIdResult.data,
        proposedMatch.latest_schedule_proposal_proposed_by_team_id,
        proposedMatch.latest_schedule_proposal_proposed_start_at
      );
    }

    const refreshed = await getCurrentEventForUser(pool, sessionUser.user_id, sessionUser.isAdmin);
    const payload: CurrentEventResponse = {
      ok: true,
      message: "Schedule proposal submitted",
      team: mapTeamSummary(refreshed.team),
      currentEvent: refreshed.currentEvent ? mapEventRow(refreshed.currentEvent) : null,
      matches: refreshed.matches.map(mapEventMatchRow)
    };
    res.status(200).json(payload);
  } catch (error: unknown) {
    if (error instanceof EventMatchNotFoundError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Match not found"
      };
      res.status(404).json(payload);
      return;
    }

    if (error instanceof EventMatchForbiddenError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Only participating team admins can propose schedules"
      };
      res.status(403).json(payload);
      return;
    }

    if (error instanceof EventMatchStateError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: error.message
      };
      res.status(409).json(payload);
      return;
    }

    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to submit schedule proposal"
    };
    res.status(500).json(payload);
  }
});

app.post("/api/events/matches/:matchId/schedule/respond", async (req, res) => {
  const parsed = respondMatchScheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Invalid schedule response payload",
      issues: parsed.error.issues.map((issue) => issue.path.join(".") || issue.message)
    };
    res.status(400).json(payload);
    return;
  }

  const matchIdResult = z.string().uuid().safeParse(req.params.matchId);
  if (!matchIdResult.success) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Invalid match id"
    };
    res.status(400).json(payload);
    return;
  }

  try {
    const sessionUser = await requireSessionUser(req.header("authorization"));
    if (!sessionUser) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Invalid or expired session"
      };
      res.status(401).json(payload);
      return;
    }

    const request: RespondMatchScheduleRequest = parsed.data;
    const pool = getDbPool();
    await respondToCurrentEventMatchSchedule(
      pool,
      matchIdResult.data,
      request.proposalId,
      request.decision,
      sessionUser.user_id
    );
    if (request.decision === "accept") {
      const postResponseEvent = await getCurrentEventForUser(pool, sessionUser.user_id, sessionUser.isAdmin);
      const acceptedMatch = postResponseEvent.matches.find((match) => match.id === matchIdResult.data);
      if (
        acceptedMatch?.latest_schedule_proposal_proposed_by_team_id &&
        acceptedMatch.latest_schedule_proposal_proposed_start_at
      ) {
        await createScheduleAcceptedNotifications(
          pool,
          matchIdResult.data,
          acceptedMatch.latest_schedule_proposal_proposed_by_team_id,
          acceptedMatch.latest_schedule_proposal_proposed_start_at
        );
      }
    }

    const refreshed = await getCurrentEventForUser(pool, sessionUser.user_id, sessionUser.isAdmin);
    const payload: CurrentEventResponse = {
      ok: true,
      message: request.decision === "accept" ? "Schedule accepted" : "Schedule rejected",
      team: mapTeamSummary(refreshed.team),
      currentEvent: refreshed.currentEvent ? mapEventRow(refreshed.currentEvent) : null,
      matches: refreshed.matches.map(mapEventMatchRow)
    };
    res.status(200).json(payload);
  } catch (error: unknown) {
    if (error instanceof EventMatchNotFoundError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Match not found"
      };
      res.status(404).json(payload);
      return;
    }

    if (error instanceof EventMatchScheduleProposalNotFoundError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Schedule proposal not found or already resolved"
      };
      res.status(404).json(payload);
      return;
    }

    if (error instanceof EventMatchForbiddenError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Only the opposing participating team admin can respond"
      };
      res.status(403).json(payload);
      return;
    }

    if (error instanceof EventMatchStateError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: error.message
      };
      res.status(409).json(payload);
      return;
    }

    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to respond to schedule proposal"
    };
    res.status(500).json(payload);
  }
});

app.post("/api/events/matches/:matchId/status", async (req, res) => {
  const parsed = updateMatchStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Invalid match status payload",
      issues: parsed.error.issues.map((issue) => issue.path.join(".") || issue.message)
    };
    res.status(400).json(payload);
    return;
  }

  const matchIdResult = z.string().uuid().safeParse(req.params.matchId);
  if (!matchIdResult.success) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Invalid match id"
    };
    res.status(400).json(payload);
    return;
  }

  try {
    const adminGuard = await requireAdminSessionUser(req.header("authorization"));
    if (!adminGuard.ok) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: adminGuard.message
      };
      res.status(adminGuard.status).json(payload);
      return;
    }

    const request: UpdateMatchStatusRequest = parsed.data;
    const pool = getDbPool();
    await updateCurrentEventMatchStatus(
      pool,
      matchIdResult.data,
      request.status,
      adminGuard.sessionUser.isAdmin
    );

    const refreshed = await getCurrentEventForUser(
      pool,
      adminGuard.sessionUser.user_id,
      adminGuard.sessionUser.isAdmin
    );

    const payload: CurrentEventResponse = {
      ok: true,
      message: `Match moved to ${request.status}`,
      team: mapTeamSummary(refreshed.team),
      currentEvent: refreshed.currentEvent ? mapEventRow(refreshed.currentEvent) : null,
      matches: refreshed.matches.map(mapEventMatchRow)
    };
    res.status(200).json(payload);
  } catch (error: unknown) {
    if (error instanceof EventMatchNotFoundError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Match not found"
      };
      res.status(404).json(payload);
      return;
    }

    if (error instanceof EventMatchForbiddenError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Only the admin account can manage match lifecycle"
      };
      res.status(403).json(payload);
      return;
    }

    if (error instanceof EventMatchStateError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Invalid match state transition"
      };
      res.status(409).json(payload);
      return;
    }

    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to update match status"
    };
    res.status(500).json(payload);
  }
});

app.post("/api/events/matches/:matchId/result", async (req, res) => {
  const parsed = reportMatchResultSchema.safeParse(req.body);
  if (!parsed.success) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Invalid match result payload",
      issues: parsed.error.issues.map((issue) => issue.path.join(".") || issue.message)
    };
    res.status(400).json(payload);
    return;
  }

  const matchIdResult = z.string().uuid().safeParse(req.params.matchId);
  if (!matchIdResult.success) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Invalid match id"
    };
    res.status(400).json(payload);
    return;
  }

  try {
    const sessionUser = await requireSessionUser(req.header("authorization"));
    if (!sessionUser) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Invalid or expired session"
      };
      res.status(401).json(payload);
      return;
    }

    const request = parsed.data;
    const pool = getDbPool();
    const outcome = await reportCurrentEventMatchResult(
      pool,
      matchIdResult.data,
      request.winnerTeamId,
      sessionUser.user_id,
      sessionUser.isAdmin,
      request.adminOverride === true
    );

    if (outcome.conflict) {
      const adminUser = await findUserByIdentifier(pool, adminEmail);
      await createResultDisputedNotifications(pool, matchIdResult.data, adminUser?.id ?? null);
    }

    if (request.adminOverride === true) {
      await createResultOverrideNotifications(pool, matchIdResult.data, request.winnerTeamId);
    }

    const refreshed = await getCurrentEventForUser(pool, sessionUser.user_id, sessionUser.isAdmin);
    const message = outcome.finalized
      ? "Match result finalized"
      : outcome.conflict
        ? "Conflicting reports submitted. Admin override required to finalize."
        : "Result submitted. Waiting for opponent confirmation.";

    const payload: CurrentEventResponse = {
      ok: true,
      message,
      team: mapTeamSummary(refreshed.team),
      currentEvent: refreshed.currentEvent ? mapEventRow(refreshed.currentEvent) : null,
      matches: refreshed.matches.map(mapEventMatchRow)
    };
    res.status(200).json(payload);
  } catch (error: unknown) {
    if (error instanceof EventMatchNotFoundError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Match not found"
      };
      res.status(404).json(payload);
      return;
    }

    if (error instanceof EventMatchForbiddenError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "You are not allowed to report this match result"
      };
      res.status(403).json(payload);
      return;
    }

    if (error instanceof EventMatchStateError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: error.message
      };
      res.status(409).json(payload);
      return;
    }

    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to report match result"
    };
    res.status(500).json(payload);
  }
});

app.post("/api/events/current/complete", async (req, res) => {
  const parsed = completeCurrentEventSchema.safeParse(req.body);
  if (!parsed.success) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Invalid current event completion payload",
      issues: parsed.error.issues.map((issue) => issue.path.join(".") || issue.message)
    };
    res.status(400).json(payload);
    return;
  }

  try {
    const adminGuard = await requireAdminSessionUser(req.header("authorization"));
    if (!adminGuard.ok) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: adminGuard.message
      };
      res.status(adminGuard.status).json(payload);
      return;
    }

    const request: CompleteCurrentEventRequest = parsed.data;
    if (!request.confirm) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Completion confirmation is required"
      };
      res.status(400).json(payload);
      return;
    }

    const pool = getDbPool();
    await completeCurrentEvent(pool, adminGuard.sessionUser.isAdmin);
    const refreshed = await getCurrentEventForUser(
      pool,
      adminGuard.sessionUser.user_id,
      adminGuard.sessionUser.isAdmin
    );

    const payload: CompleteCurrentEventResponse = {
      ok: true,
      message: "Current event completed",
      currentEvent: refreshed.currentEvent ? mapEventRow(refreshed.currentEvent) : null,
      matches: refreshed.matches.map(mapEventMatchRow)
    };
    res.status(200).json(payload);
  } catch (error: unknown) {
    if (error instanceof EventNotFoundError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "No active event to complete"
      };
      res.status(404).json(payload);
      return;
    }

    if (error instanceof EventManageForbiddenError) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Only the admin account can complete the current event"
      };
      res.status(403).json(payload);
      return;
    }

    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to complete current event"
    };
    res.status(500).json(payload);
  }
});

app.get("/api/notifications", async (req, res) => {
  try {
    const sessionUser = await requireSessionUser(req.header("authorization"));
    if (!sessionUser) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Invalid or expired session"
      };
      res.status(401).json(payload);
      return;
    }

    const pool = getDbPool();
    const result = await listNotificationsForUser(pool, sessionUser.user_id);
    const payload: NotificationsResponse = {
      ok: true,
      message: "Notifications loaded",
      notifications: result.notifications.map(mapNotificationRow),
      unreadCount: result.unreadCount
    };

    res.status(200).json(payload);
  } catch {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to load notifications"
    };
    res.status(500).json(payload);
  }
});

app.post("/api/notifications/read", async (req, res) => {
  const parsed = markNotificationsReadSchema.safeParse(req.body);
  if (!parsed.success) {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Invalid mark notifications payload",
      issues: parsed.error.issues.map((issue) => issue.path.join(".") || issue.message)
    };
    res.status(400).json(payload);
    return;
  }

  try {
    const sessionUser = await requireSessionUser(req.header("authorization"));
    if (!sessionUser) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Invalid or expired session"
      };
      res.status(401).json(payload);
      return;
    }

    const request = parsed.data;
    const pool = getDbPool();
    const unreadCount = await markNotificationsRead(pool, sessionUser.user_id, {
      markAll: request.markAll === true,
      notificationIds: request.notificationIds ?? []
    });

    const payload: MarkNotificationsReadResponse = {
      ok: true,
      message: "Notifications updated",
      unreadCount
    };

    res.status(200).json(payload);
  } catch {
    const payload: ApiErrorResponse = {
      ok: false,
      message: "Unable to update notifications"
    };
    res.status(500).json(payload);
  }
});

app.use((_req, res) => {
  const payload: ApiErrorResponse = {
    ok: false,
    message: "Route not found"
  };
  res.status(404).json(payload);
});

void startServer();

function extractBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) {
    return null;
  }

  const [scheme, token] = headerValue.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

async function requireSessionUser(
  authorizationHeader: string | undefined
): Promise<
  (NonNullable<Awaited<ReturnType<typeof findSessionUserByTokenHash>>> & { isAdmin: boolean }) | null
> {
  const token = extractBearerToken(authorizationHeader);
  if (!token) {
    return null;
  }

  const pool = getDbPool();
  const tokenHash = hashSessionToken(token);
  const sessionUser = await findSessionUserByTokenHash(pool, tokenHash);
  if (!sessionUser) {
    return null;
  }

  return {
    ...sessionUser,
    isAdmin: isAdminIdentity(sessionUser.email)
  };
}

type AdminSessionGuardResult =
  | { ok: true; sessionUser: NonNullable<Awaited<ReturnType<typeof requireSessionUser>>> }
  | { ok: false; status: 401 | 403; message: string };

async function requireAdminSessionUser(
  authorizationHeader: string | undefined
): Promise<AdminSessionGuardResult> {
  const sessionUser = await requireSessionUser(authorizationHeader);
  if (!sessionUser) {
    return {
      ok: false,
      status: 401,
      message: "Invalid or expired session"
    };
  }

  if (!sessionUser.isAdmin) {
    return {
      ok: false,
      status: 403,
      message: "Only the admin account can manage events"
    };
  }

  return {
    ok: true,
    sessionUser
  };
}

function mapTeamSummary(
  summary: {
    id: string;
    name: string;
    invite_code: string;
    member_count: number;
    your_role: "admin" | "member";
    members: Array<{
      user_id: string;
      username: string;
      steam_id: string;
      role: "admin" | "member";
      joined_at: string;
    }>;
  } | null
): PlayerTeamSummary | null {
  if (!summary) {
    return null;
  }

  return {
    id: summary.id,
    name: summary.name,
    inviteCode: summary.your_role === "admin" ? summary.invite_code : null,
    memberCount: summary.member_count,
    maxMembers: 5,
    yourRole: summary.your_role,
    members: summary.members.map((member) => ({
      userId: member.user_id,
      username: member.username,
      steamId: member.steam_id,
      role: member.role,
      joinedAt: member.joined_at
    }))
  };
}

function mapEventRow(row: EventRow): EventSummary {
  return {
    id: row.id,
    title: row.title,
    game: row.game,
    timezone: row.timezone,
    registrationOpensAt: row.registration_opens_at,
    registrationClosesAt: row.registration_closes_at,
    startsAt: row.starts_at,
    status: row.status,
    registrationCount: row.registration_count,
    isRegisteredForYourTeam: row.is_registered_for_your_team,
    canRegisterYourTeam: row.can_register_your_team,
    canManageCurrentEvent: row.can_manage_current_event,
    canStartCurrentEvent: row.can_start_current_event
  };
}

function mapEventMatchRow(row: EventMatchRow): EventMatchSummary {
  return {
    id: row.id,
    roundNumber: row.round_number,
    slotNumber: row.slot_number,
    status: row.status,
    teamAId: row.team_a_id,
    teamAName: row.team_a_name,
    teamBId: row.team_b_id,
    teamBName: row.team_b_name,
    scheduledStartAt: row.scheduled_start_at,
    winnerTeamId: row.winner_team_id,
    canManageLifecycle: row.can_manage_lifecycle,
    canTransitionToScheduled: row.can_transition_to_scheduled,
    canTransitionToInProgress: row.can_transition_to_in_progress,
    canProposeSchedule: row.can_propose_schedule,
    canRespondToScheduleProposal: row.can_respond_to_schedule_proposal,
    canReportResult: row.can_report_result,
    yourReportedWinnerTeamId: row.your_reported_winner_team_id,
    isAwaitingOpponentConfirmation: row.is_awaiting_opponent_confirmation,
    hasResultConflict: row.has_result_conflict,
    latestScheduleProposal:
      row.latest_schedule_proposal_id &&
      row.latest_schedule_proposal_proposed_by_team_id &&
      row.latest_schedule_proposal_proposed_start_at &&
      row.latest_schedule_proposal_status
        ? {
            id: row.latest_schedule_proposal_id,
            proposedByTeamId: row.latest_schedule_proposal_proposed_by_team_id,
            proposedByTeamName: row.latest_schedule_proposal_proposed_by_team_name,
            proposedStartAt: row.latest_schedule_proposal_proposed_start_at,
            status: row.latest_schedule_proposal_status,
            respondedByTeamId: row.latest_schedule_proposal_responded_by_team_id
          }
        : null
  };
}

function mapNotificationRow(row: NotificationRow): NotificationSummary {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    message: row.message,
    metadata: row.metadata,
    readAt: row.read_at,
    createdAt: row.created_at
  };
}

function requireTeamSummary(
  summary: Parameters<typeof mapTeamSummary>[0]
): PlayerTeamSummary {
  const mapped = mapTeamSummary(summary);
  if (!mapped) {
    throw new Error("Team summary missing from mutation result");
  }

  return mapped;
}

function mapAuthenticatedUser(user: {
  id?: string;
  user_id?: string;
  email: string;
  username: string;
  steam_id: string;
}): AuthSessionResponse["user"] {
  const id = user.id ?? user.user_id;
  if (!id) {
    throw new Error("User id missing");
  }

  return {
    id,
    email: user.email,
    username: user.username,
    steamId: user.steam_id,
    isAdmin: isAdminIdentity(user.email)
  };
}

function isAdminIdentity(email: string): boolean {
  return email.trim().toLowerCase() === adminEmail;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function ensureAdminAccount(): Promise<void> {
  const pool = getDbPool();
  const existingAdmin = await findUserByIdentifier(pool, adminEmail);
  if (existingAdmin) {
    return;
  }

  const passwordHash = await hashPassword(adminPassword);
  try {
    await createUser(pool, {
      email: adminEmail,
      username: adminUsername,
      steamId: adminSteamId,
      passwordHash
    });

    console.log(`Admin account created for ${adminEmail}`);
  } catch (error: unknown) {
    if (error instanceof DuplicateUserError) {
      const recheck = await findUserByIdentifier(pool, adminEmail);
      if (recheck) {
        return;
      }
      throw new Error(
        "Admin account bootstrap failed due to conflicting username. Update ADMIN_USERNAME and restart."
      );
    }
    throw error;
  }
}

async function startServer(): Promise<void> {
  try {
    await ensureAdminAccount();
  } catch (error) {
    console.warn("Unable to ensure admin account at startup", error);
  }

  app.listen(port, () => {
    console.log(`API listening on port ${port}`);
  });
}
