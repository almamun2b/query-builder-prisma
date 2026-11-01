# Changelog

Notable changes to `query-builder-prisma`. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is semver
over the public surface (`src/index.ts` exports) plus the README behavior
contracts.

## [Unreleased]

Versions are produced by semantic-release from the commit history; this entry
summarises the user-visible changes on the way to the next major release.

### Changed — breaking

- **`select()` and `include()` return a new, independent builder** (as does
  `custom()` when it carries a `select`/`include`). Code that ignored their
  return value (`qb.select({ … }); await qb.execute()`) must use the returned
  builder. `clone()` is new and branches a base query explicitly.
- **A page whose computed `skip` exceeds 100 000 is empty** (`take: 0`, truthful
  `meta.page`) instead of silently serving the rows at skip 100 000.
- **Refused keys throw.** `__proto__`, `constructor` and `prototype` in
  `filter()`, `where()`, `custom()`, `range()` and `sortBy()` raise
  `Refused key "…"` instead of being dropped (which widened the query).

### Fixed

- Backward cursor pages were wrong against real Prisma (they dropped the row
  nearest the cursor and reversed the page); verified against a generated
  Prisma 7 client.
- `select()` on a builder seeded with an `include` (or vice versa) no longer
  sends both keys.
- The strict cursor probe now inherits `where`, `orderBy` and `distinct` from
  every source, fetches only the cursor field and runs in parallel.
- `executeWithMeta()` / `executeWithCursor()` no longer change the builder.
- A cursor field that is missing, `null` or an Invalid Date fails with a message
  naming the field instead of producing a cursor of `"undefined"`.
- Types: relations the row type does not describe are `unknown` instead of
  being dropped, `select({ _count })` is kept, non-literal `boolean` flags make
  keys optional, `custom({ select | include })` narrows the result, and the
  `buildArgs()` passthrough infers Prisma's exact result type.

- `custom()` typing follows the runtime precedence: a held `select` beats a later
  `include`, a later call of the same kind replaces the earlier one, and an
  `undefined`/`null` projection changes nothing.
- `cursorType: 'date'` rejects a `bigint` cursor with a clear message instead of
  a raw `TypeError`.

### Changed — tooling

- TypeScript 6.0 (`~6.0.3`; TypeScript 7 waits for typescript-eslint support).
  tsup's declaration build ignores the TS 6 `baseUrl` deprecation in its own
  options only.
- Local quality gates (husky): `pre-commit` runs Prettier on staged files,
  typecheck and lint and refuses Claude identities; `commit-msg` runs commitlint
  and rejects Claude attribution trailers; `pre-push` runs the tests. New
  `format:check` script. The `commitlint` CI job was removed; the `verify` job
  and the release workflow are unchanged.
- Removed unused dev dependencies: `@types/node`, `conventional-commits-filter`,
  `conventional-commits-parser`.
- `docs/AUDIT.md` replaced with a fresh project audit (statuses, real-Prisma
  verification, open items); references to the earlier audit were removed from
  the docs, code comments and test titles.

### Added

- `clone()` returns an independent copy of a builder for branching a base query.
- `cursorPaginate({ cursorType: 'string' | 'number' | 'bigint' | 'date' })`
  converts a cursor read back from a query string (Prisma rejects a string for
  an `Int` cursor field); `cursor` also accepts `bigint`.
- Exported types: `CursorType`, `CursorValue`, `ProjectionArgs`, `BuiltArgsOf`.

## [0.2.1] — 2026-10-31

### Changed

- Fully automatic npm releases: semantic-release publishes on every push to
  `main` whose Conventional Commits warrant a version (`fix:` patch, `feat:`
  minor, `feat!:`/`BREAKING CHANGE:` major). It commits nothing back to the
  protected branch; the latest `v*` tag is the version of record.
- Commit messages are enforced as Conventional Commits with commitlint.
- The docs hub moved from `docs/index.md` to `docs/readme.md`.
- The CI Node matrix covers the current LTS lines (22 and 24); `esbuild`'s
  install script is allowed in `package.json`, and commitlint's optional peers
  are pinned so the lockfile installs under npm 10 and 11.

## [0.2.0] — 2026-10-30

### Changed

- **BREAKING:** `configureQueryBuilder()` renamed to `configQueryBuilder()` —
  clearer, and the old name only existed in yesterday's 0.1.0. Update imports:
  `import { configQueryBuilder } from 'query-builder-prisma'`.
- GitHub repository renamed to
  [`almamun2b/query-builder-prisma`](https://github.com/almamun2b/query-builder-prisma);
  `package.json` `repository`/`homepage`/`bugs` URLs and the README CI badge
  now point at the new slug. Pushes to `main` auto-publish to npm whenever
  `package.json` carries a version not yet on the registry
  (`.github/workflows/publish.yml`, version-gated, npm provenance attested).
- README restructured into a user-facing landing page (install, quick start,
  feature tour, FAQ) while keeping the normative "Behavior contracts" and
  "Known limitations" sections as the source of truth.

### Added

- Full user documentation set: docs hub (`docs/index.md`), getting-started
  guide, seven task guides (filtering, sorting, offset pagination, cursor
  pagination, projections, dialects, advanced patterns), a complete API
  reference (every `QueryBuilder` method, all exported types, all exported
  functions/constants), and ten end-to-end use cases
  (`docs/examples/use-cases.md`).

## [0.1.0] — 2026-10-29

First release as `query-builder-prisma` — the same code published the same day
as `@almamun2b/prisma-query-builder@0.1.0`, renamed before its first release
under this name. A fluent, zero-coupling query builder over Prisma's structural
`findMany` + `count` delegate call shape — search/filter/range/sort, offset and
cursor pagination, a structural compile-time projection engine (`select`/
`include` narrowing without Prisma types), and a dialect capability registry
(`mode: 'insensitive'` gating), dual ESM+CJS.

### Changed

- **Package renamed** from `@almamun2b/prisma-query-builder` to
  `query-builder-prisma` (unscoped). The `@prisma/` npm scope belongs to Prisma
  and cannot be published to by third parties; the unscoped `prisma-query-builder`
  name is already taken. The internal `globalThis` dialect-state symbol moved to
  `Symbol.for('query-builder-prisma.dialect-state')` (no published release
  depends on the old key). Install with `npm i query-builder-prisma`.

### Fixed

- **HIGH — seed `where` no longer replaceable.** `.custom({ where })`
  now AND-es with the seeded `initialArgs.where` and previous custom `where`s
  instead of silently replacing the seed (previously a soft-delete filter
  could be lost). Regression-tested in `test/unit/query-builder.test.ts`.
- **HIGH — `executeWithMeta()` rejects cursor mode.** It now throws
  a descriptive error when `.cursorPaginate()` was configured, instead of
  returning cursor rows with fabricated offset meta and a leaked over-fetch
  row. Use `executeWithCursor()` in cursor mode.
- **HIGH — nested `include` types keep base fields.** The
  projection engine types `.include({ posts: { include: { comments: true } } })`
  as `User & { posts: (Post & { comments: Comment[] })[] }` — matching runtime
  truth instead of dropping the relation's own fields; `| null | undefined`
  optionality preserved. Strict `Expect<Equal>` tests in
  `test/types/projection.type-test.ts`.

### Added

- Claude Code agent tooling: `design-rules-auditor` and `release-gate` agents,
  the project-authored `add-dialect` skill, and a shared permission allowlist.
- Repo hygiene: CONTRIBUTING.md, SECURITY.md, PR/issue templates, CODEOWNERS,
  `package.json` `bugs`/`homepage`.

### Removed

- `PLAN.md` (its surviving rules are single-sourced in ARCHITECTURE.md and
  AGENTS.md). Defect tracking moved out of the published docs; open limitations
  are documented in the README (`Known limitations`).
- Prisma-specific agent tooling: the 10 installed `prisma-*` skills and
  `.mcp.json` (Prisma docs MCP, Context7). This package imports nothing from
  Prisma, so tooling for using Prisma added noise without value.
