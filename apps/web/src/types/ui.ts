export type RequestStatus = {
  kind: "idle" | "success" | "error";
  message: string;
};

export type RouteKey = "auth" | "app-overview" | "app-team" | "app-events";
