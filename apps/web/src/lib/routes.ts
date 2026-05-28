import type { RouteKey } from "../types/ui";

export function routeFromHash(hash: string): RouteKey {
  const cleanHash = hash.trim();

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
  const target =
    route === "auth"
      ? "#/auth"
      : route === "app-team"
        ? "#/app/team"
        : route === "app-events"
          ? "#/app/events"
          : "#/app";

  if (window.location.hash !== target) {
    window.location.hash = target;
  }
}
