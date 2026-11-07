import type { LoginResponse, User } from "./types";

export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8080/api/v1";

const STORAGE_KEY = "parkvanta.session";

export interface Session {
  accessToken: string;
  user: User;
}

export class RequestError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "RequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

let session: Session | null = readSession();

export function getSession(): Session | null {
  return session;
}

export function saveSession(next: Session): void {
  session = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function clearSession(): void {
  session = null;
  localStorage.removeItem(STORAGE_KEY);
}

export function setSessionFromLogin(payload: LoginResponse): Session {
  const next = { accessToken: payload.access_token, user: payload.user };
  saveSession(next);
  return next;
}

async function tryRefresh(): Promise<Session | null> {
  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    clearSession();
    return null;
  }
  const payload = (await response.json()) as LoginResponse;
  saveSession({ accessToken: payload.access_token, user: payload.user });
  return session;
}

type ApiOptions = Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit | null };

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { json, ...init } = options;
  const headers = new Headers(init.headers);
  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(json);
  }
  if (session?.accessToken) {
    headers.set("Authorization", `Bearer ${session.accessToken}`);
  }

  let response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  if (response.status === 401 && session && !path.startsWith("/auth/")) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      headers.set("Authorization", `Bearer ${refreshed.accessToken}`);
      response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers,
        credentials: "include",
      });
    }
  }

  if (!response.ok) {
    let code = "request_failed";
    let message = `Request failed (${response.status})`;
    let details: unknown;
    try {
      const body = (await response.json()) as {
        error?: { code?: string; message?: string; details?: unknown };
        detail?: unknown;
      };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
      details = body.error?.details ?? body.detail;
    } catch {
      // Non-JSON error body (proxy, gateway).
    }
    throw new RequestError(response.status, code, message, details);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
