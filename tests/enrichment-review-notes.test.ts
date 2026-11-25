import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

const reviewSource = readFileSync(resolve("src/enrichment/review-view.ts"), "utf8");
const stylesSource = readFileSync(resolve("src/styles.css"), "utf8");

test("review notes group context limits and filtered suggestions without dropping unknown warnings", () => {
  const groupWarnings = loadFunction<(warnings: string[]) => Record<string, string[]>>(
    reviewSource,
    "groupEnrichmentWarnings",
  );
  const groups = groupWarnings([
    "source_truncated_for_model_context",
    "candidate_catalog_truncated_for_model_context",
    "vault_tags_truncated_for_model_context",
    "existing_tag_already_present",
    "future_warning_code",
  ]);

  assert.deepEqual(groups, {
    sourceContext: ["source_truncated_for_model_context"],
    relatedContext: [
      "candidate_catalog_truncated_for_model_context",
      "vault_tags_truncated_for_model_context",
    ],
    filtered: ["existing_tag_already_present"],
    unknown: ["future_warning_code"],
  });
});

test("review notes keep the important limitation visible and collapse supporting detail", () => {
  assert.match(reviewSource, /text: "Review notes"/u);
  assert.match(reviewSource, /this\.renderWarnings\(shell, state\.warnings\);[\s\S]*const sections = shell\.createDiv/u);
  assert.doesNotMatch(reviewSource, /header\.createSpan\(\{ cls: "omd-enrichment-section-count", text: String\(warnings\.length\) \}\)/u);
  assert.match(reviewSource, /"Suggestions may be incomplete"/u);
  assert.match(reviewSource, /"Some suggestions need review"/u);
  assert.match(reviewSource, /unexpected review limitation/u);
  assert.match(reviewSource, /createEl\("details", \{ cls: "omd-enrichment-review-details" \}\)/u);
  assert.match(reviewSource, /createEl\("summary", \{ text: "More about this review" \}\)/u);
  assert.match(reviewSource, /Some candidate notes and vault tags did not fit/u);
});

test("review note styling uses warning and neutral hierarchy with keyboard focus", () => {
  assert.match(stylesSource, /\.omd-enrichment-review-note\.is-caution\s*\{[^}]*--color-orange/su);
  assert.doesNotMatch(stylesSource, /\.omd-enrichment-warning\s*\{[^}]*--omd-danger/su);
  assert.match(stylesSource, /\.omd-enrichment-review-details\s*\{[^}]*min-width:\s*0;[^}]*border:\s*1px solid var\(--omd-line\)/su);
  assert.match(stylesSource, /\.omd-enrichment-review-details summary:focus-visible\s*\{[^}]*outline:/su);
  assert.match(stylesSource, /\.omd-enrichment-review-details-body li\s*\{[^}]*overflow-wrap:\s*anywhere/su);
});

function loadFunction<T>(source: string, name: string): T {
  const file = ts.createSourceFile("review-view.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = file.statements.find(
    (statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  assert.ok(declaration, `${name} must exist`);
  const javascript = ts.transpileModule(declaration.getText(file), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return Function(`${javascript}\nreturn ${name};`)() as T;
}
