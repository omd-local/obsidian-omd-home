# First-install beta candidate: Home 0.2.3 / Engine 0.3.0b6

This candidate is prepared from the current public repositories. Download its
PR workflow artifacts directly from GitHub and use a separate test vault.
Release assets are not published. These draft PRs do not merge main or create
release tags; versioned Release download and BRAT links apply after publication.
The current public Home 0.2.2 / engine 0.3.0b5 releases are unchanged.

## 2026-11-28 release-closure status

Home's complete dependency audit is now zero, including the development build
chain; CI and release builds gate on that full audit and zero lint warnings.
All model setup is independent: the plugin displays/copies commands and never
calls Ollama's model-download endpoint. The English/Chinese guide and manual
test plan use **Copy install command → Terminal → Check setup**; embeddings also
require **Test semantic search**.

New engine binary uploads are blocked while either dependency or license gates
fail. The native workflow still builds and tests both architectures and uploads
review **JSON evidence**, not a passing binary, when these gates fail:

- `cobble==0.1.4` declares BSD-2-Clause but omits its original package copyright
  notice. Supplemental material and the separate vendored MIT notice do not
  resolve this upstream gap. See the engine's
  [license inventory and release blockers](https://github.com/omd-local/markdown-everything/blob/agent/public-beta-first-install/docs/third-party-licenses.md).
- The exact Apple Silicon wheel lock has no known vulnerabilities in the current
  pip-audit results. Intel's `cryptography==48.0.1` has three distinct known CVEs;
  upstream removed macOS Intel support before the complete fix. Do not downgrade
  or substitute an incompatible ARM wheel. Intel distribution remains blocked
  until a separately validated solution or explicit release-scope change.

Do not use an older successful run to bypass these gates. Historical artifacts
and previous test results do not certify this revision. Home can still be tested
with an existing compatible b5 engine, or without an engine for plugin-only
features. New-engine first-install testing resumes when a matching run passes
the gates and offers the binary artifact described below.

## Download and follow the Mac guide

Use the same [English installation guide](https://github.com/omd-local/obsidian-omd-home/blob/agent/public-beta-first-install/docs/getting-started-mac.en.md#manual-install)
or [简体中文安装指南](https://github.com/omd-local/obsidian-omd-home/blob/agent/public-beta-first-install/docs/getting-started-mac.md#manual-install)
on the test Mac. Follow sections **1 → 3 → 4–6** for basic Capture.

1. Sign in to GitHub and open [Home PR #8](https://github.com/omd-local/obsidian-omd-home/pull/8).
   Under **Checks**, open the latest successful **CI** run corresponding to the
   PR's current commit. On its run summary, download **Artifacts → omd-home-pr-candidate**.
2. Unpack the download. `omd-home/` directly contains `main.js`, `manifest.json`
   and `styles.css`; install those files using guide section 3B. Keep
   `SHA256SUMS`, `build-info.json` and this `TESTING.md` outside the plugin folder.
   The build information records the PR head, tested commit and run URL; retain
   it to identify your test. No Git, Node.js or local build is required.
3. Open [Engine PR #16](https://github.com/omd-local/markdown-everything/pull/16),
   then its successful **Build independent macOS engine** run under **Checks**.
   Download **omd-engine-unsigned-arm64** for Apple Silicon or
   **omd-engine-unsigned-x86_64** for Intel. Unpack the download, find the matching
   `OMD-Engine-<architecture>.zip` within its directories, then unpack that ZIP
   and install the app using guide section 4. Engine and plugin commits are
   independent; retain each run's link. The app ZIP is the recommended first test.

Both workflows retain artifacts for **14 days**. If missing or expired, use a
newer successful run for the same PR commit, or report the run URL and wait for
a rebuild. Downloading artifacts requires a signed-in GitHub account with read
access; see [GitHub's instructions](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts).

## Included

- Missing selected local answer/writing/embedding models show an exact, validated Ollama
  install command, a copy action, and a fresh **Check setup** path. Copying a
  command does not install, select or change the provider/model.
- macOS setup opens independent engine downloads and guidance. The app contains
  Python and basic document converters, avoiding end-user Homebrew, Xcode/CLT,
  compilation and Xcode license acceptance for the base installation.
- Home discovers system/user Applications installs and validates Python inside
  the selected app. Existing executable overrides retain their meaning.
- The base package leaves OCR/languages, media/transcription, Ollama/models,
  Calendar helper and browser UI as separate optional capabilities.
- Public b5 runtime behavior remains the base. Home 0.2.3 also supports a working
  b5 installation; installing the new app is not required just to test guidance.

iPhone capture, its SSH/URI pairing commands, experimental answer verification
and evidence benchmark prototypes are excluded from both source candidates.
This beta does not introduce phone pairing or require Remote Login.

## Acceptance

1. Back up an existing vault; preferably create a separate test vault. Keep
   candidate plugin updates pinned while testing.
2. Download the Home PR artifact and install its `main.js`, `manifest.json` and
   `styles.css` together using the Mac guide.
   Confirm Home opens without an engine and shows actionable engine setup.
3. Download and independently install the matching engine PR artifact, then **Capture and
   processing → Check again**. Test a small HTML/PDF and a simple public URL with
   AI options off. A ZIP installation needs the app's full path in Terminal.
4. With Ollama running but the selected text model absent, confirm the command
   names that model. Run it yourself, wait, then **Check setup**. Verify that
   model/provider selections did not change. Also test stopped Ollama and an
   incompatible embedding-only selection.
5. Recheck an existing custom executable path, a path with spaces, and cancel /
   reload behavior. Missing optional OCR/media tools should identify the
   affected feature rather than require installing every optional tool.

## Remaining release gates

- Native iPhone functionality is outside this candidate's scope.
- The engine artifacts are unsigned and not notarized. Developer ID signing,
  notarization, Gatekeeper, actual system Installer execution, Intel, macOS 14,
  and a fresh Mac without developer tools still need acceptance.
- Resolve the upstream Cobble copyright-notice gap before public binary distribution;
  the other supplemental materials and bundle inventory are included and validated.
- Resolve Intel's exact-lock vulnerability blocker before distributing Intel binaries.
- Minimum Obsidian 1.11.4 and real model download/narrow-settings UI checks still
  need desktop acceptance. Automated tests do not establish those results.
- Keep the complete dependency audit and independent model-installation boundary
  passing after any final source or lockfile changes. These automated checks do
  not establish Obsidian directory approval.

Record exact versions, chip/macOS/Obsidian versions, steps and errors. Remove
private paths, keys and cookies before sharing diagnostics.
