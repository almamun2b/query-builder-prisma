# Project audit — 2026-11-01

Scope: the whole repository at `v0.2.0` — `src/` (1,221 lines), `test/` (1,063 lines, 88 unit tests, 16 type
assertions), build/lint/release configuration, CI, hooks and docs. Method: full read of every source and config file,
plus tooling checks (`npm ci` on npm 10 and 11, `npm audit`, TypeScript 6 compile). Status of every finding is **open**
unless the "Applied" section says otherwise.

Items marked **UNVERIFIED** rest on an assumption about real Prisma behaviour that this repository cannot test
(it never installs Prisma). Verify them against a real client in a throwaway directory — never inside this repo
(invariant 1) — before fixing.

Severity follows the project's own rules: a type narrower than runtime truth is HIGH (ARCHITECTURE.md invariant 3).

## Summary

| Area               | HIGH | MED | LOW | Notes                                                                    |
| ------------------ | ---- | --- | --- | ------------------------------------------------------------------------ |
| Correctness (BUG)  | 3    | 5   | 3   | cursor pagination and projection precedence carry most of the risk       |
| Type engine (TYPE) | 2    | 3   | 2   | `_count` in `select`; relation keys absent from the row type             |
| Performance (PERF) | –    | 2   | 2   | strict cursor probe is serial and over-fetches                           |
| API / design (API) | –    | –   | 11  | missing `omit`/`distinct`/`clone`, no allow-lists                        |
| Tests (TEST)       | –    | –   | –   | the fake delegate ignores `where`/`orderBy`, so tests assert shapes only |
| Tooling (TOOL)     | –    | 2   | 5   | no local gates (fixed), dev-dependency advisories                        |
| Deploy             | –    | –   | –   | sound; observations only                                                 |

The README claim that no known limitation "produces a silently wrong result" is contradicted by BUG-01, BUG-02,
BUG-05 and BUG-06 and must be revisited when those are fixed.

## 1. Correctness

**BUG-01 · HIGH · `src/core/query-builder.ts` `select()`/`include()` (≈L283–307, `assertCursorFieldProjected` ≈L558).**
`.select()` and `.include()` only reset `selectArg`/`includeArg`. A `select`/`include` that arrived through
`initialArgs` or `.custom()` lives in `customArgs`, which `buildArgs()` spreads first. `.select(X)` on a builder
seeded with `include` therefore sends both `select` and `include`, which Prisma rejects. The README precedence rule
only covers `select` vs `custom({ select })`.
_Fix:_ normalise seeded/custom `select` and `include` into `selectArg`/`includeArg` at ingestion (this also removes the
`customArgs.select` fallback in `assertCursorFieldProjected`).

**BUG-02 · HIGH · `src/core/pagination.ts` `serializeCursorValue`.**
Cursors are produced with `String(value)` and typed `string | null`. With an `Int`/`BigInt` cursor field (the most common
case) `nextCursor` is `'42'`, and passing it back yields `cursor: { id: '42' }`, which Prisma rejects for an `Int` field.
Only string ids and Dates are tested.
_Fix:_ a `cursorType`/parser option (`'number' | 'bigint' | 'date' | fn`) or expose the raw edge value next to the string.

**BUG-03 · HIGH · UNVERIFIED · `src/core/pagination.ts` `buildCursorPage`.**
Backward paging reverses the page and slices the over-fetch row from the end, assuming Prisma returns negative-`take`
rows in reversed order. The fake delegate encodes the same assumption, so the tests prove only self-consistency. If
Prisma re-reverses negative-`take` results into `orderBy` order, backward pages are double-reversed and the wrong row is
dropped. The Prisma pagination documentation does not state the ordering either way.
_Fix:_ run a real client against SQLite in a scratch directory, then correct the slice/reverse and make the fake match.

**BUG-04 · MED · `executeWithCursor` strict probe (≈L493–505).**
The probe copies only `orderByArg`; the main query's `orderBy` can also come from `customArgs` (`initialArgs`/`custom`),
and `distinct` is ignored. The probe then runs in a different order, so the "exact" flags can be wrong. Related:
`custom({ cursor, skip })` survives into the args when `cursorPaginate()` has no cursor.
_Fix:_ build the probe from `buildArgs()` and override `take`/`cursor`/`skip`.

**BUG-05 · MED · `toOffsetArgs` / `executeWithMeta`.**
`skip` is capped at `MAX_SKIP`, but `meta.page` reports the requested page: `page: 1e9, limit: 1000` returns the rows of
page 101 labelled page 1e9. Only `strictNumbers` makes this loud.
_Fix:_ return an empty page, or report the effective page, when the cap applies.

**BUG-06 · MED · `serializeCursorValue` / `buildCursorPage`.**
A missing or null cursor field becomes the string `"undefined"`/`"null"` (typo in `cursorField`, nullable column,
`custom({ omit })` — only `select` is guarded). An Invalid Date throws a bare `RangeError`.
_Fix:_ throw a descriptive error, or return `null` cursors.

**BUG-07 · MED · `src/core/conditions.ts` dangerous-key handling.**
`__proto__`/`constructor`/`prototype` keys are silently dropped, which _widens_ the query (fail-open): a refused filter
key returns more rows than asked for. Only assignment of `__proto__` is actually dangerous; the computed-key literals
used elsewhere already define own properties. The same silent no-op applies to `search({ fields: [] })` and dot-paths
made only of empty segments.
_Fix:_ throw on refused keys, or write with `Object.defineProperty` and allow the harmless names.

**BUG-08 · MED · `select()` / `include()` return `this` cast to a new type.**
`const a = base.select({ id: true }); const b = base.select({ email: true });` makes `a` and `b` the same object;
`a.execute()` is typed `{ id }[]` but returns `{ email }` rows. The README says "one builder per query", yet the type
system accepts this.
_Fix:_ return a clone, or add and document `clone()`.

**BUG-09 · LOW · state mutation by execute methods.**
`executeWithMeta` calls `paginate()` when no limit is set; `executeWithCursor` calls `cursorPaginate({})`, permanently
switching the builder into cursor mode (a later `executeWithMeta` throws). `.paginate({ limit: 25 }).executeWithCursor()`
silently uses the default limit 10.
_Fix:_ use local defaults without mutating.

**BUG-10 · LOW · number edge cases.** `clampLimit(Infinity)` returns 10 while `clampPage(Infinity)` returns 1; strict mode
accepts fractional page/limit and then floors them; a `null` or `''` cursor counts as "supplied".

**BUG-11 · LOW · smaller issues.**

- `first()` deletes a user's `custom({ skip, cursor })` and copies the args twice.
- `range()` passes `null`, `''` and `NaN` bounds through.
- `deepStripUndefined` skips arrays nested in arrays and overflows the stack on cyclic input.
- `count()` ignores `distinct`, so `executeWithMeta` totals can over-count.
- `resolveDialect` does not catch a throwing detector although the docs say it must never throw.
- `custom({ where })` called N times nests N levels deep.
- `initialArgs` bypasses `deepStripUndefined` and the dangerous-key filter that `custom()` applies.
- `buildArgs()` returns internal objects by reference (sole condition, `customWhere`, caller's `select`/`include`/`orderBy`).

## 2. Type engine

**TYPE-01 · HIGH · `src/types/projection.ts` `ApplySelect`.**
Keys are `TruthyKeys<S> & keyof Row`. `select: { _count: { select: … } }` is valid Prisma, but `_count` is not on the
row, so it is dropped — narrower than runtime. Only `ApplyInclude` special-cases `_count`; there is no select-side test.
_Fix:_ mirror the include handling (`Record<string, number>`) and add a type test.

**TYPE-02 · HIGH · UNVERIFIED · `ApplySelect` / `ApplyInclude`.**
Keys absent from the row type are dropped. All type tests use a hand-written row that already contains its relations.
A real Prisma delegate's `findMany` is generic (`findMany<T extends …>(args?: SelectSubset<T, …>)`); `Awaited<ReturnType<…>>`
instantiates it at its constraint, which very likely yields the scalar-only default row. Then `.include({ posts: true })`
and `.select({ posts: true })` lose `posts` — narrower than runtime.
_Fix:_ add a Prisma-shaped fake to `test/types` (generic method, `SelectSubset`, relations absent from the row), then
widen keys that are not on the row (`unknown`) instead of dropping them.

**TYPE-03 · MED · `custom()` / `initialArgs`.**
`select`/`include`/`omit`/`distinct` supplied this way are invisible to `TArgs`. `custom({ select })` is typed as the
full row but returns a narrowed one (too wide); `custom({ include })` returns relations the type omits (too narrow).
The earlier claim that this is "wider = safe" is wrong for `include`.
_Fix:_ widen the result type once `custom()`/`initialArgs` carry a projection, or route them through `select()`/`include()`.

**TYPE-04 · MED · `MetaOf`.** `includeTotal: flag` with `flag: boolean` resolves to `PaginationMeta` (`total: number`)
while the runtime may return `null`. _Fix:_ distribute over `true | false | undefined`; add a type test.

**TYPE-05 · MED · non-literal select flags.** A select typed `{ [k]?: boolean }` makes every key required in the result.
_Fix:_ when `boolean extends S[K]`, make the key optional.

**TYPE-06 · LOW · `ProjectNested`** distributes over `X | null`; the `null` branch passes through `ApplySelect<never, …>` and
can produce a spurious `{ k: never }` member. `ApplySelect` also drops optional/readonly modifiers.

**TYPE-07 · LOW · public types.**

- `QueryBuilderOptions.dialect` is `Dialect`, which rejects names added with `registerDialect` (tests cast around it).
- `search({ fields })` accepts relation and non-string keys; `range` keys are unchecked.
- `paginate`/`sortBy`/`cursorPaginate` params lack `| undefined`, which breaks `exactOptionalPropertyTypes` users who forward optionals.
- There are no negative (`@ts-expect-error`) type tests anywhere.

## 3. Performance

- **PERF-01 · MED** — the strict probe runs after the main query; both can run in parallel with `Promise.all`.
- **PERF-02 · MED** — the probe fetches a full row; `select: { [cursorField]: true }` is enough.
- **PERF-03 · LOW** — `findMany.bind(...)` plus its cast is repeated at four call sites; `executeWithMeta` computes
  `assertSkipCap`, `toOffsetArgs` and the `where` twice.
- **PERF-04 · LOW** — `buildCursorPage` copies the page to reverse it; reversing the fresh slice in place is enough.
- **PERF-05 · opportunity** — an opt-in mode could derive `total` from a short first page and skip the `COUNT` query.

## 4. API and design gaps

- No `omit()`, `distinct()`, `clone()`, `or()`/`not()` or conditional `whereIf()`; `custom()` is the only route and it breaks typing (TYPE-03).
- `filter()` and `where()` are near-duplicates (both shallow-strip).
- Dot paths produce `{ posts: { createdAt } }` for to-many relations, where Prisma needs `some`/`every`/`none`; `search` has no dot-path support.
- No allow-list: `sortBy`, `cursorField` and `range` accept arbitrary strings, so `sortBy: 'passwordHash'` is accepted.
- No `buildCountArgs()`, so a `$transaction([findMany, count])` batch cannot be assembled from the builder.
- `sortBy` defaults to `desc`, the opposite of Prisma/SQL.
- Plain `.execute()` after `.cursorPaginate()` returns the raw over-fetch row.
- `DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE`, `MAX_SKIP` and `clampLimit` are not exported; the test helper `resetDialectConfig` and the no-op `detectDialect` are.
- `DIALECT_CAPABILITIES` and its entries are mutable; the flag `caseInsensitiveCollation` is declared but never read.
- An unknown dialect name silently becomes `universal`; `NoResultError` carries no context.
- The `globalThis` dialect store is unversioned (two package versions sharing the symbol could corrupt each other) and is a documented exception to "no module-scope mutable state".

## 5. Test coverage

- The fake delegate's `findMany`/`count` ignore `where`, `orderBy` and `select`; `meta.total` always equals `rows.length`. Tests assert argument shapes, not behaviour.
- Untested in `query-builder.test.ts`: `first()` (empty, cursor, select), `firstOrThrow` success, standalone `include()`,
  non-`where` `initialArgs`, multi-field and `fields: []` search, `range` with only `to`/both/Date bounds, backward and
  Date/numeric cursor flows end to end, cursor-mode limit clamping, strict forward without a cursor (no probe), a page
  beyond the total, explicit `includeTotal: true`, `NaN`/`Infinity`/fractional strict-mode input, skip exactly at `MAX_SKIP`.
- Untested pure functions: `clampPage`, `clampLimit(Infinity)`, `buildPaginationMeta` with `total: 0`, `buildCursorPage` with empty rows.
- `dialects.test.ts`: `detectDialect`, a throwing detector, `configQueryBuilder({ dialect: undefined })`; `registerDialect`
  entries leak across tests in a file because `resetDialectConfig` keeps the registry.
- Type tests: no negatives; nothing for select `_count`, nullable relations under `select`, non-literal flags, `MetaOf` with
  `boolean`, the return types of `first`/`firstOrThrow`/`executeWithCursor`/`count`, or a Prisma-shaped delegate. The
  `Expect`/`Equal` helpers are duplicated in both type-test files.

## 6. Tooling and hygiene

**TOOL-01 · MED — no local gates (applied).** There was only a `commit-msg` hook; Prettier was never checked anywhere
(`format` was `--write`), and lint/typecheck ran only in CI.

**TOOL-02 · LOW — unused dev dependencies (applied).** `@types/node` was needed only by `tsconfig` `types: ["node"]`
(no Node API is used in `src/`, `test/` or the configs); `conventional-commits-filter`/`-parser` were lockfile-resolution
pins, not direct dependencies; `allowScripts` is not a field npm 10 reads. All four were removed; `npm ci` succeeds on npm
10.9 and npm 11, and `verify` is green. `@semantic-release/*` plugins are bundled with `semantic-release` and correctly absent.

**TOOL-03 · LOW — TypeScript pinned to 5.9.3 (applied).** Now `~6.0.3`. TypeScript 7.0.2 is npm `latest`, but
typescript-eslint 8.72.1 peers `typescript <6.1.0`, so 7 would break `npm run lint`; revisit when that range widens.
tsup's DTS step injects the deprecated `baseUrl`, which TS 6 rejects (TS5101); `ignoreDeprecations: "6.0"` is scoped to
the tsup `dts` options only.

**TOOL-04 · MED — dev-dependency advisories (open).** `npm audit` reports 53 findings (2 critical, 2 high), all in the
development tree: `vitest` 2.x (direct), `vite`, `tinypool`, `undici` and transitive moderates. Production is clean
(`npm audit --omit=dev`: 0, and the package has no runtime or peer dependencies). _Fix:_ move to a current `vitest`
major (it requires Vite ≥ 6.4 and `@types/node` ≥ 22) in its own `chore(deps)` change, with the full verify as the gate.

**TOOL-05 · LOW — drift (applied).** `eslint.config.js` ignored a non-existent `builder/**`; Node-matrix text said 18/20/24
while CI runs 22/24; the AGENTS.md fallback `git log … main` fails because clones have no local `main`.

**TOOL-06 · LOW — CI hardening (open).** `ci.yml` has no `permissions: contents: read` block and no npm cache; actions are
pinned by tag rather than commit SHA; there is no `prettier --check` in CI (it runs only in the local hook).

**TOOL-07 · LOW — commitlint is local-only (decision).** The `commitlint` CI job was removed on request. A `--no-verify`
commit with a non-conventional message is no longer rejected on GitHub; semantic-release simply ignores such a commit.

## 7. Deploy pipeline (reviewed, not changed)

`release.yml` is sound: least-privilege permissions (`contents: write`, `id-token: write`), non-cancelling `concurrency`,
repository guard, `fetch-depth: 0`, npm provenance, deterministic per commit range, and `prepublishOnly` re-runs
lint → typecheck → test → build before publishing. Observations only:

- It runs in parallel with CI on every push to `main`; the only gate on the published bits is `prepublishOnly`.
- `CHANGELOG.md` is hand-maintained (no changelog plugin) and `package.json` stays at `0.2.0` on `main` by design.
- **Constraint for any change:** `package.json`/`package-lock.json` edits must keep `npm ci` working on Node 24 / npm 11,
  or the release job fails. Verify with `npx npm@11 ci` in a scratch copy.

## 8. Applied in this round

Commits on `improvement-code`, all typed so that semantic-release does not publish:

| Change                                                                                                         | Finding          |
| -------------------------------------------------------------------------------------------------------------- | ---------------- |
| TypeScript `~6.0.3`; unused dev dependencies and `allowScripts` removed; tsup DTS deprecation scoped           | TOOL-02, TOOL-03 |
| husky `pre-commit` (identity guard, Prettier on staged files, typecheck, lint), `commit-msg`, `pre-push` hooks | TOOL-01          |
| `format:check` script and `.prettierignore`; one-off repository format                                         | TOOL-01          |
| `commitlint` CI job removed; `release.yml` untouched                                                           | TOOL-07          |
| Claude git-identity / attribution rule added to `CLAUDE.md` and `AGENTS.md`, enforced by the hooks             | TOOL-05          |
| Earlier audit tags and the old register removed from docs, code comments and test titles                       | —                |

## 9. Remediation roadmap

Each step ships as its own change with a regression test and, where behaviour changes, a README "Behavior contracts" /
"Known limitations" update (AGENTS.md rule). `fix:` commits release patch versions; `feat:` minor.

1. **Verify against real Prisma** (scratch directory, never the repo): BUG-03 negative-`take` ordering and TYPE-02
   generic-`findMany` row type. Record the outcome here.
2. **Truth in types** (HIGH): TYPE-01, TYPE-02 (with a Prisma-shaped fake delegate), TYPE-03, TYPE-04, TYPE-05.
3. **Correctness** (HIGH → MED): BUG-01, BUG-02, BUG-03, then BUG-04, BUG-05, BUG-06, BUG-07, BUG-08, BUG-09.
4. **Performance** together with BUG-04: PERF-01, PERF-02, PERF-03; PERF-05 as an opt-in `feat:`.
5. **Test hardening**: a behavioural fake delegate that honours `where`/`orderBy`/`select`, the gaps in section 5,
   shared `Expect`/`Equal` helpers, negative type tests.
6. **API additions** (`feat:`): `omit()`, `distinct()`, `clone()`, `whereIf()`, allow-lists, `buildCountArgs()`, exported limits.
7. **Dependencies and CI**: TOOL-04 (`vitest` major), TOOL-06 (permissions, cache, SHA-pinned actions, `format:check`),
   TypeScript 7 once typescript-eslint supports it.
