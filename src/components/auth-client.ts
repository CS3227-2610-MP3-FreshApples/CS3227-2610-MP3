export type AuthAccount = Readonly<{
  id: string;
  displayName: string;
  role: "USER" | "ADMIN";
  status: "active" | "suspended";
  version: number;
}>;

export type LoginInput = Readonly<{
  email: string;
  password: string;
}>;

export type RegistrationInput = Readonly<{
  displayName: string;
  email: string;
  password: string;
  confirmPassword: string;
}>;

export type LoginResult =
  | Readonly<{ ok: true; account: AuthAccount }>
  | Readonly<{
      ok: false;
      kind: "unauthenticated" | "rate_limited" | "unavailable";
    message: string;
  }>;

export type RegistrationResult =
  | Readonly<{ ok: true; account: AuthAccount }>
  | Readonly<{
      ok: false;
      kind: "conflict" | "unavailable" | "validation";
      message?: string;
      fieldErrors?: Readonly<Record<string, readonly string[]>>;
    }>;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const GENERIC_LOGIN_MESSAGE = "We couldn’t sign you in. Check your email and password.";
const RATE_LIMITED_MESSAGE = "Too many sign-in attempts. Please try again later.";
const UNAVAILABLE_MESSAGE = "We couldn’t sign you in right now. Please try again later.";
const DUPLICATE_EMAIL_MESSAGE = "An account may already exist for this email. Try signing in.";

function validAccount(value: unknown): value is AuthAccount {
  if (typeof value !== "object" || value === null) return false;
  const account = value as Record<string, unknown>;
  return typeof account.id === "string"
    && typeof account.displayName === "string"
    && (account.role === "USER" || account.role === "ADMIN")
    && (account.status === "active" || account.status === "suspended")
    && typeof account.version === "number";
}

function fieldErrors(value: unknown): Readonly<Record<string, readonly string[]>> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const errors = (value as { fieldErrors?: unknown }).fieldErrors;
  if (typeof errors !== "object" || errors === null) return undefined;

  const result: Record<string, readonly string[]> = {};
  for (const [field, messages] of Object.entries(errors)) {
    if (!Array.isArray(messages) || !messages.every((message) => typeof message === "string")) continue;
    result[field] = messages;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function resolveAuthDestination(account: Pick<AuthAccount, "role" | "status">): "/" | "/admin" | null {
  if (account.status !== "active") return null;
  if (account.role === "USER") return "/";
  if (account.role === "ADMIN") return "/admin";
  return null;
}

export async function submitLogin(input: LoginInput, fetcher: Fetcher = fetch): Promise<LoginResult> {
  try {
    const csrfResponse = await fetcher("/api/v1/auth/csrf", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!csrfResponse.ok) return { ok: false, kind: "unavailable", message: UNAVAILABLE_MESSAGE };

    const csrfBody: unknown = await csrfResponse.json();
    const csrfToken = typeof csrfBody === "object" && csrfBody !== null
      ? (csrfBody as { csrfToken?: unknown }).csrfToken
      : undefined;
    if (typeof csrfToken !== "string" || csrfToken.length === 0) {
      return { ok: false, kind: "unavailable", message: UNAVAILABLE_MESSAGE };
    }

    const loginResponse = await fetcher("/api/v1/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ email: input.email, password: input.password }),
    });

    if (loginResponse.status === 401) {
      return { ok: false, kind: "unauthenticated", message: GENERIC_LOGIN_MESSAGE };
    }
    if (loginResponse.status === 429) {
      return { ok: false, kind: "rate_limited", message: RATE_LIMITED_MESSAGE };
    }
    if (!loginResponse.ok) return { ok: false, kind: "unavailable", message: UNAVAILABLE_MESSAGE };

    const account: unknown = await loginResponse.json();
    if (!validAccount(account)) return { ok: false, kind: "unavailable", message: UNAVAILABLE_MESSAGE };
    return { ok: true, account };
  } catch {
    return { ok: false, kind: "unavailable", message: UNAVAILABLE_MESSAGE };
  }
}

export async function submitRegistration(input: RegistrationInput, fetcher: Fetcher = fetch): Promise<RegistrationResult> {
  if (input.password !== input.confirmPassword) {
    return {
      ok: false,
      kind: "validation",
      fieldErrors: { confirmPassword: ["Passwords do not match."] },
    };
  }

  try {
    const csrfResponse = await fetcher("/api/v1/auth/csrf", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!csrfResponse.ok) return { ok: false, kind: "unavailable", message: UNAVAILABLE_MESSAGE };

    const csrfBody: unknown = await csrfResponse.json();
    const csrfToken = typeof csrfBody === "object" && csrfBody !== null
      ? (csrfBody as { csrfToken?: unknown }).csrfToken
      : undefined;
    if (typeof csrfToken !== "string" || csrfToken.length === 0) {
      return { ok: false, kind: "unavailable", message: UNAVAILABLE_MESSAGE };
    }

    const registrationResponse = await fetcher("/api/v1/auth/register", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({
        displayName: input.displayName,
        email: input.email,
        password: input.password,
      }),
    });

    const body: unknown = await registrationResponse.json();
    if (registrationResponse.status === 422) {
      const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
      const errors = fieldErrors(error);
      return {
        ok: false,
        kind: "validation",
        ...(errors ? { fieldErrors: errors } : {}),
      };
    }
    if (registrationResponse.status === 409) {
      return { ok: false, kind: "conflict", message: DUPLICATE_EMAIL_MESSAGE };
    }
    if (registrationResponse.status !== 201 || !validAccount(body)) {
      return { ok: false, kind: "unavailable", message: UNAVAILABLE_MESSAGE };
    }

    return { ok: true, account: body };
  } catch {
    return { ok: false, kind: "unavailable", message: UNAVAILABLE_MESSAGE };
  }
}
