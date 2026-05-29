import type { RouteKey } from "../types/ui";

const routeTargets: Record<RouteKey, string> = {
  auth: "#/auth",
  "app-overview": "#/app",
  "app-team": "#/app/team",
  "app-events": "#/app/events",
  "app-admin": "#/app/admin"
};

export function routeFromHash(hash: string): RouteKey {
  const cleanHash = hash.trim();

  if (cleanHash.startsWith("#/app/admin")) {
    return "app-admin";
  }
  if (cleanHash.startsWith("#/app/team")) {
    return "app-team";
  }
  if (cleanHash.startsWith("#/app/events")) {
    return "app-events";
  }
  if (cleanHash.startsWith("#/app")) {
    return "app-overview";
  }
  return "auth";
}

export function navigateTo(route: RouteKey): void {
  const target = routeTargets[route];

  if (window.location.hash !== target) {
    window.location.hash = target;
  }
}
