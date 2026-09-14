# Multiline enrichment evidence acceptance

Reviewed on 2026-09-14 against [OMD issue 6](https://github.com/omd-local/markdown-everything/issues/6)
and merged public OMD commit `3274f1536936ddba9de69777e93c10e0388b51fc`
([PR 7](https://github.com/omd-local/markdown-everything/pull/7)).

The server PR was squash-merged on the review date. Its merged tree is identical
to reviewed commit `e84bafec58a5c9d5dc8603f88a8eb00913f7f2ff`; the fixture manifest
and its regression expectation now reference the commit on public `main`.

The companion client changes reject prohibited raw controls before whitespace
folding and truncation, map the optional evidence-validation category to fixed
English guidance, and hide retry for this deterministic failure. Arbitrary
terminal diagnostics are not forwarded to the review UI. Shared fixtures and
enrichment examples use English; Unicode-specific tests retain escaped inputs.

| Acceptance criterion | Evidence |
| --- | --- |
| Offline multiline example becomes one line | OMD parser regressions pass. |
| Single-line and empty evidence remain valid | OMD parser regressions pass. |
| LF, CRLF, TAB, repeated whitespace, Unicode and boundaries | Both suites cover these cases, including U+0085, U+FEFF and supplementary code points. |
| Raw size limits and prohibited controls | OMD checks raw field/request sizes before normalization; Home checks controls before folding or truncation. |
| Note content/hash and other validation | Existing path/schema/ID/hash regressions pass; request-builder tests preserve target bytes and hash. |
| Real Home builder accepted by OMD | The generator importing this checkout's builder exactly reproduces the checked public fixture. |
| Wrapped paragraph/list evidence | The shared fixture includes this plus Source/Author/Published metadata. |
| Safe actionable client failure | Fixed local error copy, unknown-category fallback, sanitized terminal callbacks and Close-only recovery are tested. |
| Capture reaches review; Apply remains explicit | Verified in Obsidian 1.13.7 with the reviewed builds and a disposable synthetic vault. |
| Model failures recorded separately | See the live-model observations below. |

## Verification

- OMD: 1,411 tests pass locally; public CI passes Python 3.10-3.13, wheel builds,
  and dependency audits. The existing lint/type baseline has no new findings.
- Home: all 508 tests, type checking, lint, build and whitespace checks pass.
- Independent code and architecture reviews found no remaining blocking defect.

## Manual integration

The disposable vault contained synthetic Source/Author/Published and wrapped-list
candidate notes. A synthetic English HTML file was captured with **Review links
and tags** enabled, using the public OMD checkout and the companion Home build.
Ollama was local (`qwen3:4b-instruct`, loopback endpoint).

Capture saved the note and automatically opened **Review proposal**. All five
Markdown files had identical hashes while that proposal awaited Apply. Choosing
**Apply** then reported three links and zero tags; only the captured target note
changed. No existing user vault was modified. The original Medium URL was not
recaptured; this isolates the evidence-format acceptance from remote article
availability and extraction behavior.

## Live-model observations

Both direct CLI runs used synthetic legacy multiline candidate evidence and
reached model generation and response validation, with the target hash unchanged.

- `qwen3:0.6b`: `invalid_model_json` because the model selected an unknown vault
  tag. This is a model-output failure after request validation.
- `qwen3:4b-instruct`: returned a valid proposal and a terminal `done` event.

These observations are separate model-quality evidence. Changing models is not
the recovery action for incompatible candidate evidence.

The server PR alone does not deliver the Home UI fixes. Publish and integrate
the companion client change before closing the cross-project issue.
