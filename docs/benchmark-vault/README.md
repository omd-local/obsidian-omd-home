# OMD Home Vault Q&A benchmark fixtures

These fixtures are synthetic and original. They exist only to test retrieval,
section selection, bilingual recall, abstention, and source hygiene in OMD Home.

From the repository root, copy them into the disposable test vault before
running the benchmark section in `docs/manual-test-plan.md`:

```bash
cp -R "docs/benchmark-vault/Calendar" \
      "docs/benchmark-vault/Sources" \
      "test-vault/"
```

What is included:

- `Sources/Benchmark/OMD Home Phase 2 Answer Rules.md`
- `Sources/Benchmark/OMD Home Cloud Setup Checklist.md`
- `Sources/Benchmark/OMD Home Release Checklist.md`
- `Sources/Benchmark/8 Balcony Tomato Tips for Small-Space Beginners.md`
- `Sources/Benchmark/阳台番茄新手常见三个错误.md`
- `Sources/Benchmark/Hydroponic Lettuce Yield Log.md`
- `Calendar/Events/2026-09-18-garden-swap.md`
- `benchmark-cases.md`

The Phase 2 answer rules and cloud setup notes are the primary benchmark set.
The release checklist is a distractor. The tomato and lettuce notes remain as a
legacy benchmark set for general retrieval and source hygiene tests.
