import type { NotificationSummary } from "@homieleague/shared";
import type { RequestStatus } from "../types/ui";

interface NotificationsPanelProps {
  notifications: NotificationSummary[];
  unreadCount: number;
  isLoadingNotifications: boolean;
  isMarkingNotificationsRead: boolean;
  notificationsStatus: RequestStatus;
  onMarkAllRead: () => void;
}

export function NotificationsPanel({
  notifications,
  unreadCount,
  isLoadingNotifications,
  isMarkingNotificationsRead,
  notificationsStatus,
  onMarkAllRead
}: NotificationsPanelProps) {
  return (
    <section className="events-catalog-panel" aria-label="Notifications">
      <div className="events-catalog-panel__header">
        <div>
          <h3>Notifications</h3>
          <p>{isLoadingNotifications ? "Loading notifications..." : `${unreadCount} unread`}</p>
        </div>
        <button
          type="button"
          className="secondary-btn"
          disabled={isMarkingNotificationsRead || unreadCount === 0}
          onClick={onMarkAllRead}
        >
          {isMarkingNotificationsRead ? "Marking..." : "Mark all read"}
        </button>
      </div>

      {notifications.length === 0 ? (
        <p>No notifications yet.</p>
      ) : (
        <ul className="notifications-list">
          {notifications.map((notification) => (
            <li key={notification.id} className={`notification-item ${notification.readAt ? "" : "notification-item--unread"}`}>
              <div className="notification-item__topline">
                <strong>{notification.title}</strong>
                <span>{formatDateTime(notification.createdAt)}</span>
              </div>
              <p>{notification.message}</p>
            </li>
          ))}
        </ul>
      )}

      {notificationsStatus.kind !== "idle" && (
        <p className={`status ${notificationsStatus.kind}`}>{notificationsStatus.message}</p>
      )}
    </section>
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
