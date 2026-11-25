# First-install beta candidate: Home 0.2.3 / Engine 0.3.0b6

This is an unpublished candidate prepared from the current public repositories.
Versioned download and BRAT links are usable only after matching assets are
published. Until then, use the supplied local files in a separate test vault.
The current public Home 0.2.2 / engine 0.3.0b5 releases are unchanged.

## Included

- Missing selected local answer/writing models show an exact, validated Ollama
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
2. Install the candidate's `main.js`, `manifest.json` and `styles.css` together.
   Confirm Home opens without an engine and shows actionable engine setup.
3. Independently install a matching engine artifact, then **Capture and
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
- Complete the engine's third-party notices before public binary distribution.
- Minimum Obsidian 1.11.4 and real model download/narrow-settings UI checks still
  need desktop acceptance. Automated tests do not establish those results.
- The existing full development-dependency audit and embedding-model download
  policy review are separate unresolved marketplace work; this focused beta does
  not claim to complete them.

Record exact versions, chip/macOS/Obsidian versions, steps and errors. Remove
private paths, keys and cookies before sharing diagnostics.
