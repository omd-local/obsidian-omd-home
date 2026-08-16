import assert from "node:assert/strict";
import test from "node:test";
import { buildEnrichmentCatalog, extractEvidence } from "../src/enrichment/catalog.ts";

test("extractEvidence skips frontmatter and headings", () => {
  const content = "---\ntags: [one]\n---\n\n# Heading\n\nFirst useful paragraph.\n\nSecond paragraph.";
  assert.equal(extractEvidence(content), "First useful paragraph.");
});

test("extractEvidence truncates by Unicode code points without splitting a surrogate pair", () => {
  const evidence = extractEvidence("😀".repeat(401));
  assert.equal([...evidence].length, 400);
  assert.equal(evidence.endsWith("😀"), true);
});

test("buildEnrichmentCatalog ranks linked notes first and normalizes vault tags", () => {
  const catalog = buildEnrichmentCatalog({
    target: {
      path: "Inbox/example.md",
      basename: "Example",
      content: "Body",
      aliases: ["Calendar workflow"],
      tags: ["project/research"],
      outgoingLinks: ["Notes/Linked.md"],
      incomingLinks: [],
    },
    files: [
      {
        path: "Notes/Linked.md",
        basename: "Linked",
        content: "Linked evidence paragraph.",
        aliases: [],
        tags: ["project/research"],
        outgoingLinks: ["Inbox/example.md"],
        incomingLinks: ["Inbox/example.md"],
      },
      {
        path: "Notes/Other.md",
        basename: "Other",
        content: "Other evidence.",
        aliases: ["Calendar workflow"],
        tags: [],
        outgoingLinks: [],
        incomingLinks: [],
      },
      {
        path: ".obsidian/ignored.md",
        basename: "Ignored",
        content: "Ignored",
        aliases: [],
        tags: [],
        outgoingLinks: [],
        incomingLinks: [],
      },
    ],
    vaultTags: ["project/research", "#project/research", "workflow"],
  });
  assert.equal(catalog.candidates[0]?.path, "Notes/Linked.md");
  assert.deepEqual(catalog.vaultTags, ["project/research", "workflow"]);
});

test("buildEnrichmentCatalog uses source content and a stable path tie-breaker", () => {
  const catalog = buildEnrichmentCatalog({
    target: {
      path: "Inbox/example.md",
      basename: "Example",
      content: "The Gamma workflow is central to this note.",
      aliases: [],
      tags: [],
      outgoingLinks: [],
      incomingLinks: [],
    },
    files: [
      note("Notes/beta.md", "Neutral"),
      note("Notes/Gamma.md", "Gamma"),
      note("Notes/Alpha.md", "Neutral"),
    ],
    vaultTags: [],
  });

  assert.deepEqual(catalog.candidates.map((candidate) => candidate.path), [
    "Notes/Gamma.md",
    "Notes/Alpha.md",
    "Notes/beta.md",
  ]);
});

test("buildEnrichmentCatalog does not treat a short alias inside another word as an exact mention", () => {
  const catalog = buildEnrichmentCatalog({
    target: {
      path: "Inbox/example.md",
      basename: "Example",
      content: "A chair is beside the desk. The Gamma workflow is explicit.",
      aliases: [],
      tags: [],
      outgoingLinks: [],
      incomingLinks: [],
    },
    files: [
      note("Notes/AI.md", "AI"),
      note("Notes/Gamma.md", "Gamma"),
    ],
    vaultTags: [],
  });

  assert.equal(catalog.candidates[0]?.path, "Notes/Gamma.md");
  assert.equal(catalog.candidates.find((candidate) => candidate.path === "Notes/AI.md")?.exactMatchScore, 0);
});

test("buildEnrichmentCatalog preserves target alias matches and unsegmented-language mentions", () => {
  const aliasCatalog = buildEnrichmentCatalog({
    target: {
      path: "Inbox/example.md",
      basename: "Example",
      content: "A neutral project note.",
      aliases: ["Project Atlas"],
      tags: [],
      outgoingLinks: [],
      incomingLinks: [],
    },
    files: [
      note("Notes/Neutral.md", "Neutral"),
      note("Notes/Atlas.md", "Project Atlas"),
    ],
    vaultTags: [],
  });
  assert.equal(aliasCatalog.candidates[0]?.path, "Notes/Atlas.md");

  const chineseCatalog = buildEnrichmentCatalog({
    target: {
      path: "Inbox/中文.md",
      basename: "中文",
      content: "这个日历工作流需要连接知识捕获流程。",
      aliases: [],
      tags: [],
      outgoingLinks: [],
      incomingLinks: [],
    },
    files: [
      note("Notes/中立.md", "中立"),
      note("Notes/知识捕获.md", "知识捕获"),
    ],
    vaultTags: [],
  });
  assert.equal(chineseCatalog.candidates[0]?.path, "Notes/知识捕获.md");
});

function note(path: string, basename: string) {
  return {
    path,
    basename,
    content: `${basename} evidence.`,
    aliases: [],
    tags: [],
    outgoingLinks: [],
    incomingLinks: [],
  };
}
