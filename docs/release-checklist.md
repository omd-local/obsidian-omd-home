# OMD Home release checklist

Use this checklist for every GitHub release and before submitting or updating OMD Home in
Obsidian Community Plugins. A checked code gate does not replace the hands-on desktop gates.

## Source and contract

- [ ] The worktree contains only reviewed release changes.
- [ ] `manifest.json`, `package.json`, the lockfile, and `versions.json` contain the same exact semantic version.
- [ ] `node scripts/sync-omd-contract-fixtures.mjs /path/to/omd` reports that fixtures are current.
- [ ] Any fixture update was reviewed against OMD's v1 contract before using `--accept`.
- [ ] The OMD executable resolved by automatic discovery reports `enrich_note.supported: true` and schema version `1` from `capabilities --json`.

## Automated gates

- [ ] `npm ci` succeeds from the committed lockfile.
- [ ] `npm run typecheck` succeeds.
- [ ] `npm run lint` succeeds without warnings.
- [ ] `npm test` succeeds.
- [ ] `npm run build` succeeds in production mode.
- [ ] `npm audit --omit=dev` reports no unresolved production vulnerability.
- [ ] `main.js` has no source map, developer machine paths, vault paths, credentials, or test-vault content.

## Desktop behavior

- [ ] OMD Home loads with OMD, Python, Ollama, and EventKit absent; unrelated modules remain usable.
- [ ] First-use OMD setup checks the app path and documented common locations automatically; a manual executable is available only under **Advanced OMD paths**.
- [ ] Missing OMD exposes Copy install steps, the official install guide, and Check again in Settings and Needs attention without executing a shell, installer, package manager, or privilege prompt.
- [ ] Automatic discovery can skip a missing or outdated earlier candidate and retain the compatible resolved executable for capture, Vault Q&A, and enrichment.
- [ ] Home, Inbox, Markdown events, capture entry points, tags, drag/push layout, visible resizing, standard-size reset, light/dark themes, narrow windows, and keyboard focus work.
- [ ] Recent-note titles and paths share one left edge; an expanded omnibox result reflows the grid and never overlays another widget.
- [ ] AI answers expose explicit provider choices for local Ollama, Ollama Cloud, OpenAI API, Anthropic API, and DeepSeek API, and provider-scoped cloud opt-in never leaks across providers.
- [ ] Local writing, Polish Markdown, and embeddings remain loopback-only; hosted providers can answer only after per-request preview approval and stay bound to the selected provider/model.
- [ ] `OMD Home: Refresh local AI models` repopulates local Ollama catalogs without rewriting an unknown or stale saved selection behind the user's back.
- [ ] **Check setup** distinguishes invalid host, unreachable daemon, missing `/api/status`, cloud-enabled Ollama, no installed models, missing credentials, provider catalog failures, and missing/incompatible selected models.
- [ ] Local answer and writing dropdowns show every downloaded local model; incompatible entries stay visible, disabled, and labelled with a reason. Unchecked uses a neutral adjacent status rail; Ready and actual errors have distinct prominent rails with text labels.
- [ ] Invalid endpoint input immediately lists `http://localhost:11434` and `http://127.0.0.1:11434` beside the field, preserves the last valid setting, and clears its error when corrected.
- [ ] **Test embeddings** validates the selected local embedding model with English and Chinese probes, reports vector dimensions, and rejects remote, malformed, or dimension-mismatched responses.
- [ ] Missing `bge-m3` offers a copyable `ollama pull bge-m3` command without running it; **Test embeddings** keeps **Advanced AI controls** open through success and failure.
- [ ] Hybrid retrieval can be disabled without making an embedding request; when enabled it labels answers as Hybrid or Sparse and exposes any fallback warning.
- [ ] First-use hybrid indexing has a longer bounded timeout, remains cancellable, and namespaces cached vectors by the installed Ollama model digest when available.
- [ ] D01 (`这些阳台番茄笔记给新手哪些建议？`) recalls both benchmark fixture notes with `bge-m3`, excludes distractors, and fails closed in the sparse-only control.
- [ ] Optional semantic reranking uses the selected loopback embedding model, stays off by default, and cannot hide a fallback or change an evidence-grounded abstention into an unsupported answer.
- [ ] Blank Python and bridge overrides resolve OMD's embedded interpreter and the bridge bundled in `main.js`; on Windows, environment-local Python discovery stops immediately on cancellation and missing Python guidance points to the advanced override.
- [ ] A blank EventKit helper override resolves only an executable regular file beside OMD Home; missing helpers and Calendar permission failures remain actionable.
- [ ] Local Ollama mode rejects any host outside `http://localhost:11434` and `http://127.0.0.1:11434`. Hosted answer providers never inherit an arbitrary loopback override.
- [ ] Ollama Cloud and hosted APIs can validate model availability, and real hosted Vault Q&A only proceeds after per-request preview approval; cancel sends nothing, no fallback occurs, and no full vault leaves the device.
- [ ] On macOS, the password field accepts the actual developer API key, saves it to macOS Keychain, and clears after success; it never treats the input as an Obsidian SecretStorage name. On Windows/Linux, Settings shows the exact provider environment variable and no unsupported Save/Remove action.
- [ ] Credential hydration settles without an automatic request/render loop, including missing-key and failed-check states; provider switches and aborted older work cannot overwrite a newer provider's state or task.
- [ ] Hosted consent shows the exact selected bounded evidence excerpts and binds approval to that question/provider/model/evidence; Cancel, Escape, provider changes, and unload while awaiting approval send nothing and cannot reuse stale consent.
- [ ] Hosted developer credentials never appear in plugin settings, notes, copied release assets, logs, or error details.
- [ ] AI setup actions are serialized across local and hosted providers; a late, cancelled, or provider-stale setup result cannot overwrite the current provider state.
- [ ] Omnibox results obey latest-submission-wins across local answers, hosted consent, ordinary OMD search, capture, quick-note, and command submissions; obsolete work cannot restore a hidden result panel or leave a stale Needs attention error.
- [ ] macOS Calendar lists only explicitly selected calendars; Google and Outlook are accessed only through accounts already added to Apple Calendar.
- [ ] Vault, Calendar, and Linked filters update events without resetting the current Calendar date/view, and at least one source stays enabled.
- [ ] Event Start/End use local native controls; timed-to-all-day conversion preserves a valid exclusive End date.
- [ ] A simultaneous Markdown/Apple Calendar edit shows a conflict and never silently chooses a side.
- [ ] Capability failure, missing/old executable, unsupported schema, stopped Ollama, missing model, timeout, cancellation, malformed output, and output overflow are actionable and write nothing.
- [ ] Current task shows only active work and offers Cancel only while the operation is cancellable; committed capture finalization has no misleading Cancel. Needs attention shows a failed capture once with timestamp, source, detail, and a Retry that survives unrelated setup checks.
- [ ] A single public URL, ordinary local file path, `~/` file path, shell-escaped-space file path, and one drag-dropped local file all reach OMD without shell evaluation.
- [ ] README and release notes do not claim cookie-gated Douyin/XHS share text or folder/list batches are connected in OMD Home.
- [ ] Home Capture exposes separate OCR and ASR controls: both use the vault's Recognition defaults, which start as No language preference; Capture-dialog changes are item-only and do not silently rewrite those defaults; OCR also has `eng`, `chi_sim+eng`, and `chi_tra+eng`; ASR distinguishes No language preference, explicit Auto-detect, `en`, and `zh`.
- [ ] Advanced AI controls contains one Local writing model and no duplicate capture-action toggles; verified completion models and local models awaiting capability verification are selectable, embedding-only or thinking-only models stay visible but disabled, and remote-backed models stay outside the local catalog; an unavailable saved value remains visible with recovery guidance; the Polish Markdown and Review links and tags capture toggles appear only in the Capture dialog.
- [ ] OCR/ASR recognition defaults affect capture only: changing them does not abort active Q&A or require optional recognition capabilities for unrelated supported Q&A operations.
- [ ] English, Simplified Chinese + English, and Traditional Chinese + English screenshots use the selected installed Tesseract packs; a missing pack is diagnosed with an actionable retry path.
- [ ] Plain webpage text bypasses OCR, and a scanned PDF is not presented as supported page OCR; polish is described only as post-conversion cleanup, never OCR or translation.
- [ ] ASR Auto and explicit `zh` produce distinct arguments, and capture Retry preserves OCR, ASR, polish, tags, and suggestion options.
- [ ] `omd config path` and `omd config show --json` expose valid versioned JSON, with explicit arguments overriding environment, config, then adapter/built-in defaults.
- [ ] Executable mismatch diagnostics compare `omd --version` and `capabilities --json` for the exact OMD path used by the plugin.
- [ ] Public docs prefer `--ocr-lang`/`--ocr-language`, identify top-level `--lang` as legacy OCR and adapter-local reel `--lang` as deprecated ASR, and do not claim automatic OCR-language detection ships.
- [ ] Commands discovers enabled core/community commands; recording uses an exact toggle or explicit Start/Stop actions without guessing state.
- [ ] English and Chinese/Unicode notes, long paths, and exact evidence remain readable without leaking unnecessary absolute paths.
- [ ] A question that cannot fit the model context is rejected before retrieval with guidance to shorten the question; accepted questions remain exact while only selected evidence may be shortened.
- [ ] Backgrounding or closing only the Home tab does not cancel a running capture; disabling/reloading the plugin and quitting Obsidian cancel plugin-owned child work and leave no orphan process.

## Review-first enrichment

- [ ] With the OMD override blank, both capture-triggered enrichment and **Suggest links and tags** immediately after capture retain the compatible automatically discovered executable, even when an older Homebrew launcher appears earlier among candidates.
- [ ] Generate displays the target, local model, loopback endpoint class, progress stages, evidence, links, tags, concepts, warnings, Cancel, Retry, and Apply.
- [ ] Generate and review leave every vault Markdown hash unchanged.
- [ ] Suggested note topics remain display-only and new tags begin unchecked.
- [ ] Add summary to note is off by default; when selected, the reviewed draft is written once in the managed Summary block.
- [ ] Apply writes only the selected summary/links/tags and keeps the note in Inbox; only **Done reviewing** sets `omd_home_status: reviewed`.
- [ ] Editing the target between Generate and Apply produces a zero-write conflict.
- [ ] A simulated frontmatter failure either rolls the body back or reports a recoverable partial failure without claiming success.

## Release artifact

- [ ] The Git tag exactly equals the manifest version, without a `v` prefix.
- [ ] The public GitHub release contains exactly `main.js`, `manifest.json`, and `styles.css` as plugin assets.
- [ ] A clean vault installs and loads those exact assets without a sibling source checkout.
- [ ] Installing/reinstalling does not overwrite the vault's plugin `data.json`.
- [ ] README, source-available license disclosure, third-party notices, security policy, privacy boundaries, desktop-only scope, explicit provider choices, provider-scoped cloud opt-ins, local-only writing gates, and optional local prerequisites are current.
- [ ] The production `main.js` banner contains the PolyForm Shield URL, exact Required Notice, and every bundled third-party runtime notice.
- [ ] README and release notes do not promise auto-install, auto-pull, alternate ports, automatic hosted failover, silent evidence egress, or automatic provider switching.
- [ ] The locally verified asset hashes match the published release assets.
- [ ] The Community Plugins submission/reviewer feedback is complete before claiming Marketplace availability.

## Community directory submission

Submit only after the manual release-candidate pass is complete and the release artifact checks
above are green.

- [ ] Sign in to [community.obsidian.md](https://community.obsidian.md/) with the Obsidian account that owns the plugin.
- [ ] Connect the GitHub account used for the repository.
- [ ] Open **Plugins** and choose **New plugin**.
- [ ] Enter the GitHub repository URL for OMD Home and select the `omd-local` owner.
- [ ] Review and agree to the current Developer policies and continue-support prompt.
- [ ] Wait for the directory review to pass before describing the plugin as ready for the Community directory.
