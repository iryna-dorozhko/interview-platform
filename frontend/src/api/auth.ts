import { ApiError, fetchWithAuth, setStoredToken } from "./client";

export type AuthUser = {
  id: string;
  email: string;
  role: "HR" | "CANDIDATE";
};

type LoginResponse = {
  token: string;
  user: AuthUser;
};

type MeResponse = {
  user: AuthUser;
};

type ErrorBody = { error?: string };

async function parseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ErrorBody;
    return body.error ?? "Помилка запиту";
  } catch {
    return "Помилка запиту";
  }
}

export async function loginHr(email: string, password: string): Promise<AuthUser> {
  const response = await fetch("/api/auth/hr/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const message = await parseError(response);
    throw new ApiError(message, response.status);
  }

  const data = (await response.json()) as LoginResponse;
  setStoredToken(data.token);
  return data.user;
}

export async function registerCandidate(
  email: string,
  password: string,
): Promise<AuthUser> {
  const response = await fetch("/api/auth/candidate/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const message = await parseError(response);
    throw new ApiError(message, response.status);
  }

  const data = (await response.json()) as LoginResponse;
  setStoredToken(data.token);
  return data.user;
}

export async function loginCandidate(
  email: string,
  password: string,
): Promise<AuthUser> {
  const response = await fetch("/api/auth/candidate/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const message = await parseError(response);
    throw new ApiError(message, response.status);
  }

  const data = (await response.json()) as LoginResponse;
  setStoredToken(data.token);
  return data.user;
}

export async function fetchMe(): Promise<AuthUser> {
  const response = await fetchWithAuth("/api/auth/me");

  if (!response.ok) {
    const message = await parseError(response);
    throw new ApiError(message, response.status);
  }

  const data = (await response.json()) as MeResponse;
  return data.user;
}

export function clearSession(): void {
  setStoredToken(null);
}
