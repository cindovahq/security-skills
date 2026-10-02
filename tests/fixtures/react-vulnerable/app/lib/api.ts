import { config } from "./config";

const TOKEN_KEY = "acme_token";

export function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const token = getToken();
  const res = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export async function adminFetch(path: string) {
  const res = await fetch(`${config.apiUrl}${path}`, {
    headers: { "X-Admin-Token": config.adminToken, "X-Support-Key": config.supportKey },
  });
  return res.json();
}
