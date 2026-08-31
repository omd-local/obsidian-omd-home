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

- `Sources/Benchmark/8 Balcony Tomato Tips for Small-Space Beginners.md`
- `Sources/Benchmark/阳台番茄新手常见三个错误.md`
- `Sources/Benchmark/Hydroponic Lettuce Yield Log.md`
- `Calendar/Events/2026-09-18-garden-swap.md`
- `benchmark-cases.md`

The first two notes are the ground-truth answer sources.
The lettuce log and calendar event are distractors.
