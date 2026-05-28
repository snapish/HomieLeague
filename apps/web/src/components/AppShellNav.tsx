import type { RouteKey } from "../types/ui";

interface AppShellNavProps {
  route: RouteKey;
  onNavigate: (route: RouteKey) => void;
}

export function AppShellNav({ route, onNavigate }: AppShellNavProps) {
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
      <p className="guard-note">Guard active: unauthenticated users are redirected to #/auth.</p>
    </aside>
  );
}
