# OMD Home

OMD Home is a local-first Obsidian plugin with four connected surfaces:

- **Home**: a draggable, resizable startup canvas.
- **Calendar**: Markdown events plus selected macOS Calendar sources.
- **Inbox**: OMD Inbox review and processing status.
- **Omnibox**: vault search, commands, quick notes, OMD capture, and consent-gated AI retrieval.

The plugin does not replace OMD. OMD remains the recoverable conversion and capture
boundary. OMD Home uses OMD's AI service when the installed build exposes it; otherwise
local vault Q&A falls back to read-only Markdown retrieval and a loopback-only Ollama
request. macOS EventKit access is isolated in a small TCC-gated native helper with no
network role. On mobile, the UI remains available but native OMD and EventKit actions
fail closed with an explanatory state.

## Using Home

- Select **+ Event** in the Home header, a calendar widget, or the Calendar top bar.
  Choose **Vault note only** for Markdown, or **Vault + _calendar_** for a linked
  Markdown/EventKit event. A writable default must first be selected in settings.
- Calendar **Refresh** is read-only. Use the visible **Sync** button when you want
  pending one-sided changes applied. If both versions changed, OMD Home asks which
  version to keep. Missing or deselected Calendar items are shown as **Unavailable**
  and can be recreated or detached instead of being mislabeled as conflicts.
- A linked event's editor provides explicit **Detach**, **Delete Calendar copy**, and
  **Recreate** actions. An unavailable link exposes only Detach/Recreate. Read-only
  Calendar events can still create linked vault notes without attempting a Calendar
  write. Cross-system edits persist a recoverable `pending` note before EventKit runs,
  so OMD Home never silently turns a linked event into two copies.
- Select **Capture** or **Capture URL or file**, paste a URL or local path, add optional
  comma-separated tags, and let OMD write the recoverable result into the vault.
  The Processing widget shows only live work as active and offers **Cancel**; completed
  work remains short history instead of leaving the system permanently “working.”
- Select **Ask vault**, type a question after `@`, and press Return. OMD Home retrieves
  Markdown evidence before the configured model answers; Ollama remains local.
- The **Vault tags** widget reads inline and frontmatter tags automatically. Nested tags
  such as `project/work` are grouped under `project`; selecting a group opens tag search.
- Drag from the persistent grip. Dropping onto an occupied area pushes affected widgets
  down and compacts the remaining gap. Use **Widgets** to restore hidden panels one at
  a time. Layout is stored per vault path, device, and wide/compact viewport.

## Development

```bash
npm install
npm run check
npm run build:eventkit
npm run install:test-vault
```

The dedicated `test-vault/` is intentionally separate from any personal vault.
The install command copies the built plugin, Python bridge, and signed EventKit
helper into that vault only. This repository never writes to a real vault
automatically.

## OMD compatibility

Set the OMD executable and optional Python bridge paths in plugin settings. The plugin
consumes OMD's v1 JSON-lines progress contract and Markdown/sidecar vault formats.
Hosted-provider API keys stay in OMD's credential boundary when its AI service is
available; the self-contained compatibility fallback deliberately supports only local
Ollama.
