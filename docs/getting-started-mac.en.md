# Install on a Mac and complete your first Capture

[Back to OMD Home](../README.md) · [简体中文](getting-started-mac.md) · **English**

> **Candidate release assets are not published:** use the supplied local artifacts in a test vault. Versioned BRAT/tag downloads below become available only after publication. The current public releases remain Home 0.2.2 / OMD 0.3.0b5. Public candidate source or a draft PR does not publish installable assets. See [candidate acceptance](first-install-beta.md).

Follow **prepare a vault → install the plugin → install the OMD backend → save your first webpage**. **Only sections 1–6 are needed for your first capture.** Transcription, AI, and Apple Calendar are optional additions afterward.

This guide covers **OMD Home 0.2.3 + OMD Engine 0.3.0b6 candidate**. The plugin provides the Obsidian interface; the separate backend converts sources. Installing the plugin does not install the backend or models. OMD's separate browser UI is deferred and is not needed for Home.

| What you want to do | Where to stop |
|---|---|
| Explore Home, note search, and Markdown calendar events | Complete section 1, then install the plugin using either section 2 or 3 |
| Save webpages or files as Markdown | Continue through sections 4–6 |
| Transcribe audio, use AI, or sync Apple Calendar | After basic Capture succeeds, choose the relevant sections 7–11 |

## 1. Check your Mac and prepare a vault

1. Open the **Apple menu → About This Mac** and check the chip and macOS version. The independent document engine requires **macOS 14+** and a matching **arm64** (Apple Silicon) or **x86_64** (Intel) package. Intel and fresh-Mac candidate acceptance remain pending.
2. If Obsidian is installed, open it. Otherwise, download the Mac version from the [Obsidian website](https://obsidian.md/download), open the download, drag Obsidian into **Applications**, and launch it from there. You need desktop **1.11.4 or newer**.
3. **Existing vault:** open the vault where you want to use OMD. Plugins are installed per vault; stay in this same vault throughout the instructions.
4. **New to Obsidian:** in the vault management window, find **Create new vault → Create**, enter `OMD Demo`, use **Browse** to choose your Documents folder, then select **Create**. From an open vault, use the bottom-left vault menu → **Manage Vaults…**. See the [official vault guide](https://obsidian.md/help/manage-vaults).

A vault is an ordinary folder containing your notes. Obsidian creates its hidden `.obsidian` settings directory when you open it; **you do not need to create that hidden directory yourself**. The recommended BRAT route below avoids finding it altogether.

The instructions use the English labels shown by OMD. Open **Settings** using the bottom-left gear or **⌘,**. **⌘** means Command, **⇧** means Shift, and Return is the Enter key.

## 2. Recommended: install with BRAT, without finding folders

<a id="install-plugin"></a>

[BRAT](https://community.obsidian.md/plugins/obsidian42-brat) is a separate third-party community plugin by **TfTHacker**. It downloads and places the OMD Home files for you. **OMD Home is not yet listed in Community plugins: search for BRAT first, then use it to install OMD Home.** If you prefer no BRAT, use the [manual method in section 3](#manual-install). Choose one method.

1. In your target vault, open **Settings → Community plugins**. If shown, read the prompt and select **Turn on community plugins**.
2. Select **Browse**, search for `BRAT`, confirm the author is **TfTHacker**, select **Install**, then **Enable**.
3. Back in Settings, select **BRAT** in the left sidebar. If it is hard to find, locate BRAT in the installed Community plugins list and select its gear button.
4. Select **Add beta plugin** and paste this line into the repository address field:

   ```text
   https://github.com/omd-local/obsidian-omd-home
   ```

5. Click outside the field and wait for repository verification and the version list. Under **Select a version**, choose **0.2.3**, without a `v`. This is a public repository: **leave GitHub token blank; no GitHub account is required**.
6. Check **Enable after installing the plugin**, select **Add plugin**, and wait. If it is not enabled, return to **Community plugins → Installed plugins**, refresh the list, and turn on **OMD Home**.
7. Close Settings, press **⌘P**, type `OMD Home: Open home`, and select that command.

**Success check:** the OMD Home page opens. Go [straight to section 4](#install-backend); skip section 3. The plugin can open now, but Capture still needs the backend.

Selecting **0.2.3** pins that version; OMD Home will not update automatically. BRAT's **Latest version** selection and update checks are a different update option, so do not select Latest accidentally during this installation. BRAT does not install the backend, models, or Calendar helper. If GitHub rate-limits a request, retry later or use the manual method; creating a token is not a required first-install step. See the [BRAT author's guide](https://tfthacker.com/brat-quick-guide).

## 3. Alternative: install the plugin manually

<a id="3-put-the-files-in-the-hidden-plugin-folder"></a>

<a id="manual-install"></a>

**Already opened Home through section 2? Skip this section.** For an existing-vault upgrade, first [back up and disable the plugin as described in section 12](#12-upgrades-backups-and-demo-checks), preserving `data.json`.

### 3A. Download the three files

Open the [OMD Home 0.2.3 release](https://github.com/omd-local/obsidian-omd-home/releases/tag/0.2.3), expand **Assets** near the bottom, and select each of these files, or use the direct links below. Downloads normally appear in Finder's **Downloads** folder.

| Required file | Download |
|---|---|
| `main.js` | [Download main.js](https://github.com/omd-local/obsidian-omd-home/releases/download/0.2.3/main.js) |
| `manifest.json` | [Download manifest.json](https://github.com/omd-local/obsidian-omd-home/releases/download/0.2.3/manifest.json) |
| `styles.css` | [Download styles.css](https://github.com/omd-local/obsidian-omd-home/releases/download/0.2.3/styles.css) |

**Do not choose Source code (zip) or Source code (tar.gz).** These three individual files need no extraction or code editor. All must come from the same version and have exactly these names, without an extra `.txt` or `(1)` suffix. If your browser renames duplicate downloads, check and restore the names above.

### 3B. Open the installation location from Obsidian

1. Back in your **target vault**, open **Settings → Community plugins** and turn on community plugins if needed.
2. Find the **folder icon** beside **Installed plugins** and select it. Finder opens this vault's plugin directory. The icon is documented in [Obsidian's official help](https://help.obsidian.md/community-plugins).
3. In that directory, press **⌘⇧N** and name the new ordinary folder `omd-home`. If it already exists, open it; **do not create another omd-home inside it**.
4. Select the three downloaded files in Downloads and press **⌘C**. Open `omd-home` and press **⌘V**. The result should be:

   ```text
   <your vault>/
   └── .obsidian/
       └── plugins/
           └── omd-home/
               ├── main.js
               ├── manifest.json
               └── styles.css
   ```

   This is a location diagram: **do not create a folder literally named `<your vault>`**. Leave any existing `data.json` and `omd-eventkit` in place.
5. Back in Obsidian's Community plugins settings, select the **refresh icon** beside the installed list. If OMD Home is still absent, use **⌘Q** to quit Obsidian completely, then reopen the same vault.
6. Turn on **OMD Home**. Close Settings, press **⌘P**, and run **OMD Home: Open home**.

**Success check:** the Home page opens. Continue to [section 4](#install-backend).

<details>
<summary><strong>No folder button, no plugins directory, or .obsidian is hidden in Finder?</strong></summary>

`.obsidian` is hidden by default; it is an ordinary usable directory. First open the target vault in Obsidian, then:

1. Open the **actual vault folder** in Finder. For the example vault, this is `OMD Demo` in the Documents location you chose.
2. Press **⌘⇧.** (Command, Shift, and a period) to show hidden items, then open `.obsidian`. Press the same shortcut afterward to hide them again.
3. If `plugins` is absent, press **⌘⇧N** **inside .obsidian** to create the ordinary folder `plugins`. Open it and create the ordinary folder `omd-home`. Neither name starts with a dot.
4. If you know your vault path, Finder's **⌘⇧G** opens **Go to Folder**. Enter the existing settings directory and press Return. Copy the following line **only if you actually created the example vault at that location**:

   ```text
   ~/Documents/OMD Demo/.obsidian/
   ```

   `~` means your home directory; use the actual location for a different vault. **Go to Folder opens existing directories; it does not create them.** If `.obsidian` is absent, return to Obsidian and confirm this vault is open; do not create another `.obsidian` in Downloads or another vault.
5. Return to **step 4 of 3B** to copy the three files.

References: [Obsidian's settings directory](https://obsidian.md/help/data-storage), [Apple's Finder shortcuts](https://support.apple.com/en-sg/102650).

</details>

## 4. Install the OMD backend

<a id="install-backend"></a>

**Capture needs a separate engine.** The independent document app requires
macOS 14+ and contains its own Python. Basic installation does not require
Homebrew, Xcode, Command Line Tools or accepting an Xcode license.

### 4A. Choose the matching independent package

1. In **Apple menu → About This Mac**, check whether you have Apple Silicon
   (**arm64**) or Intel (**x86_64**).
2. Open the [official engine releases](https://github.com/omd-local/markdown-everything/releases).
   Choose the matching **0.3.0b6 OMD Engine** asset when published. A wheel,
   source archive or downloaded Homebrew dependency is not that app package.
   For the unpublished candidate, use the separately supplied test artifact.
3. Open the matching `.pkg`, or unpack the ZIP and move **OMD Engine.app** to
   **Applications** or your home folder's **Applications**. The ZIP route needs
   no administrator installation. Candidate artifacts are unsigned, not
   notarized, and have not passed fresh-Mac/Intel acceptance. Stop and report
   any Gatekeeper block; this guide does not ask you to disable system protection.

### 4B. Connect from Obsidian

Open **Settings → OMD Home → Capture and processing** and select **Detect OMD**
or **Check again**. Home discovers both Applications locations without editing
your shell PATH. Continue when the backend reports ready. This is separate
from AI answers' **Check setup** button.

If an old **Advanced OMD paths** override is set, clear it to resume automatic
discovery, or explicitly select the new app's `Contents/MacOS/omd` executable.
Existing overrides are not silently replaced.

### 4C. Verify a command only when needed

The ZIP does not create a bare `omd` command. In Terminal, use:

```bash
"/Applications/OMD Engine.app/Contents/MacOS/omd" --version
"/Applications/OMD Engine.app/Contents/MacOS/omd" capabilities --json
```

For a user-folder install, replace `/Applications` with `$HOME/Applications`
inside the quotes. Expect **0.3.0b6** and protocol **1** in this candidate.
The installer also creates `/usr/local/bin/omd` and `omd-mcp`; it refuses to
overwrite a different Homebrew/user command. Use the ZIP if a command conflicts.

<details>
<summary><strong>Existing Homebrew installations and earlier developer-tool errors</strong></summary>

The previously public **0.3.0b5** Homebrew backend remains compatible with Home
0.2.3. Existing users may retain it; there is no need to reinstall a working
backend solely to test the model guidance. Homebrew upgrades remain separate:

```bash
brew update
brew upgrade omd-local/omd/omd
omd --version
```

Do not assume this installs b6 before its formula is published. If an earlier
install stopped with **Xcode alone is not sufficient on Tahoe**, a downloaded
bottle does not mean OMD was installed. Use the independent app route to avoid
that prerequisite. If intentionally diagnosing Homebrew, include macOS/CLT
versions and the full error; `install requested` is not proof a tools update
finished. Do not repeatedly accept licenses or reinstall tools without diagnosis.

</details>

## 5. Check recognition and first-capture options

Keep the language defaults for the first English-webpage test. For Chinese image OCR, open **Settings → OMD Home → Capture and processing**, expand **Recognition defaults**, and set **Image text language** to simplified or traditional Chinese plus English. **Speech language** defaults to **Auto-detect speech**; explicit English / Chinese are also available.

OCR affects supported image recognition, not translation or automatic OCR for ordinary or scanned PDFs. Changing a language in Capture affects only that item; Retry preserves it. b5 needs none of the older b4 preference-clearing workarounds.

## 6. Complete your first Capture

<a id="first-capture"></a>

1. Close Settings. Press **⌘P**, find and run **OMD Home: Capture URL or file**, or select that button on Home.
2. Paste `https://example.com/` into **URL, share text, or file path**. Start without login-protected pages or long videos.
3. Turn off **Polish Markdown** and **Review links and tags**, leaving other optional fields blank. Ollama is not needed for this test.
4. Select **Capture** to start processing. **Current task** appears only during active work; a fast task may appear briefly.
5. When it finishes, open **Inbox** on Home, open the new Markdown note, and check its text and source link.

**Success check: you can open and read the generated note in Inbox. Basic installation is complete here; everything below is optional.**

For a local file, drag **one small HTML or PDF file** from Finder onto **Drop a local file here** inside the Capture dialog. Confirm its path is filled in, then select **Capture**. No typed file path or separate Choose file button is needed. Submit one source at a time.

Notes normally go under `Sources/<source type>/` with adjacent `.omd.json` metadata. `<source type>` is a generated category, not a placeholder directory to create. Capture writes the new note immediately; optional link/tag proposals require **Apply**, and **Done reviewing** marks the item Reviewed. Submitting saves that capture's toggle choices; cancelling does not. On failure, read **Needs attention**, fix the cause, and select **Retry capture**.

## 7. Optional: local transcription on Apple Silicon

**Complete basic Capture first.** This route needs an Apple M series chip; MLX is not the Intel route. The independent engine does not include ffmpeg, Whisper or its model. This optional route uses [Homebrew](https://brew.sh/); install it separately and follow its own requirements only if you want transcription. Skip this section for document capture.

Run this whole block in Terminal, waiting for each line to finish:

```bash
brew install python@3.12 pipx ffmpeg
pipx install --python "$(brew --prefix python@3.12)/bin/python3.12" mlx-whisper
pipx ensurepath
```

As prompted, **close this Terminal window and open a new one**, then run:

```bash
command -v mlx_whisper
```

It should print the program path. Then use **⌘Q** to quit and reopen Obsidian; no Whisper executable path needs to be entered. Video URL capture additionally needs `yt-dlp` (`brew install yt-dlp`); it is unnecessary for the local-audio test below. See the official [pipx installation guide](https://pipx.pypa.io/latest/how-to/install-pipx.html) and [Homebrew Python formula](https://formulae.brew.sh/formula/python@3.12).

Drop a **10–30 second local audio file** you have permission to use onto **Drop a local file here** in Capture. Keep **Auto-detect speech** and both AI toggles off, then select **Capture**. The default model is `mlx-community/whisper-large-v3-turbo`; its first use requires a network download, disk space, and waiting time. **Success means an Inbox note contains a transcript you can check**, not merely that Terminal printed a program path.

Complete one real OMD capture before a demo; other standalone Whisper examples may download another model. Raw transcription does not need Ollama. See the [official mlx-whisper instructions](https://pypi.org/project/mlx-whisper/). Intel users should check the [backend's other installation routes](https://github.com/omd-local/markdown-everything#quick-start); this guide has not verified a complete Intel transcription setup.

## 8. Optional: local AI, formatting, and semantic search

1. Download the Mac app from the [Ollama website](https://ollama.com/download), open the download, drag Ollama into **Applications**, and launch it from Applications to finish first-run setup. If asked to install the CLI, complete that prompt and keep Ollama running. See [Ollama's Mac requirements](https://docs.ollama.com/macos).
2. In a **new Terminal window**, download a local text model:

   ```bash
   ollama pull qwen3:4b-instruct
   ollama list
   ```

   Wait for completion and the model name in the list. If Terminal cannot find `ollama`, finish the app's initial CLI setup, then reopen Terminal; do not change OMD's Python path.
3. Under **Settings → OMD Home → AI answers**, set **Answer provider** to **Ollama on this computer**. Select **Check setup** to load models, choose the downloaded answer model, and **Check setup** again. If the list is stale, run **OMD Home: Refresh local AI models**.
4. For formatting or link/tag proposals, expand **Advanced AI controls → Local writing tools** and choose a text model under **Local writing model**. Then **return to Check setup under AI answers above**; the writing-model row has no separate check button. These writing tools use local Ollama only.

   If the selected answer or writing model is missing, use **Copy install command** beside its setup message. Run that exact command in Terminal, wait for the download to finish, then **Check setup** again. The plugin refreshes the model list while retaining your selected model and provider; copying the command does not install it.
5. For semantic search, download a separate embedding model:

   ```bash
   ollama pull bge-m3
   ```

   Under **Advanced AI controls → Vault retrieval**, enable **Keyword + semantic search**, select `bge-m3`, and select **Test semantic search**. **Install bge-m3** also downloads it after an explicit click; opening settings does not. For keyword-only search, leave the switch off; no embedding model is needed.
6. Close Settings and type `@` plus a question answerable from your test notes in Home's omnibox. **Success means an answer has citations that open the original notes.** Vault Q&A is read-only. Preview formatting on a test note before Apply; enable Capture's AI toggles only after the relevant checks pass.

Keep the endpoint `http://localhost:11434`; no Ollama executable path is needed. Custom endpoints require loopback on this Mac and an explicit port; select **Save endpoint** when changing one. A downloaded model may not fit every workflow, so follow each check's result.

Local models do not require disabling all Ollama cloud features. If desired, use the [official local-only instructions](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features); that setting also disables Ollama Cloud and is not a required installation step here.

## 9. Optional: cloud answers

Cloud answers need a separate account or developer API access and may incur charges. Local capture, raw transcription, and local writing do not require them.

| Provider | What to do |
|---|---|
| **Ollama Cloud** | Follow the [official Cloud guide](https://docs.ollama.com/cloud) for `ollama signin` and a cloud model. Select Ollama Cloud under AI answers, Check setup, and a model. Ollama local-only mode must be off. |
| **OpenAI API / Anthropic API** | Select the provider under AI answers, paste a real developer API key into **Developer key**, and select **Save & check** to store it in macOS Keychain and check access; then select a model. ChatGPT / Claude subscriptions do not include API credit. |
| **DeepSeek API** | The verified b5 policy does not enable it. Requests are rejected even if the option appears; it is not an available installation route. |

After enabling the selected provider's **Allow … answers**, inspect each question's destination, model, and bounded evidence excerpts before explicitly approving it. Cancel sends nothing; no other provider is chosen automatically. Only the question and approved excerpts are sent, and retrieval stays local. Writing, link/tag proposals, and embeddings still use local Ollama.

## 10. Optional: Douyin or Xiaohongshu sources

b5 accepts a Douyin or Xiaohongshu / Rednote share message with **exactly one HTTP(S) URL**. Paste only the URL for ordinary webpages. Platforms may require login or restrict conversion; not every post is guaranteed to work. Video transcription still needs section 7's program and model.

If a session is needed, export your own account's Netscape-format `cookies.txt`. Find the actual file in Finder, right-click it, hold **Option**, and select **Copy … as Pathname**. Paste that absolute path into settings without quotes. See [Apple's pathname instructions](https://support.apple.com/en-mn/guide/terminal/apd3cf6fe02-3ec8-48f1-951f-866e52955fc8/mac).

Under **Settings → OMD Home → Capture and processing → Social capture access**, paste the path into the matching platform's field; **Site access** in Capture is another entry. Configure each platform separately; the files are not interchangeable. Only the path is saved, and local OMD uses matching cookies for approved source-platform HTTPS requests, never AI providers. Keep cookie files out of your vault, GitHub, and issue reports. Start with a short item you can open in your own browser.

## 11. Optional: Apple Calendar

**This is an advanced optional setup. Basic Capture and Markdown events in your vault do not need it.** Apple Calendar sync, including Google / Outlook accounts already added to macOS Calendar, needs **macOS 14+, a separate EventKit helper, Calendar permission, and explicitly selected calendars**. Neither BRAT nor the three standard plugin files include the helper.

### 11A. Build the helper

Build on this Mac from the matching plugin source. This optional helper needs Xcode Command Line Tools, which the basic engine installation does not need. If absent, request them with `xcode-select --install`, wait for the system installation to finish, then check in Terminal:

```bash
swift --version
```

You need **Swift 6 or newer**; update the developer tools first if older. The helper script uses Swift directly: **no Node.js installation or npm ci is needed for it**.

The block below uses the **0.2.3 tag after publication**. While testing this candidate before that tag exists, replace `--branch 0.2.3` with `--branch agent/public-beta-first-install`; use source matching your candidate plugin. Paste the whole block into Terminal and press Return. It stops if any step fails and refuses to overwrite an existing source directory. If `~/Developer/omd-home-0.2.3` already exists, change the directory name both at the end of clone and in cd to the same new name, then retry.

```bash
(
set -e
mkdir -p ~/Developer
cd ~/Developer
git clone --branch 0.2.3 --depth 1 https://github.com/omd-local/obsidian-omd-home.git omd-home-0.2.3
cd omd-home-0.2.3
sh scripts/build-eventkit.sh
open dist
)
```

On success, Terminal prints the helper's version and Finder opens `dist` containing the **omd-eventkit** executable. Do not double-click it.

### 11B. Copy with Finder, without typing a hidden path

1. Select **omd-eventkit** in `dist` and press **⌘C**.
2. In Obsidian, open **Settings → Community plugins**, select the folder icon, then open **omd-home** in Finder.
3. Press **⌘V** to copy the helper beside `main.js`, `manifest.json`, and `styles.css`, preserving executable permission. For a helper update, disable OMD Home before replacement and enable it afterward.
4. Return to **Settings → OMD Home → Calendar**, select **Refresh calendars**, and grant access when macOS asks.
5. Enable only calendars OMD may access and choose a writable test calendar as **Default calendar**.
6. Close Settings, press **⌘P**, and run **OMD Home: Create event**. Enter a test title, Start and End; set **Destination** to **Vault + your test calendar name**, then select **Save**.
7. Check the event in OMD Home Calendar and the system Calendar app, and open its vault note. Creating an ordinary event only in the system Calendar does not automatically create a vault note.

**Success check:** selected calendars and the test event load and can be checked. If both copies change, choose which to keep. After denying access, adjust **System Settings → Privacy & Security → Calendars**.

To keep the helper elsewhere, copy the actual executable's pathname into **Calendar → Advanced Calendar helper → Helper override**. Do not select source code or the `dist` directory. Moving its source folder afterward requires updating the override.

## 12. Upgrades, backups, and demo checks

Before upgrading, back up the whole vault, stop captures, and disable OMD Home in Community plugins. Keep a separate copy of `.obsidian/plugins/omd-home/`, especially `data.json` (settings), your notes, and any installed helper.

- **BRAT installation:** section 2 pins 0.2.3, so later versions will not replace it automatically. When ready to upgrade, change the plugin's version selection in BRAT's plugin list and update to your chosen version; switching to Latest version is unnecessary.
- **Manual installation:** download the target release's three files and replace only `main.js`, `manifest.json`, and `styles.css`. Preserve `data.json` and `omd-eventkit`; do not delete the entire plugin folder to update it.
- **Backend:** independently obtain a matching newer app package, stop engine tasks, and replace the app; the plugin does not update it. Existing Homebrew users retain section 4's separate upgrade path.
- **Calendar helper:** if updated, build and replace it from the matching tag using section 11.

Enable the plugin again, reopen Obsidian, and recheck OMD and the AI / Calendar features you use. To roll back, disable it and restore backed-up files/settings without deleting notes. Do not overwrite your vault with a demo vault's settings.

| Demo workflow | Completion check |
|---|---|
| Basic Capture | A simple webpage and one local HTML/PDF open in Inbox with correct sources |
| Transcription, if used | A real OMD capture has downloaded its model and a person has checked the short transcript |
| Local AI, if used | Check setup passes, citations open, and edits are previewed |
| Calendar, if used | The helper is executable, permission is granted, selected calendars participate, and a test event can be checked |

## Troubleshooting

| Where you are stuck | Next step |
|---|---|
| OMD Home is absent from the community directory | It is not yet listed. Follow section 2: find BRAT first, then add the OMD Home repository; or install manually with section 3. |
| BRAT has no version list or GitHub rate-limits a request | Check the repository address, click outside it, and wait; retry later or install manually. A public repository needs no token. |
| Finder hides .obsidian or Go to Folder cannot find the path | Start with Obsidian's plugin-folder icon, then section 3's disclosed fallback. Confirm the actual vault location. |
| OMD Home is absent from Installed plugins | Check the same vault, exact filenames, and one omd-home directory level; refresh, or ⌘Q and reopen. |
| Terminal cannot find omd | A ZIP app install creates no bare command. Use section 4's app executable path, then Check again in Home. |
| OMD is missing or outdated | Use section 4's diagnostics, update, then Check again under Capture and processing; AI's check button is separate. |
| An OCR language pack is missing | Check tesseract --list-langs and install the pack; clearing preferences does not install missing dependencies. |
| mlx_whisper is unavailable | Check Apple Silicon, pipx, and the program path; reopen Obsidian and try a short-audio capture. |
| Terminal cannot find ollama | Open the app, finish CLI setup, and open a new Terminal; leave OMD/Python overrides alone. |
| AI setup fails | Keep Ollama running and check the model finished downloading; use Check setup under AI answers and check text/embedding models separately. |
| Current task disappears after completion | It shows active work only; open the result in Inbox. |
| A webpage rejects access or requires login | Try a public page needing no login, or capture a local copy you may save; use section 10 for platform-specific setup. |
| Calendar has no results | Check the helper's folder or executable override, system permission, then Refresh calendars and select calendars. |

Report plugin and OMD versions, Mac chip, the failed step, and error text; include diagnostics if needed after removing personal paths. Do not attach your whole vault, API keys, or cookie contents.

## Developers: build the pinned plugin source

Regular users need no plugin build. Developers with Git and Node.js/npm can reproduce **0.2.3 after its tag is published**. Before then, use `--branch agent/public-beta-first-install` instead, and record the checked-out commit for candidate testing:

```bash
git clone --branch 0.2.3 --depth 1 https://github.com/omd-local/obsidian-omd-home.git
cd obsidian-omd-home
npm ci
npm run build
```

The output is still the three plugin files, without backend or models. Pushing a candidate branch or opening a draft PR does not update main, create a tag, or publish installable assets. A branch can change; retain the exact commit when reproducing a candidate. See the [manual test plan](manual-test-plan.md) for desktop acceptance.
