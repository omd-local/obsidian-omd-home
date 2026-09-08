<div align="center">

<img src="docs/assets/omd-home-icon.png" alt="OMD Home pixel icon: a doorway inside a Markdown note" width="144">

<sub>OMD HOME // PUBLIC BETA 0.1.1</sub>

# OMD Home

**A single doorway for capture, calendars, review, and vault-grounded questions.**

The note is your vault. The doorway is the controlled working surface around it.

Bring sources in. See the day. Ask with evidence. Review every write before it lands.
Your Markdown files remain the source of truth.

[![CI](https://github.com/omd-local/obsidian-omd-home/actions/workflows/ci.yml/badge.svg)](https://github.com/omd-local/obsidian-omd-home/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/omd-local/obsidian-omd-home?style=flat-square&label=release)](https://github.com/omd-local/obsidian-omd-home/releases/latest)
[![Obsidian desktop](https://img.shields.io/badge/Obsidian-desktop-7C3AED?style=flat-square)](https://obsidian.md/)
[![License: PolyForm Shield](https://img.shields.io/badge/License-PolyForm%20Shield-202124?style=flat-square)](LICENSE)

[Install](#install) ·
[See the rooms](#one-doorway-four-rooms) ·
[Configure](#choose-your-setup) ·
[Test](docs/manual-test-plan.md) ·
[Report an issue](https://github.com/omd-local/obsidian-omd-home/issues)

</div>

> [!IMPORTANT]
> OMD Home requires Obsidian desktop 1.11.4 or newer. It is a desktop-only plugin.
> Home, Markdown events, capture, and local AI work on supported desktop
> platforms. Apple Calendar integration requires macOS 14 or newer and the
> separately built EventKit helper. Until OMD Home is listed in Obsidian
> Community Plugins, install it from GitHub Releases.
>
> OMD Home does not install, update, or bundle OMD, Python, Ollama, or the EventKit helper.
> When OMD is missing, the plugin can copy the official install commands or
> open the official guide. It never executes those commands for you.

## One doorway, four rooms

OMD Home is a doorway, not a second vault. Capture, calendar, review, and
vault Q&A share one controlled entrance while Obsidian remains the source of truth.

<img src="docs/assets/omd-home-system-overview.svg" alt="OMD Home system overview" />

### Four rooms, one source of truth

| Surface | What it is for |
|---|---|
| **Home** | A centered dashboard for Today, Upcoming, Recent notes, Pinned notes, Vault tags, system health, and the work that needs attention. |
| **Omnibox** | Vault search, Obsidian and community commands, quick notes, URL or file capture, event creation, recording commands, and read-only `@` vault questions. |
| **Calendar** | Month, week, day, and list views for Markdown events plus explicitly selected macOS calendars. |
| **Inbox** | Recent OMD captures, review-first link and tag suggestions, current work, failures, timestamps, details, retry, and cancellation. |

Widgets use a 12-column grid, move occupied cards out of the way, and keep their
layout per device viewport. Standard sizes are always available from each
widget menu, so a desktop layout does not have to fit a different screen.

## Bring sources in. Decide what changes.

Paste a URL, paste a local path, or drop a file onto Home. OMD Home starts a
managed OMD process, reports progress, and leaves conversion ownership with
[Markdown Everything](https://github.com/omd-local/markdown-everything).

The boundary stays narrow: only the URL or file you submit enters, and nothing
new is written back without review.

<img src="docs/assets/omd-home-capture-flow.svg" alt="OMD Home capture flow" />

- URL capture contacts only the source you submit. A local file capture reads
  only the path you submit.
- Drag and drop, `~/` paths, and shell-escaped spaces are normalized without
  evaluating a shell command.
- Capture continues when the Home tab is backgrounded or closed. Cancel,
  plugin unload, or quitting Obsidian stops plugin-owned child work.
- Capture keeps OCR and speech recognition separate. On first use, both controls
  begin with **No language preference**. Vault-wide defaults live under
  **Recognition defaults** in Settings. OCR can also use `eng`, `chi_sim+eng`,
  or `chi_tra+eng`; speech can use explicit **Auto-detect**, `en`, or `zh`.
  Recognition changes in the Capture dialog apply only to that capture, while
  Retry preserves them without changing the vault defaults.
- **Review links and tags** is proposal-only. Nothing is written until you explicitly press **Apply**.
  New concepts stay display-only, and new tags start unchecked.
- The **Polish Markdown** and **Review links and tags** capture toggles appear
  only in the Capture dialog. New captures remember the last submitted choices. Cancelling the
  dialog does not change them. Polish Markdown is off by default.

## Calendar sync with no silent winner

Create a vault-only Markdown event or link it to a writable calendar selected
in settings. OMD Home never enables every calendar by default.

<img src="docs/assets/omd-home-calendar-flow.svg" alt="OMD Home calendar sync flow" />

- **Vault**, **Calendar**, and **Linked** are live source filters. At least one
  source remains visible.
- Google Calendar and Outlook Calendar can participate when they have already been added to macOS Calendar.
  Their calendars must also be explicitly selected in OMD Home.
- Start and End use local date and time controls. An all-day End is the
  exclusive calendar date.
- When both linked copies change before sync, OMD Home asks which side to keep.

## Ask the vault. See the evidence.

Type `@` in the omnibox to ask a question. Vault Q&A is read-only and renders
its answer in an owned result panel with evidence chips, retrieval mode,
elapsed time, and **Copy result**.

This room is intentionally conservative. It can inspect bounded evidence, but it
does not get to silently rewrite the vault.

<img src="docs/assets/omd-home-vault-ai.svg" alt="OMD Home vault Q&A flow" />

Hybrid retrieval can combine sparse recall with a locally installed embedding
model. If semantic recall fails, OMD Home labels the sparse fallback instead of
claiming a hybrid result. Optional semantic reranking is off by default.

OMD Home supports explicit answer-provider setup for local Ollama on this computer,
Ollama Cloud through the local Ollama app, OpenAI API, Anthropic API, and
DeepSeek API.

Local Ollama remains the default answer path. Hosted providers are explicit
opt-ins: every cloud answer request shows a preview with the selected provider,
model, and bounded evidence excerpts before anything leaves the device. OMD Home sends only the question plus the selected local evidence snippets; it never sends the whole vault. The UI uses that preview only for the immediately approved request; there is no silent fallback across providers or auto-switch to another provider.

Local-first rules still apply where they matter:

- The live local Ollama answer path accepts only `http://localhost:11434` and
  `http://127.0.0.1:11434`.
- Local answer mode, note enrichment, Polish Markdown, and local embedding-based
  retrieval stay on loopback Ollama. Cloud availability does not block local
  model selection.
- Hosted answer providers only receive the question plus bounded evidence
  excerpts after the preview and your explicit approval. They never receive
  your whole vault.
- If local hybrid retrieval cannot be verified safely, Vault Q&A falls back to
  sparse retrieval and labels that fallback instead of pretending it stayed hybrid.

Cloud access is provider-scoped and explicit:

- Ollama Cloud sends the question plus bounded evidence excerpts to Ollama's
  cloud service after preview approval.
- OpenAI, Anthropic, and DeepSeek send the question plus bounded evidence
  excerpts to their own APIs after preview approval.
- OMD Home does not auto-switch providers or send the full vault.
- Ollama Cloud requires an Ollama account/sign-in; OpenAI, Anthropic, and
  DeepSeek require separate developer API access, and consumer subscriptions
  are separate from API billing.

Settings provide:

- **Check setup** for the selected provider, model, and safety boundary.
- **Test embeddings** for local hybrid retrieval.
- `OMD Home: Refresh local AI models` from the command palette when you want to
  rescan local Ollama models without changing the saved selection.

## Install

### From a GitHub release

1. Download `main.js`, `manifest.json`, and `styles.css` from the
   [latest release](https://github.com/omd-local/obsidian-omd-home/releases/latest).
2. Create `<your-vault>/.obsidian/plugins/omd-home/`.
3. Put the three files directly in that folder.
4. In Obsidian, open **Settings > Community plugins**, reload installed
   plugins, and enable **OMD Home**.
5. Run **OMD Home: Open home** from the command palette.

The release tag must exactly match the version in `manifest.json`, without a
`v` prefix. The plugin release contains no executable helper, model, Python
runtime, or OMD installation.

### From source

```bash
git clone https://github.com/omd-local/obsidian-omd-home.git
cd obsidian-omd-home
npm ci
npm run build
```

If you also want to test Apple Calendar integration from source on macOS, build
the helper before installing into the repository test vault:

```bash
npm run build:eventkit
npm run install:test-vault
```

`npm run install:test-vault` always copies `main.js`, `manifest.json`, and
`styles.css` into this repository's disposable `test-vault/`, preserving an
existing plugin `data.json`. It also copies `dist/omd-eventkit` when a built
executable helper is present. Settings and this optional helper are not release assets.

## Choose your setup

OMD Home starts with useful vault-only features. Add local tools only for the
workflows you want.

### Connect OMD

On startup, OMD Home checks the app executable path and safe common locations
used by Homebrew, MacPorts, user installs, and local Python environments. It
probes candidates for the compatible OMD capability contract and can continue
past a missing or outdated candidate to find a current one.

If no compatible install is found, **Settings > OMD Home > OMD** and the Home
**Needs attention** widget provide **Copy install commands**, **Install guide**,
and **Check again** actions. On macOS, the copied commands are:

```bash
brew install omd-local/omd/omd
omd doctor
```

Windows and Linux receive the official source-install steps instead. OMD Home
only copies the text or opens the
[Markdown Everything quick start](https://github.com/omd-local/markdown-everything#quick-start);
it does not download a release, run a shell, request administrator access, or
change a Python environment.

Most users should leave **Advanced OMD paths** closed. Open it only to select a
specific OMD or Python environment when automatic discovery cannot reach the
right one. Clearing the OMD override restores automatic discovery.

If Terminal and OMD Home appear to use different installs, run `omd --version`
and `omd capabilities --json` against the executable path shown by OMD Home.
OMD keeps persistent defaults in versioned JSON; `omd config path` locates the
file and `omd config show --json` shows the resolved settings. Explicit capture
arguments override environment, then config, then adapter or built-in defaults.

Capture language scope is deliberately narrow. OCR applies to images,
screenshots, and enabled article-image OCR, not ordinary webpage text or
ordinary/scanned PDF pages. OMD Home does not promise automatic OCR-language
detection. **No language preference** sends no explicit language flag, so the
lower-priority converter setting remains in control. **Auto-detect** explicitly
requests speech-language detection. Polish Markdown is a post-conversion
cleanup step; it is neither OCR nor translation. If an OCR
preset fails, install the named Tesseract language pack and check
`tesseract --list-langs` before retrying.

| Capability | Minimum setup | Boundary |
|---|---|---|
| Home, search, commands, quick notes, Markdown events | Obsidian desktop | Current vault only |
| URL and file capture | A compatible local OMD install, discovered automatically when possible | Submitted URL or file; URLs contact their source |
| Link and tag proposals | A compatible OMD executable and local Ollama | Review-first; no write before Apply |
| Local Vault Q&A | OMD with retrieval support, a Python interpreter, and local Ollama | Bounded evidence over loopback; read-only |
| Hosted answer providers | OMD with `ai_service`, provider-model discovery, credential support, and per-question consent grants | Retrieval stays local; only the question and bounded selected evidence are sent after approval |
| Hybrid retrieval | A local embedding model selected in settings | Derived vectors stay local; query vectors are not persisted |
| Apple Calendar sync | macOS 14+, EventKit helper, Calendar permission | Explicitly selected calendars only |
| Google or Outlook calendar sync | Account already added to macOS Calendar | Uses the same selected EventKit calendars |

<details>
<summary><strong>ASK VAULT SETUP // local by default, cloud by per-request approval</strong></summary>

1. Install and start Ollama.
2. If you want local Vault Q&A, enrichment, or Polish Markdown, install a
   completion model yourself. For example:

   ```bash
   ollama pull qwen3:4b-instruct
   ```

3. To use hybrid retrieval, install a local embedding model such as `bge-m3`:

   ```bash
   ollama pull bge-m3
   ```

   Choose it under **Advanced AI controls > Vault retrieval**, then press
   **Test embeddings**. Missing-model guidance can copy the download command;
   the plugin never runs it for you.
4. In **Settings > OMD Home > AI answers**, choose an answer provider.
   - For **Ollama on this computer**, choose a local model and press **Check setup**.
     A downloaded model marked **unverified** is still selectable when Ollama
     omits capability metadata; Check setup inspects it before use.
   - For **Ollama Cloud**, follow [Ollama Cloud](#ollama-cloud) for the
     first-run sign-in, model selection, and per-request preview flow.
   - For **OpenAI API**, **Anthropic API**, or **DeepSeek API**, configure a
     developer API key, press **Check setup** to load models, then choose one.
     On macOS, paste the actual API key into the password field and press
     **Save key** to store it in macOS Keychain. On Windows and
     Linux, set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `DEEPSEEK_API_KEY`
     before starting Obsidian. Keys never enter notes or plugin settings.
     OpenAI API billing stays separate from ChatGPT subscriptions, and Anthropic API billing stays separate from Claude subscriptions.
5. If local models changed on disk, run **OMD Home: Refresh local AI models**
   from the command palette, then return to **Check setup**.
6. Leave the Python bridge override blank to use the bridge bundled in
   `main.js`. OMD Home derives the Python interpreter from the detected OMD
   launcher when that launcher has a direct Python shebang. Otherwise, set an
   explicit Python executable.

### Ollama Cloud

Ollama Cloud requires an Ollama account and whatever cloud billing or usage rules Ollama applies to cloud models. OMD Home only reads the local Ollama app's cloud state; it does not manage Ollama billing or switch providers for you.

1. Sign in to Ollama:

   ```bash
   ollama signin
   ```

2. Confirm a cloud-backed model is available:

   ```bash
   ollama pull gpt-oss:120b-cloud
   ollama run gpt-oss:120b-cloud
   ```

3. In **Settings > OMD Home > AI answers**, choose **Ollama Cloud**.
4. Press **Check setup** to load the detected cloud model metadata.
5. Select the cloud-backed model you want to use.
6. Turn on the selected provider's **Allow … answers** toggle only when you want `@`
   questions to send the question plus bounded evidence excerpts. The label always matches the
   current provider, for example **Allow Ollama Cloud answers**.
7. Review the preview modal every time. Cancel sends nothing; Send keeps the selected provider and model fixed.

Official provider references:

- [Ollama API introduction](https://docs.ollama.com/api/introduction)
- [OpenAI API model docs](https://developers.openai.com/api/docs/models)
- [Anthropic API overview](https://platform.claude.com/docs/en/api/overview)
- [DeepSeek API docs](https://api-docs.deepseek.com/api/deepseek-api)

OMD Home does not auto-pull, auto-install, auto-select models, or auto-switch
providers. Local answer and writing dropdowns show all downloaded models that
stay on this computer. Compatible completion models and models awaiting
capability verification are selectable; known incompatible models remain
visible but disabled with a reason. Remote-backed models stay out of the local
catalog. An incompatible, remote-backed, or stale saved selection remains
visible with recovery guidance and is never silently replaced.

If you want Ollama itself to run in local-only mode, you can still set
`disable_ollama_cloud` in `~/.ollama/server.json` or export `OLLAMA_NO_CLOUD=1`
inside Ollama. OMD Home does not require that setting for local model use, and
it never writes the file for you.

</details>

<details>
<summary><strong>CALENDAR SETUP // EventKit and selected accounts</strong></summary>

Build the helper on macOS:

```bash
npm run build:eventkit
```

For the repository test vault, `npm run install:test-vault` installs
`dist/omd-eventkit` beside the plugin when the built helper is present and
executable. For another vault, build the helper first, then copy the executable
to `.obsidian/plugins/omd-home/omd-eventkit` or select its absolute path in OMD
Home settings.

Then:

1. Grant Calendar permission when macOS asks.
2. Press **Refresh calendars**.
3. Enable only the calendars OMD Home may read.
4. Choose one writable calendar as the default destination for linked events.

Windows and Linux keep Markdown calendar features but do not expose Apple
Calendar controls.

</details>

## Platform support

| Platform | Available now |
|---|---|
| **macOS 14+** | Home, capture, Inbox, omnibox, Markdown events, local AI, and optional selected-calendar sync |
| **Windows and Linux desktop** | Home, capture, Inbox, omnibox, Markdown events, and local AI; no Apple Calendar integration |
| **iPhone and iPad** | Not supported in v0.1 because the plugin depends on desktop child processes and filesystem APIs |

## Commands and status

The command palette exposes the main workflows without requiring the Home view
to be open:

- **Open home** and **Focus omnibox**
- **Open calendar**, **Create event**, and **Sync linked calendar events**
- **Capture URL or file** and **Cancel active OMD action**
- **Check OMD setup** and **Open OMD install guide**
- **Suggest links and tags**
- **Refresh local AI models**, **Check local AI connection**, and
  **Test local AI embeddings**
- **Start or stop recording**
- **Refresh macOS calendars**

The omnibox **Commands** action also searches commands from Obsidian core and
enabled community plugins. Recording exposes a wrapper command that delegates to Obsidian's own recorder toggle or Start/Stop commands; if the underlying recorder is unavailable, OMD Home should tell you how to enable it rather than guess a second recorder state.

**Current task** shows only active work. **Cancel** appears only while that work
can still be stopped; after OMD has saved a capture, the short Inbox/indexing
finalization remains visible without a misleading Cancel button. **Needs
attention** owns unresolved failures with a timestamp, safe source label,
details, and the right recovery action for that failure, such as capture retry,
Local AI checks, or Calendar follow-up. A failed capture keeps its own Retry even
if a later setup check reports another issue. Missing or incompatible OMD,
Ollama, model, bridge, and EventKit states surface there instead of failing
silently.

## Privacy and failure boundaries

- No OMD Home telemetry, ads, account creation, or payment flow.
- No automatic helper install, executable update, model pull, or model switch.
- OMD setup actions copy official text or open an external guide. They never
  execute an installer or mutate a Python environment.
- Cloud answer providers are explicit BYOK setup choices. OMD Home retrieves
  evidence locally, then sends only the question and bounded selected evidence
  after you approve each cloud answer request. It never falls back to another
  provider automatically.
- OMD Home reads and writes the current vault. A local file capture reads only
  the external path you explicitly submit; it does not scan neighboring files.
- To launch the bundled bridge, OMD Home may read the detected OMD launcher's
  first line only to identify its Python interpreter. It then starts only the
  local executable you configured or that passed automatic capability checks.
- Optional EventKit integration uses local macOS permissions and only the
  calendars selected in OMD Home.
- URL conversion is local-first, not offline: OMD contacts the URL you submit.
- Review-first note enrichment sends only bounded note content, ranked
  candidate metadata, and bounded vault tags to the detected local OMD
  installation.
- Polish Markdown sends only the captured note content needed for that local
  cleanup pass.
- Local Ollama receives bounded note content and metadata only over an accepted
  loopback endpoint. Retrieval, capture, enrichment, and embedding work remain
  local unless you explicitly opt into a cloud answer request. Review generated
  answers, links, and tags before relying on them.
- Disabling or reloading the plugin and quitting Obsidian cancel plugin-owned
  child work. Closing only the Home tab does not.

## Development and release

```bash
npm ci
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

To check the copied OMD enrichment contract fixtures without writing:

```bash
node scripts/sync-omd-contract-fixtures.mjs /path/to/omd
```

After reviewing upstream contract and validator changes, accept an intentional
fixture update with `--accept`.

| Read this | When you need it |
|---|---|
| [Manual test plan](docs/manual-test-plan.md) | Exact desktop QA, local AI benchmarks, background work, reload, and unload cases |
| [Release checklist](docs/release-checklist.md) | Community Plugins packaging, privacy, compatibility, and release gates |
| [Security policy](SECURITY.md) | Supported versions and private vulnerability reporting |
| [Third-party notices](THIRD_PARTY_NOTICES) | Licences and notices for bundled third-party components |

GitHub release assets contain exactly `main.js`, `manifest.json`, and
`styles.css`. External helpers remain optional manual prerequisites and must not
be assumed present after a Community Plugins install.

## License

OMD Home is source-available under the
[PolyForm Shield License 1.0.0](LICENSE). Company-wide internal use is
permitted. You may not use OMD Home to provide or market a product or service
that competes with OMD Home or the OMD product family without a separate
license from the copyright holders.

The licence text controls if this summary and the licence differ. Third-party
components remain under their own licences; see
[THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).

<div align="center">

**ONE DOORWAY -> LOCAL EVIDENCE -> REVIEW BEFORE WRITE -> KEEP THE VAULT YOURS**

[Download](https://github.com/omd-local/obsidian-omd-home/releases/latest) ·
[Read about OMD](https://github.com/omd-local/markdown-everything) ·
[Report a bug](https://github.com/omd-local/obsidian-omd-home/issues) ·
[PolyForm Shield License](LICENSE)

</div>
