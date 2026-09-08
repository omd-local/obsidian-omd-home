# OMD Home manual-test fixtures

These files are deterministic, disposable inputs for `docs/manual-test-plan.md`. They contain no
personal data and can be copied, edited, captured, pinned, or deleted during testing.

## HOME-01 notes

The five files in `vault-notes/` cover:

- a one-character filename;
- a long filename that must truncate without changing row indentation;
- English and Chinese titles/body text;
- nested tags for the Vault tags widget;
- one synthetic note with `omd_home_status: inbox` for the Inbox Pin/Unpin path.

For the prepared 2026-09-06 test vault, these notes are installed in `Manual Test Notes/` before
the first launch. They are controlled fixtures, not restored user data.

## CAP-01 inputs

- Public URL: `https://example.com/`
- Ordinary path: `capture/small-local-file.html`
- Path containing spaces: `capture/path with spaces/survival analysis sample.html`
- Prepared tilde-expansion copy: `~/Desktop/OMD Home Test Fixtures/survival analysis sample.html`
- Prepared Desktop space-path copy: `/Users/shion/Desktop/OMD Home Test Fixtures/survival analysis sample.html`
- Missing path: append `.missing` to either real path; do not create that file.
- Retry path: submit `capture/retry/retry-source.html` while it is absent. After the failure, copy
  `capture/retry/retry-source.ready.html` to that exact path and use Needs attention -> Retry.

## CAP-01A OCR and ASR inputs

The generated files beside this README are:

- `generated/english-ocr.png`
- `generated/simplified-chinese-english-ocr.png`
- `generated/traditional-chinese-english-ocr.png`
- `generated/scanned-bilingual-page.pdf`
- `generated/bilingual-speech.wav`
- `generated/slow-bilingual-speech.wav` (CAP-06 background/unload fixture)

The source text is intentionally short and explicit so OCR/ASR output can be checked without
subjective scoring. The PDF is image-only: selecting its text should not reveal a text layer. It is
an OCR/limitation fixture, not the ordinary successful PDF/path fixture used by CAP-01.

## Vault Q&A fixtures

Phase 2 and multilingual RAG fixtures remain in `docs/benchmark-vault/`. Import them only at
AI-08/AI-09 so they do not influence earlier search and Home tests.
