/** Tiny typed fetch wrapper. Session cookie auth + CSRF header on every write. */

let csrfToken = "";

export function setCsrf(token: string | undefined) {
  if (token) csrfToken = token;
}

export class ApiError extends Error {
  status: number;
  errors: string[];
  constructor(message: string, status: number, errors: string[] = []) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

type Body = Record<string, unknown> | FormData | undefined;

async function request<T>(method: string, path: string, body?: Body): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let payload: BodyInit | undefined;
  if (method !== "GET") headers["X-CSRF-Token"] = csrfToken;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (data && typeof data === "object" && "csrf" in data) setCsrf(data.csrf as string);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth")) {
      window.dispatchEvent(new CustomEvent("cl:unauthorized"));
    }
    throw new ApiError((data as { error?: string }).error || `Request failed (${res.status})`, res.status,
      (data as { errors?: string[] }).errors || []);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: Body) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: Body) => request<T>("PUT", path, body ?? {}),
  del: <T>(path: string, body?: Body) => request<T>("DELETE", path, body ?? {}),
};

/** Build a query string, skipping empty values. */
export function qs(params: object) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Convert a plain object (plus optional files) into FormData for multipart endpoints. */
export function toForm(values: Record<string, unknown>, files: Record<string, File | null | undefined> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === null) continue;
    fd.append(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  }
  for (const [k, f] of Object.entries(files)) if (f) fd.append(k, f);
  return fd;
}

export function errorMessage(err: unknown) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

/** POST that returns a binary Blob (live PDF previews). */
export async function postBlob(path: string, body: Record<string, unknown>): Promise<Blob> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError((data as { error?: string }).error || `Preview failed (${res.status})`, res.status);
  }
  return res.blob();
}
