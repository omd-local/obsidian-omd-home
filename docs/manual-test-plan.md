# OMD Home v0.1 Test Plan

Use a disposable vault. Install the current build with `npm run install:test-vault`, enable
OMD Home, and configure the OMD executable, loopback Ollama endpoint/model, and optional
EventKit helper. Keep Obsidian's developer console open for unexpected errors.

## Home and omnibox

### Install-00: clean install and community release sanity

1. Close Obsidian.
2. Remove any existing local install copies you want to force-clean:
   - `<vault>/.obsidian/plugins/omd-home` for each tested vault.
   - Optional manual cleanup only if you know a custom global plugin test vault path, remove that same plugin folder directly.
3. Download release assets from GitHub (`main.js`, `manifest.json`, `styles.css`) or checkout the
   branch commit you want to test.
4. Copy only those three files into the target vault plugin folder.
5. Launch Obsidian, open **Settings > Community plugins**, and disable then re-enable OMD Home once
   before first open.
6. Run **OMD Home: Open home** and confirm:
   - no startup crash
   - no missing plugin warning in Needs attention
   - Home and command palette actions are available
7. Run these minimum checks (no helper dependencies needed):
   - AI-01
   - HOME-01
   - HOME-02
   - AI-02 step 1 and step 2 (connection/unreachability)
8. Install optional helpers if used:
   - OMD executable
   - Python bridge auto-discover path (or explicit override)
   - EventKit helper (macOS only)
   - Ollama + local models
9. Run AI-03, AI-04, and AI-07 using the installed dependencies.
10. Remove local plugin folder again and repeat steps 4–9 to validate clean-reinstall behavior.

Expected: clean install and clean reinstall both produce identical behavior; all failures are surfaced in
Needs attention and can be retried; no data or layout file is required in a location outside the target vault.

### HOME-01: default layout and note alignment

1. Reset the widget layout from the Home header.
2. Confirm Today and Inbox share one two-column row, Current task and Needs attention share
   the next, Recent notes and Upcoming share a two-column row, and Pinned, Vault tags, and System
   share the final three-column row. Confirm there is no default Continue card.
3. Open Recent notes with short, long, English, and Chinese filenames.
4. Right-click a Markdown note, choose **Pin to OMD Home**, and confirm it appears under Pinned.
5. Narrow the Home workspace while leaving Obsidian's sidebar open.

Expected: adjacent cards align; every title and path begins at the same left edge; no row is
centered or indented by its text length. Pinned is available now as an explicit user-curated list;
OMD Inbox remains the separate review queue for new captures. The cards stack before the right
column can be clipped, even when the overall app window is wider than the Home content area.

### HOME-02: move and resize discovery

1. Hover a widget, drag its grip onto an occupied area, and release it.
2. Drag the visible lower-right resize corner, then use arrow keys while that corner is focused.
3. Choose **Use standard size** from the widget menu.

Expected: the active card has an explicit moving/resizing outline; displaced cards move out of
the way; no cards overlap; standard size restores that card's default width and height.

### AI-01: model discovery and refresh

1. Open OMD Home settings with Ollama selected.
2. Use **Refresh models** to load locally installed models.
3. Compare each workflow dropdown with `ollama list`. Confirm every downloaded model appears,
   including models labelled as not text-capable or thinking-only.
4. Resize the Settings pane narrower and wider. Confirm the model name/description on the left
   keeps the same type size while the controls reflow.
5. Change one workflow model selection, then use **Refresh models** again.

Expected: the dropdown lists locally installed models from Ollama; the UI never invents a model;
incompatible downloaded models remain visible with a warning instead of disappearing; and a stale
or missing stored value remains visible as stale until you choose a replacement. The Local AI
section stays in place instead of repainting the full settings page, and completion shows the
installed-model count plus a timestamp.

### AI-02: Check local daemon health

1. Open Ollama, set the endpoint to `http://localhost:11434`, and press **Check connection**.
2. Quit Ollama completely and press **Check connection** again. Expected: **Daemon unreachable**,
   not a model or Cloud error. Reopen Ollama before continuing.
3. Set the endpoint to `http://localhost:9999` and press **Check connection**. Expected: OMD Home
   rejects the non-default port immediately because Phase 1a accepts only port 11434. Restore
   `http://localhost:11434` afterward.
4. In Terminal, run `curl -s http://localhost:11434/api/status`. Record the value of
   `cloud.disabled`.
5. To test Cloud-available mode, fully quit Ollama from its menu; closing its window is not enough.
   Alternatively run `osascript -e 'quit app "Ollama"'`. Before changing or reopening anything,
   run `curl -sS --max-time 2 http://localhost:11434/api/status`; it must fail to connect, proving
   the old background server has stopped.
   If `~/.ollama/server.json` exists, back it up with
   `cp ~/.ollama/server.json ~/.ollama/server.json.local-only-backup`. Edit the original file,
   preserve unrelated JSON keys, and remove the `disable_ollama_cloud` property. If that was its
   only property, the temporary test file can contain `{}`. Then run
   `launchctl unsetenv OLLAMA_NO_CLOUD`. Confirm `launchctl getenv OLLAMA_NO_CLOUD` prints nothing.
   Reopen Ollama and run `curl -sS http://localhost:11434/api/status; echo`. Expected:
   `cloud.disabled` is `false`. A previous `source: "both"` result means the running Ollama process
   still had both the environment setting and `server.json`; repeat this step after fully quitting.
6. Press **Check connection**. Expected: the message explains that Cloud availability does not mean
   the selected model is currently online, but content remains blocked because local-only operation
   has not been proven. The message appears once, not once per workflow.
7. To restore local-only mode, fully quit Ollama and confirm the same two-second `curl` check fails.
   Restore the backup with
   `cp ~/.ollama/server.json.local-only-backup ~/.ollama/server.json`, or add
   `"disable_ollama_cloud": true` while preserving valid JSON and other keys. Reopen Ollama, confirm
   `/api/status` reports `disabled: true`, then press **Check connection** again. One explicit
   local-only source is sufficient; using both the JSON setting and environment variable is optional.

Expected: the final check reports daemon version, installed-model count, selected-model readiness,
and a timestamp. It accepts only `http://localhost:11434` or `http://127.0.0.1:11434` and remains
fail-closed until Ollama explicitly reports local-only mode.

### AI-03: per-workflow smoke tests

Prerequisite: complete AI-02 with `cloud.disabled: true`. While Cloud availability is still enabled,
all three Smoke buttons are expected to stop at the same privacy gate without sending content.

1. In **Settings > OMD Home > Local AI**, find **Vault Q&A model** and press the **Smoke**
   button on that same row. Do not type `@` in Home for this step: `@` starts the real
   content-bearing vault workflow covered by AI-04.
2. Press **Smoke** on the **Enrichment model** row.
3. Press **Smoke** on the **Capture polish model** row.

Expected: each Smoke uses the currently selected local model, sends no vault note content,
distinguishes missing/incompatible models from daemon failures, reports latency, can be cancelled,
and never writes to the vault. Each result remains visible in Local AI activity with a timestamp.

### AI-04: owned omnibox result surface

1. In OMD Home settings, leave **Python executable** and **OMD Home bridge** blank. If an older
   install retained a bridge override, press **Use bundled**; clear the Python override to exercise
   interpreter discovery. Confirm the bridge description says OMD Home is using its bundled bridge
   automatically.
   The Python interpreter is derived from the configured OMD executable when its override is blank.
2. With the two bouldering fixture notes under `Sources/Web`, ask
   `@how many beginner tips for bouldering, could you summarise and list them all`.
3. Confirm the evidence chips contain the two bouldering notes, do not contain the survival-analysis
   or transfer-learning notes, and the answer lists the 10 numbered tips while identifying the
   separate three-mistakes note.
4. Press **Copy result**, paste into a temporary Markdown note, and confirm the answer is followed by
   a deduplicated `Sources:` list containing Obsidian `[[path]]` links for both evidence notes. Confirm
   the button briefly changes to **Copied** and can also be triggered with the keyboard.
5. Confirm the result header shows an end-to-end duration such as **Returned in 4.2s**. It should
   measure from submitting the question until the complete answer appears, including vault retrieval.
6. Scroll the answer, switch between light/dark themes, then press the result panel's close button.

Expected: the result has its own bordered background and bounded scroll area; lower widgets
reflow while it is open; no text overlaps Inbox or another widget; closing it restores the grid.
Copying includes the complete answer and source links without modifying the vault automatically.
The bundled bridge works without a manually entered bridge or Python path, even though the
test-vault installer does not copy an external `.py` file. A missing bundled source still fails with
an actionable custom-override message. The query's common instruction words do not outrank topical
terms; duplicate captures do not consume multiple evidence slots; and numbered headings remain
available to the model instead of being replaced by a title-only excerpt.

### AI-05: stale configured model

1. Select a local model for one workflow.
2. Remove that model from Ollama, then return to settings and press **Refresh models**.
3. Try **Check connection** and then the related Smoke action.

Expected: the stale selection is shown as missing, the plugin does not silently switch models,
Check reports the missing model explicitly, and Smoke is blocked before any content send.

### AI-06: cloud-enabled gate

1. Start Ollama with cloud features enabled.
2. Try **Check connection**, then try a vault question, enrichment generate, and capture polish.
3. Disable Ollama Cloud, restart Ollama, and repeat.

Expected: all content-bearing local AI stays blocked until its live gate can prove `cloud.disabled = true`;
after disabling cloud and restarting, the same actions can proceed without changing providers.

### AI-07: cancellation, backgrounding, and settings invalidation

1. Start a cold per-workflow Smoke, switch away from Settings, and close only the OMD Home tab.
2. Reopen Settings and confirm the same task is still running or has completed.
3. Start another Smoke and press **Cancel** in Local AI status.
4. Start **Check connection** and change the selected model or endpoint before it finishes.
5. Start one more Smoke, then disable or reload OMD Home from Community plugins.

Expected: switching tabs and closing only the view do not cancel plugin-owned work; Cancel and
plugin unload do cancel it; a host/model change invalidates the old request, and no result from
the old tuple is displayed as ready or sent downstream.

### AI-08: no-model, incompatible, and custom-model recovery

1. Run **Check connection** against a cloud-disabled Ollama daemon with no models installed.
2. Install or select an embedding-only model and repeat Check and Smoke.
3. Choose **Custom…**, enter an installed completion-capable model ID, and repeat.
4. Enter a nonexistent custom model ID and repeat.
5. If `qwen3:4b` is installed, select it and repeat. Then select `qwen3:4b-instruct` and repeat.

Expected: no-model, non-text, ready custom, and missing custom states remain distinct; the plugin
never auto-pulls, auto-selects, or silently falls back to a different model. The known `qwen3:4b`
thinking-only alias is marked incompatible for bounded text work and recommends
`qwen3:4b-instruct`; the instruct tag can pass when it is installed and local.

### AI-09: preserved hosted provider with local enrichment/capture

1. Save `openai`, `anthropic`, or `deepseek` as the provider in plugin data, then reopen Obsidian.
2. Confirm Vault Q&A is blocked with a clear Phase 1a message.
3. Use **Refresh models** and **Check connection** in Settings without changing the saved provider.
4. Run enrichment Generate and capture-polish Smoke.

Expected: the hosted provider stays preserved and disabled for Vault Q&A only; Local AI status,
model discovery, enrichment, and capture-polish checks still work against loopback Ollama; nothing
is silently rewritten to Ollama until the user explicitly chooses it.

### AI-10: section-aware Vault Q&A retrieval

Prerequisite: point OMD Home at an OMD build that includes `build_answer_context`, keep the two
bouldering fixture notes under `Sources/Web`, and complete AI-02 with local-only Ollama ready.

1. **B01 count:** ask `@How many explicit numbered beginner tips are present? List each once.` three
   times. Every run must report 10 and include headings 1 through 10 once. It must not report 0 or mix
   the separate three-mistakes outline into a 13-item list.
2. **B01 roles / B2 duplicate:** ask `@Which note contains explicit beginner tips, and which note
   contains three mistakes?`. Confirm `bouldering-tipps-for-beginners.md` is the explicit 10-tip note
   and `3 Simple Bouldering Tips for Beginner to Intermediate Climbers.md` is the three-mistakes note.
   B2 in the benchmark repeats this same question; record one result rather than treating it as new
   coverage.
3. **B3 mistakes:** ask `@What are the three beginner mistakes, and what should the climber do
   instead?`. Confirm all three appear in order with evidence-grounded corrections: vary project
   difficulty/length, deliberately watch and remember beta, and work the flash/moves/links/reassess
   checklist. `Long arms` must not replace Mistake #1.
4. **B4 beta recall:** ask `@Which note discusses beta recall, and what does it recommend?`. Confirm
   only the three-mistakes source is used and the answer includes `Put your phone down and watch`,
   treating each problem as a puzzle, and breaking it into sections. Every inline wiki link must be
   the exact path; reject split or corrupted paths such as `Middlere` or `B-ouldering`.
5. **B5 combined advice:** ask `@Combine actionable advice from both bouldering notes, separate
   explicit tips from lessons inferred from mistakes, and remove duplicates.` Confirm the explicit
   category preserves all 10 numbered outline items separately and the inferred category contains
   one corrective lesson for each of the three mistakes. Related outline headings may not be merged
   or omitted, and shop/footer navigation must not become advice.
6. **B6 overlap:** ask `@Across the two bouldering notes, which recommendations overlap? Cite each
   claim.` A reported overlap must pair semantically aligned actions from both notes and cite both on
   that claim. Valid candidates include deliberate warm-up, learning by observing/asking experienced
   climbers, and mentally reading/planning a problem. A one-source action such as `try from the bottom`
   is not an overlap. If the selected 4B model cannot verify pairs, OMD Home must show the conservative
   `sparse evidence ... could not verify a reliable overlap` result with both source links, not claim
   that the notes have zero overlap.
7. **B7 abstention:** ask `@What shoe size should a beginner buy according to these bouldering notes?`.
   Confirm the answer says the evidence does not specify a size and does not turn general gear advice
   into a number.
8. **B08 mixed language:** ask `@summarise 这两篇 bouldering notes 里的 beginner mistakes and tips`
   three times. Confirm both sources appear, all 10 explicit headings remain separate, all three
   mistakes keep their role, and summaries do not invent details for a heading.
9. **D01 sparse control:** turn **Hybrid retrieval** off, then ask
   `@这些抱石笔记给初学者哪些建议？`. Sparse retrieval is expected to return no matching English
   evidence. It must fail closed rather than inject an unrelated outline. Restore the setting before
   AI-11.
10. Across B01, B3, B5, B6, and B08, compare three consecutive runs. Record source paths, item counts,
    unsupported claims, input/output tokens, and elapsed time. No answer may expose `[S#]`/`[E#]`
    placeholders; exact Obsidian wiki paths must be restored.

Expected: Vault Q&A recalls at most 24 lexical section candidates, selects at most eight bounded
evidence blocks, expands nested heading matches to their surrounding section, uses complete outlines
for exhaustive questions, pairs each multi-source outline with a source-local item digest, and uses one
compact overview per source only for comparisons. It rejects weak distractors, footer navigation, and
comparison operator words, preserves exact source paths, and fails closed when a small local model
cannot establish a reliable cross-source comparison. Ordinary Vault Search remains note-based.
Cross-language semantic recall and optional semantic evidence reranking are covered by AI-11.
Implicit follow-up source memory remains deferred.

### AI-11: hybrid multilingual retrieval and optional semantic reranking

Prerequisite: use an OMD build with `SemanticRecallConfig`, keep Ollama in verified local-only mode,
and keep the two bouldering fixtures plus the survival-analysis and transfer-learning distractors in
the vault.

1. In Terminal, run `ollama pull bge-m3`. In **Settings > OMD Home > Local AI**, press
   **Refresh models**, enable **Hybrid retrieval**, choose `bge-m3` under **Embedding model**, leave
   **Semantic rerank** off, and press **Test embeddings**.
2. Confirm the test reports two vectors with one shared non-zero dimension count. It must not send
   vault text, auto-pull a model, accept a remote model, or pass when vector dimensions differ.
3. Ask `@这些抱石笔记给初学者哪些建议？` three times. The first run may be slower while note
   representations are embedded; record all three end-to-end durations. Confirm the loading copy
   explains the first-use delay. Changing a Local AI setting while the request runs, or unloading
   the plugin, must stop the bridge instead of leaving an orphan Python process.
4. Confirm every result header says **Hybrid · bge-m3**, both bouldering fixture paths appear, and
   the survival-analysis and transfer-learning distractors do not appear. The answer must distinguish
   the 10 explicit tips from the separate three-mistakes note and must not invent Chinese source text.
5. Enable **Semantic rerank**, repeat D01 and B4, then compare sources and claims with reranking off.
   The setting may change evidence order but may not introduce a weak distractor, remove the exact
   beta-recall evidence, or change an abstention into an unsupported answer.
6. Turn **Hybrid retrieval** off and repeat D01. Confirm the header says **Sparse**, no embedding
   request is made, and the query fails closed as in AI-10. Turn Hybrid retrieval back on afterward.
7. Optional fallback exercise: with the generation model still installed, temporarily make the saved
   embedding model unavailable, then ask D01. Confirm the result says **Sparse** and shows an explicit
   semantic-recall fallback warning. Restore `bge-m3` and press **Test embeddings** again.
8. Edit one fixture note, ask D01 again, then restore the edit. Confirm changed content is re-embedded;
   unchanged notes reuse their cached vectors. Refresh Ollama with a different digest for the same
   model name (or cover this with the automated revision test) and confirm the old vectors are not
   reused. Neither the note nor its frontmatter gains vector data.

Expected: OMD fuses BM25-style sparse note ranking with multilingual embedding ranking, recalls no
more than 24 candidate notes and selects no more than eight evidence blocks, while keeping source paths deterministic. Embedding
traffic stays on the configured default loopback Ollama endpoint. The derived-vector cache is outside
the vault, bounded, and namespaced by Ollama model digest when available; query embeddings are not
persisted. Missing, unreachable, malformed, or
dimension-mismatched embeddings degrade to sparse retrieval with a visible warning. Semantic reranking
uses the selected embedding model only and is optional; it is not a separately installed cross-encoder.

### CMD-01: Obsidian and community commands

1. Select **Commands**, type part of a core command, and run it.
2. Enable a community plugin that registers a harmless command and repeat.
3. Enable Obsidian's recorder and reload OMD Home.

Expected: both registered commands are discoverable. A registered recorder toggle appears as
Recording; separate recorder commands appear as Start recording and Stop recording. Each action
invokes Obsidian's existing recorder rather than a second OMD Home recorder.

4. Search for and run **OMD Home: Refresh local AI models**, **OMD Home: Check local AI
   connection**, and **OMD Home: Refresh macOS calendars**.

Expected: maintenance actions can be launched from the omnibox or Command palette without opening
Settings first, and their results still appear in the relevant status surface.

## Calendar

### CAL-00: installed EventKit helper and calendar discovery

1. Rebuild with `npm run build:eventkit`, `npm run build`, and `npm run install:test-vault`.
2. Open OMD Home settings and leave the EventKit helper override blank.
3. Confirm the description shows the resolved helper beside the installed plugin, ending in
   `.obsidian/plugins/omd-home/omd-eventkit`.
4. Press **Refresh calendars**. If macOS asks for Calendar access, allow it. If it does not ask and
   refresh fails, open **System Settings > Privacy & Security > Calendars** and allow Obsidian.
5. Confirm the calendars already visible in the macOS Calendar app are listed. Google and Outlook
   calendars appear only after those accounts have been added to macOS Calendar.
6. Enter an invalid custom helper path and confirm Settings immediately reports that it is missing
   or not executable. Refresh, confirm the specific helper error, then press **Clear override** and
   refresh again.

Expected: blank means use the executable helper installed automatically; a missing or non-executable
file is never labeled installed. Success reports a calendar count and timestamp; permission,
missing-helper, and genuinely empty-calendar states have different guidance.

### CAL-01: readable boundaries

1. Create a timed event and edit Start/End with the native local date/time controls.
2. Turn on All day for a one-hour same-day event, save it, and reopen it.

Expected: inputs are readable local values; End remains after Start; the all-day End is the
exclusive next calendar date.

### CAL-02: source filters

1. Prepare one Vault-only, one Calendar-only, and one Linked event in the same visible range.
2. Move Calendar to a non-default month or switch to week view.
3. Toggle Vault, Calendar, and Linked independently.

Expected: each button has a clear pressed state and filters immediately without changing the
current month/view. The final enabled source cannot be turned off.

## Capture and enrichment

### CAP-01: local paths and drag/drop

1. Capture a small local file using its ordinary absolute path.
2. Capture `~/Desktop/example.pdf` after replacing it with a real file in your home directory.
3. Capture `/Users/example/data\ science/survival\ analysis.pdf` after replacing it with a real
   test path that contains spaces.
4. Drag a file onto the Home omnibox and then onto the capture dialog.
5. Turn capture polish off, set the Ollama host to an invalid Phase 1a value such as
   `http://localhost:9999`, and capture a small local file again.

Expected: all valid sources reach OMD; `~/` expands to the local home directory;
backslash-escaped spaces become ordinary spaces; no shell is invoked; a missing path produces a
specific, actionable failure; and a non-AI capture still works when capture polish is off even if
the saved Ollama host is invalid.

### CAP-02: local AI links and tags

1. Enable **Suggest links and tags after capture**, capture a document, and wait for the proposal.
2. Review existing/new tag suggestions, leave one unchecked, and Apply.
3. Reopen Capture and confirm the toggle remembered its last value.

Expected: generation is local and review-first; no note changes before Apply; only selected links
and tags are written.

### CAP-03: failure ownership and setup health

1. Submit a nonexistent path.
2. Point the OMD executable setting at a nonexistent or pre-enrich-note build and run the check.
3. Trigger an Ollama-side local AI failure from Home.

Expected: Current task returns to idle; Needs attention shows one timestamped failure with safe
source/detail/retry; missing and old executables are distinguished and visible without opening
the active-task panel; and local AI setup failures appear there without duplicating the same
error in multiple panels.

### CAP-06: background continuation and lifecycle cancellation

1. Start a deliberately slow capture and confirm Current task shows active work.
2. Switch to another Obsidian tab for at least 30 seconds, then close only the OMD Home tab.
3. Reopen OMD Home from the ribbon.

Expected: the capture continues through both tab changes and the reopened Home shows its current
state or completed note. Backgrounding means hiding/closing the view, not disabling the plugin.

4. Start another slow capture, then disable or reload OMD Home from Community plugins.
5. Repeat once and quit Obsidian while the capture is active.

Expected: plugin unload/quit cancels its child process; reopening Obsidian shows no orphan task,
stale active state, or partial success claim. Use Cancel only when testing explicit user
cancellation.

## Release

### REL-01: clean-vault install and bundle acceptance

1. Start from a clean disposable vault with no prior OMD Home files in `.obsidian/plugins/`.
2. Run `npm run build`, copy the released `manifest.json`, `main.js`, and `styles.css` into a
   fresh `omd-home` plugin directory, then enable the plugin from Community plugins.
3. Disable and re-enable the plugin once, then fully quit and reopen Obsidian.
4. Open Settings and confirm the plugin name, description, version, and settings screen render
   without missing assets or console errors.

Expected: the release bundle installs without manual patching; Obsidian can enable, disable, and
reload it cleanly; the Home view and Settings open after a cold restart; and the shipped manifest,
bundle, and stylesheet are sufficient for a Marketplace-style installation.
