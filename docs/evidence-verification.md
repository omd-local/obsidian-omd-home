# Answer evidence verification (protocol 2)

> [!IMPORTANT]
> **Development preview — not included in public OMD Home 0.2.1.**
> This document describes local development code and its remaining acceptance
> checks. Installing the public release does not enable these modes.

This feature checks whether this request’s captured note text supports an answer. It separately records source provenance and the scope actually searched. It does not establish that a note or its original material is true.

## Modes and compatibility

The Home setting **Evidence verification** defaults to **Shadow**. This is a code default, not a change to any existing vault’s saved settings or an automatic production deployment.

- **Off** preserves the existing grounded-answer v1 citation/provenance gate. Results explicitly remain unverified semantically.
- **Shadow** shows the complete candidate plus the actual verification state, claim findings, source conflicts and unanswered requirements. Failed and partial verification remain visible.
- **Enforce** presents a definitive candidate only after the required checks complete against a fresh snapshot. Otherwise a controlled notice directs the reader to the evidence, conflicts and missing requirements. No automatic semantic rewrite reuses an old verdict.

The new bridge envelope has `grounding_contract_version: 2`, capability `evidence_verification_v2`, an independent `answer_status` (`answer`, `partial`, `insufficient`, `conflict`), and the required `verification` schema 2 report. Execution status is separate. Empty factual arrays are legal for refusal or conflict; fabricated facts are never required to satisfy v1’s minimum-item rule.

V1 retains its original meaning and citation gate. A backend without the verifier is shown as unverified; enforce refuses to publish an unchecked answer. A malformed v2 report is rejected, including unknown nested fields, invalid IDs/spans, and text/snapshot mismatches.

## Runtime and evidence binding

A request-local session records the question, actual first retrieval candidates, selected generator materials and their input hash before generation. It reads UTF-8 original bytes with SHA-256 and preserves CRLF. All answer and evidence offsets use half-open Unicode code point indices; lines start at 1. TypeScript explicitly converts code points instead of treating UTF-16 units as Python indices.

Independent versioned tasks extract requirements and claims, audit the full decomposition, propose local searches, judge support and original citations separately, and check question coverage. Audits can fail or remain unknown. A supported claim requires exact host-bound evidence locations, all required conditions and safe original citations. Joint evidence is represented as alternative groups whose members are all necessary.

Counterevidence search uses only the selected vault’s Markdown notes. It preserves different bodies sharing a capture source ID. Existing duplicate-note grouping is unchanged. Each query distinguishes returned candidates from source versions actually read, and records exclusions, limits and errors. Capture timestamps and file order do not resolve conflicts. Original images, audio, websites and other attachments are recorded as not checked.

Before publication the host checks original-byte hashes and a separate directory metadata manifest. These provide different guarantees. Changed, missing or unreadable sources, added notes and renames can invalidate results. A bounded retry shares the original deadline and budget. Verification describes the captured snapshot at its check time; it does not promise a file will remain unchanged afterward.

The client shows the captured source fragment, version hash and check time. **Check and open current note** reads current bytes before opening. A mismatch is marked stale and the current note is clearly identified as unverified. Vault changes also invalidate visible results. Cancellation, switching questions, changing verification mode and unloading retain the existing request-generation protections. Clipboard export includes verification state and limitations.

## Privacy, authorization and resource limits

No new dependencies or provider are introduced. Snapshots and private evidence remain in request memory and the displayed result. This implementation adds no persistent verification cache, audit corpus or ordinary-log copies of note text. Existing retrieval caches remain separate. A future verification cache must bind the exact candidate, claim spans, plan, evidence versions, search generation, model/settings, template/schema and legal authorization scope; it must still check authorization and freshness.

Hosted verification uses a different task and source from answer generation. The generator’s exact consent grant cannot authorize it. Without a matching independent grant, verification stops visibly with authorization required before credentials or additional cloud transmission. This development implementation does not manufacture session consent or add a new cloud authorization flow. The legacy Ollama Cloud transport also stops at this boundary. Loopback Ollama can run through the existing local AI service. Provider schema/context failures are visible failures.

The existing process timeout remains the total request limit: 95 seconds normally or 300 seconds with configured hybrid retrieval. The bridge reserves serialization time, recomputes remaining time and applies it to model/network calls. The verifier shares one cumulative budget: at most 6 post-generation model calls, 8 extra queries, 12 extra sources, 24,000 context characters, 40 claims, one decomposition repair and one freshness retry. Existing stricter model context limits win. Exhaustion cannot become a full pass.

For predictable limits the implementation uses a controlled notice for incomplete enforce results rather than generating a semantic revision that would need a new full audit cycle. Both final display and original candidate have distinct hashes, and claim verdicts retain their candidate binding.

## Verification and evaluation

Offline regressions exercise protocol validation, Unicode/CRLF spans, false citations, source conflicts, compound relations, question coverage, added/changed sources, version preservation, budgets, cancellation, authorization and old-backend behavior. Mock judgments verify orchestration and validation, not model reliability.

The backend benchmark adapter is documented in `omd/docs/evidence-benchmark.md`. It separates fixed-evidence verification from free-retrieval QA and supports QA20’s controlled initial input. Gold/review/authoring metadata and split/family labels are excluded from model payloads; retrieval stays inside the exact case vault. Draft gold remains pending independent human review.

Live model effectiveness, paid provider runs and native Obsidian acceptance are separate external checks. They have not been authorized or run by the default offline test commands. No effect score or enforce rollout recommendation follows from unit tests or draft-gold agreement.
