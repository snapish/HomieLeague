export const SERVICE_NAME = "homieleague-api";

export type MatchStatus =
  | "pending"
  | "scheduling"
  | "scheduled"
  | "in_progress"
  | "result_pending"
  | "completed"
  | "disputed";

export type MatchScheduleProposalStatus = "pending" | "accepted" | "rejected";

export interface HealthResponse {
  ok: boolean;
  service: string;
  timestamp: string;
}

export interface SignupRequest {
  email: string;
  username: string;
  steamId: string;
  password: string;
}

export interface LoginRequest {
  identifier: string;
  password: string;
}

export interface ApiErrorResponse {
  ok: false;
  message: string;
  issues?: string[];
}

export interface ApiSuccessResponse {
  ok: true;
  message: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string;
  steamId: string;
  isAdmin: boolean;
}

export interface AuthSuccessResponse extends ApiSuccessResponse {
  user: AuthenticatedUser;
  sessionToken: string;
  expiresAt: string;
}

export interface AuthSessionResponse extends ApiSuccessResponse {
  user: AuthenticatedUser;
}

export type TeamMemberRole = "admin" | "member";

export interface TeamMemberSummary {
  userId: string;
  username: string;
  steamId: string;
  role: TeamMemberRole;
  joinedAt: string;
}

export interface PlayerTeamSummary {
  id: string;
  name: string;
  inviteCode: string | null;
  memberCount: number;
  maxMembers: number;
  yourRole: TeamMemberRole;
  members: TeamMemberSummary[];
}

export interface PlayerDashboardResponse extends ApiSuccessResponse {
  user: AuthenticatedUser;
  team: PlayerTeamSummary | null;
}

export interface CreateTeamRequest {
  name: string;
}

export interface JoinTeamRequest {
  inviteCode: string;
}

export interface TransferTeamAdminRequest {
  newAdminUserId: string;
}

export interface RemoveTeamMemberRequest {
  memberUserId: string;
}

export interface TeamActionSuccessResponse extends ApiSuccessResponse {
  team: PlayerTeamSummary;
}

export type EventStatus = "draft" | "registration_open" | "registration_closed" | "in_progress" | "completed";

export interface EventSummary {
  id: string;
  title: string;
  game: string;
  timezone: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  startsAt: string;
  status: EventStatus;
  registrationCount: number;
  isRegisteredForYourTeam: boolean;
  canRegisterYourTeam: boolean;
  canManageCurrentEvent: boolean;
  canStartCurrentEvent: boolean;
}

export interface EventMatchSummary {
  id: string;
  roundNumber: number;
  slotNumber: number;
  status: MatchStatus;
  teamAId: string | null;
  teamAName: string | null;
  teamBId: string | null;
  teamBName: string | null;
  scheduledStartAt: string | null;
  winnerTeamId: string | null;
  canManageLifecycle: boolean;
  canTransitionToScheduled: boolean;
  canTransitionToInProgress: boolean;
  canProposeSchedule: boolean;
  canRespondToScheduleProposal: boolean;
  canReportResult: boolean;
  yourReportedWinnerTeamId: string | null;
  isAwaitingOpponentConfirmation: boolean;
  hasResultConflict: boolean;
  latestScheduleProposal: EventMatchScheduleProposalSummary | null;
}

export interface EventMatchScheduleProposalSummary {
  id: string;
  proposedByTeamId: string;
  proposedByTeamName: string | null;
  proposedStartAt: string;
  status: MatchScheduleProposalStatus;
  respondedByTeamId: string | null;
}

export interface CurrentEventResponse extends ApiSuccessResponse {
  team: PlayerTeamSummary | null;
  currentEvent: EventSummary | null;
  matches: EventMatchSummary[];
}

export interface CreateEventRequest {
  title: string;
  game: string;
  timezone: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  startsAt: string;
}

export interface CreateEventResponse extends ApiSuccessResponse {
  event: EventSummary;
}

export interface RegisterCurrentEventRequest {
  confirm: true;
}

export interface CompleteCurrentEventRequest {
  confirm: true;
}

export interface StartCurrentEventRequest {
  confirm: true;
}

export interface CompleteCurrentEventResponse extends ApiSuccessResponse {
  currentEvent: EventSummary | null;
  matches: EventMatchSummary[];
}

export interface StartCurrentEventResponse extends ApiSuccessResponse {
  currentEvent: EventSummary | null;
  createdMatches: number;
  matches: EventMatchSummary[];
}

export interface RegisterEventResponse extends ApiSuccessResponse {
  event: EventSummary;
}

export interface UpdateMatchStatusRequest {
  status: "scheduled" | "in_progress";
}

export interface ReportMatchResultRequest {
  winnerTeamId: string;
  adminOverride?: boolean;
}

export interface ProposeMatchScheduleRequest {
  proposedStartAt: string;
}

export interface RespondMatchScheduleRequest {
  proposalId: string;
  decision: "accept" | "reject";
}

export type NotificationKind =
  | "team_invite"
  | "match_created"
  | "schedule_proposed"
  | "schedule_accepted"
  | "result_disputed"
  | "result_override";

export interface NotificationSummary {
  id: string;
  kind: NotificationKind;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsResponse extends ApiSuccessResponse {
  notifications: NotificationSummary[];
  unreadCount: number;
}

export interface MarkNotificationsReadRequest {
  markAll?: boolean;
  notificationIds?: string[];
}

export interface MarkNotificationsReadResponse extends ApiSuccessResponse {
  unreadCount: number;
}
