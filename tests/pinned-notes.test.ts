import assert from "node:assert/strict";
import test from "node:test";
import { isPinnedNote, setPinnedNote } from "../src/pinned-notes.ts";

test("pinning a note is idempotent and preserves existing order", () => {
  assert.deepEqual(setPinnedNote(["A.md"], "B.md", true), ["A.md", "B.md"]);
  assert.deepEqual(setPinnedNote(["A.md", "B.md"], "B.md", true), ["A.md", "B.md"]);
  assert.equal(isPinnedNote(["A.md", "B.md"], "B.md"), true);
});

test("unpinning removes duplicate legacy entries without disturbing other notes", () => {
  assert.deepEqual(setPinnedNote(["A.md", "B.md", "A.md"], "A.md", false), ["B.md"]);
  assert.equal(isPinnedNote(["B.md"], "A.md"), false);
});

test("pin state normalizes harmless whitespace and ignores an empty path", () => {
  assert.deepEqual(setPinnedNote([" A.md ", "A.md", ""], " B.md ", true), ["A.md", "B.md"]);
  assert.deepEqual(setPinnedNote(["A.md"], "   ", true), ["A.md"]);
  assert.equal(isPinnedNote(["A.md"], " A.md "), true);
});
