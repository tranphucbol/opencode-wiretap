# Releasing

Two packages release together: `opencode-wiretap` and
`opencode-wiretap-viewer`. Never edit committed manifest versions; the tag is
the version source.

## Before Tagging

```bash
bun run check && bun run build && bun run smoke
git status --short
```

Require a clean worktree and an npm `NPM_TOKEN` repository secret with
read/write access to both packages.

## Release

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

The tag workflow stamps all manifests, checks, builds, smoke-tests under Bun
and Node, publishes both packages with provenance, and creates the GitHub
Release. Stable versions publish as `latest`; prereleases such as
`vX.Y.Z-rc.1` publish as `next`.

## Dry Run

Use **Actions → Release → Run workflow** with a version without `v` and
`dry-run` enabled. It verifies everything but does not publish or create a
GitHub Release.

## Failure

Inspect the failed GitHub Actions run. If a pushed tag failed before publishing,
commit the fix and release a new patch version; do not delete or retag a pushed
version. npm versions are immutable.
