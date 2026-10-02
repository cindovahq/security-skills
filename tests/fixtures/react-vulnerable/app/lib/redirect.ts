export function toLocalPath(input: string | null | undefined, fallback = "/") {
  if (!input) return fallback;
  try {
    const base = "https://app.invalid";
    const url = new URL(input, base);
    if (url.origin !== base || /[\u0000-\u001F\\]/.test(input)) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
