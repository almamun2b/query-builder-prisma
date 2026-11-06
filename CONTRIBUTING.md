# Contributing

Short version: **`npm run verify` green = the bar.** It runs lint → typecheck →
test → build, the same gate CI runs on Node 22/24. A change is not done until
it is green, with **zero Prisma installed and no database running** — that is
the standing proof of the zero-coupling design, not an accident.

## Before you change code

Read [AGENTS.md](./AGENTS.md) (rules + review checklist) and
[ARCHITECTURE.md](./ARCHITECTURE.md) (layer boundaries). The short form:

1. **Zero Prisma coupling** — no runtime or type imports from `@prisma/client`,
   `prisma`, or generated code; no `dependencies`/`peerDependencies`. All types
   are extracted structurally from the delegate.
2. **Dialects are data, not branches** — per-DB behavior lives in
   `src/dialects/capabilities.ts`; database names may appear only in
   `src/dialects/`. Recipe: `.claude/skills/add-dialect/SKILL.md`.
3. **Types never lie** — projection changes must widen, never narrow below
   runtime truth, and need strict `Expect<Equal<A, B>>` assertions in
   `test/types/*.type-test.ts` (verified by `npm run typecheck`, not vitest).
4. **Limitations are documented, not hidden** — open gaps live in the README
   (`Known limitations`); do not extend one's code path, and when you fix one,
   update the README and add a regression test in the same change.

## Where things live

- `src/core/` — the stateful fluent builder + pure `conditions.ts`/`pagination.ts`.
- `src/types/` — the structural contracts and the compile-time projection engine.
- `src/dialects/` — capability registry (pure data + resolution order).
- `test/unit/` — runtime behavior against recorded fake delegates;
  `test/types/` — compile-time projection shapes. Fixtures in
  `test/helpers/fake-delegate.ts` are hand-written and Prisma-free on purpose.
- `dist/` is build output, never source — don't edit or import from it.

Docs are single-sourced: design in ARCHITECTURE.md, working rules in AGENTS.md,
behavior contracts and known limitations in the README. Behavior changes update
the README "Behavior contracts" section in the same change.

## Working with AI agents (Claude Code)

- `.claude/agents/design-rules-auditor` — run after non-trivial `src/`/`test/`
  changes; enforces the checklist above.
- `.claude/agents/release-gate` — full pre-publish gate before version bumps.
- `.claude/skills/add-dialect` — project-authored recipe for adding a database
  dialect without touching `src/core/`.
- No Prisma-specific skills or MCP servers: the package imports nothing from
  Prisma, so there is nothing for such tooling to do here.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) —
they are what semantic-release parses on `main` to pick the next version, and
the format is enforced locally by commitlint:

```text
type(scope)?: subject        e.g. fix: strip undefined where keys
feat!: / BREAKING CHANGE:    for breaking changes
```

| Type                                  | Effect on release (push to `main`) |
| ------------------------------------- | ---------------------------------- |
| `fix:`, `perf:`, `revert:`            | patch                              |
| `feat:`                               | minor                              |
| `feat!:` or `BREAKING CHANGE:` footer | major                              |
| `docs:`, `chore:`, `ci:`, `test:`, …  | no release                         |

Enforcement is local: husky hooks (installed automatically by the `prepare`
script) run Prettier, typecheck and lint on `pre-commit`, commitlint on
`commit-msg`, and the unit tests on `pre-push`. GitHub CI re-runs lint,
typecheck, test and build. A `--no-verify` bypass of the message check is not
caught in GitHub — semantic-release simply ignores a non-conventional commit.
Scope is free-form (`feat(dialects): …`); the type is what matters.

## Releases

`prepublishOnly` runs the verify gate; the `release-gate` agent additionally
checks the tarball file list, coupling sweep, scope drift, and the
known-limitations review. Semver applies to the `src/index.ts` exports plus the
README behavior contracts.

### One-time npm setup (trusted publishing, no token)

Releases authenticate to npm with **trusted publishing** (OIDC): the GitHub
Actions job proves its identity to npm, which hands back a short-lived publish
credential and attaches provenance automatically. There is no `NPM_TOKEN`
secret to create, rotate or leak (npm is retiring 2FA-bypass tokens).

1. **npmjs.com** → package `query-builder-prisma` → **Settings** →
   **Trusted Publisher** → **GitHub Actions**, then enter exactly (case-sensitive):
   - Organization or user: `almamun2b`
   - Repository: `query-builder-prisma`
   - Workflow filename: `release.yml`
   - Environment name: leave blank
   - Allowed actions: tick **Allow `npm publish`** (semantic-release runs a
     plain `npm publish`; without it npm only accepts a _staged_ publish that a
     human must approve with 2FA, so nothing would auto-release). Leave
     **Allow `npm dist-tag`** unticked — only needed for prerelease/maintenance
     channels, and `.releaserc.json` releases from `main` only.

   Save. (You must be an owner of the package and have 2FA enabled.)

2. **Prove it works**: merge a releasable commit (`fix:` / `feat:`) to `main`.
   In the Release run's log, `semantic-release` prints
   `OIDC token exchange with the npm registry succeeded`; the npm package page
   then shows a provenance badge.

3. **Lock it down** (only after step 2 succeeded): npm package → **Settings** →
   **Publishing access** → _Require two-factor authentication and disallow
   tokens_. Then revoke the old automation / bypass-2FA token under npm
   **Account → Access Tokens**, and delete the `NPM_TOKEN` secret in GitHub →
   repo **Settings → Secrets and variables → Actions**.

Requirements already met by the workflow: `permissions: id-token: write`, a
GitHub-hosted runner, Node 24 (npm >= 11.6.2), and `repository.url` in
`package.json` matching this GitHub repo.

### Troubleshooting a failed release

- `OIDC token exchange ... failed` / `ENEEDAUTH` / `E404` on publish: the
  trusted-publisher fields on npm do not match (owner, repo, or workflow file
  name). Fix them on npmjs.com and re-run the workflow from the Actions tab
  (`workflow_dispatch`).
- "Have you granted the `id-token: write` permission": the workflow
  `permissions` block lost `id-token: write`.
- Renaming `release.yml` (or moving the repo) silently breaks publishing until
  the trusted publisher is updated to the new name.
- `E400 Cannot publish over previously published version`: see the burned 1.x
  runbook in `AGENTS.md`.
