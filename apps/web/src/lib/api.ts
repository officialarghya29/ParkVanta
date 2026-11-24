import type { LoginResponse, User } from "./types";

interface ParkVantaRuntimeConfig {
  API_BASE_URL?: string;
}

declare global {
  interface Window {
    __PARKVANTA_CONFIG__?: ParkVantaRuntimeConfig;
  }
}

const BUILD_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();

function resolveApiBaseUrl(): string {
  const runtimeBaseUrl =
    typeof window !== "undefined" ? window.__PARKVANTA_CONFIG__?.API_BASE_URL?.trim() : undefined;
  const configured = runtimeBaseUrl || BUILD_API_BASE_URL;
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  if (import.meta.env.DEV) {
    return "http://localhost:8080/api/v1";
  }
  return "";
}

export const API_BASE_URL = resolveApiBaseUrl();

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

let session: Session | null = null;
let refreshPromise: Promise<Session | null> | null = null;

export function getSession(): Session | null {
  return session;
}

export function saveSession(next: Session): void {
  session = next;
}

export function clearSession(): void {
  session = null;
}

export async function restoreSession(): Promise<Session | null> {
  if (session) return session;
  return tryRefresh();
}

export function setSessionFromLogin(payload: LoginResponse): Session {
  const next = { accessToken: payload.access_token, user: payload.user };
  saveSession(next);
  return next;
}

async function tryRefresh(): Promise<Session | null> {
  if (!API_BASE_URL) {
    clearSession();
    return null;
  }
  if (refreshPromise) return refreshPromise;
  const pending = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: "{}",
      });
      if (!response.ok) {
        clearSession();
        return null;
      }
      const payload = (await response.json()) as LoginResponse;
      saveSession({ accessToken: payload.access_token, user: payload.user });
      return session;
    } catch {
      clearSession();
      return null;
    }
  })();
  refreshPromise = pending;
  try {
    return await pending;
  } finally {
    if (refreshPromise === pending) refreshPromise = null;
  }
}

type ApiOptions = Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit | null };

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  if (!API_BASE_URL) {
    throw new RequestError(
      0,
      "configuration_error",
      "API base URL is not configured (VITE_API_BASE_URL).",
    );
  }
  const { json, ...init } = options;
  const headers = new Headers(init.headers);
  headers.set("X-Requested-With", "XMLHttpRequest");
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
