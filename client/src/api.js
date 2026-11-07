const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000/api/v1";

let accessToken = null;
let csrfToken = null;

export function setAccessToken(value) { accessToken = value; }
export function getAccessToken() { return accessToken; }

function readCookie(name) {
  return document.cookie.split("; ").find((item) => item.startsWith(`${name}=`))?.split("=").slice(1).join("=");
}

export async function bootstrapCsrf() {
  try {
    const response = await fetch(`${API_BASE}/auth/csrf`, { credentials: "include" });
    const body = await response.json();
    csrfToken = body.data?.csrfToken || readCookie("csrfToken") || null;
  } catch {
    csrfToken = readCookie("csrfToken") || null;
  }
  return csrfToken;
}

async function refreshAccess() {
  if (!csrfToken) await bootstrapCsrf();
  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: "POST", credentials: "include", headers: { "X-CSRF-Token": csrfToken || "" },
  });
  if (!response.ok) { setAccessToken(null); return false; }
  const body = await response.json();
  setAccessToken(body.data.accessToken);
  return true;
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData) && options.body !== undefined) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const method = (options.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    if (!csrfToken) await bootstrapCsrf();
    headers.set("X-CSRF-Token", csrfToken || "");
  }
  let response = await fetch(`${API_BASE}${path}`, { ...options, method, headers, credentials: "include" });
  if (response.status === 401 && path !== "/auth/login" && path !== "/auth/register" && path !== "/auth/refresh") {
    if (await refreshAccess()) {
      headers.set("Authorization", `Bearer ${accessToken}`);
      response = await fetch(`${API_BASE}${path}`, { ...options, method, headers, credentials: "include" });
    }
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || "The request could not be completed.");
    error.status = response.status;
    error.code = payload.error?.code;
    throw error;
  }
  return payload.data;
}
