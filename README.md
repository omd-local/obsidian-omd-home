# OMD Home

OMD Home is a desktop-only Obsidian plugin that gives OMD a local-first home screen,
calendar workspace, Inbox workflow, and omnibox.

It is designed for a separate local OMD installation. OMD Home does not install, update,
or bundle OMD, Python, Ollama, or the EventKit helper for you.

## What it includes

- Home: a centered dashboard with a consistent two-column and three-column widget grid.
- Calendar: Markdown event notes plus optional linked macOS Calendar events.
- Inbox: recent OMD captures and processing status.
- Omnibox: vault search, commands, quick notes, capture shortcuts, and optional AI actions.

## Platform support

- Desktop only. The plugin uses Node.js child processes and desktop filesystem APIs, so
  `isDesktopOnly` is set to `true`.
- macOS calendar integration is optional and currently supported on macOS 14+ with the
  separately built EventKit helper.
- Windows and Linux can still use Home, Inbox, omnibox, Markdown events, and OMD capture,
  but Apple Calendar controls stay disabled.

## External dependencies and manual setup

OMD Home can run without any external helper, but optional features depend on local tools
you configure yourself in settings.

- OMD executable: used for URL/file capture and for review-first note enrichment.
- Ollama: used for Phase 1a local AI checks, smoke tests, and local vault Q&A.
- Python bridge: used by the existing vault retrieval bridge behind omnibox AI. Its source is
  bundled into `main.js`, so the normal path needs no bridge-file setting; advanced installs can
  still override it. When the Python executable override is blank, OMD Home derives Python from
  the configured OMD executable's launcher.
- EventKit helper: used only for macOS Calendar read/write.

The plugin never downloads these tools and never self-updates.

## Privacy and data behavior

- No OMD Home telemetry.
- No ads.
- No account creation or payment flow in OMD Home.
- OMD Home reads and writes files only inside the current vault, except when it launches
  user-configured local executables.
- OMD capture may contact the URL you submit, read a local file path you submit, and write
  Markdown plus OMD recovery artifacts into your vault.
- Optional calendar syncing uses the local EventKit helper and macOS calendar permissions.
- Review-first note enrichment sends only bounded note content, ranked candidate metadata,
  and bounded vault tags to your configured local OMD executable, which then talks only to
  a loopback Ollama endpoint in Phase 1a.
- Phase 1a local AI allows only the default local Ollama endpoints:
  `http://localhost:11434` and `http://127.0.0.1:11434`.
- Before local AI sends note or vault content, OMD Home checks the reachable Ollama daemon,
  requires the selected model to exist locally, and requires Ollama Cloud to be disabled.
- OMD Home does not auto-pull, auto-install, or auto-select models for you.
- Optional hybrid Vault Q&A sends bounded note representations to the selected
  local embedding model through the same loopback Ollama endpoint. OMD keeps a
  bounded derived-vector cache outside the vault; query vectors are not persisted.
- Hosted providers are preserved only as legacy-disabled settings in Phase 1a and do not run
  until you explicitly switch back to Ollama.

## Current workflows

### Home and widgets

- Open OMD Home from the ribbon or command palette.
- Drag widgets from their grip handle.
- Resize widgets from the visible lower-right handle, or choose **Use standard size** from
  a widget menu. Resize remains available because layouts are stored separately per device.
- Use Widgets to re-show hidden panels.
- Layout is stored per device viewport, so wide and compact layouts can differ safely.

### Calendar

- Choose **Vault note only** to create a Markdown event note.
- Choose **Vault + Calendar** to create a linked Markdown note and a macOS Calendar event.
- OMD Home reads only calendars you explicitly select in settings.
- Use the **Vault**, **Calendar**, and **Linked** buttons as live source filters. At least one
  source always remains visible.
- Event Start and End use local date/time controls; all-day End is an exclusive calendar date.
- Google Calendar and Outlook Calendar can participate when they have already been added to
  macOS Calendar and then selected inside OMD Home.
- If a linked event changes in both places, OMD Home shows a conflict and lets you choose.

### Capture

- Use **Capture** or the **Capture URL or file** command.
- Paste a URL or local file path.
- You can also drag a local file onto the Home omnibox or the capture dialog.
- Shell-escaped spaces such as `/Users/me/data\ science/file.pdf` are normalized without
  executing a shell command.
- Home-relative paths such as `~/Desktop/file.pdf` are expanded locally before OMD runs.
- Add optional tags.
- OMD writes the recoverable capture into the vault.
- **Suggest links and tags after capture** opens a local, review-first proposal and remembers
  its last setting. Capture polish remains a separate, remembered option and is off by default.
- A capture keeps running if the Home tab is backgrounded or closed. Disabling/reloading the
  plugin, quitting Obsidian, or pressing Cancel stops plugin-owned child work.

### Review-first note enrichment

- Use **Suggest links and tags** from the command palette, file menu, or Inbox row action.
- OMD Home builds the candidate catalog from your vault, then asks the configured local OMD
  executable for a proposal.
- The review modal shows exact evidence, existing-note link suggestions, existing tags,
  optional new tags, and display-only new concepts.
- Nothing is written until you explicitly press **Apply**.
- Phase 1a accepts only the default loopback Ollama endpoints for this workflow.

### Local AI setup

- Type `@` in the omnibox to ask a vault question.
- The current omnibox AI path is optional and read-only.
- For multilingual retrieval, install a local embedding model yourself, for example
  `ollama pull bge-m3`, then use **Refresh models** and **Test embeddings** in
  **Settings > OMD Home > Local AI**.
- **Hybrid retrieval** fuses OMD's BM25-style sparse recall with the selected local
  multilingual embedding model. Turn it off for deterministic sparse-only recall.
- **Semantic rerank** is optional and off by default. It uses the same embedding model
  to reorder the bounded evidence blocks; it is not a separate cross-encoder reranker.
- The first hybrid question can be slower while OMD embeds uncached note representations.
  Later questions reuse the bounded local cache. If embeddings fail, the answer remains
  sparse-only and shows the fallback reason instead of silently claiming hybrid retrieval.
- Phase 1a exposes Ollama-only controls for:
  - model selection per workflow
  - **Refresh** model discovery
  - **Check** connection, version, and cloud-disabled readiness
  - per-workflow **Smoke** checks that do not send vault content
- The **Smoke** button beside **Vault Q&A model** checks Ollama and the selected model only. Typing
  `@` in Home starts the real vault retrieval workflow and therefore also requires the OMD Home
  Python bridge.
- If Check connection reports that Cloud features are available, this does not mean the selected
  model is currently using Cloud. OMD Home still requires verifiable local-only mode before it
  sends vault content. Set `disable_ollama_cloud` in `~/.ollama/server.json` or use
  `OLLAMA_NO_CLOUD=1`, restart Ollama, then check again.
- OMD Home does not silently fall back to hosted providers or a different local model.

### Obsidian and community commands

- Choose **Commands** in the omnibox, or type `>`, to search commands registered by Obsidian
  core and enabled community plugins.
- When Obsidian exposes one recording toggle, OMD Home shows **Recording**. When Obsidian
  exposes separate commands, OMD Home shows explicit **Start recording** and **Stop recording**
  actions instead of guessing recorder state. OMD Home does not create a second recorder.

### Status panels

- **Current task** shows only work that is running and its Cancel action.
- **Needs attention** owns unresolved failures, including a timestamp, safe source label,
  details, and retry action. It also reports a missing or incompatible OMD enrichment build,
  unreachable Ollama, cloud-enabled Ollama, and missing or stale selected models.

## Release expectations

Obsidian installs community plugins from GitHub release assets whose tag exactly matches the
version in `manifest.json`. OMD Home release assets include only:

- `main.js`
- `manifest.json`
- `styles.css`

External helpers remain manual prerequisites and are not assumed to be present after a
Marketplace install.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

Optional helper workflows:

```bash
npm run build:eventkit
npm run install:test-vault
```

`test-vault/` is the only vault this repository's helper installer touches automatically.

To check the copied OMD enrichment contract fixtures without writing anything:

```bash
node scripts/sync-omd-contract-fixtures.mjs /path/to/omd
```

Contract drift exits nonzero and prints the fixture/provenance changes. After reviewing the
upstream contract and corresponding TypeScript validators, accept the update explicitly:

```bash
node scripts/sync-omd-contract-fixtures.mjs /path/to/omd --accept
```

See [the release checklist](./docs/release-checklist.md) before tagging a Community Plugins
release. The [manual test plan](./docs/manual-test-plan.md) contains exact desktop steps,
including the background-capture case.

## License

OMD Home is source-available under the
[PolyForm Shield License 1.0.0](./LICENSE). Company-wide internal use is
permitted. You may not use OMD Home to provide or market a product or service
that competes with OMD Home or the OMD product family without a separate
license from the copyright holders.

The license text controls if this summary and the license differ. Third-party
components remain under their own licenses; see
[THIRD_PARTY_NOTICES](./THIRD_PARTY_NOTICES).
