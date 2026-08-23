import type { WidgetId, WidgetPlacement } from "./model";

export const GRID_COLUMNS = 12;
export const MIN_WIDGET_WIDTH = 3;
export const MIN_WIDGET_HEIGHT = 2;

export const DEFAULT_LAYOUT: WidgetPlacement[] = [
  { id: "omnibox", x: 0, y: 0, w: 12, h: 2 },
  { id: "today", x: 0, y: 2, w: 6, h: 6 },
  { id: "inbox", x: 6, y: 2, w: 6, h: 6 },
  { id: "processing", x: 0, y: 8, w: 6, h: 4 },
  { id: "attention", x: 6, y: 8, w: 6, h: 4 },
  { id: "recent", x: 0, y: 12, w: 6, h: 4 },
  { id: "upcoming", x: 6, y: 12, w: 6, h: 4 },
  { id: "pinned", x: 0, y: 16, w: 4, h: 4 },
  { id: "tags", x: 4, y: 16, w: 4, h: 4 },
  { id: "status", x: 8, y: 16, w: 4, h: 4 },
];

export const PREVIOUS_DEFAULT_LAYOUT: WidgetPlacement[] = [
  { id: "omnibox", x: 0, y: 0, w: 12, h: 2 },
  { id: "today", x: 0, y: 2, w: 6, h: 6 },
  { id: "inbox", x: 6, y: 2, w: 6, h: 6 },
  { id: "processing", x: 0, y: 8, w: 6, h: 4 },
  { id: "attention", x: 6, y: 8, w: 6, h: 4 },
  { id: "recent", x: 0, y: 12, w: 4, h: 4 },
  { id: "upcoming", x: 4, y: 12, w: 4, h: 4 },
  { id: "continue", x: 8, y: 12, w: 4, h: 4 },
  { id: "pinned", x: 0, y: 16, w: 4, h: 4 },
  { id: "tags", x: 4, y: 16, w: 4, h: 4 },
  { id: "status", x: 8, y: 16, w: 4, h: 4 },
];

export const LEGACY_DEFAULT_LAYOUT: WidgetPlacement[] = [
  { id: "omnibox", x: 0, y: 0, w: 12, h: 2 },
  { id: "today", x: 0, y: 2, w: 7, h: 7 },
  { id: "inbox", x: 7, y: 2, w: 5, h: 4 },
  { id: "processing", x: 7, y: 6, w: 5, h: 3 },
  { id: "recent", x: 0, y: 9, w: 5, h: 4 },
  { id: "upcoming", x: 5, y: 9, w: 4, h: 4 },
  { id: "attention", x: 9, y: 9, w: 3, h: 4 },
  { id: "continue", x: 0, y: 13, w: 4, h: 3 },
  { id: "pinned", x: 4, y: 13, w: 5, h: 3 },
  { id: "status", x: 9, y: 13, w: 3, h: 3 },
  { id: "tags", x: 0, y: 16, w: 12, h: 3 },
];

export function migrateLegacyLayout(layout: WidgetPlacement[]): WidgetPlacement[] {
  const normalized = normalizeLayout(layout);
  const matchesKnownDefault = [LEGACY_DEFAULT_LAYOUT, PREVIOUS_DEFAULT_LAYOUT].some((knownDefault) => knownDefault.every((fallback) => {
    const placement = normalized.find((item) => item.id === fallback.id);
    return placement
      && placement.x === fallback.x
      && placement.y === fallback.y
      && placement.w === fallback.w
      && placement.h === fallback.h;
  }));
  if (!matchesKnownDefault) return normalized;
  return DEFAULT_LAYOUT.map((placement) => ({
    ...placement,
    hidden: normalized.find((item) => item.id === placement.id)?.hidden ?? false,
  }));
}

export function normalizeLayout(layout: WidgetPlacement[]): WidgetPlacement[] {
  const seen = new Set<WidgetId>();
  const normalized: WidgetPlacement[] = [];
  for (const placement of layout) {
    if (seen.has(placement.id)) continue;
    seen.add(placement.id);
    normalized.push(clampPlacement(placement));
  }
  for (const fallback of DEFAULT_LAYOUT) {
    if (!seen.has(fallback.id)) normalized.push({ ...fallback });
  }
  return normalized;
}

export function clampPlacement(value: WidgetPlacement): WidgetPlacement {
  const w = clamp(Math.round(value.w), MIN_WIDGET_WIDTH, GRID_COLUMNS);
  const h = Math.max(MIN_WIDGET_HEIGHT, Math.round(value.h));
  return {
    ...value,
    x: clamp(Math.round(value.x), 0, GRID_COLUMNS - w),
    y: Math.max(0, Math.round(value.y)),
    w,
    h,
    hidden: Boolean(value.hidden),
  };
}

export function movePlacement(
  layout: WidgetPlacement[],
  id: WidgetId,
  next: Pick<WidgetPlacement, "x" | "y" | "w" | "h">,
): WidgetPlacement[] {
  const moving = clampPlacement({ id, ...next });
  const byId = new Map(normalizeLayout(layout).map((item) => [item.id, { ...item }]));
  byId.set(id, moving);
  const queue: WidgetId[] = [id];
  const visited = new Set<WidgetId>();

  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId) break;
    const current = byId.get(currentId);
    if (!current || current.hidden) continue;
    visited.add(currentId);
    const collisions = [...byId.values()]
      .filter((item) => item.id !== currentId && !item.hidden && overlaps(current, item))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    for (const collision of collisions) {
      if (collision.id === id) continue;
      const pushed = clampPlacement({ ...collision, y: current.y + current.h });
      if (pushed.y === collision.y && visited.has(collision.id)) continue;
      byId.set(collision.id, pushed);
      queue.push(collision.id);
    }
  }

  return compactLayout([...byId.values()], id);
}

function compactLayout(layout: WidgetPlacement[], movingId: WidgetId): WidgetPlacement[] {
  const ordered = [...layout].sort((a, b) => {
    if (a.id === movingId) return -1;
    if (b.id === movingId) return 1;
    return a.y - b.y || a.x - b.x;
  });
  const placed: WidgetPlacement[] = [];
  for (const item of ordered) {
    let candidate = { ...item };
    if (!candidate.hidden && candidate.id !== movingId) {
      while (candidate.y > 0) {
        const upward = { ...candidate, y: candidate.y - 1 };
        if (placed.some((other) => !other.hidden && overlaps(upward, other))) break;
        candidate = upward;
      }
    }
    placed.push(candidate);
  }
  return normalizeLayout(placed);
}

export function overlaps(a: WidgetPlacement, b: WidgetPlacement): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
