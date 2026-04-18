---
name: release
description: Cut a bnot release — compute next version, push main, and create a GitHub release that triggers the build/sign/notarize workflow.
disable-model-invocation: true
argument-hint: "[patch|minor|major|x.y.z]   # omit for patch bump"
allowed-tools: Bash(gh:*), Bash(git:*)
---

Cut a new bnot release. The user invoked `/release $ARGUMENTS`.

## How bnot releases work

The release is triggered by creating a GitHub Release (`gh release create`) with a semver tag. The `release.yml` workflow fires on `release: created`, reads the version from the tag, writes it into `apps/desktop/tauri.conf.json` and `apps/desktop/Cargo.toml` **inside the runner only** (not committed back), then builds, signs, notarizes, and uploads the universal `.app` + DMG + updater artifacts.

**Never bump version strings in the repo.** The workflow owns them.

## Steps

### 1. Pre-flight checks (fail fast)

Run these in parallel, then report any failures and stop:

- `git rev-parse --abbrev-ref HEAD` — must be `main`. If not, stop and ask.
- `git status --porcelain` — must be empty (no dirty working tree). If dirty, stop and tell the user to commit or stash first. Do NOT auto-commit.
- `git log origin/main..HEAD --oneline` — capture the unpushed commits; they're the release payload.
- `gh auth status` — must be authenticated. If not, stop.

### 2. Compute the next version

Get the latest release tag:

```
gh release list --limit 1 --json tagName,isDraft,isPrerelease
```

Strip the leading `v` to get the base version (e.g., `v0.1.16` → `0.1.16`). Then apply `$ARGUMENTS`:

- empty / `patch` → bump patch (`0.1.16` → `0.1.17`)
- `minor` → bump minor, reset patch (`0.1.16` → `0.2.0`)
- `major` → bump major, reset minor+patch (`0.1.16` → `1.0.0`)
- `x.y.z` (exact semver) → use as-is

Validate the final version against `^[0-9]+\.[0-9]+\.[0-9]+$` — the workflow rejects non-semver tags. If `$ARGUMENTS` is none of the above, stop and ask.

Check the tag doesn't already exist on remote:

```
git ls-remote --tags origin "refs/tags/v$VERSION"
```

If it returns anything, stop — the tag already exists.

### 3. Confirm with the user

State in one line: "Cutting `vX.Y.Z` from `main` at `<short-sha>` with N commits since `vPREVIOUS`." Show the commit subjects (one line each). Then ask for confirmation before pushing. In auto mode, proceed if there are no red flags; otherwise still ask.

### 4. Push main

```
git push origin main
```

Must succeed before creating the release, or the workflow would check out code without the commits being released.

### 5. Create the release (this triggers the workflow)

```
gh release create "v$VERSION" --title "v$VERSION" --generate-notes --target main
```

`--generate-notes` fills the body from PRs/commits since the previous tag. `--target main` pins the tag to the pushed HEAD.

### 6. Report back

Print the release URL from `gh release view "v$VERSION" --json url -q .url` and mention that the workflow is running — direct the user to `gh run list --workflow=release.yml --limit=1` or the Actions tab to watch it. Do NOT poll the workflow unless the user asks.

## Guardrails

- Do NOT edit `version` fields in `apps/desktop/tauri.conf.json`, `packages/sidecar/package.json`, `apps/desktop/Cargo.toml`, or `packages/bridge/Cargo.toml`. The workflow handles it.
- Do NOT `git tag` locally — `gh release create` creates the tag on the remote as part of the release.
- Do NOT `--force` push or reuse an existing tag.
- If any step fails, stop and surface the error — don't try to "fix forward" into a half-released state.
