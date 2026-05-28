import type { AuthenticatedUser } from "@homieleague/shared";
import type { RequestStatus } from "../types/ui";

interface SessionHeroProps {
  isCheckingSession: boolean;
  activeUser: AuthenticatedUser | null;
  sessionStatus: RequestStatus;
  isLoggingOut: boolean;
  onLogout: () => void;
}

export function SessionHero({
  isCheckingSession,
  activeUser,
  sessionStatus,
  isLoggingOut,
  onLogout
}: SessionHeroProps) {
  return (
    <header className="hero">
      <p className="eyebrow">HomieLeague</p>
      <h1>Seasonal Esports, Organized</h1>
      <p className="subtitle">
        Your secure player dashboard centralizes your profile and team actions in one place.
      </p>
      {isCheckingSession ? (
        <p className="auth-summary">Checking saved session...</p>
      ) : activeUser ? (
        <div className="auth-summary">
          <p>
            Signed in as <strong>{activeUser.username}</strong> ({activeUser.email})
          </p>
          <button type="button" onClick={onLogout} disabled={isLoggingOut} className="logout-btn">
            {isLoggingOut ? "Logging out..." : "Log out"}
          </button>
        </div>
      ) : (
        <p className="auth-summary">No active session.</p>
      )}
      {sessionStatus.kind !== "idle" && (
        <p className={`status ${sessionStatus.kind}`}>{sessionStatus.message}</p>
      )}
    </header>
  );
}
