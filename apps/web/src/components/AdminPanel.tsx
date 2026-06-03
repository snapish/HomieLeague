import type { FormEvent } from "react";
import type { AuthenticatedUser, CreateEventRequest, EventSummary } from "@homieleague/shared";
import type { RequestStatus } from "../types/ui";

interface AdminPanelProps {
  activeUser: AuthenticatedUser | null;
  currentEvent: EventSummary | null;
  isCreatingEvent: boolean;
  isStartingCurrentEvent: boolean;
  isCompletingCurrentEvent: boolean;
  eventsStatus: RequestStatus;
  createEventForm: CreateEventRequest;
  onCreateEventChange: (next: CreateEventRequest) => void;
  onCreateEventSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onStartCurrentEvent: () => void;
  onCompleteCurrentEvent: () => void;
}

export function AdminPanel({
  activeUser,
  currentEvent,
  isCreatingEvent,
  isStartingCurrentEvent,
  isCompletingCurrentEvent,
  eventsStatus,
  createEventForm,
  onCreateEventChange,
  onCreateEventSubmit,
  onStartCurrentEvent,
  onCompleteCurrentEvent
}: AdminPanelProps) {
  return (
    <>
      <h2>Admin Control Center</h2>
      <p>
        This page is reserved for the single HomieLeague admin account and controls the current event
        lifecycle.
      </p>
      <section className="events-create-panel">
        <div className="events-create-panel__header">
          <div>
            <h3>Admin Session</h3>
            <p>Signed in as {activeUser?.email ?? "Unknown"}.</p>
          </div>
        </div>
      </section>

      {!currentEvent && (
        <section className="events-create-panel">
          <div className="events-create-panel__header">
            <div>
              <h3>Create Current Event</h3>
              <p>No active event exists. Create one to open the next season.</p>
            </div>
          </div>
          <form className="form" onSubmit={onCreateEventSubmit} noValidate>
            <label>
              Title
              <input
                type="text"
                value={createEventForm.title}
                onChange={(event) => onCreateEventChange({ ...createEventForm, title: event.target.value })}
                maxLength={80}
                required
              />
            </label>
            <label>
              Game
              <input
                type="text"
                value={createEventForm.game}
                onChange={(event) => onCreateEventChange({ ...createEventForm, game: event.target.value })}
                maxLength={40}
                required
              />
            </label>
            <label>
              Timezone
              <input
                type="text"
                value={createEventForm.timezone}
                onChange={(event) => onCreateEventChange({ ...createEventForm, timezone: event.target.value })}
                maxLength={64}
                required
              />
            </label>
            <label>
              Registration opens
              <input
                type="datetime-local"
                value={toDateTimeLocalValue(createEventForm.registrationOpensAt)}
                onChange={(event) =>
                  onCreateEventChange({ ...createEventForm, registrationOpensAt: toIsoStringValue(event.target.value) })
                }
                required
              />
            </label>
            <label>
              Registration closes
              <input
                type="datetime-local"
                value={toDateTimeLocalValue(createEventForm.registrationClosesAt)}
                onChange={(event) =>
                  onCreateEventChange({ ...createEventForm, registrationClosesAt: toIsoStringValue(event.target.value) })
                }
                required
              />
            </label>
            <label>
              Starts at
              <input
                type="datetime-local"
                value={toDateTimeLocalValue(createEventForm.startsAt)}
                onChange={(event) =>
                  onCreateEventChange({ ...createEventForm, startsAt: toIsoStringValue(event.target.value) })
                }
                required
              />
            </label>
            <button type="submit" disabled={isCreatingEvent}>
              {isCreatingEvent ? "Creating..." : "Create current event"}
            </button>
          </form>
        </section>
      )}

      {currentEvent && (
        <section className="events-catalog-panel">
          <div className="events-catalog-panel__header">
            <div>
              <h3>Current Event Control</h3>
              <p>Use this action to finish the active event and unlock the next one.</p>
            </div>
          </div>
          <div className="events-grid">
            <article className="event-card" key={currentEvent.id}>
              <div className="event-card__topline">
                <h4>{currentEvent.title}</h4>
                <span className={`event-status status-pill status-pill--${currentEvent.status}`}>
                  {currentEvent.status}
                </span>
              </div>
              <p>{currentEvent.game}</p>
              <p>
                {formatDateTime(currentEvent.registrationOpensAt)} to {formatDateTime(currentEvent.registrationClosesAt)}
              </p>
              <p>Starts {formatDateTime(currentEvent.startsAt)}</p>
              <p>
                {currentEvent.registrationCount} team{currentEvent.registrationCount === 1 ? "" : "s"} registered
              </p>
              <button
                type="button"
                className="secondary-btn"
                disabled={!currentEvent.canStartCurrentEvent || isStartingCurrentEvent || isCompletingCurrentEvent}
                onClick={onStartCurrentEvent}
              >
                {isStartingCurrentEvent ? "Starting..." : "Start current event"}
              </button>
              <button
                type="button"
                className="secondary-btn"
                disabled={isCompletingCurrentEvent || currentEvent.status !== "in_progress"}
                onClick={onCompleteCurrentEvent}
              >
                {isCompletingCurrentEvent ? "Completing..." : "Complete current event"}
              </button>
            </article>
          </div>
        </section>
      )}

      {eventsStatus.kind !== "idle" && <p className={`status ${eventsStatus.kind}`}>{eventsStatus.message}</p>}
    </>
  );
}

function toDateTimeLocalValue(isoValue: string): string {
  if (!isoValue) {
    return "";
  }

  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetMinutes = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offsetMinutes * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function toIsoStringValue(localValue: string): string {
  if (!localValue) {
    return "";
  }

  const date = new Date(localValue);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
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
