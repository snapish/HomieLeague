import type { FormEvent } from "react";
import type { AuthenticatedUser, CreateTeamRequest, PlayerTeamSummary } from "@homieleague/shared";
import type { RequestStatus } from "../types/ui";
import { TeamAdminControls } from "./TeamAdminControls";

interface PlayerDashboardOverviewProps {
  activeUser: AuthenticatedUser | null;
  playerTeam: PlayerTeamSummary | null;
  dashboardStatus: RequestStatus;
  isLoadingDashboard: boolean;
  isCreatingTeam: boolean;
  isJoiningTeam: boolean;
  isLeavingTeam: boolean;
  isRotatingInvite: boolean;
  isTransferringAdmin: boolean;
  removingMemberId: string | null;
  createTeamForm: CreateTeamRequest;
  joinCode: string;
  transferTargetUserId: string;
  onCreateTeamChange: (next: CreateTeamRequest) => void;
  onJoinCodeChange: (next: string) => void;
  onTransferTargetChange: (next: string) => void;
  onCreateTeamSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onJoinTeamSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onLeaveTeam: () => void;
  onRotateInvite: () => void;
  onTransferAdmin: () => void;
  onRemoveMember: (memberUserId: string) => void;
}

export function PlayerDashboardOverview({
  activeUser,
  playerTeam,
  dashboardStatus,
  isLoadingDashboard,
  isCreatingTeam,
  isJoiningTeam,
  isLeavingTeam,
  isRotatingInvite,
  isTransferringAdmin,
  removingMemberId,
  createTeamForm,
  joinCode,
  transferTargetUserId,
  onCreateTeamChange,
  onJoinCodeChange,
  onTransferTargetChange,
  onCreateTeamSubmit,
  onJoinTeamSubmit,
  onLeaveTeam,
  onRotateInvite,
  onTransferAdmin,
  onRemoveMember
}: PlayerDashboardOverviewProps) {
  return (
    <>
      <h2>Player Dashboard</h2>
      <p>Protected hub for profile visibility, team membership, and invite-based team joins.</p>

      <div className="shell-cards">
        <section>
          <h3>Profile</h3>
          <p>
            <strong>Username:</strong> {activeUser?.username ?? "-"}
          </p>
          <p>
            <strong>Email:</strong> {activeUser?.email ?? "-"}
          </p>
          <p>
            <strong>SteamID64:</strong> {activeUser?.steamId ?? "-"}
          </p>
        </section>

        <section>
          <h3>Team Status</h3>
          {isLoadingDashboard ? (
            <p>Loading team data...</p>
          ) : playerTeam ? (
            <>
              <p>
                <strong>{playerTeam.name}</strong> ({playerTeam.memberCount}/{playerTeam.maxMembers})
              </p>
              <p>
                <strong>Your role:</strong> {playerTeam.yourRole}
              </p>
              {playerTeam.inviteCode ? (
                <p>
                  <strong>Invite code:</strong> {playerTeam.inviteCode}
                </p>
              ) : (
                <p>Ask your team admin for the invite code.</p>
              )}
            </>
          ) : (
            <p>You are not on a team yet.</p>
          )}
        </section>

        <section>
          <h3>Safety Guardrails</h3>
          <p>Sessions are validated server-side on every protected team action.</p>
          <p>Admins cannot leave a multi-member team until ownership transfer is implemented.</p>
        </section>
      </div>

      {playerTeam ? (
        <>
          <section className="team-panel">
          <h3>Roster</h3>
          <ul className="roster-list">
            {playerTeam.members.map((member) => (
              <li key={member.userId}>
                <span>
                  <strong>{member.username}</strong> ({member.role})
                </span>
                <span>{member.steamId}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="secondary-btn" onClick={onLeaveTeam} disabled={isLeavingTeam}>
            {isLeavingTeam ? "Leaving team..." : "Leave team"}
          </button>
          </section>

          <TeamAdminControls
            team={playerTeam}
            transferTargetUserId={transferTargetUserId}
            isRotatingInvite={isRotatingInvite}
            isTransferringAdmin={isTransferringAdmin}
            removingMemberId={removingMemberId}
            onTransferTargetChange={onTransferTargetChange}
            onRotateInvite={onRotateInvite}
            onTransferAdmin={onTransferAdmin}
            onRemoveMember={onRemoveMember}
          />
        </>
      ) : (
        <section className="team-actions-grid">
          <article className="panel">
            <h3>Create Team</h3>
            <form className="form" onSubmit={onCreateTeamSubmit} noValidate>
              <label>
                Team name
                <input
                  type="text"
                  value={createTeamForm.name}
                  onChange={(event) => onCreateTeamChange({ ...createTeamForm, name: event.target.value })}
                  maxLength={40}
                  required
                />
              </label>
              <button type="submit" disabled={isCreatingTeam || isJoiningTeam}>
                {isCreatingTeam ? "Creating..." : "Create team"}
              </button>
            </form>
          </article>

          <article className="panel">
            <h3>Join Team</h3>
            <form className="form" onSubmit={onJoinTeamSubmit} noValidate>
              <label>
                Invite code
                <input
                  type="text"
                  value={joinCode}
                  onChange={(event) => onJoinCodeChange(event.target.value)}
                  maxLength={8}
                  required
                />
              </label>
              <button type="submit" disabled={isJoiningTeam || isCreatingTeam}>
                {isJoiningTeam ? "Joining..." : "Join team"}
              </button>
            </form>
          </article>
        </section>
      )}

      {dashboardStatus.kind !== "idle" && <p className={`status ${dashboardStatus.kind}`}>{dashboardStatus.message}</p>}
    </>
  );
}
