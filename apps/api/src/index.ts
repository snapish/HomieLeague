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
  CurrentEventResponse,
  CreateEventRequest,
  CreateTeamRequest,
  HealthResponse,
  JoinTeamRequest,
  LoginRequest,
  EventSummary,
  CreateEventResponse,
  RegisterCurrentEventRequest,
  RegisterEventResponse,
  PlayerDashboardResponse,
  PlayerTeamSummary,
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
  transferTeamAdmin
} from "./db/teamRepository.js";
import {
  ActiveEventExistsError,
  completeCurrentEvent,
  createCurrentEvent,
  EventManageForbiddenError,
  EventNotFoundError,
  EventRegistrationClosedError,
  EventTeamAlreadyRegisteredError,
  EventTeamNotEligibleError,
  EventTeamNotReadyError,
  type EventRow,
  getCurrentEventForUser,
  registerCurrentTeamForCurrentEvent
} from "./db/eventRepository.js";
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
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        steamId: user.steam_id
      },
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
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        steamId: user.steam_id
      },
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
      user: {
        id: sessionUser.user_id,
        email: sessionUser.email,
        username: sessionUser.username,
        steamId: sessionUser.steam_id
      }
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
      user: {
        id: sessionUser.user_id,
        email: sessionUser.email,
        username: sessionUser.username,
        steamId: sessionUser.steam_id
      },
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
    const result = await getCurrentEventForUser(pool, sessionUser.user_id);
    const payload: CurrentEventResponse = {
      ok: true,
      message: "Current event loaded",
      team: mapTeamSummary(result.team),
      currentEvent: result.currentEvent ? mapEventRow(result.currentEvent) : null
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
    const createdEvent = await createCurrentEvent(pool, request, sessionUser.user_id);
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
    const updatedEvent = await registerCurrentTeamForCurrentEvent(pool, sessionUser.user_id);
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
    const sessionUser = await requireSessionUser(req.header("authorization"));
    if (!sessionUser) {
      const payload: ApiErrorResponse = {
        ok: false,
        message: "Invalid or expired session"
      };
      res.status(401).json(payload);
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
    await completeCurrentEvent(pool, sessionUser.user_id);
    const refreshed = await getCurrentEventForUser(pool, sessionUser.user_id);

    const payload: CompleteCurrentEventResponse = {
      ok: true,
      message: "Current event completed",
      currentEvent: refreshed.currentEvent ? mapEventRow(refreshed.currentEvent) : null
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
        message: "Only the event creator can complete the current event"
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

app.use((_req, res) => {
  const payload: ApiErrorResponse = {
    ok: false,
    message: "Route not found"
  };
  res.status(404).json(payload);
});

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});

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
): Promise<Awaited<ReturnType<typeof findSessionUserByTokenHash>> | null> {
  const token = extractBearerToken(authorizationHeader);
  if (!token) {
    return null;
  }

  const pool = getDbPool();
  const tokenHash = hashSessionToken(token);
  return findSessionUserByTokenHash(pool, tokenHash);
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
    canManageCurrentEvent: row.can_manage_current_event
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
