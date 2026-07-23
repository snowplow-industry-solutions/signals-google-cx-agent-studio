export function getSessionId() {
  if (typeof document === "undefined") {
    return null;
  }

  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (!trimmed.startsWith("_sp_id.")) {
      continue;
    }

    const value = trimmed.split("=")[1];
    const parts = value?.split(".") ?? [];
    return parts[5] ?? null;
  }

  return null;
}
