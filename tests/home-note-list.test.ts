import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHomeNoteSnapshot,
  filterHomeNoteRows,
  homeNoteDisplayTime,
  homeNoteTagFilterOptions,
  matchesHomeNoteTagFilters,
  normalizeHomeNoteTags,
  sortHomeNoteRows,
  visibleHomeNoteTags,
  type HomeNoteFileLike,
} from "../src/home-note-list.ts";

const NOW = Date.parse("2026-09-22T12:00:00.000Z");

test("note snapshots normalize and deduplicate Unicode tags", () => {
  assert.deepEqual(normalizeHomeNoteTags([
    "#Café",
    "Cafe\u0301",
    "#研究/模型",
    "#研究/模型/",
    "#Research/AI",
    "#research/ai",
  ]), ["Café", "Research/AI", "研究/模型"]);
});

test("Inbox time uses reliable captured_at, then ctime, then Updated mtime", () => {
  const files = [
    file("A.md", 100, 200),
    file("B.md", 300, 400),
    file("C.md", 0, 600),
  ];
  const rows = buildHomeNoteSnapshot(files, (candidate) => ({
    frontmatter: candidate.path === "A.md"
      ? { omd_home_status: "inbox", captured_at: "2026-09-20T09:00:00.000Z" }
      : candidate.path === "B.md"
        ? { omd_home_status: "inbox", captured_at: "not-an-iso-time" }
        : { omd_home_status: "inbox", captured_at: "2028-09-20T09:00:00.000Z" },
  }), NOW);

  assert.deepEqual(homeNoteDisplayTime(rows[0]!, "inbox"), {
    timestamp: Date.parse("2026-09-20T09:00:00.000Z"),
    kind: "captured",
  });
  assert.deepEqual(homeNoteDisplayTime(rows[1]!, "inbox"), { timestamp: 300, kind: "captured" });
  assert.deepEqual(homeNoteDisplayTime(rows[2]!, "inbox"), { timestamp: 600, kind: "updated" });
  assert.deepEqual(homeNoteDisplayTime(rows[0]!, "recent"), { timestamp: 200, kind: "updated" });
});

test("nested tag filters match parents and combine with AND semantics", () => {
  assert.equal(matchesHomeNoteTagFilters(["research/ai", "language/中文"], ["research", "language"]), true);
  assert.equal(matchesHomeNoteTagFilters(["research/ai", "language/中文"], ["research/ai", "language/中文"]), true);
  assert.equal(matchesHomeNoteTagFilters(["research", "language/中文"], ["research/ai"]), false);
  assert.equal(matchesHomeNoteTagFilters(["research/ai"], ["research", "language"]), false);
});

test("tag filter options include parents and filter rows without changing source order", () => {
  const rows = buildHomeNoteSnapshot(
    [file("First.md", 1, 1), file("Second.md", 1, 2)],
    (candidate) => ({ tags: candidate.path === "First.md" ? ["#research/ai", "#language/en"] : ["#research/books"] }),
    NOW,
  );
  assert.deepEqual(homeNoteTagFilterOptions(rows), ["language", "language/en", "research", "research/ai", "research/books"]);
  assert.deepEqual(filterHomeNoteRows(rows, ["research", "language"]).map((row) => row.path), ["First.md"]);
});

test("tag display is capped at two with an accurate remainder", () => {
  assert.deepEqual(visibleHomeNoteTags(["a", "b", "c", "d"]), { visible: ["a", "b"], remaining: 2 });
  assert.deepEqual(visibleHomeNoteTags(["a"]), { visible: ["a"], remaining: 0 });
});

test("newest-first sorting has a stable path tie break", () => {
  const rows = buildHomeNoteSnapshot(
    [file("z.md", 10, 30), file("a.md", 10, 30), file("new.md", 20, 40)],
    () => ({}),
    NOW,
  );
  assert.deepEqual(sortHomeNoteRows(rows, "recent").map((row) => row.path), ["new.md", "a.md", "z.md"]);
});

test("a large Home refresh reads metadata once per file and never requests note bodies", () => {
  const files = Array.from({ length: 125 }, (_, index) => file(`Notes/${index}.md`, index + 1, index + 1));
  let metadataReads = 0;
  const rows = buildHomeNoteSnapshot(files, (candidate) => {
    metadataReads += 1;
    return { frontmatter: { omd_home_status: candidate.path.endsWith("0.md") ? "inbox" : "reviewed" } };
  }, NOW);
  assert.equal(rows.length, 125);
  assert.equal(metadataReads, 125);
  assert.equal(rows.filter((row) => row.inbox).length > 0, true);
});

function file(path: string, ctime: number, mtime: number): HomeNoteFileLike {
  const name = path.split("/").at(-1) ?? path;
  return {
    path,
    basename: name.replace(/\.md$/u, ""),
    parent: { path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "/" },
    stat: { ctime, mtime },
  };
}
