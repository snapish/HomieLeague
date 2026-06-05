import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type {
  ApiSuccessResponse,
  ApiErrorResponse,
  AuthSessionResponse,
  AuthSuccessResponse,
  AuthenticatedUser,
  CompleteCurrentEventRequest,
  CompleteCurrentEventResponse,
  StartCurrentEventRequest,
  StartCurrentEventResponse,
  CreateEventRequest,
  CreateEventResponse,
  CurrentEventResponse,
  CreateTeamRequest,
  EventMatchSummary,
  EventSummary,
  JoinTeamRequest,
  LoginRequest,
  PlayerDashboardResponse,
  PlayerTeamSummary,
  NotificationsResponse,
  NotificationSummary,
  MarkNotificationsReadRequest,
  MarkNotificationsReadResponse,
  RegisterCurrentEventRequest,
  RegisterEventResponse,
  ProposeMatchScheduleRequest,
  RespondMatchScheduleRequest,
  ReportMatchResultRequest,
  UpdateMatchStatusRequest,
  RemoveTeamMemberRequest,
  TeamActionSuccessResponse,
  SignupRequest,
  TransferTeamAdminRequest
} from "@homieleague/shared";
import { AppShellNav } from "./components/AppShellNav";
import { AdminPanel } from "./components/AdminPanel";
import { AuthPanels } from "./components/AuthPanels";
import { EventsPanel } from "./components/EventsPanel";
import { NotificationsPanel } from "./components/NotificationsPanel";
import { PlayerDashboardOverview } from "./components/PlayerDashboardOverview";
import { SessionHero } from "./components/SessionHero";
import { navigateTo, routeFromHash } from "./lib/routes";
import type { RequestStatus, RouteKey } from "./types/ui";
import "./App.css";

type DashboardAction = "create-team" | "join-team" | "leave-team";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const SESSION_TOKEN_STORAGE_KEY = "homieleague.sessionToken";

const initialSignup: SignupRequest = {
  email: "",
  username: "",
  steamId: "",
  password: ""
};

const initialLogin: LoginRequest = {
  identifier: "",
  password: ""
};

const initialCreateTeamForm: CreateTeamRequest = {
  name: ""
};

function buildInitialEventForm(): CreateEventRequest {
  const now = Date.now();
  return {
    title: "",
    game: "Counter-Strike 2",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    registrationOpensAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    registrationClosesAt: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
    startsAt: new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString()
  };
}

function App() {
  const [signupForm, setSignupForm] = useState<SignupRequest>(initialSignup);
  const [loginForm, setLoginForm] = useState<LoginRequest>(initialLogin);
  const [signupStatus, setSignupStatus] = useState<RequestStatus>({ kind: "idle", message: "" });
  const [loginStatus, setLoginStatus] = useState<RequestStatus>({ kind: "idle", message: "" });
  const [sessionStatus, setSessionStatus] = useState<RequestStatus>({ kind: "idle", message: "" });
  const [dashboardStatus, setDashboardStatus] = useState<RequestStatus>({ kind: "idle", message: "" });
  const [activeUser, setActiveUser] = useState<AuthenticatedUser | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [playerTeam, setPlayerTeam] = useState<PlayerTeamSummary | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);
  const [isSubmittingSignup, setIsSubmittingSignup] = useState(false);
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [isJoiningTeam, setIsJoiningTeam] = useState(false);
  const [isLeavingTeam, setIsLeavingTeam] = useState(false);
  const [isRotatingInvite, setIsRotatingInvite] = useState(false);
  const [isTransferringAdmin, setIsTransferringAdmin] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [currentEvent, setCurrentEvent] = useState<EventSummary | null>(null);
  const [currentMatches, setCurrentMatches] = useState<EventMatchSummary[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);
  const [isStartingCurrentEvent, setIsStartingCurrentEvent] = useState(false);
  const [isRegisteringCurrentEvent, setIsRegisteringCurrentEvent] = useState(false);
  const [isCompletingCurrentEvent, setIsCompletingCurrentEvent] = useState(false);
  const [proposingScheduleMatchId, setProposingScheduleMatchId] = useState<string | null>(null);
  const [respondingScheduleMatchId, setRespondingScheduleMatchId] = useState<string | null>(null);
  const [updatingMatchId, setUpdatingMatchId] = useState<string | null>(null);
  const [reportingMatchId, setReportingMatchId] = useState<string | null>(null);
  const [eventsStatus, setEventsStatus] = useState<RequestStatus>({ kind: "idle", message: "" });
  const [notifications, setNotifications] = useState<NotificationSummary[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(true);
  const [isMarkingNotificationsRead, setIsMarkingNotificationsRead] = useState(false);
  const [notificationsStatus, setNotificationsStatus] = useState<RequestStatus>({ kind: "idle", message: "" });
  const [createTeamForm, setCreateTeamForm] = useState<CreateTeamRequest>(initialCreateTeamForm);
  const [joinCode, setJoinCode] = useState("");
  const [transferTargetUserId, setTransferTargetUserId] = useState("");
  const [createEventForm, setCreateEventForm] = useState<CreateEventRequest>(() => buildInitialEventForm());

  const authUrl = `${API_BASE_URL}/api/auth`;
  const playerUrl = `${API_BASE_URL}/api/player`;

  const [route, setRoute] = useState<RouteKey>(() => routeFromHash(window.location.hash));

  useEffect(() => {
    function onHashChange() {
      setRoute(routeFromHash(window.location.hash));
    }

    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  useEffect(() => {
    async function bootstrapSession() {
      const storedToken = localStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
      if (!storedToken) {
        setIsCheckingSession(false);
        return;
      }

      try {
        const response = await fetch(`${authUrl}/me`, {
          headers: { Authorization: `Bearer ${storedToken}` }
        });
        const payload = (await response.json()) as AuthSessionResponse | ApiErrorResponse;

        if (!response.ok || !payload.ok) {
          clearSessionState();
          setSessionStatus({ kind: "error", message: "Saved session expired. Please log in again." });
          return;
        }

        setSessionToken(storedToken);
        setActiveUser(payload.user);
        setSessionStatus({ kind: "success", message: "Session restored." });
      } catch {
        clearSessionState();
        setSessionStatus({ kind: "error", message: "Could not validate saved session." });
      } finally {
        setIsCheckingSession(false);
      }
    }

    void bootstrapSession();
  }, [authUrl]);

  useEffect(() => {
    if (isCheckingSession) {
      return;
    }

    if (!activeUser && route !== "auth") {
      navigateTo("auth");
      return;
    }

    if (activeUser && route === "auth") {
      navigateTo("app-overview");
      return;
    }

    if (activeUser && route === "app-admin" && !activeUser.isAdmin) {
      navigateTo("app-overview");
    }
  }, [activeUser, isCheckingSession, route]);

  useEffect(() => {
    if (isCheckingSession || !sessionToken) {
      return;
    }

    void loadDashboard();
  }, [isCheckingSession, sessionToken]);

  useEffect(() => {
    if (isCheckingSession || !sessionToken) {
      return;
    }

    void loadEvents();
  }, [isCheckingSession, sessionToken]);

  useEffect(() => {
    if (isCheckingSession || !sessionToken) {
      return;
    }

    void loadNotifications();
  }, [isCheckingSession, sessionToken]);

  async function loadDashboard() {
    if (!sessionToken) {
      setIsLoadingDashboard(false);
      return;
    }

    setIsLoadingDashboard(true);

    try {
      const response = await fetch(`${playerUrl}/dashboard`, {
        headers: {
          Authorization: `Bearer ${sessionToken}`
        }
      });

      const payload = (await response.json()) as PlayerDashboardResponse | ApiErrorResponse;
      if (!response.ok || !payload.ok) {
        if (response.status === 401) {
          clearSessionState();
          setSessionStatus({ kind: "error", message: "Session expired. Please log in again." });
          navigateTo("auth");
          return;
        }

        setDashboardStatus({ kind: "error", message: payload.message });
        return;
      }

      setPlayerTeam(payload.team);
    } catch {
      setDashboardStatus({ kind: "error", message: "Could not load dashboard data." });
    } finally {
      setIsLoadingDashboard(false);
    }
  }

  async function loadEvents() {
    if (!sessionToken) {
      setIsLoadingEvents(false);
      return;
    }

    setIsLoadingEvents(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/events`, {
        headers: {
          Authorization: `Bearer ${sessionToken}`
        }
      });

      const payload = (await response.json()) as CurrentEventResponse | ApiErrorResponse;
      if (!response.ok || !payload.ok) {
        if (response.status === 401) {
          clearSessionState();
          setSessionStatus({ kind: "error", message: "Session expired. Please log in again." });
          navigateTo("auth");
          return;
        }

        setEventsStatus({ kind: "error", message: payload.message });
        return;
      }

      setPlayerTeam(payload.team);
      setCurrentEvent(payload.currentEvent);
      setCurrentMatches(payload.matches);
    } catch {
      setEventsStatus({ kind: "error", message: "Could not load events." });
    } finally {
      setIsLoadingEvents(false);
    }
  }

  async function loadNotifications() {
    if (!sessionToken) {
      setIsLoadingNotifications(false);
      return;
    }

    setIsLoadingNotifications(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/notifications`, {
        headers: {
          Authorization: `Bearer ${sessionToken}`
        }
      });

      const payload = (await response.json()) as NotificationsResponse | ApiErrorResponse;
      if (!response.ok || !payload.ok) {
        if (response.status === 401) {
          clearSessionState();
          setSessionStatus({ kind: "error", message: "Session expired. Please log in again." });
          navigateTo("auth");
          return;
        }

        setNotificationsStatus({ kind: "error", message: payload.message });
        return;
      }

      setNotifications(payload.notifications);
      setUnreadNotificationCount(payload.unreadCount);
    } catch {
      setNotificationsStatus({ kind: "error", message: "Could not load notifications." });
    } finally {
      setIsLoadingNotifications(false);
    }
  }

  async function handleMarkAllNotificationsRead() {
    if (!sessionToken) {
      setNotificationsStatus({ kind: "error", message: "Missing session. Please log in again." });
      return;
    }

    setIsMarkingNotificationsRead(true);

    try {
      const body: MarkNotificationsReadRequest = { markAll: true };
      const response = await fetch(`${API_BASE_URL}/api/notifications/read`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify(body)
      });

      const payload = (await response.json()) as MarkNotificationsReadResponse | ApiErrorResponse;
      if (!response.ok || !payload.ok) {
        if (response.status === 401) {
          clearSessionState();
          setSessionStatus({ kind: "error", message: "Session expired. Please log in again." });
          navigateTo("auth");
          return;
        }

        setNotificationsStatus({ kind: "error", message: payload.message });
        return;
      }

      setNotificationsStatus({ kind: "success", message: payload.message });
      setUnreadNotificationCount(payload.unreadCount);
      await loadNotifications();
    } catch {
      setNotificationsStatus({ kind: "error", message: "Could not mark notifications as read." });
    } finally {
      setIsMarkingNotificationsRead(false);
    }
  }

  async function handleTeamAction(
    action: DashboardAction,
    options?: { body?: CreateTeamRequest | JoinTeamRequest }
  ) {
    if (!sessionToken) {
      setDashboardStatus({ kind: "error", message: "Missing session. Please log in again." });
      return;
    }

    const endpoint =
      action === "create-team"
        ? `${playerUrl}/team`
        : action === "join-team"
          ? `${playerUrl}/team/join`
          : `${playerUrl}/team/leave`;

    if (action === "create-team") {
      setIsCreatingTeam(true);
    }
    if (action === "join-team") {
      setIsJoiningTeam(true);
    }
    if (action === "leave-team") {
      setIsLeavingTeam(true);
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`
        },
        body: options?.body ? JSON.stringify(options.body) : undefined
      });

      const payload = (await response.json()) as
        | ApiSuccessResponse
        | ApiErrorResponse
        | { ok: true; message: string; team: PlayerTeamSummary };

      if (!response.ok || !payload.ok) {
        if (response.status === 401) {
          clearSessionState();
          setSessionStatus({ kind: "error", message: "Session expired. Please log in again." });
          navigateTo("auth");
          return;
        }

        setDashboardStatus({ kind: "error", message: payload.message });
        return;
      }

      setDashboardStatus({ kind: "success", message: payload.message });
      setCreateTeamForm(initialCreateTeamForm);
      setJoinCode("");
      await loadDashboard();
      await loadNotifications();
    } catch {
      setDashboardStatus({ kind: "error", message: "Could not complete team action." });
    } finally {
      setIsCreatingTeam(false);
      setIsJoiningTeam(false);
      setIsLeavingTeam(false);
    }
  }

  async function handleCreateTeamSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = createTeamForm.name.trim();
    if (!trimmedName) {
      setDashboardStatus({ kind: "error", message: "Team name is required." });
      return;
    }

    await handleTeamAction("create-team", {
      body: { name: trimmedName }
    });
  }

  async function handleJoinTeamSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedInviteCode = joinCode.trim().toUpperCase();
    if (!normalizedInviteCode) {
      setDashboardStatus({ kind: "error", message: "Invite code is required." });
      return;
    }

    await handleTeamAction("join-team", {
      body: { inviteCode: normalizedInviteCode }
    });
  }

  async function handleCreateEventSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!sessionToken) {
      setEventsStatus({ kind: "error", message: "Missing session. Please log in again." });
      return;
    }

    setIsCreatingEvent(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify(createEventForm)
      });

      const payload = (await response.json()) as CreateEventResponse | ApiErrorResponse;
      if (!response.ok || !payload.ok) {
        if (response.status === 401) {
          clearSessionState();
          setSessionStatus({ kind: "error", message: "Session expired. Please log in again." });
          navigateTo("auth");
          return;
        }

        setEventsStatus({ kind: "error", message: payload.message });
        return;
      }

      setEventsStatus({ kind: "success", message: payload.message });
      setCreateEventForm(buildInitialEventForm());
      await loadEvents();
    } catch {
      setEventsStatus({ kind: "error", message: "Could not create event." });
    } finally {
      setIsCreatingEvent(false);
    }
  }

  async function handleRegisterTeamForCurrentEvent() {
    if (!sessionToken) {
      setEventsStatus({ kind: "error", message: "Missing session. Please log in again." });
      return;
    }

    setIsRegisteringCurrentEvent(true);

    try {
      const request: RegisterCurrentEventRequest = { confirm: true };
      const response = await fetch(`${API_BASE_URL}/api/events/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify(request)
      });

      const payload = (await response.json()) as RegisterEventResponse | ApiErrorResponse;
      if (!response.ok || !payload.ok) {
        if (response.status === 401) {
          clearSessionState();
          setSessionStatus({ kind: "error", message: "Session expired. Please log in again." });
          navigateTo("auth");
          return;
        }

        setEventsStatus({ kind: "error", message: payload.message });
        return;
      }

      setEventsStatus({ kind: "success", message: payload.message });
      await loadEvents();
    } catch {
      setEventsStatus({ kind: "error", message: "Could not register team for event." });
    } finally {
      setIsRegisteringCurrentEvent(false);
    }
  }

  async function handleCompleteCurrentEvent() {
    if (!sessionToken) {
      setEventsStatus({ kind: "error", message: "Missing session. Please log in again." });
      return;
    }

    if (!window.confirm("Complete the current event? This unlocks creating the next event.")) {
      return;
    }

    setIsCompletingCurrentEvent(true);

    try {
      const request: CompleteCurrentEventRequest = { confirm: true };
      const response = await fetch(`${API_BASE_URL}/api/events/current/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify(request)
      });

      const payload = (await response.json()) as CompleteCurrentEventResponse | ApiErrorResponse;
      if (!response.ok || !payload.ok) {
        if (response.status === 401) {
          clearSessionState();
          setSessionStatus({ kind: "error", message: "Session expired. Please log in again." });
          navigateTo("auth");
          return;
        }

        setEventsStatus({ kind: "error", message: payload.message });
        return;
      }

      setEventsStatus({ kind: "success", message: payload.message });
      setCurrentEvent(payload.currentEvent);
      setCurrentMatches(payload.matches);
      await loadNotifications();
    } catch {
      setEventsStatus({ kind: "error", message: "Could not complete current event." });
    } finally {
      setIsCompletingCurrentEvent(false);
    }
  }

  async function handleStartCurrentEvent() {
    if (!sessionToken) {
      setEventsStatus({ kind: "error", message: "Missing session. Please log in again." });
      return;
    }

    if (!window.confirm("Start the current event? Registration will lock and opening matches will be generated.")) {
      return;
    }

    setIsStartingCurrentEvent(true);

    try {
      const request: StartCurrentEventRequest = { confirm: true };
      const response = await fetch(`${API_BASE_URL}/api/events/current/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify(request)
      });

      const payload = (await response.json()) as StartCurrentEventResponse | ApiErrorResponse;
      if (!response.ok || !payload.ok) {
        if (response.status === 401) {
          clearSessionState();
          setSessionStatus({ kind: "error", message: "Session expired. Please log in again." });
          navigateTo("auth");
          return;
        }

        setEventsStatus({ kind: "error", message: payload.message });
        return;
      }

      setEventsStatus({ kind: "success", message: payload.message });
      setCurrentEvent(payload.currentEvent);
      setCurrentMatches(payload.matches);
      await loadNotifications();
    } catch {
      setEventsStatus({ kind: "error", message: "Could not start current event." });
    } finally {
      setIsStartingCurrentEvent(false);
    }
  }

  async function handleUpdateMatchStatus(matchId: string, status: "scheduled" | "in_progress") {
    if (!sessionToken) {
      setEventsStatus({ kind: "error", message: "Missing session. Please log in again." });
      return;
    }

    setUpdatingMatchId(matchId);

    try {
      const body: UpdateMatchStatusRequest = { status };
      const response = await fetch(`${API_BASE_URL}/api/events/matches/${matchId}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify(body)
      });

      const payload = (await response.json()) as CurrentEventResponse | ApiErrorResponse;
      if (!response.ok || !payload.ok) {
        if (response.status === 401) {
          clearSessionState();
          setSessionStatus({ kind: "error", message: "Session expired. Please log in again." });
          navigateTo("auth");
          return;
        }

        setEventsStatus({ kind: "error", message: payload.message });
        return;
      }

      setEventsStatus({ kind: "success", message: payload.message });
      setCurrentEvent(payload.currentEvent);
      setCurrentMatches(payload.matches);
      await loadNotifications();
    } catch {
      setEventsStatus({ kind: "error", message: "Could not update match status." });
    } finally {
      setUpdatingMatchId(null);
    }
  }

  async function handleProposeMatchSchedule(matchId: string, proposedStartAt: string) {
    if (!sessionToken) {
      setEventsStatus({ kind: "error", message: "Missing session. Please log in again." });
      return;
    }

    setProposingScheduleMatchId(matchId);

    try {
      const body: ProposeMatchScheduleRequest = { proposedStartAt };
      const response = await fetch(`${API_BASE_URL}/api/events/matches/${matchId}/schedule/propose`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify(body)
      });

      const payload = (await response.json()) as CurrentEventResponse | ApiErrorResponse;
      if (!response.ok || !payload.ok) {
        if (response.status === 401) {
          clearSessionState();
          setSessionStatus({ kind: "error", message: "Session expired. Please log in again." });
          navigateTo("auth");
          return;
        }

        setEventsStatus({ kind: "error", message: payload.message });
        return;
      }

      setEventsStatus({ kind: "success", message: payload.message });
      setCurrentEvent(payload.currentEvent);
      setCurrentMatches(payload.matches);
      await loadNotifications();
    } catch {
      setEventsStatus({ kind: "error", message: "Could not submit schedule proposal." });
    } finally {
      setProposingScheduleMatchId(null);
    }
  }

  async function handleRespondMatchSchedule(matchId: string, proposalId: string, decision: "accept" | "reject") {
    if (!sessionToken) {
      setEventsStatus({ kind: "error", message: "Missing session. Please log in again." });
      return;
    }

    setRespondingScheduleMatchId(matchId);

    try {
      const body: RespondMatchScheduleRequest = { proposalId, decision };
      const response = await fetch(`${API_BASE_URL}/api/events/matches/${matchId}/schedule/respond`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify(body)
      });

      const payload = (await response.json()) as CurrentEventResponse | ApiErrorResponse;
      if (!response.ok || !payload.ok) {
        if (response.status === 401) {
          clearSessionState();
          setSessionStatus({ kind: "error", message: "Session expired. Please log in again." });
          navigateTo("auth");
          return;
        }

        setEventsStatus({ kind: "error", message: payload.message });
        return;
      }

      setEventsStatus({ kind: "success", message: payload.message });
      setCurrentEvent(payload.currentEvent);
      setCurrentMatches(payload.matches);
    } catch {
      setEventsStatus({ kind: "error", message: "Could not respond to schedule proposal." });
    } finally {
      setRespondingScheduleMatchId(null);
    }
  }

  async function handleReportMatchResult(matchId: string, winnerTeamId: string, adminOverride = false) {
    if (!sessionToken) {
      setEventsStatus({ kind: "error", message: "Missing session. Please log in again." });
      return;
    }

    setReportingMatchId(matchId);

    try {
      const body: ReportMatchResultRequest = { winnerTeamId, adminOverride };
      const response = await fetch(`${API_BASE_URL}/api/events/matches/${matchId}/result`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify(body)
      });

      const payload = (await response.json()) as CurrentEventResponse | ApiErrorResponse;
      if (!response.ok || !payload.ok) {
        if (response.status === 401) {
          clearSessionState();
          setSessionStatus({ kind: "error", message: "Session expired. Please log in again." });
          navigateTo("auth");
          return;
        }

        setEventsStatus({ kind: "error", message: payload.message });
        return;
      }

      setEventsStatus({ kind: "success", message: payload.message });
      setCurrentEvent(payload.currentEvent);
      setCurrentMatches(payload.matches);
    } catch {
      setEventsStatus({ kind: "error", message: "Could not submit match result." });
    } finally {
      setReportingMatchId(null);
    }
  }

  async function handleRotateInvite() {
    if (!sessionToken) {
      setDashboardStatus({ kind: "error", message: "Missing session. Please log in again." });
      return;
    }

    setIsRotatingInvite(true);

    try {
      const response = await fetch(`${playerUrl}/team/invite/rotate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionToken}`
        }
      });

      const payload = (await response.json()) as TeamActionSuccessResponse | ApiErrorResponse;
      if (!response.ok || !payload.ok) {
        if (response.status === 401) {
          clearSessionState();
          setSessionStatus({ kind: "error", message: "Session expired. Please log in again." });
          navigateTo("auth");
          return;
        }

        setDashboardStatus({ kind: "error", message: payload.message });
        return;
      }

      setDashboardStatus({ kind: "success", message: payload.message });
      await loadDashboard();
    } catch {
      setDashboardStatus({ kind: "error", message: "Could not rotate invite code." });
    } finally {
      setIsRotatingInvite(false);
    }
  }

  async function handleTransferAdmin() {
    if (!sessionToken) {
      setDashboardStatus({ kind: "error", message: "Missing session. Please log in again." });
      return;
    }

    if (!transferTargetUserId) {
      setDashboardStatus({ kind: "error", message: "Select a member to transfer admin to." });
      return;
    }

    setIsTransferringAdmin(true);

    try {
      const body: TransferTeamAdminRequest = { newAdminUserId: transferTargetUserId };
      const response = await fetch(`${playerUrl}/team/admin/transfer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify(body)
      });

      const payload = (await response.json()) as TeamActionSuccessResponse | ApiErrorResponse;
      if (!response.ok || !payload.ok) {
        if (response.status === 401) {
          clearSessionState();
          setSessionStatus({ kind: "error", message: "Session expired. Please log in again." });
          navigateTo("auth");
          return;
        }

        setDashboardStatus({ kind: "error", message: payload.message });
        return;
      }

      setTransferTargetUserId("");
      setDashboardStatus({ kind: "success", message: payload.message });
      await loadDashboard();
    } catch {
      setDashboardStatus({ kind: "error", message: "Could not transfer admin rights." });
    } finally {
      setIsTransferringAdmin(false);
    }
  }

  async function handleRemoveMember(memberUserId: string) {
    if (!sessionToken) {
      setDashboardStatus({ kind: "error", message: "Missing session. Please log in again." });
      return;
    }

    setRemovingMemberId(memberUserId);

    try {
      const body: RemoveTeamMemberRequest = { memberUserId };
      const response = await fetch(`${playerUrl}/team/members/remove`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify(body)
      });

      const payload = (await response.json()) as TeamActionSuccessResponse | ApiErrorResponse;
      if (!response.ok || !payload.ok) {
        if (response.status === 401) {
          clearSessionState();
          setSessionStatus({ kind: "error", message: "Session expired. Please log in again." });
          navigateTo("auth");
          return;
        }

        setDashboardStatus({ kind: "error", message: payload.message });
        return;
      }

      setDashboardStatus({ kind: "success", message: payload.message });
      await loadDashboard();
    } catch {
      setDashboardStatus({ kind: "error", message: "Could not remove team member." });
    } finally {
      setRemovingMemberId(null);
    }
  }

  async function handleSignupSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmittingSignup(true);
    setSignupStatus({ kind: "idle", message: "" });

    try {
      const response = await fetch(`${authUrl}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signupForm)
      });

      const payload = (await response.json()) as AuthSuccessResponse | ApiErrorResponse;
      if (!response.ok || !payload.ok) {
        const issues = payload.ok ? [] : payload.issues ?? [];
        const suffix = issues.length > 0 ? ` (${issues.join(", ")})` : "";
        setSignupStatus({ kind: "error", message: `${payload.message}${suffix}` });
        return;
      }

      setSignupStatus({ kind: "success", message: payload.message });
      setSessionToken(payload.sessionToken);
      setActiveUser(payload.user);
      localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, payload.sessionToken);
      setSessionStatus({ kind: "success", message: "Signed in and session saved." });
      navigateTo("app-overview");
      setSignupForm(initialSignup);
    } catch {
      setSignupStatus({ kind: "error", message: "Could not reach the API service." });
    } finally {
      setIsSubmittingSignup(false);
    }
  }

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmittingLogin(true);
    setLoginStatus({ kind: "idle", message: "" });

    try {
      const response = await fetch(`${authUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm)
      });

      const payload = (await response.json()) as AuthSuccessResponse | ApiErrorResponse;
      if (!response.ok || !payload.ok) {
        const issues = payload.ok ? [] : payload.issues ?? [];
        const suffix = issues.length > 0 ? ` (${issues.join(", ")})` : "";
        setLoginStatus({ kind: "error", message: `${payload.message}${suffix}` });
        return;
      }

      setLoginStatus({ kind: "success", message: payload.message });
      setSessionToken(payload.sessionToken);
      setActiveUser(payload.user);
      localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, payload.sessionToken);
      setSessionStatus({ kind: "success", message: "Session saved." });
      navigateTo("app-overview");
      setLoginForm(initialLogin);
    } catch {
      setLoginStatus({ kind: "error", message: "Could not reach the API service." });
    } finally {
      setIsSubmittingLogin(false);
    }
  }

  async function handleLogout() {
    if (!sessionToken) {
      return;
    }

    setIsLoggingOut(true);
    try {
      const response = await fetch(`${authUrl}/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionToken}`
        }
      });

      const payload = (await response.json()) as ApiSuccessResponse | ApiErrorResponse;
      if (!response.ok || !payload.ok) {
        setSessionStatus({ kind: "error", message: payload.message });
        return;
      }
    } finally {
      clearSessionState();
      setIsLoggingOut(false);
      setSessionStatus({ kind: "success", message: "Logged out." });
      navigateTo("auth");
    }
  }

  function clearSessionState() {
    setSessionToken(null);
    setActiveUser(null);
    setPlayerTeam(null);
    setDashboardStatus({ kind: "idle", message: "" });
    setCurrentEvent(null);
    setCurrentMatches([]);
    setEventsStatus({ kind: "idle", message: "" });
    setNotifications([]);
    setUnreadNotificationCount(0);
    setNotificationsStatus({ kind: "idle", message: "" });
    localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
  }

  const authRouteActive = route === "auth";

  return (
    <main className="layout">
      <SessionHero
        isCheckingSession={isCheckingSession}
        activeUser={activeUser}
        sessionStatus={sessionStatus}
        isLoggingOut={isLoggingOut}
        onLogout={() => {
          void handleLogout();
        }}
      />

      {authRouteActive ? (
        <AuthPanels
          signupForm={signupForm}
          loginForm={loginForm}
          signupStatus={signupStatus}
          loginStatus={loginStatus}
          isSubmittingSignup={isSubmittingSignup}
          isSubmittingLogin={isSubmittingLogin}
          onSignupChange={setSignupForm}
          onLoginChange={setLoginForm}
          onSignupSubmit={handleSignupSubmit}
          onLoginSubmit={handleLoginSubmit}
        />
      ) : (
        <section className="app-shell" aria-label="Authenticated Application">
          <AppShellNav route={route} isAdmin={activeUser?.isAdmin ?? false} onNavigate={navigateTo} />

          <article className="shell-content">
            <NotificationsPanel
              notifications={notifications}
              unreadCount={unreadNotificationCount}
              isLoadingNotifications={isLoadingNotifications}
              isMarkingNotificationsRead={isMarkingNotificationsRead}
              notificationsStatus={notificationsStatus}
              onMarkAllRead={() => {
                void handleMarkAllNotificationsRead();
              }}
            />

            {route === "app-overview" && (
              <PlayerDashboardOverview
                activeUser={activeUser}
                playerTeam={playerTeam}
                dashboardStatus={dashboardStatus}
                isLoadingDashboard={isLoadingDashboard}
                isCreatingTeam={isCreatingTeam}
                isJoiningTeam={isJoiningTeam}
                isLeavingTeam={isLeavingTeam}
                isRotatingInvite={isRotatingInvite}
                isTransferringAdmin={isTransferringAdmin}
                removingMemberId={removingMemberId}
                createTeamForm={createTeamForm}
                joinCode={joinCode}
                transferTargetUserId={transferTargetUserId}
                onCreateTeamChange={setCreateTeamForm}
                onJoinCodeChange={setJoinCode}
                onTransferTargetChange={setTransferTargetUserId}
                onCreateTeamSubmit={handleCreateTeamSubmit}
                onJoinTeamSubmit={handleJoinTeamSubmit}
                onLeaveTeam={() => {
                  void handleTeamAction("leave-team");
                }}
                onRotateInvite={() => {
                  void handleRotateInvite();
                }}
                onTransferAdmin={() => {
                  void handleTransferAdmin();
                }}
                onRemoveMember={(memberUserId) => {
                  void handleRemoveMember(memberUserId);
                }}
              />
            )}

            {route === "app-team" && (
              <>
                <h2>Team Hub</h2>
                <p>Protected page placeholder for roster, invites, and captain controls.</p>
              </>
            )}

            {route === "app-events" && (
              <EventsPanel
                team={playerTeam}
                currentEvent={currentEvent}
                matches={currentMatches}
                isLoadingEvents={isLoadingEvents}
                isRegisteringCurrentEvent={isRegisteringCurrentEvent}
                proposingScheduleMatchId={proposingScheduleMatchId}
                respondingScheduleMatchId={respondingScheduleMatchId}
                updatingMatchId={updatingMatchId}
                reportingMatchId={reportingMatchId}
                eventsStatus={eventsStatus}
                onRegisterCurrentEvent={() => {
                  void handleRegisterTeamForCurrentEvent();
                }}
                onUpdateMatchStatus={(matchId, status) => {
                  void handleUpdateMatchStatus(matchId, status);
                }}
                onProposeMatchSchedule={(matchId, proposedStartAt) => {
                  void handleProposeMatchSchedule(matchId, proposedStartAt);
                }}
                onRespondMatchSchedule={(matchId, proposalId, decision) => {
                  void handleRespondMatchSchedule(matchId, proposalId, decision);
                }}
                onReportMatchResult={(matchId, winnerTeamId, adminOverride) => {
                  void handleReportMatchResult(matchId, winnerTeamId, adminOverride);
                }}
              />
            )}

            {route === "app-admin" && (
              <AdminPanel
                activeUser={activeUser}
                currentEvent={currentEvent}
                isCreatingEvent={isCreatingEvent}
                isStartingCurrentEvent={isStartingCurrentEvent}
                isCompletingCurrentEvent={isCompletingCurrentEvent}
                eventsStatus={eventsStatus}
                createEventForm={createEventForm}
                onCreateEventChange={setCreateEventForm}
                onCreateEventSubmit={handleCreateEventSubmit}
                onStartCurrentEvent={() => {
                  void handleStartCurrentEvent();
                }}
                onCompleteCurrentEvent={() => {
                  void handleCompleteCurrentEvent();
                }}
              />
            )}
          </article>
        </section>
      )}
    </main>
  );
}

export default App;
