import assert from "node:assert/strict";
import test from "node:test";
import { groupTagCounts } from "../src/tags.ts";

test("groups nested Obsidian tags by their first segment", () => {
  assert.deepEqual(groupTagCounts(["#project/work", "project/work", "#project/home", "#idea"]), [
    {
      name: "project",
      count: 3,
      tags: [
        { name: "project/work", count: 2 },
        { name: "project/home", count: 1 },
      ],
    },
    { name: "idea", count: 1, tags: [{ name: "idea", count: 1 }] },
  ]);
});
