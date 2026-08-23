import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LAYOUT,
  LEGACY_DEFAULT_LAYOUT,
  PREVIOUS_DEFAULT_LAYOUT,
  migrateLegacyLayout,
  movePlacement,
  normalizeLayout,
  overlaps,
} from "../src/layout.ts";

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

test("default dashboard uses coherent rows without the redundant Continue widget", () => {
  const rowAt = (y: number) => DEFAULT_LAYOUT
    .filter((item) => item.y === y)
    .sort((a, b) => a.x - b.x)
    .map((item) => ({ x: item.x, w: item.w, h: item.h }));

  assert.deepEqual(rowAt(2), [
    { x: 0, w: 6, h: 6 },
    { x: 6, w: 6, h: 6 },
  ]);
  assert.deepEqual(rowAt(12), [
    { x: 0, w: 6, h: 4 },
    { x: 6, w: 6, h: 4 },
  ]);
  assert.equal(DEFAULT_LAYOUT.some((item) => item.id === "continue"), false);
  assert.equal(DEFAULT_LAYOUT.some((item) => item.id === "pinned"), true);
});

test("legacy default layout upgrades without losing hidden widget choices", () => {
  const legacy = LEGACY_DEFAULT_LAYOUT.map((item) => ({
    ...item,
    hidden: item.id === "tags",
  }));

  const migrated = migrateLegacyLayout(legacy);

  assert.deepEqual(
    migrated.map(({ id, x, y, w, h, hidden }) => ({ id, x, y, w, h, hidden })),
    DEFAULT_LAYOUT.map((item) => ({ ...item, hidden: item.id === "tags" })),
  );
});

test("legacy migration preserves customized widget geometry", () => {
  const customized = LEGACY_DEFAULT_LAYOUT.map((item) => ({ ...item }));
  const recent = customized.find((item) => item.id === "recent");
  assert.ok(recent);
  recent.h = 6;

  const migrated = migrateLegacyLayout(customized);

  assert.equal(migrated.find((item) => item.id === "recent")?.h, 6);
  assert.equal(migrated.find((item) => item.id === "today")?.w, 7);
});

test("the previous default retires Continue without rewriting customized layouts", () => {
  const migratedDefault = migrateLegacyLayout(PREVIOUS_DEFAULT_LAYOUT);
  assert.deepEqual(migratedDefault, DEFAULT_LAYOUT.map((item) => ({ ...item, hidden: false })));

  const customized = PREVIOUS_DEFAULT_LAYOUT.map((item) => ({ ...item }));
  const recent = customized.find((item) => item.id === "recent");
  assert.ok(recent);
  recent.h = 5;
  const migratedCustom = migrateLegacyLayout(customized);
  assert.equal(migratedCustom.some((item) => item.id === "continue"), true);
  assert.equal(migratedCustom.find((item) => item.id === "recent")?.h, 5);
});
