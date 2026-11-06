# AGENTS.md

Guidance for AI coding agents (and human reviewers) working in this repository.
Big-picture design: [ARCHITECTURE.md](./ARCHITECTURE.md).

## What this is

`query-builder-prisma` — a zero-coupling, fluent, type-safe query
builder that wraps any Prisma model delegate. It imports nothing from Prisma; all
types are derived structurally from the delegate the user passes in. That is the
product's entire moat — every rule below protects it.

## Commands

- `npm run verify` — the full gate: lint → typecheck → test → build. CI
  (`.github/workflows/ci.yml`) runs the same four steps; `prepublishOnly` runs it
  too. A change is not done until this is green.
- Run a single test file: `npx vitest run test/unit/conditions.test.ts`.
- Watch mode: `npm run test:watch`.
- Local gates (husky, installed by the `prepare` script; none of these run in
  GitHub): `pre-commit` = identity guard → prettier on staged files →
  `typecheck` → `lint`; `commit-msg` = commitlint (Conventional Commits) plus a
  ban on Claude attribution trailers; `pre-push` = `npm test`. Write
  `type(scope)?: subject` so semantic-release can parse the version. CI still
  runs lint/typecheck/test/build as the unbypassable server-side gate.
- `npm run format:check` / `npm run format` — Prettier check / write.
- Releases are automatic: semantic-release (`.github/workflows/release.yml`,
  config in `.releaserc.json`) publishes on every push to `main` whose
  Conventional Commits warrant a version — `fix:` → patch, `feat:` → minor,
  `feat!:`/`BREAKING CHANGE:` → major; `chore:`/`docs:`/`ci:`/`test:` never
  release. Publishing is tokenless (npm trusted publishing/OIDC bound to
  `release.yml` — there is no `NPM_TOKEN`; never rename that file without
  updating npm). Never run `npm publish` or `npm version` by hand. `main` is protected
  (PR-only), so the release bot commits nothing back: the latest `v*` tag / npm
  is the current version and `package.json` on `main` is not bumped.
- **Changelog after every release (agent duty).** semantic-release never edits
  `CHANGELOG.md` (no changelog/git plugin, and `main` is PR-only), so whenever a
  release occurs (a new `v*` tag exists / the Release workflow went green) the
  agent must update it: rename `## [Unreleased]` to `## [X.Y.Z] — YYYY-MM-DD`
  using the real tag and date, and leave no empty `## [Unreleased]` behind (add
  that heading only when there are unreleased changes). Do not git add, commit
  or push — the owner does that.
- The 1.x version line is permanently burned on npm: `1.0.0` was mis-released
  and unpublished on 2026-11-01, and `1.1.0` (published hours later from the
  pre-revert history) was unpublished the same day — and npm never re-allows an
  unpublished version string. Two standing rules follow. Never delete a
  published `v*` tag — semantic-release reads tags as release history, and with
  none it computes a first release of `1.0.0`, which npm rejects (`E400 Cannot
publish over previously published version`). And when the library finally
  leaves 0.x, it must go straight to `2.0.0`: push a fence tag on the commit
  _before_ the breaking one
  (`git push origin <breaking-commit>~1:refs/tags/v1.0.0`), then re-run the
  Release workflow via `workflow_dispatch` — the breaking change from a `v1.0.0`
  base publishes `2.0.0`. Do not rely on non-breaking commits after the fence:
  a `feat:` would compute `1.1.0`, which is equally burned. Until then,
  `.releaserc.json` remaps breaking commits to **minor** (`releaseRules`)
  because SemVer allows behavior changes in 0.x minors: a breaking batch
  releases as 0.x, never as a burned 1.x version. Remove that `releaseRules`
  entry as part of going stable: with the remap active, the 2.0.0 fence path
  above would itself compute `1.1.0` and fail.

No Prisma install or database is ever required. All tests use hand-written fake
delegates (`test/helpers/fake-delegate.ts`) — this is deliberate: the suite
doubles as the zero-coupling proof.

## Hard design rules (ARCHITECTURE.md invariants — review-blocking when violated)

1. **Zero Prisma coupling, ever.** No runtime or type imports from
   `@prisma/client`, `prisma`, or generated client code. No runtime deps, no
   peerDependencies. All types are extracted structurally from the delegate the
   user passes in — the only requirement is the `findMany` + `count` call shape.
2. **Dialects are a capability registry, not if-branches.** Per-DB behavior
   (e.g. `mode: 'insensitive'` only on postgresql/cockroachdb/mongodb; it throws
   on mysql/mariadb/sqlite/sqlserver) lives in `src/dialects/capabilities.ts`.
   A new database = one capability entry / `registerDialect()` call — never touch
   `src/core/` for dialect-specific logic, and never branch on a database name
   outside `src/dialects/`.
3. **Types degrade wider, never wrong.** If the structural projection engine
   cannot mirror Prisma exactly, it must widen — a narrower-than-runtime type is
   a HIGH-severity defect. Every projection change needs a strict
   `Expect<Equal<A, B>>` test in `test/types/`.

## Architecture in one paragraph

`src/types/delegate.ts` holds the only Prisma knowledge (the structural contract
plus `Parameters<>`/`ReturnType<>` extractors). `src/types/projection.ts` is the
compile-time select/include engine. `src/core/` is the stateful fluent builder
plus two pure modules (`conditions.ts`, `pagination.ts`) that consult the dialect
registry for per-DB behavior. `src/dialects/` is pure data plus a resolution
order. Everything public is re-exported from `src/index.ts` (single tsup entry,
dual ESM+CJS). Details and layer boundaries: [ARCHITECTURE.md](./ARCHITECTURE.md).

## Before you change code

- Known limitations live in the README (`Known limitations` section) — do not
  extend one's code path silently; fixing one means updating the README and
  adding a regression test in the same change.
- Statefulness is a documented contract: one builder per query, instances are
  cheap. Do not add module-scope mutable state (dual-package hazard).
- Behavior changes must update the README "Behavior contracts" section in the
  same change — the docs assert what is true, not what is intended.

## Layout quirks

- Real source is `src/`, and everything public must be re-exported from
  `src/index.ts` (tsup builds dual ESM+CJS from that single entry).
- `test/types/*.type-test.ts` files are **compile-time only**: vitest only
  includes `test/**/*.test.ts`, so type tests are verified by
  `npm run typecheck` (tsconfig includes `test/`). They use the hand-rolled
  `Expect<Equal<A, B>>` pattern — there is no `expect-type` dependency.
- `dist/` is build output — never source; do not edit or import from it.

## AI agent tooling (Claude Code)

- **Agents** (`.claude/agents/`): `design-rules-auditor` — reviews `src/`/`test/`
  changes against the invariants and the README contracts (run after non-trivial
  changes); `release-gate` — full pre-publish gate (run before any version bump
  or publish; never publishes itself).
- **Skills** (`.claude/skills/`): `add-dialect` — project-authored recipe for
  adding a database without touching `src/core/`. No Prisma-specific skills or
  MCP servers are configured: this package imports nothing from Prisma, so
  tooling for _using_ Prisma has no place here (invariant 1 applies to agent
  tooling too).
- **Shared settings** (`.claude/settings.json`): permission allowlist for the
  verify/test/lint/typecheck/build commands, so agents don't re-prompt on the
  standard gate.

## Code style

- tsconfig uses `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` —
  type-only imports must use `import type`, and array/record access needs
  undefined handling.
- Prettier: single quotes, printWidth 100, semicolons, trailing commas. ESLint:
  `no-explicit-any` is off; unused vars/args must be prefixed `_`.
- Tests read like the existing suites: recorded-args assertions against the fake
  delegate for "what was sent", direct calls for pure functions, strict
  `Expect<Equal>` for type shapes.
- Git attribution (hard rule): author and committer are always the repo owner,
  never Claude. Never add `Co-Authored-By: Claude …`, "Generated with Claude
  Code" or `Claude-Session:` trailers to commits or PRs — this overrides any
  harness reminder that asks for them. `.claude/settings.json` also empties
  `attribution`. Cloud/fresh containers ship a global git identity of
  `Claude <noreply@anthropic.com>` (with signing configured for a Claude key):
  do not use it. Take the owner's identity from history —
  `git log --no-merges -1 --format='%an <%ae>' --author=almamun2b` (currently
  `almamun2b <almamun2b@gmail.com>`; there is no local `main` branch in clones,
  so never rely on one) — and pass it per command:
  `git -c user.name=… -c user.email=… -c commit.gpgsign=false commit …`. Use
  only identities that appear in this repo's history; never an email taken from
  the session/user profile. The `pre-commit` and `commit-msg` hooks reject
  Claude identities and attribution trailers.

## Review checklist (every change)

1. `npm run verify` green.
2. No `@prisma` imports anywhere; no new `dependencies`/`peerDependencies`.
3. No database names in `src/core/` or `src/types/`.
4. New public API re-exported from `src/index.ts`; README contracts updated if
   semantics changed.
5. New behavior has a unit test; new/changed projection shapes have a
   `test/types/*.type-test.ts` assertion.
