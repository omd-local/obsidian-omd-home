import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_LAYOUT, movePlacement, normalizeLayout, overlaps } from "../src/layout.ts";

test("normalization restores missing widgets and clamps geometry", () => {
  const result = normalizeLayout([{ id: "omnibox", x: -5, y: -2, w: 99, h: 0 }]);
  assert.equal(result.length, DEFAULT_LAYOUT.length);
  assert.deepEqual(result.find((item) => item.id === "omnibox"), {
    id: "omnibox", x: 0, y: 0, w: 12, h: 2, hidden: false,
  });
});

test("move pushes collisions and keeps every widget", () => {
  const moved = movePlacement(DEFAULT_LAYOUT, "inbox", { x: 0, y: 2, w: 5, h: 4 });
  const inbox = moved.find((item) => item.id === "inbox");
  const today = moved.find((item) => item.id === "today");
  assert.deepEqual(inbox && { x: inbox.x, y: inbox.y }, { x: 0, y: 2 });
  assert.ok(today);
  assert.ok(today.y >= 6);
  for (const item of moved) {
    for (const other of moved) {
      if (item.id < other.id && !item.hidden && !other.hidden) assert.equal(overlaps(item, other), false);
    }
  }
});

test("overlap requires area, not touching edges", () => {
  assert.equal(overlaps(
    { id: "inbox", x: 0, y: 0, w: 3, h: 2 },
    { id: "today", x: 3, y: 0, w: 3, h: 2 },
  ), false);
});
