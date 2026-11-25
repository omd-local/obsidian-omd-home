import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildEnrichmentCatalog, buildEnrichmentRequest } from "../src/enrichment/catalog.ts";
import type { EnrichmentFileRecord } from "../src/enrichment/catalog.ts";

test("catalog excludes unrelated notes and incidental function-word matches", () => {
  const target = note("Sources/Embeddings.md", "Dense and Sparse Embeddings", {
    content: "This is an overview of embeddings and how they are used to represent text.",
  });
  const result = buildEnrichmentCatalog({
    target,
    files: [
      note("Notes/Unrelated.md", "Orchard Maintenance"),
      note("Notes/Long.md", "This is an intentionally very long filename used to test truncation alignment and pin controls"),
      note("Notes/A.md", "A"),
      note("Notes/Sparse.md", "Sparse Embeddings"),
    ],
    vaultTags: [],
  });
  assert.deepEqual(result.candidates.map((candidate) => candidate.path), ["Notes/Sparse.md"]);
  assert.equal(result.candidates[0]?.id, "candidate-1");
});

test("capture frontmatter, provenance, and URL query terms do not create note matches", () => {
  const target = note("Sources/Embeddings.md", "Embeddings", {
    content: [
      "---", "omd_home_status: inbox", "source_type: webpage", "---", "",
      "> [Source](https://example.com/audio?layout=calendar) · Captured: `2026-09-16`", "",
      "[Read](https://example.com/audio?layout=calendar)", "",
      "Dense embeddings represent semantic meaning.",
    ].join("\n"),
  });
  const result = buildEnrichmentCatalog({
    target,
    files: [
      note("Notes/Inbox.md", "Inbox"),
      note("Notes/Captured.md", "Captured"),
      note("Notes/Calendar.md", "Calendar"),
      note("Notes/Audio.md", "Audio"),
      note("Notes/Semantic.md", "Semantic Meaning"),
    ],
    vaultTags: [],
  });
  assert.deepEqual(result.candidates.map((candidate) => candidate.path), ["Notes/Semantic.md"]);
});

test("exact mentions preserve short and symbol-bearing identities without promoting function words", () => {
  const result = buildEnrichmentCatalog({
    target: note("Notes/Languages.md", "Languages", {
      content: "A comparison of R, C++, and C# for a programming project.",
    }),
    files: [
      note("Notes/R.md", "R"),
      note("Notes/Cpp.md", "C++"),
      note("Notes/Csharp.md", "C#"),
      note("Notes/A.md", "A"),
      note("Notes/And.md", "And"),
    ],
    vaultTags: [],
  });
  assert.deepEqual(result.candidates.map((candidate) => [candidate.path, candidate.exactMatchScore]), [
    ["Notes/Cpp.md", 1], ["Notes/Csharp.md", 1], ["Notes/R.md", 1],
  ]);
});

test("related links and deliberate shared tags remain candidates without body overlap", () => {
  const target = note("Inbox/Source.md", "Embeddings", {
    content: "Dense vectors represent meaning.",
    outgoingLinks: ["Notes/Linked.md"],
    tags: ["project/research"],
  });
  const result = buildEnrichmentCatalog({
    target,
    files: [
      note("Notes/Tag.md", "Team", { tags: ["project/research"] }),
      note("Notes/Incoming.md", "Backlink", { outgoingLinks: [target.path] }),
      note("Notes/Linked.md", "A"),
      note("../Escape.md", "Embeddings"),
      note(".obsidian/Hidden.md", "Embeddings"),
    ],
    vaultTags: [],
  });
  assert.deepEqual(result.candidates.map((candidate) => candidate.path), [
    "Notes/Linked.md", "Notes/Incoming.md", "Notes/Tag.md",
  ]);
});

test("incidental body words and media tags do not promote unrelated multiword notes", () => {
  const result = buildEnrichmentCatalog({
    target: note("Sources/Embeddings.md", "Dense and Sparse Embeddings", {
      content: "Vectors capture relationships in text and audio. Deep learning models produce embeddings.",
      tags: ["webpage"],
    }),
    files: [
      note("Notes/Capture.md", "Synthetic OMD Inbox Capture"),
      note("Notes/Recording.md", "Recording 20260909203142", { tags: ["audio"] }),
      note("Notes/Models.md", "Deep Learning Methods"),
      note("Notes/Retrieval.md", "Sparse Retrieval"),
    ],
    vaultTags: ["audio", "webpage"],
  });
  assert.deepEqual(result.candidates.map((candidate) => candidate.path), ["Notes/Models.md", "Notes/Retrieval.md"]);
});

test("relevant candidates with equal scores keep the deterministic path tie-breaker", () => {
  const result = buildEnrichmentCatalog({
    target: note("Source.md", "Embeddings", { content: "Dense vectors represent meaning." }),
    files: [note("Notes/z.md", "Dense Vectors"), note("Notes/a.md", "Dense Vectors")],
    vaultTags: [],
  });
  assert.deepEqual(result.candidates.map((candidate) => candidate.path), ["Notes/a.md", "Notes/z.md"]);
});

test("request catalog retains resolved extensionless wikilinks and backlinks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omd-catalog-links-"));
  try {
    const target = { path: "Inbox/Source.md", basename: "Source" };
    const linked = { path: "Notes/Target.md", basename: "Unrelated" };
    const backlink = { path: "Notes/Backlink.md", basename: "Elsewhere" };
    const files = [target, linked, backlink];
    for (const file of files) {
      await mkdir(path.dirname(path.join(root, file.path)), { recursive: true });
      await writeFile(path.join(root, file.path), "Safe note content.");
    }
    const app = {
      vault: {
        adapter: { getBasePath: () => root },
        getMarkdownFiles: () => files,
        cachedRead: async () => "Embeddings describe vectors.",
      },
      metadataCache: {
        resolvedLinks: {
          [target.path]: { [linked.path]: 1 },
          [backlink.path]: { [target.path]: 1 },
        },
        getFileCache: (file: { path: string }) => ({
          links: file.path === target.path ? [{ link: "Target" }] : [],
        }),
      },
    };
    const { request } = await buildEnrichmentRequest(app, target, "local-model", "http://localhost:11434");
    assert.deepEqual(request.candidates.map((candidate) => candidate.path), [linked.path, backlink.path]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function note(path: string, basename: string, overrides: Partial<EnrichmentFileRecord> = {}): EnrichmentFileRecord {
  return { path, basename, content: "", aliases: [], tags: [], outgoingLinks: [], incomingLinks: [], ...overrides };
}
