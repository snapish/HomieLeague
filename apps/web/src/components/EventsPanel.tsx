import type { EventSummary, PlayerTeamSummary } from "@homieleague/shared";
import type { RequestStatus } from "../types/ui";

interface EventsPanelProps {
  team: PlayerTeamSummary | null;
  currentEvent: EventSummary | null;
  isLoadingEvents: boolean;
  isRegisteringCurrentEvent: boolean;
  eventsStatus: RequestStatus;
  onRegisterCurrentEvent: () => void;
}

export function EventsPanel({
  team,
  currentEvent,
  isLoadingEvents,
  isRegisteringCurrentEvent,
  eventsStatus,
  onRegisterCurrentEvent
}: EventsPanelProps) {
  return (
    <>
      <h2>Current Event</h2>
      <p>HomieLeague now runs one active event at a time, with a single current season workflow.</p>

      {!currentEvent && (
        <section className="events-create-panel">
          <div className="events-create-panel__header">
            <div>
              <h3>No Active Event</h3>
              <p>Only the admin account can create the next event.</p>
            </div>
          </div>
        </section>
      )}

      <section className="events-catalog-panel">
        <div className="events-catalog-panel__header">
          <div>
            <h3>Current Event Snapshot</h3>
            <p>{isLoadingEvents ? "Loading current event..." : currentEvent ? "One event is active." : "No active event."}</p>
          </div>
        </div>
        {currentEvent ? (
          <div className="events-grid">
            <article className="event-card" key={currentEvent.id}>
              <div className="event-card__topline">
                <h4>{currentEvent.title}</h4>
                <span className={`event-status status-pill status-pill--${currentEvent.status}`}>{currentEvent.status}</span>
              </div>
              <p>{currentEvent.game}</p>
              <p>
                {formatDateTime(currentEvent.registrationOpensAt)} to {formatDateTime(currentEvent.registrationClosesAt)}
              </p>
              <p>Starts {formatDateTime(currentEvent.startsAt)}</p>
              <p>
                {currentEvent.registrationCount} team{currentEvent.registrationCount === 1 ? "" : "s"} registered
              </p>
              <p>
                {currentEvent.isRegisteredForYourTeam
                  ? "Your team is registered."
                  : team
                    ? "Your team is not registered yet."
                    : "Join or create a team to register."}
              </p>
              <button
                type="button"
                className="secondary-btn"
                disabled={!currentEvent.canRegisterYourTeam || isRegisteringCurrentEvent}
                onClick={onRegisterCurrentEvent}
              >
                {isRegisteringCurrentEvent
                  ? "Registering..."
                  : currentEvent.isRegisteredForYourTeam
                    ? "Registered"
                    : "Register team"}
              </button>
            </article>
          </div>
        ) : (
          <p>No current event has been created yet.</p>
        )}
      </section>

      {eventsStatus.kind !== "idle" && <p className={`status ${eventsStatus.kind}`}>{eventsStatus.message}</p>}
    </>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}
