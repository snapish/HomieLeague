import { useMemo, useState } from "react";
import type { EventMatchSummary, EventSummary, PlayerTeamSummary } from "@homieleague/shared";
import type { RequestStatus } from "../types/ui";

interface EventsPanelProps {
  team: PlayerTeamSummary | null;
  currentEvent: EventSummary | null;
  matches: EventMatchSummary[];
  isLoadingEvents: boolean;
  isRegisteringCurrentEvent: boolean;
  proposingScheduleMatchId: string | null;
  respondingScheduleMatchId: string | null;
  updatingMatchId: string | null;
  reportingMatchId: string | null;
  eventsStatus: RequestStatus;
  onRegisterCurrentEvent: () => void;
  onUpdateMatchStatus: (matchId: string, status: "scheduled" | "in_progress") => void;
  onProposeMatchSchedule: (matchId: string, proposedStartAt: string) => void;
  onRespondMatchSchedule: (matchId: string, proposalId: string, decision: "accept" | "reject") => void;
  onReportMatchResult: (matchId: string, winnerTeamId: string, adminOverride?: boolean) => void;
}

export function EventsPanel({
  team,
  currentEvent,
  matches,
  isLoadingEvents,
  isRegisteringCurrentEvent,
  proposingScheduleMatchId,
  respondingScheduleMatchId,
  updatingMatchId,
  reportingMatchId,
  eventsStatus,
  onRegisterCurrentEvent,
  onUpdateMatchStatus,
  onProposeMatchSchedule,
  onRespondMatchSchedule,
  onReportMatchResult
}: EventsPanelProps) {
  const [winnerByMatch, setWinnerByMatch] = useState<Record<string, string>>({});
  const [proposedStartByMatch, setProposedStartByMatch] = useState<Record<string, string>>({});

  const winnerFallback = useMemo(() => {
    const seed: Record<string, string> = {};
    for (const match of matches) {
      if (match.yourReportedWinnerTeamId) {
        seed[match.id] = match.yourReportedWinnerTeamId;
      }
    }
    return seed;
  }, [matches]);

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

      {currentEvent && matches.length > 0 && (
        <section className="events-catalog-panel">
          <div className="events-catalog-panel__header">
            <div>
              <h3>Current Matches</h3>
              <p>Track match state and submit results here.</p>
            </div>
          </div>

          <div className="events-grid">
            {matches.map((match) => {
              const selectedWinner = winnerByMatch[match.id] ?? winnerFallback[match.id] ?? "";
              const proposedStartLocal =
                proposedStartByMatch[match.id] ??
                toDateTimeLocalValue(match.latestScheduleProposal?.proposedStartAt ?? "");
              const hasTwoTeams = Boolean(match.teamAId && match.teamBId);

              return (
                <article className="event-card" key={match.id}>
                  <div className="event-card__topline">
                    <h4>
                      Round {match.roundNumber} • Match {match.slotNumber}
                    </h4>
                    <span className={`event-status status-pill status-pill--${match.status}`}>{match.status}</span>
                  </div>
                  <p>
                    {match.teamAName ?? "TBD"} vs {match.teamBName ?? "TBD"}
                  </p>
                  <p>
                    Winner: {resolveTeamName(match, match.winnerTeamId) ?? "Not decided"}
                  </p>
                  <p>
                    Scheduled time: {match.scheduledStartAt ? formatDateTime(match.scheduledStartAt) : "Not scheduled"}
                  </p>

                  {match.latestScheduleProposal && (
                    <p>
                      Latest proposal: {formatDateTime(match.latestScheduleProposal.proposedStartAt)} by {match.latestScheduleProposal.proposedByTeamName ?? "Unknown"} ({match.latestScheduleProposal.status})
                    </p>
                  )}

                  {match.canProposeSchedule && hasTwoTeams && (
                    <>
                      <label>
                        Propose match time
                        <input
                          type="datetime-local"
                          value={proposedStartLocal}
                          onChange={(event) => {
                            setProposedStartByMatch((previous) => ({
                              ...previous,
                              [match.id]: event.target.value
                            }));
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        className="secondary-btn"
                        disabled={!proposedStartLocal || proposingScheduleMatchId === match.id}
                        onClick={() => {
                          const iso = toIsoStringValue(proposedStartLocal);
                          if (iso) {
                            onProposeMatchSchedule(match.id, iso);
                          }
                        }}
                      >
                        {proposingScheduleMatchId === match.id ? "Submitting..." : "Propose time"}
                      </button>
                    </>
                  )}

                  {match.canRespondToScheduleProposal &&
                    match.latestScheduleProposal &&
                    match.latestScheduleProposal.status === "pending" && (
                      <>
                        <button
                          type="button"
                          className="secondary-btn"
                          disabled={respondingScheduleMatchId === match.id}
                          onClick={() =>
                            onRespondMatchSchedule(
                              match.id,
                              match.latestScheduleProposal?.id ?? "",
                              "accept"
                            )
                          }
                        >
                          {respondingScheduleMatchId === match.id ? "Applying..." : "Accept proposal"}
                        </button>
                        <button
                          type="button"
                          className="secondary-btn"
                          disabled={respondingScheduleMatchId === match.id}
                          onClick={() =>
                            onRespondMatchSchedule(
                              match.id,
                              match.latestScheduleProposal?.id ?? "",
                              "reject"
                            )
                          }
                        >
                          {respondingScheduleMatchId === match.id ? "Applying..." : "Reject proposal"}
                        </button>
                      </>
                    )}

                  {match.canTransitionToScheduled && (
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={updatingMatchId === match.id}
                      onClick={() => onUpdateMatchStatus(match.id, "scheduled")}
                    >
                      {updatingMatchId === match.id ? "Updating..." : "Move to scheduled"}
                    </button>
                  )}

                  {match.canTransitionToInProgress && (
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={updatingMatchId === match.id}
                      onClick={() => onUpdateMatchStatus(match.id, "in_progress")}
                    >
                      {updatingMatchId === match.id ? "Updating..." : "Move to in progress"}
                    </button>
                  )}

                  {(match.canReportResult || match.canManageLifecycle) && hasTwoTeams && (
                    <>
                      <label>
                        Report winner
                        <select
                          value={selectedWinner}
                          onChange={(event) => {
                            setWinnerByMatch((previous) => ({
                              ...previous,
                              [match.id]: event.target.value
                            }));
                          }}
                        >
                          <option value="">Select winner</option>
                          {match.teamAId && <option value={match.teamAId}>{match.teamAName ?? "Team A"}</option>}
                          {match.teamBId && <option value={match.teamBId}>{match.teamBName ?? "Team B"}</option>}
                        </select>
                      </label>

                      {match.canReportResult && (
                        <button
                          type="button"
                          className="secondary-btn"
                          disabled={!selectedWinner || reportingMatchId === match.id}
                          onClick={() => onReportMatchResult(match.id, selectedWinner, false)}
                        >
                          {reportingMatchId === match.id ? "Submitting..." : "Submit result"}
                        </button>
                      )}

                      {match.canManageLifecycle && (
                        <button
                          type="button"
                          className="secondary-btn"
                          disabled={!selectedWinner || reportingMatchId === match.id}
                          onClick={() => onReportMatchResult(match.id, selectedWinner, true)}
                        >
                          {reportingMatchId === match.id ? "Applying..." : "Admin override"}
                        </button>
                      )}
                    </>
                  )}

                  {match.isAwaitingOpponentConfirmation && (
                    <p>Waiting for opponent confirmation.</p>
                  )}

                  {match.hasResultConflict && (
                    <p>Conflicting reports detected. Admin override required.</p>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {eventsStatus.kind !== "idle" && <p className={`status ${eventsStatus.kind}`}>{eventsStatus.message}</p>}
    </>
  );
}

function resolveTeamName(match: EventMatchSummary, teamId: string | null): string | null {
  if (!teamId) {
    return null;
  }

  if (match.teamAId === teamId) {
    return match.teamAName;
  }

  if (match.teamBId === teamId) {
    return match.teamBName;
  }

  return null;
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
