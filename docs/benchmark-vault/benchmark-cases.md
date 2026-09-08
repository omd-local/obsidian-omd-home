# Section-aware Vault Q&A benchmark cases

Use these cases with the files in `docs/benchmark-vault/`.

## Ground-truth source roles

- `Sources/Benchmark/OMD Home Phase 2 Answer Rules.md`
  - contains the local answer contract, the shared local writing model, and the recording wrapper
- `Sources/Benchmark/OMD Home Cloud Setup Checklist.md`
  - contains the cloud setup sequence and the per-request preview / approval flow
- `Sources/Benchmark/OMD Home Release Checklist.md`
  - distractor

## Benchmark cases

| ID | Query | Expected answer shape | Required sources | Must avoid |
|---|---|---|---|---|
| P01 | `@What stays local in the Phase 2 answer flow, even for cloud providers?` | Local retrieval and source selection stay local; cloud answers need preview and approval; no fallback | Rules note | Release checklist, fabricated egress |
| P02 | `@What is the exact Ollama Cloud setup sequence before a cloud answer can be sent?` | Seven-step setup from install/signin through preview approval or cancel | Cloud setup note | Release checklist |
| P03 | `@Which actions share the local writing model, and how are they different?` | Links/tags and capture polish share one local writing model; links/tags are review-first, capture polish is optional per capture | Rules note | Release checklist |
| P04 | `@What should the recording command surface say, and what should it avoid guessing?` | Wrapper command name and no state guessing when only Start/Stop exist | Rules note | Release checklist |
| P05 | `@Summarise the phase 2 answer flow in one paragraph, using only the two primary notes.` | Short paragraph covering local default, cloud opt-in preview, local writing tools, and no fallback | Both primary notes | Release checklist |
| P06 | `@Does the release checklist explain cloud answer routing?` | Abstain or redirect: the file is a distractor and not an answer-routing source | No fabricated source | Answer-routing claims from the distractor |

## Scoring rubric

Score each run out of 4:

1. **Answer correctness** — 0 to 2
   - 2: Facts are correct and complete for the case.
   - 1: Partly correct but incomplete, duplicated, or loosely phrased.
   - 0: Wrong source role, fabricated fact, or missing abstention.
2. **Source hygiene** — 0 to 1
   - 1: Uses only the required source notes.
   - 0: Includes distractors or misses a required source.
3. **Boundary behavior** — 0 to 1
   - 1: Abstains when evidence is missing and does not leak placeholders.
   - 0: Fabricates, overclaims, or leaks `[S#]` / `[E#]` placeholders.

Suggested release threshold:

- P01, P02, P03, P04, P06 must score **4/4**
- P05 must score **3/4** or better

Any distractor citation, fabricated cloud send path, or placeholder leak is a
release blocker for the Phase 2 benchmark.

## Legacy tomato benchmark cases

Use these cases with the older tomato and lettuce fixtures that remain in
`docs/benchmark-vault/`.

### Ground-truth source roles

- `Sources/Benchmark/8 Balcony Tomato Tips for Small-Space Beginners.md`
  - contains exactly 8 explicit beginner tips
- `Sources/Benchmark/阳台番茄新手常见三个错误.md`
  - contains exactly 3 mistakes and 3 corrective actions
- `Sources/Benchmark/Hydroponic Lettuce Yield Log.md`
  - distractor
- `Calendar/Events/2026-09-18-garden-swap.md`
  - distractor

### Legacy benchmark cases

| ID | Query | Expected answer shape | Required sources | Must avoid |
|---|---|---|---|---|
| B01 | `@How many explicit beginner tomato tips are present? List each once.` | Count = 8, one list item per explicit tip | Tips note | Mistakes note as a ninth tip; distractors |
| B02 | `@Which note contains explicit tomato tips, and which note contains three mistakes?` | Correctly classify the two source roles | Both primary notes | Distractors |
| B03 | `@What are the three beginner mistakes, and what should the grower do instead?` | Three mistakes with three corrections in order | Mistakes note | Tips note standing in for the mistake list |
| B04 | `@Which recommendations overlap across both tomato notes? Cite each overlap.` | Overlaps include deep watering, direct sun, and early support | Both primary notes | Unsupported overlap claims |
| B05 | `@Combine the advice from both tomato notes. Separate explicit tips from lessons inferred from mistakes, and remove duplicates.` | 8 explicit tips plus 3 inferred lessons, with duplication handled cleanly | Both primary notes | Distractors, duplicated tip wording |
| B06 | `@What exact fertiliser grams per plant do these tomato notes recommend?` | Abstain: the notes do not specify grams per plant | No fabricated source | Invented numbers from distractors |
| D01 | `@这些阳台番茄笔记给新手哪些建议？` | Chinese answer grounded in both tomato notes when hybrid retrieval is enabled | Both primary notes | Lettuce log, calendar event |
| M01 | `@Summarise the tomato mistakes in Chinese, then restate the fixes in English.` | Bilingual answer with the same 3 mistake/fix pairs | Mistakes note, optional tips note for overlap context | Distractors |

### Legacy scoring rubric

Score each run out of 4:

1. **Answer correctness** — 0 to 2
   - 2: Facts are correct and complete for the case.
   - 1: Partly correct but incomplete, duplicated, or loosely phrased.
   - 0: Wrong count, wrong source role, fabricated fact, or missing abstention.
2. **Source hygiene** — 0 to 1
   - 1: Uses only the required source notes.
   - 0: Includes distractors or misses a required source.
3. **Boundary behavior** — 0 to 1
   - 1: Abstains when evidence is missing and does not leak placeholders.
   - 0: Fabricates, overclaims, or leaks `[S#]` / `[E#]` placeholders.

Suggested release threshold:

- B01, B02, B03, B04, B06, D01 must score **4/4**
- B05 and M01 must score **3/4** or better

Any distractor citation, fabricated fertiliser amount, or placeholder leak is a
release blocker for the legacy Vault Q&A benchmark.
