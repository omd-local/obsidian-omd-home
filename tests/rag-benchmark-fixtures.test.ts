import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const benchmarkRoot = path.join(repoRoot, "docs/benchmark-vault");

test("synthetic benchmark vault fixtures exist with the expected source set", () => {
  const required = [
    "README.md",
    "benchmark-cases.md",
    "Sources/Benchmark/8 Balcony Tomato Tips for Small-Space Beginners.md",
    "Sources/Benchmark/阳台番茄新手常见三个错误.md",
    "Sources/Benchmark/Hydroponic Lettuce Yield Log.md",
    "Calendar/Events/2026-09-18-garden-swap.md",
  ];
  for (const relativePath of required) {
    assert.equal(existsSync(path.join(benchmarkRoot, relativePath)), true, `${relativePath} must exist`);
  }
});

test("primary benchmark notes keep deterministic facts and bilingual support", () => {
  const tips = readBenchmark("Sources/Benchmark/8 Balcony Tomato Tips for Small-Space Beginners.md");
  const mistakes = readBenchmark("Sources/Benchmark/阳台番茄新手常见三个错误.md");

  assert.equal(
    [...tips.matchAll(/^\d+\.\s/gmu)].length,
    8,
    "tips note must keep exactly eight explicit numbered tips",
  );
  assert.match(tips, /6 hours of direct sun/u);
  assert.match(tips, /18 litres/u);
  assert.match(tips, /top 2 cm of soil is dry/u);
  assert.match(tips, /中文摘要/u);

  assert.equal(
    [...mistakes.matchAll(/^## 错误[一二三]/gmu)].length,
    3,
    "mistakes note must keep exactly three top-level mistake sections",
  );
  assert.equal(
    [...mistakes.matchAll(/^### 更好的做法/gmu)].length,
    3,
    "mistakes note must keep one correction per mistake",
  );
  assert.match(mistakes, /每天至少 6 小时直射阳光/u);
  assert.match(mistakes, /English recap/u);
});

test("benchmark distractors stay out-of-domain and benchmark cases define expected scoring", () => {
  const lettuce = readBenchmark("Sources/Benchmark/Hydroponic Lettuce Yield Log.md");
  const calendar = readBenchmark("Calendar/Events/2026-09-18-garden-swap.md");
  const cases = readBenchmark("benchmark-cases.md");

  assert.match(lettuce, /Crop: lettuce, not tomatoes/u);
  assert.match(calendar, /not a tomato care guide/u);

  for (const id of ["B01", "B02", "B03", "B04", "B05", "B06", "D01", "M01"]) {
    assert.match(cases, new RegExp(`\\| ${id} \\|`, "u"), `${id} must be listed in the benchmark table`);
  }
  assert.match(cases, /Sources\/Benchmark\/8 Balcony Tomato Tips for Small-Space Beginners\.md/u);
  assert.match(cases, /Sources\/Benchmark\/阳台番茄新手常见三个错误\.md/u);
  assert.match(cases, /Calendar\/Events\/2026-09-18-garden-swap\.md/u);
  assert.match(cases, /Score each run out of 4/u);
  assert.match(cases, /fabricated fertiliser amount/u);
});

function readBenchmark(relativePath: string): string {
  return readFileSync(path.join(benchmarkRoot, relativePath), "utf8");
}
