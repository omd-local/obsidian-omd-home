import assert from "node:assert/strict";
import test from "node:test";
import {
  applyEnrichmentSelection,
  MANAGED_LINKS_END,
  MANAGED_LINKS_START,
  mergeTags,
  normalizeFrontmatterTags,
  upsertManagedLinksBlock,
  type ApplyEnrichmentPlan,
  type ApplyServices,
} from "../src/enrichment/apply.ts";
import { sha256HexUtf8 } from "../src/enrichment/contract.ts";
import { OmdEnrichmentError } from "../src/enrichment/errors.ts";
import {
  MANAGED_SUMMARY_END,
  MANAGED_SUMMARY_START,
} from "../src/enrichment/managed-block.ts";

test("upsertManagedLinksBlock inserts before a real Full Content heading", () => {
  const source = "# Note\n\nBody\n\n## Full Content\n\nMore";
  const result = upsertManagedLinksBlock(source, ["[[One]]", "[[Two]]"]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.content, new RegExp(`${escape(MANAGED_LINKS_START)}[\\s\\S]*## Related notes[\\s\\S]*\\[\\[One\\]\\][\\s\\S]*## Full Content`));
  assert.equal(result.changed, true);
});

test("upsertManagedLinksBlock ignores fenced headings and replaces existing blocks idempotently", () => {
  const source = [
    "# Note",
    "```md",
    "## Full Content",
    "```",
    MANAGED_LINKS_START,
    "## Related notes",
    "- [[Old]]",
    MANAGED_LINKS_END,
    "",
  ].join("\n");
  const result = upsertManagedLinksBlock(source, ["[[New]]"]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.content, /\-\s\[\[New\]\]/);
  assert.doesNotMatch(result.content, /\-\s\[\[Old\]\]/);
});

test("normalizeFrontmatterTags preserves unique tags case-insensitively", () => {
  assert.deepEqual(normalizeFrontmatterTags(["AI", "ai", "research"]), ["AI", "research"]);
  assert.deepEqual(mergeTags(["AI"], ["ai", "workflow"]), ["AI", "workflow"]);
});

test("applyEnrichmentSelection rejects an invalid proposal hash without touching files", async () => {
  const harness = createHarness({
    "Inbox/target.md": { content: "# Target\n" },
    "Notes/alpha.md": { content: "# Alpha\n" },
  });
  const plan = createPlan({
    originalContent: "# Target\n",
    originalHash: "stale-hash",
    linkCandidates: [{ id: "alpha", path: "Notes/alpha.md", display: "Alpha" }],
    selectedCandidateIds: ["alpha"],
  });

  await assert.rejects(
    () => applyEnrichmentSelection(plan, harness.services),
    /proposal snapshot hash is invalid/i,
  );
  assert.equal(harness.counts.resolveMarkdown, 0);
  assert.equal(harness.counts.read, 0);
  assert.equal(harness.counts.process, 0);
  assert.equal(harness.counts.processFrontMatter, 0);
  assert.equal(harness.content("Inbox/target.md"), "# Target\n");
});

test("applyEnrichmentSelection returns conflict when a selected candidate moved or disappeared", async () => {
  const harness = createHarness({
    "Inbox/target.md": { content: "# Target\n" },
  });
  const plan = createPlan({
    linkCandidates: [{ id: "alpha", path: "Notes/alpha.md", display: "Alpha" }],
    selectedCandidateIds: ["alpha"],
  });

  const result = await applyEnrichmentSelection(plan, harness.services);

  assert.deepEqual(result, {
    status: "conflict",
    changedBody: false,
    message: "A selected note moved or became unavailable. Generate again.",
  });
  assert.equal(harness.counts.process, 0);
  assert.equal(harness.counts.processFrontMatter, 0);
});

test("applyEnrichmentSelection preserves an external edit made after Generate and before Apply", async () => {
  const harness = createHarness(
    {
      "Inbox/target.md": { content: "# Target\n\nBody\n" },
      "Notes/alpha.md": { content: "# Alpha\n" },
    },
    {
      beforeProcessUpdate: ({ file, current }) => {
        if (file.path === "Inbox/target.md") current.content += "\nCAP-02 conflict test: keep this line.\n";
      },
    },
  );
  const plan = createPlan({
    originalContent: "# Target\n\nBody\n",
    linkCandidates: [{ id: "alpha", path: "Notes/alpha.md", display: "Alpha" }],
    selectedCandidateIds: ["alpha"],
    selectedTags: ["reviewed-by-test"],
  });

  const result = await applyEnrichmentSelection(plan, harness.services);

  assert.deepEqual(result, {
    status: "conflict",
    changedBody: false,
    message: "The note changed after the proposal was generated. Generate again before applying.",
  });
  assert.match(harness.content("Inbox/target.md"), /CAP-02 conflict test: keep this line\./u);
  assert.doesNotMatch(harness.content("Inbox/target.md"), /Related notes|\[\[Alpha\]\]/u);
  assert.deepEqual(harness.frontmatter("Inbox/target.md"), {});
  assert.equal(harness.counts.processFrontMatter, 0);
});

test("applyEnrichmentSelection applies tags only and marks the note reviewed", async () => {
  const harness = createHarness({
    "Inbox/target.md": { content: "# Target\n", frontmatter: { tags: ["AI"] } },
  });
  const plan = createPlan({
    selectedTags: ["workflow", "Workflow"],
  });

  const result = await applyEnrichmentSelection(plan, harness.services);

  assert.deepEqual(result, {
    status: "applied",
    appliedLinks: 0,
    appliedTags: 1,
    appliedSummary: false,
    changedBody: false,
  });
  assert.equal(harness.content("Inbox/target.md"), "# Target\n");
  assert.deepEqual(harness.frontmatter("Inbox/target.md"), {
    tags: ["AI", "workflow"],
    omd_home_status: "reviewed",
  });
});

test("applying suggestions can preserve Inbox status until review is explicitly finished", async () => {
  const harness = createHarness({
    "Inbox/target.md": {
      content: "# Target\n",
      frontmatter: { omd_home_status: "inbox", tags: ["existing"] },
    },
  });
  const plan = createPlan({
    selectedTags: ["suggested"],
    markReviewed: false,
  });

  const result = await applyEnrichmentSelection(plan, harness.services);

  assert.deepEqual(result, {
    status: "applied",
    appliedLinks: 0,
    appliedTags: 1,
    appliedSummary: false,
    changedBody: false,
  });
  assert.deepEqual(harness.frontmatter("Inbox/target.md"), {
    omd_home_status: "inbox",
    tags: ["existing", "suggested"],
  });
});

test("an omitted runtime review decision fails safe and keeps Inbox status", async () => {
  const harness = createHarness({
    "Inbox/target.md": {
      content: "# Target\n",
      frontmatter: { omd_home_status: "inbox" },
    },
  });
  const plan = createPlan({ selectedTags: ["suggested"] });
  delete (plan as Partial<ApplyEnrichmentPlan>).markReviewed;

  const result = await applyEnrichmentSelection(plan, harness.services);

  assert.equal(result.status, "applied");
  assert.deepEqual(harness.frontmatter("Inbox/target.md"), {
    omd_home_status: "inbox",
    tags: ["suggested"],
  });
});

test("applyEnrichmentSelection applies links only and keeps the final status reviewed", async () => {
  const harness = createHarness({
    "Inbox/target.md": { content: "# Target\n\nBody\n" },
    "Notes/alpha.md": { content: "# Alpha\n" },
  });
  const plan = createPlan({
    originalContent: "# Target\n\nBody\n",
    linkCandidates: [{ id: "alpha", path: "Notes/alpha.md", display: "Alpha" }],
    selectedCandidateIds: ["alpha"],
  });

  const result = await applyEnrichmentSelection(plan, harness.services);

  assert.deepEqual(result, {
    status: "applied",
    appliedLinks: 1,
    appliedTags: 0,
    appliedSummary: false,
    changedBody: true,
  });
  assert.match(harness.content("Inbox/target.md"), new RegExp(`${escape(MANAGED_LINKS_START)}[\\s\\S]*\\- \\[\\[Alpha\\]\\]`));
  assert.deepEqual(harness.frontmatter("Inbox/target.md"), { omd_home_status: "reviewed" });
});

test("applyEnrichmentSelection keeps managed links idempotent when the same block already exists", async () => {
  const existing = [
    "# Target",
    "",
    MANAGED_LINKS_START,
    "## Related notes",
    "- [[Alpha]]",
    MANAGED_LINKS_END,
    "",
  ].join("\n");
  const harness = createHarness({
    "Inbox/target.md": { content: existing },
    "Notes/alpha.md": { content: "# Alpha\n" },
  });
  const plan = createPlan({
    originalContent: existing,
    linkCandidates: [{ id: "alpha", path: "Notes/alpha.md", display: "Alpha" }],
    selectedCandidateIds: ["alpha"],
  });

  const result = await applyEnrichmentSelection(plan, harness.services);

  assert.deepEqual(result, {
    status: "applied",
    appliedLinks: 1,
    appliedTags: 0,
    appliedSummary: false,
    changedBody: false,
  });
  assert.equal(harness.content("Inbox/target.md"), existing);
  assert.deepEqual(harness.frontmatter("Inbox/target.md"), { omd_home_status: "reviewed" });
});

test("applyEnrichmentSelection can apply an edited summary without links or tags", async () => {
  const original = "# Target\n\n## Full Content\nBody\n";
  const harness = createHarness({
    "Inbox/target.md": { content: original, frontmatter: { omd_home_status: "inbox" } },
  });
  const result = await applyEnrichmentSelection(createPlan({
    originalContent: original,
    selectedSummary: "Edited 中文 summary.\n\nملخص عربي.",
    markReviewed: false,
  }), harness.services);

  assert.deepEqual(result, {
    status: "applied",
    appliedLinks: 0,
    appliedTags: 0,
    appliedSummary: true,
    changedBody: true,
  });
  assert.match(harness.content("Inbox/target.md"), new RegExp(`${escape(MANAGED_SUMMARY_START)}[\\s\\S]*Edited 中文 summary\\.[\\s\\S]*ملخص عربي\\.[\\s\\S]*${escape(MANAGED_SUMMARY_END)}`));
  assert.deepEqual(harness.frontmatter("Inbox/target.md"), { omd_home_status: "inbox" });
  assert.equal(harness.counts.process, 1);
  assert.equal(harness.counts.processFrontMatter, 0);
});

test("summary and links share one guarded body transaction before tags are written", async () => {
  const original = "# Target\n\n## Full Content\nBody\n";
  const harness = createHarness({
    "Inbox/target.md": { content: original, frontmatter: { omd_home_status: "inbox" } },
    "Notes/alpha.md": { content: "# Alpha\n" },
  });
  const result = await applyEnrichmentSelection(createPlan({
    originalContent: original,
    linkCandidates: [{ id: "alpha", path: "Notes/alpha.md", display: "Alpha" }],
    selectedCandidateIds: ["alpha"],
    selectedTags: ["research"],
    selectedSummary: "Combined summary.",
    markReviewed: false,
  }), harness.services);

  assert.deepEqual(result, {
    status: "applied",
    appliedLinks: 1,
    appliedTags: 1,
    appliedSummary: true,
    changedBody: true,
  });
  const content = harness.content("Inbox/target.md");
  assert.ok(content.indexOf(MANAGED_SUMMARY_START) < content.indexOf(MANAGED_LINKS_START));
  assert.equal(harness.counts.process, 1);
  assert.equal(harness.counts.processFrontMatter, 1);
  assert.deepEqual(harness.frontmatter("Inbox/target.md"), {
    omd_home_status: "inbox",
    tags: ["research"],
  });
});

test("leaving summary unchecked does not touch an existing managed summary", async () => {
  const original = [
    "# Target",
    "",
    MANAGED_SUMMARY_START,
    "## Summary",
    "Keep this summary.",
    MANAGED_SUMMARY_END,
    "",
  ].join("\n");
  const harness = createHarness({
    "Inbox/target.md": { content: original, frontmatter: { omd_home_status: "inbox" } },
  });
  const result = await applyEnrichmentSelection(createPlan({
    originalContent: original,
    selectedTags: ["tag-only"],
    markReviewed: false,
  }), harness.services);
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.equal(result.appliedSummary, false);
  assert.equal(harness.content("Inbox/target.md"), original);
  assert.equal(harness.counts.process, 0);
});

test("summary apply preserves an unmanaged Summary section and reports a safe failure", async () => {
  const original = "# Target\n\n## Summary\nUser text.\n";
  const harness = createHarness({ "Inbox/target.md": { content: original } });
  await assert.rejects(
    () => applyEnrichmentSelection(createPlan({ originalContent: original, selectedSummary: "Model text" }), harness.services),
    /already has a Summary section/u,
  );
  assert.equal(harness.content("Inbox/target.md"), original);
  assert.equal(harness.counts.processFrontMatter, 0);
});

test("an unchanged managed summary is idempotent", async () => {
  const original = [
    "# Target",
    "",
    MANAGED_SUMMARY_START,
    "## Summary",
    "Same summary.",
    MANAGED_SUMMARY_END,
    "",
  ].join("\n");
  const harness = createHarness({ "Inbox/target.md": { content: original } });
  const result = await applyEnrichmentSelection(createPlan({
    originalContent: original,
    selectedSummary: "Same summary.",
    markReviewed: false,
  }), harness.services);
  assert.deepEqual(result, {
    status: "applied",
    appliedLinks: 0,
    appliedTags: 0,
    appliedSummary: true,
    changedBody: false,
  });
  assert.equal(harness.content("Inbox/target.md"), original);
});

test("applyEnrichmentSelection rolls back body changes when frontmatter update fails", async () => {
  const harness = createHarness(
    {
      "Inbox/target.md": { content: "# Target\n\nBody\n" },
      "Notes/alpha.md": { content: "# Alpha\n" },
    },
    {
      onProcessFrontMatter: () => {
        throw new Error("frontmatter write failed");
      },
    },
  );
  const plan = createPlan({
    originalContent: "# Target\n\nBody\n",
    linkCandidates: [{ id: "alpha", path: "Notes/alpha.md", display: "Alpha" }],
    selectedCandidateIds: ["alpha"],
  });

  const result = await applyEnrichmentSelection(plan, harness.services);

  assert.deepEqual(result, {
    status: "failed",
    changedBody: false,
    message: "Properties could not be updated, so the selected note changes were rolled back.",
  });
  assert.equal(harness.content("Inbox/target.md"), "# Target\n\nBody\n");
  assert.deepEqual(harness.frontmatter("Inbox/target.md"), {});
});

test("applyEnrichmentSelection returns partial-failure when another edit lands before frontmatter", async () => {
  const harness = createHarness(
    {
      "Inbox/target.md": { content: "# Target\n\nBody\n" },
      "Notes/alpha.md": { content: "# Alpha\n" },
    },
    {
      afterFirstProcess: ({ file, current }) => {
        if (file.path === "Inbox/target.md") current.content = `${current.content}\nConcurrent edit.\n`;
      },
    },
  );
  const plan = createPlan({
    originalContent: "# Target\n\nBody\n",
    linkCandidates: [{ id: "alpha", path: "Notes/alpha.md", display: "Alpha" }],
    selectedCandidateIds: ["alpha"],
  });

  const result = await applyEnrichmentSelection(plan, harness.services);

  assert.deepEqual(result, {
    status: "partial-failure",
    changedBody: true,
    message:
      "Some selected content may be present in Inbox/target.md, but its Properties were not finalized. Open the note and review Summary, Related notes, and Properties before generating again.",
  });
  assert.match(harness.content("Inbox/target.md"), /\[\[Alpha\]\]/);
  assert.match(harness.content("Inbox/target.md"), /Concurrent edit\./);
  assert.deepEqual(harness.frontmatter("Inbox/target.md"), {});
});

test("applyEnrichmentSelection returns partial-failure when rollback is blocked by a later mutation", async () => {
  const harness = createHarness(
    {
      "Inbox/target.md": { content: "# Target\n\nBody\n" },
      "Notes/alpha.md": { content: "# Alpha\n" },
    },
    {
      onProcessFrontMatter: ({ file, current }) => {
        if (file.path === "Inbox/target.md") current.content = `${current.content}\nExternal edit.\n`;
        throw new Error("frontmatter write failed");
      },
    },
  );
  const plan = createPlan({
    originalContent: "# Target\n\nBody\n",
    linkCandidates: [{ id: "alpha", path: "Notes/alpha.md", display: "Alpha" }],
    selectedCandidateIds: ["alpha"],
  });

  const result = await applyEnrichmentSelection(plan, harness.services);

  assert.deepEqual(result, {
    status: "partial-failure",
    changedBody: true,
    message:
      "Some selected content may be present in Inbox/target.md, but its Properties were not finalized. Open the note and review Summary, Related notes, and Properties before generating again.",
  });
  assert.match(harness.content("Inbox/target.md"), /\[\[Alpha\]\]/);
  assert.match(harness.content("Inbox/target.md"), /External edit\./);
  assert.deepEqual(harness.frontmatter("Inbox/target.md"), {});
});

test("applyEnrichmentSelection reports a partial write when its post-write binding cannot refresh", async () => {
  const harness = createHarness(
    {
      "Inbox/target.md": { content: "# Target\n\nBody\n" },
      "Notes/alpha.md": { content: "# Alpha\n" },
    },
    {
      afterFirstProcess: () => {
        throw new OmdEnrichmentError("note_conflict", "The owned write completed but its file binding changed.");
      },
    },
  );
  const plan = createPlan({
    originalContent: "# Target\n\nBody\n",
    linkCandidates: [{ id: "alpha", path: "Notes/alpha.md", display: "Alpha" }],
    selectedCandidateIds: ["alpha"],
  });

  const result = await applyEnrichmentSelection(plan, harness.services);

  assert.deepEqual(result, {
    status: "partial-failure",
    changedBody: true,
    message:
      "Some selected content may be present in Inbox/target.md, but its Properties were not finalized. Open the note and review Summary, Related notes, and Properties before generating again.",
  });
  assert.match(harness.content("Inbox/target.md"), /\[\[Alpha\]\]/u);
  assert.deepEqual(harness.frontmatter("Inbox/target.md"), {});
});

test("applyEnrichmentSelection reports a partial write when a generic error follows the body write", async () => {
  const harness = createHarness(
    {
      "Inbox/target.md": { content: "# Target\n\nBody\n" },
      "Notes/alpha.md": { content: "# Alpha\n" },
    },
    {
      afterFirstProcess: () => {
        throw new Error("The body write completed before an I/O acknowledgement failed.");
      },
    },
  );
  const plan = createPlan({
    originalContent: "# Target\n\nBody\n",
    linkCandidates: [{ id: "alpha", path: "Notes/alpha.md", display: "Alpha" }],
    selectedCandidateIds: ["alpha"],
  });

  const result = await applyEnrichmentSelection(plan, harness.services);

  assert.deepEqual(result, {
    status: "partial-failure",
    changedBody: true,
    message:
      "Some selected content may be present in Inbox/target.md, but its Properties were not finalized. Open the note and review Summary, Related notes, and Properties before generating again.",
  });
  assert.match(harness.content("Inbox/target.md"), /\[\[Alpha\]\]/u);
  assert.deepEqual(harness.frontmatter("Inbox/target.md"), {});
});

test("applyEnrichmentSelection merges tags case-insensitively against existing frontmatter", async () => {
  const harness = createHarness({
    "Inbox/target.md": { content: "# Target\n", frontmatter: { tags: ["AI"] } },
  });
  const plan = createPlan({
    selectedTags: ["ai", "Workflow", "workflow"],
  });

  const result = await applyEnrichmentSelection(plan, harness.services);

  assert.deepEqual(result, {
    status: "applied",
    appliedLinks: 0,
    appliedTags: 2,
    appliedSummary: false,
    changedBody: false,
  });
  assert.deepEqual(harness.frontmatter("Inbox/target.md"), {
    tags: ["AI", "Workflow"],
    omd_home_status: "reviewed",
  });
});

type FileState = {
  content: string;
  frontmatter: Record<string, unknown>;
};

type FileRef = {
  path: string;
};

type HarnessHooks = {
  beforeProcessUpdate?: (context: { file: FileRef; current: FileState }) => void;
  afterFirstProcess?: (context: { file: FileRef; current: FileState }) => void;
  onProcessFrontMatter?: (context: { file: FileRef; current: FileState }) => void;
};

function createHarness(
  initial: Record<string, { content: string; frontmatter?: Record<string, unknown> }>,
  hooks: HarnessHooks = {},
): {
  services: ApplyServices<FileRef>;
  counts: Record<"resolveMarkdown" | "validate" | "read" | "process" | "processFrontMatter", number>;
  content(path: string): string;
  frontmatter(path: string): Record<string, unknown>;
} {
  const files = new Map<string, FileState>(
    Object.entries(initial).map(([path, file]) => [
      path,
      { content: file.content, frontmatter: structuredClone(file.frontmatter ?? {}) },
    ]),
  );
  const counts = {
    resolveMarkdown: 0,
    validate: 0,
    read: 0,
    process: 0,
    processFrontMatter: 0,
  };
  let processCalls = 0;

  const services: ApplyServices<FileRef> = {
    async resolveMarkdown(path) {
      counts.resolveMarkdown += 1;
      return files.has(path) ? { path } : null;
    },
    async validate(file) {
      counts.validate += 1;
      return files.has(file.path);
    },
    async read(file) {
      counts.read += 1;
      return mustGet(files, file.path).content;
    },
    async process(file, update) {
      counts.process += 1;
      const current = mustGet(files, file.path);
      hooks.beforeProcessUpdate?.({ file, current });
      current.content = update(current.content);
      processCalls += 1;
      if (processCalls === 1) hooks.afterFirstProcess?.({ file, current });
      return file;
    },
    async processFrontMatter(file, update) {
      counts.processFrontMatter += 1;
      const current = mustGet(files, file.path);
      hooks.onProcessFrontMatter?.({ file, current });
      const next = structuredClone(current.frontmatter);
      update(next);
      current.frontmatter = next;
    },
    generateMarkdownLink(file, sourcePath, display) {
      void file;
      void sourcePath;
      return `[[${display}]]`;
    },
  };

  return {
    services,
    counts,
    content(path) {
      return mustGet(files, path).content;
    },
    frontmatter(path) {
      return mustGet(files, path).frontmatter;
    },
  };
}

function createPlan(overrides: Partial<ApplyEnrichmentPlan> = {}): ApplyEnrichmentPlan {
  const originalContent = overrides.originalContent ?? "# Target\n";
  return {
    targetPath: "Inbox/target.md",
    originalContent,
    originalHash: overrides.originalHash ?? sha256HexUtf8(originalContent),
    linkCandidates: overrides.linkCandidates ?? [],
    selectedCandidateIds: overrides.selectedCandidateIds ?? [],
    selectedTags: overrides.selectedTags ?? [],
    selectedSummary: overrides.selectedSummary,
    // Tests that exercise the legacy combined helper behavior opt in
    // explicitly; the production Review pane always passes false.
    markReviewed: overrides.markReviewed ?? true,
  };
}

function mustGet(files: Map<string, FileState>, path: string): FileState {
  const file = files.get(path);
  assert.ok(file, `Expected test file ${path} to exist.`);
  return file;
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
