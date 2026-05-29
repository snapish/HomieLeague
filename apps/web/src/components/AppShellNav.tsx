import type { RouteKey } from "../types/ui";

interface AppShellNavProps {
  route: RouteKey;
  isAdmin: boolean;
  onNavigate: (route: RouteKey) => void;
}

export function AppShellNav({ route, isAdmin, onNavigate }: AppShellNavProps) {
  return (
    <aside className="shell-nav">
      <h2>App Shell</h2>
      <button
        type="button"
        className={route === "app-overview" ? "nav-btn active" : "nav-btn"}
        onClick={() => onNavigate("app-overview")}
      >
        Dashboard
      </button>
      <button
        type="button"
        className={route === "app-team" ? "nav-btn active" : "nav-btn"}
        onClick={() => onNavigate("app-team")}
      >
        Team Hub
      </button>
      <button
        type="button"
        className={route === "app-events" ? "nav-btn active" : "nav-btn"}
        onClick={() => onNavigate("app-events")}
      >
        Current Event
      </button>
      {isAdmin && (
        <button
          type="button"
          className={route === "app-admin" ? "nav-btn active" : "nav-btn"}
          onClick={() => onNavigate("app-admin")}
        >
          Admin
        </button>
      )}
      <p className="guard-note">Guard active: unauthenticated users are redirected to #/auth.</p>
    </aside>
  );
}
