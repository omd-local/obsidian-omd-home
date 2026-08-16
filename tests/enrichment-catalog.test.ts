import assert from "node:assert/strict";
import test from "node:test";
import { buildEnrichmentCatalog, extractEvidence } from "../src/enrichment/catalog.ts";

test("extractEvidence skips frontmatter and headings", () => {
  const content = "---\ntags: [one]\n---\n\n# Heading\n\nFirst useful paragraph.\n\nSecond paragraph.";
  assert.equal(extractEvidence(content), "First useful paragraph.");
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
