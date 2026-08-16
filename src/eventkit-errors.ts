export function eventKitErrorMessage(stderr: string): string {
  const tokens = normalize(stderr);
  if (!tokens) return "Calendar helper failed. Check the local EventKit setup and try again.";
  if (tokens.includes("calendar access was not granted")) {
    return "Calendar access was not granted in System Settings.";
  }
  if (tokens.includes("selected calendar is unavailable") || tokens.includes("no longer writable")) {
    return "The selected Calendar is unavailable or no longer writable.";
  }
  if (tokens.includes("calendar event no longer exists")) {
    return "The Calendar event no longer exists.";
  }
  if (
    tokens.includes("missing --")
    || tokens.includes("invalid iso-8601 date")
    || tokens.includes("expected version, calendars, events, upsert, or delete")
    || tokens.includes("unknown eventkit command")
  ) {
    return "Calendar helper rejected the request. Check OMD Home settings and try again.";
  }
  return "Calendar helper failed. Check the local EventKit setup and try again.";
}

export function eventKitProcessErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  const tokens = normalize(detail);
  if (tokens.includes("enoent") || tokens.includes("not found")) {
    return "The configured EventKit helper could not be found.";
  }
  if (tokens.includes("eacces") || tokens.includes("permission denied")) {
    return "The configured EventKit helper could not be started. Check its permissions and try again.";
  }
  return "Calendar helper failed to start. Check the local EventKit setup and try again.";
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
