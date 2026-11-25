# Install on a Mac and complete your first Capture

[Back to OMD Home](../README.md) · [简体中文](getting-started-mac.md) · **English**

Start with a result you can check: **install the Obsidian plugin → install the OMD converter → save a webpage or file as Markdown → open the result in Inbox**. Add transcription, AI, or Apple Calendar afterward as needed.

This guide covers **OMD Home 0.2.2 + [OMD 0.3.0b5](https://github.com/omd-local/markdown-everything/releases/tag/v0.3.0b5)**. Both public `main` branches include the source for this release; the pinned tags and downloads below reproduce this version. The plugin, backend, models, and Calendar helper are separate installations. OMD's browser UI is deferred; use OMD Home in Obsidian.

## 1. Check your Mac and prepare a vault

1. Open **Apple menu → About This Mac** and check the system and **Chip / Processor**. This guide's supported Homebrew route uses **Apple Silicon and macOS 15 or newer**; Homebrew classifies Intel as Tier 3. The same installation experience is not guaranteed on Intel or older systems. See [Homebrew system requirements](https://docs.brew.sh/Installation).
2. Install Obsidian desktop **1.11.4 or newer** from the [official download page](https://obsidian.md/download). Check the version in **Settings → General**.
3. Use **Create new vault**, name it `OMD Demo`, save it in your Documents folder, and open it once so Obsidian creates `.obsidian`.

The examples use `~/Documents/OMD Demo`. `~` means your own home directory. Substitute your actual vault location if different. A vault is an ordinary folder containing your notes.

**Upgrading an existing vault:** back up the whole vault, stop captures, disable the plugin, and keep a separate copy of `.obsidian/plugins/omd-home/`. Replace only the three files below and **preserve the existing `data.json`** and notes. That file holds plugin settings; do not overwrite an existing vault with demo settings.

## 2. Download the three plugin files

Open the [OMD Home 0.2.2 release](https://github.com/omd-local/obsidian-omd-home/releases/tag/0.2.2) and download these three **Assets**:

| Required file | Pinned download |
|---|---|
| `main.js` | [Download main.js](https://github.com/omd-local/obsidian-omd-home/releases/download/0.2.2/main.js) |
| `manifest.json` | [Download manifest.json](https://github.com/omd-local/obsidian-omd-home/releases/download/0.2.2/manifest.json) |
| `styles.css` | [Download styles.css](https://github.com/omd-local/obsidian-omd-home/releases/download/0.2.2/styles.css) |

All three must come from the same version. Keep the original filenames, without `.txt` or `(1)` suffixes. **Source code (zip)** is source code, not an installable plugin. These files do not include OMD, Python, Whisper, Ollama, or the Calendar helper.

## 3. Put the files in the hidden plugin folder

1. In **Finder**, press **Command–Shift–G** to open **Go to Folder** and enter:

   ```text
   ~/Documents/OMD Demo/.obsidian/
   ```

2. Inside `.obsidian`, find or create `plugins`, then create `omd-home` inside it.
3. Put the three files directly in `omd-home`:

   ```text
   OMD Demo/
   └── .obsidian/
       └── plugins/
           └── omd-home/
               ├── main.js
               ├── manifest.json
               └── styles.css
   ```

   Leave an existing `data.json` there. Avoid an extra `omd-home/omd-home/` level or copying the whole source directory.
4. Open **Settings → Community plugins** in Obsidian. If shown, use **Turn on community plugins** after deciding you trust the plugin. Refresh the list; quit and reopen Obsidian if necessary.
5. Enable **OMD Home** under **Installed plugins**. Press **Command–P** and run **OMD Home: Open home**.

Seeing Home confirms that the plugin is enabled. Capture also needs the backend.

## 4. Install the OMD backend

Open **Terminal**:

```bash
brew --version
```

If `brew` is unavailable, use the [official Homebrew page](https://brew.sh/), complete the installer's **Next steps** including `brew shellenv`, and check again in a new Terminal. Use a standard installation on your internal disk, avoiding external or network drives and protected folders such as Documents. The formula needs source build tools. If Xcode Command Line Tools are missing, run this and finish the system installation before continuing:

```bash
xcode-select --install
```

Copy one line at a time and press Return:

```bash
brew install omd-local/omd/omd
omd --version
omd doctor
omd capabilities --json
```

The version should be **0.3.0b5**. The formula installs Python 3.12, ffmpeg/ffprobe, Tesseract, OCR language packs, and yt-dlp; no separate Python installation is needed. See the [public formula](https://github.com/omd-local/homebrew-omd/blob/main/Formula/omd.rb). Install the Whisper program and models, Ollama, cookies, and Calendar helper separately as needed.

For an older OMD installation:

```bash
brew update
brew upgrade omd-local/omd/omd
omd --version
omd capabilities --json
```

Return to **Settings → OMD Home → OMD** and press **Detect OMD** or **Check again**. b5 supplies the recognition-language, social-capture, and local Ollama interfaces used by this Mac release. Each workflow still depends on capability checks and external tools. Missing optional AI or transcription tools in `doctor` do not prevent webpage conversion.

If automatic detection fails, run:

```bash
printf '%s\n' "$(brew --prefix omd-local/omd/omd)/bin/omd"
```

Paste the complete absolute path into **Advanced OMD paths → OMD executable override**, then check again. Use your Mac's output rather than someone else's `/Users/...` path. Normally leave Python and bridge overrides blank to use the backend environment and bundled bridge.

**Copy install commands** only copies text, and **Install guide** only opens documentation. The plugin does not execute installation commands. Updating the tap obtains a public release, not unpublished experiments.

## 5. Check recognition and first-capture options

Open **Settings → OMD Home → OMD → Recognition defaults**. A new vault starts with **Image text language: English** and **Speech language: Auto-detect speech**. b5 supports these defaults; **you do not need to clear both preferences as older b4 instructions required**.

For Chinese OCR, choose simplified or traditional Chinese plus English. Speech can use automatic detection or explicit English / Chinese. OCR affects supported image-text recognition; it does not translate text or promise automatic OCR for ordinary PDFs. Capture-specific language changes affect only that item, and Retry preserves them.

For the first basic test, turn off **Polish Markdown** and **Review links and tags** in **Capture URL or file**, so conversion can be checked before installing Ollama. These are optional AI actions, rather than compatibility fixes for the new backend; enable them after AI checks pass. Submitting Capture saves the choices; cancelling does not.

## 6. Complete your first Capture

1. Click **Capture URL or file** on Home, or run **Command–P → OMD Home: Capture URL or file**.
2. Enter a simple public page needing no login, such as `https://example.com/`, or drop a small local text file or paste its full path. Submit one source at a time.
3. Keep both AI toggles off and press **Capture**.
4. **Current task** shows progress while work runs; a fast task may appear briefly. After completion, open the Markdown in **Inbox** and check its content and original source.

**The first capture is complete when you can open the note in Inbox.** Files normally go under `Sources/<source type>/` with adjacent `.omd.json` metadata. Capture writes a new note immediately. Optional link and tag proposals need **Apply** before writing; **Done reviewing** marks the item Reviewed.

Web capture needs access to its source website; local files do not. On failure, read **Needs attention**, fix the cause, and **Retry capture**. Avoid login-protected, frequently rate-limited, or long videos for the first check.

## 7. Optional: local transcription on Apple Silicon

This requires an **Apple M series chip**; MLX is not the Intel route. The base backend includes ffmpeg, but not the Whisper program or models.

```bash
brew install pipx
pipx install --python "$(brew --prefix python@3.12)/bin/python3.12" mlx-whisper
pipx ensurepath
```

Open a new Terminal as instructed, then check:

```bash
command -v mlx_whisper
omd doctor
```

Submit a **10–30 second local audio file** you have permission to use through OMD Home's **Capture URL or file**. Keep **Auto-detect speech** and both AI toggles off. Wait for the Inbox result, open the note, and check the transcript.

**Test OMD's own flow.** Its default model is `mlx-community/whisper-large-v3-turbo`; the first run needs network access to download it and enough disk space. A standalone `mlx_whisper` default example may download a different tiny model, which does not prove OMD's model is ready. Complete a successful real capture before a demo. Raw transcription needs no Ollama; AI cleanup is separate. See the [official mlx-whisper instructions](https://pypi.org/project/mlx-whisper/).

**Intel Macs:** this guide has not verified a complete Home transcription installation on Intel. Installing MLX will not provide this route. Start with webpages or documents and consult [OMD's transcription and manual installation instructions](https://github.com/omd-local/markdown-everything#quick-start) for a platform-appropriate alternative.

## 8. Optional: local AI, formatting, and semantic search

1. Install the Mac app from the [Ollama website](https://ollama.com/download), move it to **Applications**, open it, complete CLI setup, and keep it running. It currently requires macOS 14+; Apple M supports CPU/GPU use and Intel uses CPU. See the [system requirements](https://docs.ollama.com/macos).
2. Download a local text model, for example:

   ```bash
   ollama pull qwen3:4b-instruct
   ollama list
   ```

3. Under **Settings → OMD Home → AI answers**, choose **Ollama on this computer**, the downloaded model, and **Check setup**. Run **OMD Home: Refresh local AI models** if the list is stale. Download size and speed depend on your Mac; downloading a model does not verify every workflow.
4. Under **Advanced AI controls → Local writing tools → Local writing model**, choose a local text model and complete its check. It powers **Improve formatting**, **Polish Markdown**, and **Review links and tags**, without a cloud answer provider. Preview formatting on a test note before choosing **Apply**.
5. For semantic search, install a separate embedding model:

   ```bash
   ollama pull bge-m3
   ```

   Select `bge-m3` under **Advanced AI controls → Vault retrieval** and press **Test semantic search**. The explicit **Install bge-m3** button also downloads it; opening settings does not. Turn off **Keyword + semantic search** for keyword-only retrieval, which needs no embedding model. The UI labels any fallback to keywords.
6. Type `@` and a question answerable from your test notes into Home's omnibox. Check citations and open the original notes. Vault Q&A is read-only.

Keep the default endpoint `http://localhost:11434`. Manual endpoints must use a loopback host on this computer and an explicit port; **Save endpoint** before checking. A listed model may still be incompatible with a particular workflow.

Local models do not require disabling all Ollama cloud features. For local-only Ollama, follow the [official instructions](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features): preserve other settings in `~/.ollama/server.json`, add `"disable_ollama_cloud": true`, then quit and reopen Ollama. This also disables Ollama Cloud.

## 9. Optional: cloud answers

Cloud answers require a separate account or developer API access and may incur charges. Local capture, raw transcription, and local writing do not require them.

| Provider | Setup and checks |
|---|---|
| **Ollama Cloud** | Run `ollama signin`, prepare a cloud model using the [official Cloud guide](https://docs.ollama.com/cloud), then choose Ollama Cloud, Check setup, and a model under AI answers. Ollama local-only mode must be off. |
| **OpenAI API / Anthropic API** | Paste a real developer API key into the matching password field, press **Save & check** to store it in macOS Keychain, then select a listed model. ChatGPT / Claude subscriptions do not include API credit. |
| **DeepSeek API** | The verified policy in this b5 release does not enable it. Requests are rejected even if the option appears; do not use it as an available demo path. |

After enabling the selected provider's **Allow … answers**, every question still needs inspection of its destination, model, and bounded evidence excerpts before explicit approval. Cancel sends nothing, and no other provider is chosen automatically. Only the question and approved excerpts are sent; retrieval stays local. Formatting, link and tag proposals, and embeddings continue to use local Ollama.

## 10. Optional: Douyin or Xiaohongshu sources

b5 accepts a Douyin or Xiaohongshu / Rednote share message containing **exactly one HTTP(S) URL** in Capture. Paste only the URL for ordinary webpages; multiple sources per submission are unsupported. Platforms may require login or restrict access, so not every post is guaranteed to work.

If needed, export your own account session to a Netscape-format `cookies.txt`. Enter its absolute path for the matching platform under **Settings → OMD Home → OMD → Social capture access**, or **Site access** in Capture. Configure platforms separately; their files are not interchangeable. Only the path is saved, and local OMD uses the contents. Keep cookie files out of your vault, GitHub, and issue reports. Start with a short public item you can open in your own browser; video transcription still requires section 7's program and models.

## 11. Optional: Apple Calendar

Markdown events in the vault need no helper. Syncing Apple Calendar, including Google / Outlook accounts added to macOS Calendar, requires **macOS 14+, the separate EventKit helper, Calendar permission, and explicitly selected calendars**. The three standard plugin files do not include the helper.

Build it locally from the matching plugin tag. Install current Xcode Command Line Tools first (`xcode-select --install`, unless already installed), and check for **Swift 6 or newer** with `swift --version`. Then:

```bash
brew install node
mkdir -p ~/Developer
cd ~/Developer
git clone --branch 0.2.2 --depth 1 https://github.com/omd-local/obsidian-omd-home.git omd-home-0.2.2
cd omd-home-0.2.2
npm ci
npm run build:eventkit
```

Use a different new directory name if that one exists; do not overwrite it. A successful build produces `dist/omd-eventkit`. Copy it to `.obsidian/plugins/omd-home/omd-eventkit` in your actual vault, for example:

```bash
cp dist/omd-eventkit "$HOME/Documents/OMD Demo/.obsidian/plugins/omd-home/omd-eventkit"
```

Preserve executable permission. Alternatively, keep it in a stable location and enter its full absolute path under **Settings → OMD Home → Calendar → Advanced Calendar helper**; select the executable, not source code or the `dist` folder.

In Calendar settings, press **Refresh calendars** and grant access when macOS asks. Enable only calendars OMD may read and choose a writable **Default calendar**. Create a test event and check the vault and selected calendar. If both copies change, choose which to keep; avoid important calendars for the first test. After denying permission, adjust **System Settings → Privacy & Security → Calendars**.

## 12. Upgrades, backups, and demo checks

Preserve `data.json` and replace only the three files from the same plugin release. Build and replace the helper separately if updated. Upgrade the backend using section 4. Reopen Obsidian and recheck OMD plus AI / Calendar features you use. To roll back, disable the plugin and restore backed-up files and settings without deleting notes.

| Demo workflow | Completion check |
|---|---|
| Basic Capture | A simple webpage and local text file open in Inbox with correct sources |
| Transcription, if used | A real OMD capture has downloaded its selected model and a person has checked the short transcript |
| Local AI, if used | Check setup passes, answer citations open, and edits are previewed |
| Calendar, if used | The helper is executable, access is granted, only selected calendars participate, and a test event can be checked |

Finish downloads and system permission prompts before a demo. Seeing Home or doctor alone does not verify all optional features.

## Troubleshooting

| Symptom | Next step |
|---|---|
| OMD Home is absent from Installed plugins | Check filenames, current vault, and folder depth; reopen Obsidian |
| Terminal cannot find brew | Complete official Next steps / shellenv and open a new Terminal; avoid `sudo brew install` |
| OMD is missing or still reports b4 | brew update / upgrade, inspect the actual executable override, then Check again |
| Recognition preference / hardened local Ollama transport check fails | Confirm Home uses b5 and its capabilities. For temporary basic capture on old b4, clear both language preferences and disable both AI toggles; full workflows still require upgrading |
| An OCR language pack is missing | Check `tesseract --list-langs` and install the pack; b5 does not supply missing external tools by itself |
| mlx_whisper is unavailable | Check Apple Silicon, the pipx path, and doctor; reopen Obsidian and try a real short-audio capture |
| AI model or connection fails | Open Ollama, inspect `ollama list`, Refresh local AI models, then Check setup; check text and embedding models separately |
| DeepSeek is rejected | This policy does not enable it; use a verified provider or local Ollama |
| Current task disappears after completion | It shows active work only; open the result in Inbox |
| A webpage returns 403 / needs login | Try a public page, check platform setup, or capture a local copy you have permission to save |
| Calendar has no results | Check the helper executable, permission, Refresh calendars, and selected calendars |

Report plugin and OMD versions, capabilities, Mac chip, steps, and error text. Your whole vault, API keys, and cookie contents are unnecessary.

## Developers: build the pinned plugin source

Regular users need no build. To reproduce **0.2.2**, prepare Git and Node.js/npm, then:

```bash
git clone --branch 0.2.2 --depth 1 https://github.com/omd-local/obsidian-omd-home.git
cd obsidian-omd-home
npm ci
npm run build
```

The output is still the three plugin files, without installing the backend or models. Public main matches this release but will change; a fixed tag is reproducible. See the [0.2.2 manual test plan](https://github.com/omd-local/obsidian-omd-home/blob/0.2.2/docs/manual-test-plan.md) for desktop acceptance.
