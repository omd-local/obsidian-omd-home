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
- [ ] Home, Inbox, Markdown events, capture entry points, tags, drag/push layout, resizing, light/dark themes, narrow windows, and keyboard focus work.
- [ ] macOS Calendar lists only explicitly selected calendars; Google and Outlook are accessed only through accounts already added to Apple Calendar.
- [ ] A simultaneous Markdown/Apple Calendar edit shows a conflict and never silently chooses a side.
- [ ] Capability failure, unsupported schema, stopped Ollama, missing model, timeout, cancellation, malformed output, and output overflow are actionable and write nothing.
- [ ] English and Chinese/Unicode notes, long paths, and exact evidence remain readable without leaking unnecessary absolute paths.
- [ ] Reload/unload during idle, generation, review, and Calendar access leaves no orphan child process or stale proposal.

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
- [ ] README, license, third-party notices, security policy, privacy boundaries, desktop-only scope, and optional local prerequisites are current.
- [ ] The locally verified asset hashes match the published release assets.
- [ ] The Community Plugins submission/reviewer feedback is complete before claiming Marketplace availability.
