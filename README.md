# OMD Home

OMD Home is a desktop-only Obsidian plugin that gives OMD a local-first home screen,
calendar workspace, Inbox workflow, and omnibox.

It is designed for a separate local OMD installation. OMD Home does not install, update,
or bundle OMD, Python, Ollama, or the EventKit helper for you.

## What it includes

- Home: a centered dashboard with draggable and resizable widgets.
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

- OMD executable: used for URL/file capture now, and for review-first enrichment in Phase 2.
- Python bridge: used by the current optional omnibox AI and vault retrieval bridge.
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
- Optional AI actions send only the task payload chosen by the user to the configured OMD
  path. If you point OMD at a hosted provider, that provider's privacy and retention rules
  apply instead of OMD Home's.

## Current workflows

### Home and widgets

- Open OMD Home from the ribbon or command palette.
- Drag widgets from their grip handle.
- Resize widgets from the lower-right handle.
- Use Widgets to re-show hidden panels.
- Layout is stored per device viewport, so wide and compact layouts can differ safely.

### Calendar

- Choose **Vault note only** to create a Markdown event note.
- Choose **Vault + Calendar** to create a linked Markdown note and a macOS Calendar event.
- OMD Home reads only calendars you explicitly select in settings.
- Google Calendar and Outlook Calendar can participate when they have already been added to
  macOS Calendar and then selected inside OMD Home.
- If a linked event changes in both places, OMD Home shows a conflict and lets you choose.

### Capture

- Use **Capture** or the **Capture URL or file** command.
- Paste a URL or local file path.
- Add optional tags.
- OMD writes the recoverable capture into the vault.

### Optional AI actions

- Type `@` in the omnibox to ask a vault question.
- The current omnibox AI path is optional and read-only.
- Local Ollama can be used through your OMD configuration.
- If a hosted provider is selected, OMD Home should show task-specific disclosure and consent
  before content is sent.

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

## License

MIT. See [LICENSE](./LICENSE) and [THIRD_PARTY_NOTICES](./THIRD_PARTY_NOTICES).
