# OMD Home release checklist

Use this checklist for every GitHub release and before submitting or updating OMD Home in
Obsidian Community Plugins. A checked code gate does not replace the hands-on desktop gates.

## Source and contract

- [ ] The worktree contains only reviewed release changes.
- [ ] `manifest.json`, `package.json`, the lockfile, and `versions.json` contain the same exact semantic version.
- [ ] `node scripts/sync-omd-contract-fixtures.mjs /path/to/omd` reports that fixtures are current.
- [ ] Any fixture update was reviewed against OMD's v1 contract before using `--accept`.
- [ ] The configured OMD executable reports `enrich_note.supported: true` and schema version `1` from `capabilities --json`.

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
- [ ] Home, Inbox, Markdown events, capture entry points, tags, drag/push layout, visible resizing, standard-size reset, light/dark themes, narrow windows, and keyboard focus work.
- [ ] Recent-note titles and paths share one left edge; an expanded omnibox result reflows the grid and never overlays another widget.
- [ ] Phase 1a local AI settings expose only Ollama as an active provider and preserve any old hosted provider value as disabled until the user explicitly selects Ollama.
- [ ] **Refresh models** repopulates locally installed Ollama models without rewriting an unknown/stale selection behind the user's back.
- [ ] **Refresh models** keeps the settings page stable and reports progress, installed-model count, completion, and a timestamp.
- [ ] **Check connection** distinguishes invalid host, unreachable daemon, missing `/api/status`, cloud-enabled Ollama, no installed models, and missing/incompatible selected models.
- [ ] **Test embeddings** validates the selected local embedding model with English and Chinese probes, reports vector dimensions, and rejects remote, malformed, or dimension-mismatched responses.
- [ ] Hybrid retrieval can be disabled without making an embedding request; when enabled it labels answers as Hybrid or Sparse and exposes any fallback warning.
- [ ] First-use hybrid indexing has a longer bounded timeout, remains cancellable, and namespaces cached vectors by the installed Ollama model digest when available.
- [ ] D01 (`这些抱石笔记给初学者哪些建议？`) recalls both English bouldering fixtures with `bge-m3`, excludes distractors, and fails closed in the sparse-only control.
- [ ] Optional semantic reranking uses the selected loopback embedding model, stays off by default, and cannot hide a fallback or change an evidence-grounded abstention into an unsupported answer.
- [ ] Smoke checks exist for vault Q&A, enrichment, and capture polish, send no vault content, and fail closed when the selected model is missing or incompatible.
- [ ] Blank Python and bridge overrides resolve OMD's embedded interpreter and the bridge bundled in `main.js`; the Settings-row Vault Q&A Smoke remains clearly distinct from a real `@` vault question.
- [ ] A blank EventKit helper override resolves only an executable regular file beside OMD Home; missing helpers and Calendar permission failures remain actionable.
- [ ] Local AI rejects any Ollama host outside `http://localhost:11434` and `http://127.0.0.1:11434` in Phase 1a.
- [ ] macOS Calendar lists only explicitly selected calendars; Google and Outlook are accessed only through accounts already added to Apple Calendar.
- [ ] Vault, Calendar, and Linked filters update events without resetting the current Calendar date/view, and at least one source stays enabled.
- [ ] Event Start/End use local native controls; timed-to-all-day conversion preserves a valid exclusive End date.
- [ ] A simultaneous Markdown/Apple Calendar edit shows a conflict and never silently chooses a side.
- [ ] Capability failure, missing/old executable, unsupported schema, stopped Ollama, missing model, timeout, cancellation, malformed output, and output overflow are actionable and write nothing.
- [ ] Current task shows only active work; Needs attention shows a failed capture once with timestamp, source, detail, and Retry.
- [ ] A URL, ordinary local path, `~/` path, shell-escaped-space path, and drag-dropped local file all reach OMD without shell evaluation.
- [ ] Commands discovers enabled core/community commands; recording uses an exact toggle or explicit Start/Stop actions without guessing state.
- [ ] English and Chinese/Unicode notes, long paths, and exact evidence remain readable without leaking unnecessary absolute paths.
- [ ] Backgrounding or closing only the Home tab does not cancel a running capture; disabling/reloading the plugin and quitting Obsidian cancel plugin-owned child work and leave no orphan process.

## Review-first enrichment

- [ ] Generate displays the target, local model, loopback endpoint class, progress stages, evidence, links, tags, concepts, warnings, Cancel, Retry, and Apply.
- [ ] Generate and review leave every vault Markdown hash unchanged.
- [ ] New concepts remain display-only and new tags begin unchecked.
- [ ] Apply writes only the selected links/tags and sets `omd_home_status: reviewed` only after success.
- [ ] Editing the target between Generate and Apply produces a zero-write conflict.
- [ ] A simulated frontmatter failure either rolls the body back or reports a recoverable partial failure without claiming success.

## Release artifact

- [ ] The Git tag exactly equals the manifest version, without a `v` prefix.
- [ ] The public GitHub release contains exactly `main.js`, `manifest.json`, and `styles.css` as plugin assets.
- [ ] A clean vault installs and loads those exact assets without a sibling source checkout.
- [ ] Installing/reinstalling does not overwrite the vault's plugin `data.json`.
- [ ] README, license, third-party notices, security policy, privacy boundaries, desktop-only scope, Phase 1a Ollama-only behavior, cloud-disabled gate, and optional local prerequisites are current.
- [ ] README and release notes do not promise auto-install, auto-pull, alternate ports, or hosted-provider fallback for local AI.
- [ ] The locally verified asset hashes match the published release assets.
- [ ] The Community Plugins submission/reviewer feedback is complete before claiming Marketplace availability.

## Community directory submission

Submit only after the manual release-candidate pass is complete and the release artifact checks
above are green.

- [ ] Sign in to `community.obsidian.md` with the Obsidian account that owns the plugin.
- [ ] Connect the GitHub account used for the repository.
- [ ] Open **Plugins** and choose **New plugin**.
- [ ] Enter the GitHub repository URL for OMD Home.
- [ ] Review and agree to the current Developer policies and continue-support prompt.
- [ ] Wait for the directory review to pass before describing the plugin as ready for the Community directory.
