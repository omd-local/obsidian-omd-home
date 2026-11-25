---
title: OMD Home Phase 2 Answer Rules
topic: omd home phase 2
language: en
benchmark_role: primary_rules
---

# OMD Home Phase 2 Answer Rules

This note is synthetic and exists to test section-aware retrieval for the Phase 2 answer flow.

## Local answers

- Local Ollama remains the default answer path.
- Cloud availability does not block local model use.
- Retrieval and source selection stay local.
- Cloud answers require a preview and explicit approval before any bounded evidence excerpts leave the device.
- The selected provider and model stay fixed for the request.
- There is no automatic fallback across answer providers.

## Local writing tools

- Link and tag suggestions share one local writing model with capture polish.
- The actions stay separate: links and tags are review-first, capture polish is optional per capture.
- If capture polish is off, the raw Markdown path stays unchanged.

## Recording

- The command palette exposes a wrapper named `Start or stop recording`.
- It delegates to Obsidian's recorder commands and should not invent a second recorder.
- The UI should not guess state when only Start and Stop commands exist.

## Cloud answers

- Ollama Cloud, OpenAI API, Anthropic API, and DeepSeek API are explicit answer providers.
- Enabling cloud answers for one provider does not enable the others.
- Every cloud answer request should show a preview before anything is sent.
