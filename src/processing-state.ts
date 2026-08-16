import type { OmdProgressEvent } from "./model";

export type ProcessingTone = "active" | "done" | "error";

export interface ProcessingRow {
  label: string;
  value: string;
  tone: ProcessingTone;
}

export function summarizeProcessingEvents(
  events: OmdProgressEvent[],
  captureActive = inferCaptureActive(events),
): { active: ProcessingRow | null; recent: ProcessingRow[] } {
  if (!events.length) return { active: null, recent: [] };
  const active = captureActive ? summarizeActiveRun(events) : null;
  const recent = summarizeHistoricalRuns(captureActive ? historyBeforeActiveRun(events) : events);
  return { active, recent: recent.slice(0, 4) };
}

export function inferCaptureActive(events: OmdProgressEvent[]): boolean {
  const latest = events.at(-1);
  return latest ? !isTerminalEvent(latest) : false;
}

function summarizeActiveRun(events: OmdProgressEvent[]): ProcessingRow | null {
  const run = currentRun(events);
  const latest = run.at(-1);
  if (!latest) return null;
  const percent = [...run].reverse().find((event) => typeof event.percent === "number")?.percent;
  return {
    label: eventLabel(latest),
    value: typeof percent === "number" ? `${Math.round(percent)}%` : "working",
    tone: "active",
  };
}

function historyBeforeActiveRun(events: OmdProgressEvent[]): OmdProgressEvent[] {
  const terminalIndex = findLastTerminalIndex(events);
  return terminalIndex >= 0 ? events.slice(0, terminalIndex + 1) : [];
}

function currentRun(events: OmdProgressEvent[]): OmdProgressEvent[] {
  const terminalIndex = findLastTerminalIndex(events);
  return terminalIndex >= 0 ? events.slice(terminalIndex + 1) : [...events];
}

function summarizeHistoricalRuns(events: OmdProgressEvent[]): ProcessingRow[] {
  const rows: ProcessingRow[] = [];
  let index = events.length - 1;
  while (index >= 0 && rows.length < 4) {
    let terminalIndex = index;
    while (terminalIndex >= 0 && !isTerminalEvent(events[terminalIndex])) terminalIndex -= 1;
    const event = terminalIndex >= 0 ? events[terminalIndex] : events[index];
    rows.push({ label: eventLabel(event), value: terminalValue(event), tone: terminalTone(event) });
    if (terminalIndex < 0) break;
    index = terminalIndex - 1;
    while (index >= 0 && !isTerminalEvent(events[index])) index -= 1;
  }
  return rows;
}

function findLastTerminalIndex(events: OmdProgressEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (isTerminalEvent(events[index])) return index;
  }
  return -1;
}

function isTerminalEvent(event: OmdProgressEvent): boolean {
  const token = `${event.event} ${event.kind ?? ""}`.toLowerCase();
  return token.includes("done")
    || token.includes("complete")
    || token.includes("error")
    || token.includes("fatal")
    || token.includes("fail")
    || token.includes("cancel")
    || token.includes("finish")
    || (typeof event.percent === "number" && event.percent >= 100)
    || event.output !== undefined;
}

function terminalTone(event: OmdProgressEvent): ProcessingTone {
  return /\b(error|fail|fatal)\b/i.test(`${event.event} ${event.kind ?? ""}`) ? "error" : "done";
}

function terminalValue(event: OmdProgressEvent): string {
  const token = `${event.event} ${event.kind ?? ""}`.toLowerCase();
  if (token.includes("error") || token.includes("fail") || token.includes("fatal")) return "error";
  if (token.includes("cancel")) return "cancelled";
  return "completed";
}

function eventLabel(event: OmdProgressEvent): string {
  return event.label?.trim()
    || event.name?.trim()
    || event.message?.trim()
    || humanizeEventName(event.event);
}

function humanizeEventName(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase()) || "OMD";
}
