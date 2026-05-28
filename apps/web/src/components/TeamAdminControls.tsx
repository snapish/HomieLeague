import type { PlayerTeamSummary } from "@homieleague/shared";

interface TeamAdminControlsProps {
  team: PlayerTeamSummary;
  transferTargetUserId: string;
  isRotatingInvite: boolean;
  isTransferringAdmin: boolean;
  removingMemberId: string | null;
  onTransferTargetChange: (next: string) => void;
  onRotateInvite: () => void;
  onTransferAdmin: () => void;
  onRemoveMember: (memberUserId: string) => void;
}

export function TeamAdminControls({
  team,
  transferTargetUserId,
  isRotatingInvite,
  isTransferringAdmin,
  removingMemberId,
  onTransferTargetChange,
  onRotateInvite,
  onTransferAdmin,
  onRemoveMember
}: TeamAdminControlsProps) {
  const transferTargets = team.members.filter((member) => member.role === "member");

  if (team.yourRole !== "admin") {
    return null;
  }

  return (
    <section className="team-admin-panel">
      <div className="team-admin-panel__header">
        <div>
          <h3>Team Admin</h3>
          <p>Manage invite access, roster membership, and admin handoff.</p>
        </div>
        <button type="button" className="secondary-btn" onClick={onRotateInvite} disabled={isRotatingInvite}>
          {isRotatingInvite ? "Rotating..." : "Rotate invite code"}
        </button>
      </div>

      <div className="team-admin-panel__body">
        <article className="team-admin-card">
          <h4>Transfer admin</h4>
          <p>Select a current member to promote before you step down.</p>
          <div className="team-admin-inline">
            <select
              value={transferTargetUserId}
              onChange={(event) => onTransferTargetChange(event.target.value)}
              disabled={isTransferringAdmin || transferTargets.length === 0}
            >
              <option value="">Select a member</option>
              {transferTargets.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.username}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="secondary-btn"
              onClick={onTransferAdmin}
              disabled={isTransferringAdmin || transferTargetUserId.length === 0}
            >
              {isTransferringAdmin ? "Transferring..." : "Transfer"}
            </button>
          </div>
        </article>

        <article className="team-admin-card">
          <h4>Manage members</h4>
          <ul className="team-admin-member-list">
            {team.members.map((member) => (
              <li key={member.userId}>
                <span>
                  <strong>{member.username}</strong> {member.role === "admin" ? "(admin)" : ""}
                </span>
                {member.role === "admin" ? (
                  <span className="team-admin-muted">Owner</span>
                ) : (
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => onRemoveMember(member.userId)}
                    disabled={removingMemberId === member.userId}
                  >
                    {removingMemberId === member.userId ? "Removing..." : "Remove"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
