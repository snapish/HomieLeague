import type { FormEvent } from "react";
import type { LoginRequest, SignupRequest } from "@homieleague/shared";
import type { RequestStatus } from "../types/ui";

interface AuthPanelsProps {
  signupForm: SignupRequest;
  loginForm: LoginRequest;
  signupStatus: RequestStatus;
  loginStatus: RequestStatus;
  isSubmittingSignup: boolean;
  isSubmittingLogin: boolean;
  onSignupChange: (next: SignupRequest) => void;
  onLoginChange: (next: LoginRequest) => void;
  onSignupSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onLoginSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

export function AuthPanels({
  signupForm,
  loginForm,
  signupStatus,
  loginStatus,
  isSubmittingSignup,
  isSubmittingLogin,
  onSignupChange,
  onLoginChange,
  onSignupSubmit,
  onLoginSubmit
}: AuthPanelsProps) {
  return (
    <section className="panel-grid" aria-label="Authentication">
      <article className="panel">
        <h2>Create account</h2>
        <form onSubmit={onSignupSubmit} className="form" noValidate>
          <label>
            Email
            <input
              type="email"
              value={signupForm.email}
              onChange={(event) => onSignupChange({ ...signupForm, email: event.target.value })}
              required
            />
          </label>
          <label>
            Username
            <input
              type="text"
              value={signupForm.username}
              onChange={(event) => onSignupChange({ ...signupForm, username: event.target.value })}
              required
            />
          </label>
          <label>
            SteamID64
            <input
              type="text"
              inputMode="numeric"
              value={signupForm.steamId}
              onChange={(event) => onSignupChange({ ...signupForm, steamId: event.target.value })}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={signupForm.password}
              onChange={(event) => onSignupChange({ ...signupForm, password: event.target.value })}
              required
            />
          </label>
          <button type="submit" disabled={isSubmittingSignup}>
            {isSubmittingSignup ? "Submitting..." : "Sign up"}
          </button>
        </form>
        {signupStatus.kind !== "idle" && <p className={`status ${signupStatus.kind}`}>{signupStatus.message}</p>}
      </article>

      <article className="panel">
        <h2>Log in</h2>
        <form onSubmit={onLoginSubmit} className="form" noValidate>
          <label>
            Email or username
            <input
              type="text"
              value={loginForm.identifier}
              onChange={(event) => onLoginChange({ ...loginForm, identifier: event.target.value })}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={loginForm.password}
              onChange={(event) => onLoginChange({ ...loginForm, password: event.target.value })}
              required
            />
          </label>
          <button type="submit" disabled={isSubmittingLogin}>
            {isSubmittingLogin ? "Submitting..." : "Log in"}
          </button>
        </form>
        {loginStatus.kind !== "idle" && <p className={`status ${loginStatus.kind}`}>{loginStatus.message}</p>}
      </article>
    </section>
  );
}
