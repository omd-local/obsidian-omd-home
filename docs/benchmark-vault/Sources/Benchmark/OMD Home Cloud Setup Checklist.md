---
title: OMD Home Cloud Setup Checklist
topic: omd home cloud setup
language: en
benchmark_role: primary_setup
---

# OMD Home Cloud Setup Checklist

This note is synthetic and exists to test the setup path for cloud answers.

## Ollama Cloud

1. Install and start Ollama.
2. Sign in with `ollama signin`.
3. Pull a cloud-backed model such as `gpt-oss:120b-cloud`.
4. Run the cloud model once so Ollama exposes metadata.
5. In OMD Home, choose Ollama Cloud, select the model, and press Check setup.
6. Turn on Allow cloud answers before sending a vault question.
7. Review the preview modal and approve or cancel the request.
8. Switching to OpenAI, Anthropic, or DeepSeek requires that provider's own setup and Check setup flow; enabling Ollama Cloud does not enable the others.

## Hosted APIs

- OpenAI, Anthropic, and DeepSeek use developer API keys.
- Consumer subscriptions do not count as API access.
- OMD Home saves keys to Keychain or environment variables, then loads the model catalog on Check setup.

## No fallback

- OMD Home does not silently switch to another provider.
- Cloud answers stay opt-in and per-request.
