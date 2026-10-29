# Consolidated Audit — `@almamun2b/prisma-query-builder` v0.1.0

- **Date:** 2026-10-29 (merged from two independent audits: `AUDIT.md` A-series + `audit-2026-10-29.md` B/G-series)
- **Updated:** 2026-10-29 (same day) — the three P0/HIGH findings (F1, F2, F3) are fixed with the regression tests this register asks for. **Second pass, same day:** every remaining P1/P2 code finding is fixed (F4–F18, G1–G3, G5–G8); F19 stays documented by decision; G4/G12 stay as documented guidance; only P3 release engineering remains open. **Internal register:** lives in `docs/` and is deliberately not referenced from any other doc; the user-facing subset of open limitations is mirrored in the README `Known limitations` section.
- **Scope:** all of `src/`, `test/`, packaging, config, CI, docs; framework compatibility (Next.js / Express / Node / NestJS / edge).
- **Method:** static review of every source file (ground truth from disk), runtime probes against built `dist/` (ESM + CJS), TypeScript consumer fixtures (`nodenext`, `exactOptionalPropertyTypes`), targeted type probes. Findings marked `[probe]` were confirmed by a runnable experiment; findings from the second audit were **re-verified here** where noted.
- **Baseline:** `npm run verify` green (lint, typecheck, 84/84 tests after the 2026-10-29 fixes, dual build).

**Verdict:** architecture is sound and the zero-coupling rule holds (structural types, dialect registry, dual build all correct). The review found **3 high-severity bugs** — cursor/offset meta conflict with a leaked over-fetch row, a soft-delete seed that can be silently replaced (data leak), and a projection type that lies for nested `include` — plus several medium footguns. **All HIGH findings and all P1/P2 code findings are fixed as of 2026-10-29** (see the rows for fix + regression tests). Open: F19 (stays documented by decision), G4/G12 (documented guidance), and the P3 release-engineering gates. Nothing blocks development.

## Severity summary

| ID | Sev | Area | Finding (source) |
|----|-----|------|------------------|
| F1 | HIGH | pagination | `executeWithMeta()` × `cursorPaginate()`: fabricated meta **and** over-fetched row leaked to caller (A1 + B1) `[probe]` — **FIXED 2026-10-29** |
| F2 | HIGH | API | `.custom({ where })` silently **replaces** seeded `initialArgs.where` → soft-delete filters lost (B2) `[probe]` — **FIXED 2026-10-29** |
| F3 | HIGH | types | nested `include` drops the relation's base fields from the type — narrower than runtime truth (B3) — **FIXED 2026-10-29** |
| F4 | MED | pagination | Date `cursorField` coerced with `String()` → locale/TZ-dependent, non-round-trippable cursors (B4) | — **FIXED 2026-10-29**
| F5 | MED | pagination | `.select()` without `cursorField` yields literal `"undefined"` cursor (B5) | — **FIXED 2026-10-29**
| F6 | MED | API | `sortBy()` does not expand dot paths → invalid `orderBy` for relation fields (B6) `[probe]` | — **FIXED 2026-10-29**
| F7 | MED | framework | global dialect config lives in module scope → dual ESM/CJS instance hazard (A12) | — **FIXED 2026-10-29**
| F8 | MED | framework | builder is stateful; sharing one instance across concurrent requests races (A13) | — **FIXED 2026-10-29**
| F9 | MED | types | `_count` include present at runtime, missing from projected type (A2 + B§3) `[probe]` | — **FIXED 2026-10-29**
| F10 | MED | pagination | cursor `hasNext/hasPrev` flags are optimistic approximations; empty-page edge wrong too (A5 + G9) | — **FIXED 2026-10-29**
| F11 | MED | API | silent override precedence: explicit methods always beat `custom()` args; `where` is the undocumented exception (A3/A4) `[probe]` | — **FIXED 2026-10-29**
| F12 | LOW-UX | pagination | limit clamped silently (`5000→1000`, `0→1`) (A6) `[probe]` | — **FIXED 2026-10-29**
| F13 | LOW | search | all `OR` arms share one `match` object reference (A7) `[probe]` | — **FIXED 2026-10-29**
| F14 | LOW | types | `.search()` accepts relation keys → Prisma runtime error (A8) | — **FIXED 2026-10-29**
| F15 | LOW | conditions | `undefined` stripped top-level only; `custom()` never strips (A9 + G10) | — **FIXED 2026-10-29**
| F16 | LOW | security | `__proto__`-keyed input sets a local prototype (contained; hardening recommended) (A10) | — **FIXED 2026-10-29**
| F17 | LOW | types | `FindResultOf` duplicates `RowElementOf` extraction (Promise-only) (A11) | — **FIXED 2026-10-29**
| F18 | LOW | perf | offset `skip` unbounded: `page: 1e9 × limit 1000` → `skip ≈ 1e12` hits the DB (B§4) | — **FIXED 2026-10-29**
| F19 | MED | pagination | plain `.execute()` after `.cursorPaginate()` returns raw seek-order rows including the one-row over-fetch (untrimmed — `buildCursorPage` only runs in `executeWithCursor`); surfaced by the 2026-10-29 review, documented in README `Known limitations` — **Decision 2026-10-29: stays documented** (raw-passthrough semantics kept by choice) |

Old-ID map: A1→F1, A2→F9, A3/A4→F11, A5→F10, A6→F12, A7→F13, A8→F14, A9→F15 (+G10), A10→F16, A11→F17, A12→F7, A13→F8, B1→F1, B2→F2, B3→F3, B4→F4, B5→F5, B6→F6.

---

## 1. Confirmed bugs

### F1 — HIGH · `executeWithMeta()` after `cursorPaginate()` `[probe]`
**Where:** `src/core/query-builder.ts` `executeWithMeta()` (L338–350) + `buildArgs()` (L263–281).
The guard `!this.cursorActive` only skips the *default* paginate; the method then runs `execute()` which builds **cursor** args (`take = limit + 1`, `cursor`, `skip: 1`) while meta is computed from offset defaults that were never applied. Two consequences `[probe]`:
1. `meta` lies (`{ page: 1, limit: 10, … }` for a cursor query),
2. the over-fetch row **leaks into `data`** (11 rows for `limit: 10`) — `buildCursorPage()` trimming only happens in `executeWithCursor()`.

**Fix:** throw a descriptive error when `cursorActive` ("use `executeWithCursor()` for cursor pagination; `executeWithMeta()` is offset-mode only"), or delegate to `buildCursorPage()` and return cursor-aware meta. The `count()` call is unused work in cursor mode — it falls out of the fix.

**Fixed (2026-10-29):** `executeWithMeta()` now throws a descriptive error at the top of the method when `cursorActive` (the audit's preferred option); the unused `COUNT` fell out of the fix, and the delegate is never called in cursor mode. Regression test: *"executeWithMeta throws under cursor mode and never calls the delegate (audit F1)"* in `test/unit/query-builder.test.ts`.

### F2 — HIGH · `.custom({ where })` replaces the seeded `where` (soft-delete leak) `[probe]`
**Where:** `constructor` (L98–100) copies `initialArgs` into `customArgs`; `custom()` (L240–243) flat-spreads. A later `.custom({ where: X })` **overwrites** the seed instead of AND-ing.
The seed is where users put safety filters (`{ deletedAt: null }`), so this silently leaks soft-deleted rows. Re-verified in the consolidated pass: sent `where` was `{"role":"ADMIN"}` with the seed gone.
**Fix:** special-case `where` in `custom()` — merge through the same `combineAnd()` logic as `buildWhere()`. Regression test: seed survives `.custom({ where })`.

**Fixed (2026-10-29):** the seed `where` moved out of `customArgs` into a dedicated `customWhere` field; `custom()` merges through `combineAnd()`, so the seed and successive custom `where`s are AND-ed, never replaced (successive merges may nest `{ AND: [...] }` groups — semantically identical in Prisma). Regression tests: *"QueryBuilder custom where merge (audit F2)"* block (4 cases: seed survival, no-seed passthrough, successive custom wheres, seed + other custom keys) in `test/unit/query-builder.test.ts`.

### F3 — HIGH · nested `include` types drop the relation's base fields
**Where:** `src/types/projection.ts` `ProjectField` (L35–41) routes `Spec extends { include: Sub }` into `ProjectNested` → `ApplySelect`, which emits **only** the projected keys.
Prisma's real result for `.include({ author: { include: { posts: true } } })` is `Post & { author: Author & { posts: Post[] } }`; our engine types it as `Post & { author: { posts: Post[] } }` — `author.id`/`author.name` vanish from the type while present at runtime. This is a **narrower-than-truth type**, violating the type invariant (ARCHITECTURE.md invariant 3, "never lie"). The existing type tests cover nested *select* but never nested *include* — that's how it slipped through.
**Fix:** `ProjectNested` must know the spec origin: add an include-branch that maps `Field extends readonly (infer E)[] ? ApplyInclude<E, Sub>[] : ApplyInclude<NonNullable<Field>, Sub> | null/undefined-preserved`. Add the nested-include `Expect<Equal>` type test.

**Fixed (2026-10-29):** `ProjectNestedInclude` added to `src/types/projection.ts` — an include spec now maps onto `ApplyInclude`, intersecting the relation's own base fields into the nested projection exactly like Prisma's output, with `| null | undefined` optionality preserved. Regression tests: `_7`–`_10` strict `Expect<Equal>` assertions in `test/types/projection.type-test.ts` (nested include, nested include + inner select, nullable nested include, flat nullable-include guard).

### F4 — MED · Date `cursorField` → lossy `String()` coercion
**Where:** `src/core/pagination.ts` `buildCursorPage()` (L114–115). `String(dateValue)` produces locale strings like `"Thu Jan 01 2026 06:00:09 GMT+0600"` — not ISO, not round-trippable, TZ-dependent (code-verified; the probe path requires a non-null `nextCursor`). Number fields survive only by luck.
**Fix options:** keep raw value in meta (`nextCursor: unknown`); or serialize Dates via `.toISOString()`; or base64-encode a JSON envelope for opaque cursors. Also widen `cursorPaginate({ cursor })` to `string | number | Date` to match Prisma.

**Fixed (2026-10-29):** `serializeCursorValue()` (Date → ISO-8601) used by `buildCursorPage()`; `cursorPaginate({ cursor })` and `CursorPlan.cursor` widened to `string | number | Date` (passed raw to Prisma). README limitation replaced by the cursor-serialization contract. Regression tests: `serializeCursorValue` + Date-`buildCursorPage` unit tests, builder round-trip *"next cursor round-trips to the following page without overlap (audit F4)"*.

### F5 — MED · `.select()` without `cursorField` → cursor `"undefined"`
**Where:** `executeWithCursor()` feeds rows into `buildCursorPage()`, which does `String(last[cursorField])`. If projection removed the cursor field, the value is `undefined` → literal `"undefined"` cursor; the next seek targets a nonexistent row and pagination silently corrupts.
**Fix:** detect a projection missing `cursorField` (`this.selectArg` without `cursorField: true`) and throw a clear error (or auto-add it to the select).

**Fixed (2026-10-29):** `executeWithCursor()` throws a descriptive error when a `.select()` projection drops `cursorField` (auto-add rejected: it would silently change the projection shape). README limitation replaced by the throwing contract. Regression tests: *"throws when the select drops the cursorField (audit F5)"* + passing counterpart.

### F6 — MED · `sortBy()` doesn't expand dot paths `[probe]`
**Where:** `sortBy()` (L168–174) builds `orderBy` verbatim; `range()` expands the same `'avatar.size'` syntax. Probe: sent `{"avatar.size":"desc"}` — Prisma rejects flat paths for relation fields; inconsistent with `range()` and fails at runtime.
**Fix:** `this.orderBy = expandDotPath(sortBy, { [lastKey]: sortOrder })` (or a small variant that puts the sort order at the leaf). The `(string & {})` escape hatch already lets dot paths through the types.

**Fixed (2026-10-29):** `expandDotPath()` generalized to any leaf value; `sortBy()` expands dot paths (`'avatar.size'` → `{ avatar: { size: 'desc' } }`); dangerous path segments are refused (F16). README limitation replaced by the sorting contract. Regression tests: conditions unit + *"sortBy expands dot paths into nested orderBy (audit F6)"*.

### F7 — MED · dual-package hazard on global dialect config
`configureQueryBuilder()` / `setDialectDetector()` / the registry `Map` live in module scope. A bundler loading the package as both ESM and CJS (possible in Next.js mixed middleware/server graphs) creates two instances; global dialect config set in one is invisible in the other → silent `'universal'` fallback.
**Fix:** prefer per-builder `dialect` (already supported — document as the reliable path); optionally key shared state off `globalThis` (namespaced symbol); document the limitation.

**Fixed (2026-10-29):** all dialect state (registry, global config, detector) moved to `globalThis` under `Symbol.for('almamun2b.prisma-query-builder.dialect-state')` — ESM+CJS copies converge on one config. ARCHITECTURE.md state contract updated; per-builder option stays the documented recommendation. Regression test: *"dialect state is shared via globalThis (audit F7)"*.

### F8 — MED · statefulness / concurrency contract
The builder accumulates state per instance. Sharing one instance across concurrent requests (NestJS singleton provider, module-level `const qb`) mixes conditions between requests. **Fix:** loud README contract — "one builder per query; instances are cheap"; consider an opt-in immutable (clone-per-method) variant for DI-heavy apps later.

**Fixed (2026-10-29):** README contract present; `docs/framework-recipes.md` adds Next.js App Router + NestJS per-request wiring examples (a stateless factory pattern covers DI-heavy apps). The immutable variant remains a possible v2 add-on.

### F9 — MED · `_count` include missing from the projected type `[probe]`
`include({ posts: true, _count: true })` returns `_count` at runtime, but `ApplyInclude` intersects keys with `keyof Row` and the base row has no `_count` — so the type omits it (access is a compile error). This is the one place the engine degrades *narrower* instead of the policy's "wider but correct". Applies to `_all`/aggregate-ish keys generally.
**Fix:** document per release; escape hatch = `findMany(qb.buildArgs())` passthrough. Future: special-case `_count` in `ApplyInclude` as `number | Record<string, number>`.

**Fixed (2026-10-29):** `ApplyInclude` widens a truthy `_count` in as `Record<string, number>` (the runtime value is always a relation→count record — wider-but-correct, folded into the mapped object so strict `Equal` holds). Type tests `_11`–`_13` in `test/types/projection.type-test.ts`. README moved from limitations to the "`_count` is typed wide" contract.

### F10 — MED · cursor edge flags are optimistic
`buildCursorPage()` (`pagination.ts:104-105`): forward-with-cursor claims `hasPrevPage = hadCursor && hasRows` without certainty (may yield an empty page); backward symmetric; empty page + `hadCursor` reports `hasPrevPage: false` though the previous page obviously existed (G9).
**Fix:** document; M2 `strict` mode fetching `limit+2` makes both flags exact for one extra row.

**Fixed (2026-10-29):** `cursorPaginate({ strict: true })` spends one extra 1-row probe query (forward pages probe the row before the cursor, backward pages the row after) making both flags exact, including the G9 empty-page edge; `buildCursorPage()` takes an `exactFlags` override. (A single `findMany` cannot over-fetch both directions, hence the probe.) README contract updated. Regression tests: pagination `exactFlags` unit tests + builder strict tests.

### F11 — MED · silent override precedence between `custom()` and explicit methods `[probe]`
Independent of call order: `.select(X)` beats `custom({ select: Y })`; `.paginate()`/`.cursorPaginate()` beat `custom({ take })`; while `where` from `custom()` is **AND-ed** with method conditions — an undocumented exception. Deterministic but invisible.
**Fix:** README precedence table ("explicit methods win over `custom()` args, regardless of order; `where` is always AND-ed"); optional dev-time `console.warn` on collisions.

**Fixed (2026-10-29):** README precedence contract shipped in the P0 pass and extended with `.sortBy()`/`.orderBy()`; the dev-time warning was not added — the documented table is the contract.

### F12 — LOW-UX · silent limit clamping `[probe]`
`paginate({ limit: 5000 })` → `take: 1000`; `limit: 0` → `1`. Meta stays consistent with what was sent, but intent changes silently. Document `[1, MAX_PAGE_SIZE]`; optional `strictNumbers` throwing mode.

**Fixed (2026-10-29):** `new QueryBuilder(delegate, { strictNumbers: true })` throws on out-of-range limits/pages (and on skip-cap exceed, F18) instead of clamping; default stays silent clamping. Regression tests: the `strictNumbers` block in `test/unit/query-builder.test.ts`.

### F13 — LOW · shared `match` object across `OR` arms `[probe]`
`search()` reuses one `match` reference for every field. Prisma never mutates args, so harmless today, but fragile. Trivial fix: per-field object.

**Fixed (2026-10-29):** one match object per `OR` arm. Regression test: *"OR arms do not share one match object reference (audit F13)"*.

### F14 — LOW · `.search()` typing includes relation keys
`fields: WhereKeyOf<D>[]` = keys of the whole `WhereInput` (relations included). Compiles, throws at runtime. Document "scalar string fields only" (structural typing can't filter relation keys).

**Fixed (2026-10-29, documented):** README contract "pass scalar string fields only" shipped in the P0 pass. Structural typing cannot filter relation keys — this stays a documented contract, not a code change.

### F15 — LOW · `undefined` handling is inconsistent
`stripUndefined` is shallow (nested `undefined` survives — Prisma tolerates most positions, rejects some), and `custom()` never strips (`custom({ distinct: undefined })` overwrites an earlier `distinct` with `undefined`). Fix: deep-strip util + run `custom()` merges through `stripUndefined`.

**Fixed (2026-10-29):** `deepStripUndefined()` (plain objects + arrays of plain objects; Date/BigInt/class instances preserved, input never mutated) applied to `custom()` args and its `where`. Regression tests: conditions unit tests + *"custom({ distinct: undefined }) does not overwrite an earlier distinct (audit F15)"*.

### F16 — LOW · prototype hardening
Computed-key literals (`{ [key]: value }`) are safe (own properties). `stripUndefined`'s bracket assignment can set a *local* object's prototype for own `'__proto__'` keys (possible via JSON-parsed bodies) — contained, `Object.keys` unaffected. Hardening: skip `__proto__`/`constructor`/`prototype` keys in `stripUndefined` + `expandDotPath`.

**Fixed (2026-10-29):** the three dangerous keys are refused in `stripUndefined`, `deepStripUndefined` and `expandDotPath` (a dangerous path segment expands to `{}`, so `range()`/`sortBy()` add nothing). Regression tests: conditions unit tests + builder-level *"range adds nothing for a dangerous path"* / *"sortBy adds nothing for a dangerous path"*.

### F17 — LOW · `FindResultOf` duplicates row extraction
`types/projection.ts:66-73` re-derives the row element (Promise-only) while `RowElementOf` (`delegate.ts:51`) already does it via `Awaited<ReturnType>` (array-or-single tolerant). Unify on `RowElementOf`.

**Fixed (2026-10-29):** `FindResultOf<D, TArgs> = ApplyProjection<RowElementOf<D>, TArgs>[]` — the duplicate extraction is gone. The existing `_6` strict-`Equal` type test proves `FindResultOf` ≡ `execute()`.

### F18 — LOW · unbounded offset `skip`
`clampPage`/`clampLimit` cap the factors, not the product: `page: 1e9, limit: 1000` sends `skip ≈ 1e12` to the DB (possible DoS via naive query-param wiring). Cap `skip` (e.g. ≤ 100_000) and/or document cursor pagination as the deep-access answer.

**Fixed (2026-10-29):** `MAX_SKIP = 100_000` caps the computed skip (silently by default; `strictNumbers` throws beyond it). README contract updated. Regression tests: `toOffsetArgs` cap unit test + builder *"caps skip silently by default"* / *"throws when the computed skip exceeds the cap"*.

---

## 2. Gaps & improvements (API completeness)

| ID | Gap | Note |
|----|-----|------|
| G1 | No multi-key / array `orderBy` | **fixed (2026-10-29):** `.orderBy(OrderByOf<D>)` passthrough accepts the full Prisma shape (arrays, nested); `.sortBy()` stays single-key sugar |
| G2 | `detectDialect()` is dead code | **fixed (2026-10-29):** wired into `resolveDialect()` as step 4 of the resolution chain (built-in no-op — behavior unchanged) |
| G3 | No `includeTotal: false` fast path | **fixed (2026-10-29):** `executeWithMeta({ includeTotal: false })` skips the `COUNT`; meta becomes `PaginationMetaNoTotal` (`total: null`) |
| G4 | Cursor pagination doesn't enforce/auto-add `sortBy({ sortBy: cursorField })` | open as guidance — auto-adding would silently rewrite user args (rejected); the README `cursorField` contract is the answer |
| G5 | `.first()` deletes `skip` | **fixed (2026-10-29):** semantics pinned in the README contract and by the test *"paginate().first() returns the global first row (audit G5 semantics)"* |
| G6 | `range()` dot paths on to-many relations generate invalid where | **fixed (2026-10-29, documented):** README contract states dot paths reach to-one relations/nested objects; to-many needs `.custom({ where: { posts: { some: ... } } })` (a `some:` path syntax stays a v2 idea) |
| G7 | `search()` doesn't trim `searchText` | **fixed (2026-10-29):** trimmed; whitespace-only adds no condition. Regression test: *"whitespace-only searchText adds no condition (audit G7)"* |
| G8 | Unknown dialect names report themselves | **fixed (2026-10-29):** unknown names resolve to `{ name: 'universal', capabilities: universal }`. Regression test updated in `test/unit/dialects.test.ts` |
| G9 | Cursor empty-page `hasPrevPage` edge | folded into F10 |
| G10 | `custom()` doesn't strip `undefined` | folded into F15 |
| G11 | ~~PLAN.md drift~~ resolved 2026-10-29 | PLAN.md retired; surviving rules live in ARCHITECTURE.md/AGENTS.md (the `expect-type` claim had already been corrected in place) |
| G12 | No guard/amplified warning for non-unique `cursorField` | README warning stands as the contract — uniqueness is undetectable client-side without an extra query; `strict: true` (F10) makes the edge *flags* exact but cannot detect duplicate keys |
| G13 | Stale `@mamun/` header in `src/index.ts` comment | fixed |
| G14 | AGENTS.md has HTML-escaped entities (`&lt;`) | verified clean |

---

## 3. Framework compatibility ("works in any JS/TS project")

| Environment | Status | Evidence |
|---|---|---|
| Node ≥ 18, ESM + CJS | ✅ | smoke tests against `dist/index.js` and `dist/index.cjs` |
| TypeScript `moduleResolution: nodenext` (Next.js/NestJS defaults) | ✅ | consumer fixture compiles, `skipLibCheck: false`; types resolve via `exports` map; `index.d.cts` present |
| `exactOptionalPropertyTypes: true` consumers | ✅ | fixture compiles |
| Edge runtimes (Vercel Edge, Cloudflare Workers) | ✅ by construction | zero Node APIs in `src/` (grep `require\|process\|Buffer\|fs\|crypto\|__dirname` → none); pure ESM |
| Next.js App Router (RSC / route handlers) | ✅ with one rule | per-request builder instances; never pass an instance (holds the delegate) across the server/client boundary |
| NestJS | ✅ with one rule | F8 — create per request/handler, never store in a singleton provider; a `forRoot()` provider factory is a good v2 add-on |
| Express / Fastify / Koa / Hono | ✅ | plain calls; REST query-param adapter is planned v2 |
| Bun | ✅ untested | pure ESM+CJS, no Node APIs — add to M3 matrix |
| Deno (npm: specifier) | ✅ untested | same; add to M3 matrix |

---

## 4. Type-safety assessment

**Verified working (compile-time, `npm run typecheck`):** flat select narrowing; nested relation **select**; include = base + projected relation; `| null` / `| undefined` preservation; `FindResultOf` ≡ `execute()`; strict `Expect<Equal>` suite — with zero Prisma imports.

**Weak spots:** F9 omits `_count` (the F3 wrong-type is fixed — see §1); `TArgs` doesn't see projections passed via `custom()` (wider = safe, document; passthrough regains exactness); `sortBy`/`cursorField` `(string & {})` escape hatches weaken key safety (keep for compat, document); `RangeInput` raw strings for dates aren't coerced (document); `buildArgs()` cast to `FindManyArgsOf<D>` is the documented escape hatch but `custom()` bypasses narrowing at the merge site.

**Suggested type-test additions:** nested `include` (F3 regression — **done**, `_7`–`_10`), `_count` (F9 regression), relation-as-`true`, select/include mutual exclusion, strict `WhereInput` filter keys.

---

## 5. Performance

- **Good:** `count` + `findMany` in `Promise.all` ✅; linear condition assembly; page-sized allocations in `buildCursorPage`; keyset pagination for deep pages; types bounded by select depth (d.ts build ~1.6s); 30.8 kB tarball / 13 kB ESM; `sideEffects: false`, single entry.
- **Watch:** F18 unbounded `skip`; F1's useless `COUNT` in cursor mode (falls out of the F1 fix); G3 missing `includeTotal` fast path; don't loop `search()` per field (it ORs internally).

---

## 6. Security

- No SQL/string construction → no injection surface (args go to Prisma's parameterized engine).
- F16 prototype hardening (contained today).
- Publish hygiene: dry-run = exactly 9 files (`dist/`, README, LICENSE, package.json). *Incident note:* a mis-aimed `npm publish` from an app directory would ship an entire app source tree — add `"private": true` to application `package.json`s.
- No secrets in repo; npm token lives in `~/.npmrc` (outside repo).

---

## 7. Packaging / CI / docs gaps

- CI: verify-only today. Missing (planned): version × DB integration matrix (M3), nightly canary vs `prisma@dev` (M3), provenance publish workflow (M4), coverage step.
- Node 22 omitted from the CI matrix (18/20/24) — intentional; commented in ci.yml (2026-10-29).
- ~~Missing files~~ resolved (2026-10-29): `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, PR/issue templates, CODEOWNERS added; `examples/` (express, next-app-router, nest-provider) remains open (M4).
- `package.json`: `bugs`/`homepage` added (2026-10-29); `engines`/`exports`/`sideEffects`/`files`/repository URL all correct post-rename ✅.
- Docs: README precedence table (F11), per-request rule (F8), cursor-approximation note (F10), clamping note (F12), dialect-vs-global note (F7), cursorField uniqueness (G12), scalar-only search (F14) — all present in the README "Behavior contracts" section ✅; framework recipes still open (M4).
- G11/G13/G14 doc drift — resolved (2026-10-29): PLAN.md retired and its surviving rules single-sourced into ARCHITECTURE.md/AGENTS.md; `src/index.ts` header fixed; AGENTS.md entities verified clean.

---

## 8. Test coverage gaps (highest value first)

1. `executeWithMeta` × `cursorPaginate` (F1) — **done** (2026-10-29).
2. `custom({ where })` × `initialArgs` seed survival (F2) — **done** (2026-10-29).
3. Type test: nested `include` (F3) — **done** (2026-10-29, `_7`–`_10`).
4. `executeWithCursor` with `select()` missing `cursorField` (F5) — **done** (2026-10-29).
5. `sortBy` dot path (F6) + Date cursorField round-trip (F4) — **done** (2026-10-29).
6. `first()` × `paginate()` semantics (G5) — **done** (2026-10-29).
7. `registerDialect` affecting `search()` output (builder-level) — **done** (2026-10-29).
8. `_count` regression — **done** (2026-10-29, `_11`–`_13`).

---

## 9. Remediation roadmap

**P0 — before any adoption** ✅ **done (2026-10-29)**
1. F2 seed-where merge — done (dedicated `customWhere` field + `combineAnd()` in `custom()`; 4 regression tests).
2. F1 throw in `executeWithMeta()` under cursor mode — done (descriptive error, zero delegate calls; regression test).
3. README contracts: precedence table (F11), per-request instances (F8), cursor approximations (F10), clamps (F12), dialect/global config (F7), cursorField uniqueness (G12), scalar-only search fields (F14) — done (README "Behavior contracts").

**P1 — v0.2.0**
4. F3 nested-include projection branch + type test — done (2026-10-29, see the F3 row).
5. F5 cursorField-missing guard; F6 `sortBy` dot-path expansion; F13 per-field match; F17 unify `FindResultOf` — **done (2026-10-29)**.
6. F4 cursor serialization (`toISOString()`) + widened `cursor` type — **done (2026-10-29)**.
7. F9 `_count` typed special case (`Record<string, number>`); F16 key hardening; F15 `custom()` strip — **done (2026-10-29)**.
8. G11/G13/G14 doc drift — resolved (2026-10-29); G2 `detectDialect` wired into the resolution chain — **done (2026-10-29)**.

**P2 — v0.3.0**
9. F10 strict cursor-edge mode (probe query); F12 `strictNumbers`; F18 skip cap; G1 multi-key `orderBy`; G3 `includeTotal`; G7 trim; G8 universal naming; G5/G6 docs; F7 `globalThis` shared config; NestJS/Next recipes — **done (2026-10-29)** (`docs/framework-recipes.md`).

**P3 — v1.0 gates (test matrix + publish readiness)**
10. Version × DB integration matrix + canary + provenance publish + coverage; CHANGELOG/CONTRIBUTING/SECURITY; examples; Bun/Deno matrix cells.

---

## Appendix: evidence index

| Probe / fixture | Result |
|---|---|
| Runtime probe: `executeWithMeta` × cursor | cursor-mode args (`take:6, cursor, skip:1`) + fabricated offset meta (A1/B1) |
| Runtime probe: cursor-mode row leak | `executeWithCursor` trims ✅ (10 rows); `executeWithMeta` leaks 11 rows |
| Runtime probe: `custom({where})` × seed | seed `deletedAt: null` replaced → `{"role":"ADMIN"}` only (B2) |
| Runtime probe: `sortBy` dot path | flat `{"avatar.size":"desc"}` sent (B6) |
| Runtime probe: `custom({select})` × `.select()` | `.select()` wins silently (A3) |
| Runtime probe: clamps | `5000→1000`, `0→1` (A6) |
| Runtime probe: `first()` | cursor/skip stripped, `take: 1` forced ✅ |
| Runtime probe: `custom({take})` | explicit pagination wins silently (A4) |
| Runtime probe: OR aliasing | arms share one match object (A7) |
| Type probe: `_count` include | access is a compile error — type omits it (A2) |
| Type probe: relation include (`posts`) | ✅ correct narrowing |
| `nodenext` consumer fixture | exit 0 ✅ |
| `exactOptionalPropertyTypes` fixture | exit 0 ✅ |
| Node-API grep in `src/` | none ✅ |
| `npm publish --dry-run` | 9 files, 30.8 kB, no app source ✅ |
| B3 / B4 / B5 (second audit) | verified by code reading + its original executable repros (scratch tests since deleted); probe paths for B4/B5 require a non-null `nextCursor` state |
