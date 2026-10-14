export function safeSameOriginUrl(requestedPath: string, origin: string) {
  const fallback = new URL("/", origin);
  if (!requestedPath.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(requestedPath)) {
    return fallback;
  }

  try {
    const candidate = new URL(requestedPath, origin);
    return candidate.origin === fallback.origin ? candidate : fallback;
  } catch {
    return fallback;
  }
}
