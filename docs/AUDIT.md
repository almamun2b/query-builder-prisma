# Project audit — 2026-11-02

Scope: the whole repository at `v0.2.0` (`src/`, `test/`, configs, CI, hooks, docs), re-audited from scratch
after the 2026-11-01 round. Method: full read of every source and config file, suspected bugs reproduced with
throwaway vitest tests (deleted after proof), and the full gate run as the baseline. This file replaces the
2026-11-01 audit; the prior round's history lives in this file's git history.

Baseline at audit time: `lint ✓ · typecheck ✓ · 138 tests ✓ · build ✓ · format:check ✗`.

`docs/AUDIT.md` from 2026-11-01 is accurate about what was fixed. This round verifies the current tree and
finds **2 new bugs it missed**, 1 broken gate, 1 doc contradiction, plus a fix/keep decision for every README
"Known limitations" entry.

## 1. New bugs (not in the 2026-11-01 audit, both reproduced with tests)

**AUD-01 · MED · offset `.paginate()` leaks `custom({ cursor })` into the query.**
`compose()` (`src/core/query-builder.ts`) deletes `cursor`/`skip` only in the **cursor** branch. In offset
mode, a `custom({ cursor })` survives and Prisma silently applies a seek _on top of_ `skip`/`take` — wrong
rows, no error. This violates the README precedence contract ("explicit methods always win over `custom()`
args").

```ts
new QueryBuilder(prisma.user)
  .custom({ cursor: { id: 'leak' } })
  .paginate({ page: 2, limit: 5 })
  .execute();
// sends { cursor: { id: 'leak' }, skip: 5, take: 5 }  ← cursor wins in Prisma
```

_Fix:_ one line — `delete args.cursor;` in the offset branch of `compose()` (`first()` already does this),
plus a regression test. Ship as `fix:`.

**AUD-02 · LOW · `custom({ where: null })` sends `{ AND: [X, null] }` to Prisma.**
`custom()` guards `select`/`include` against `null`, but the `where` branch only checks `!== undefined`. A JS
caller (or untyped input) produces `AND: [{ role }, null]` → Prisma runtime error.

_Fix:_ `where != null`, consistent with the sibling checks in the same method, plus a regression test. Ship as
`fix:`.

> **Status update (2026-11-06):** AUD-01 and AUD-02 are fixed with regression tests (AUD-02 only
> misbehaved once a seed or earlier `custom({ where })` existed — a lone `null` was already dropped),
> as are the `initialArgs` hardening gap and the uncaught throwing detector (Phase 0 items). A new
> finding was fixed alongside: `package.json` `exports` served the ESM `index.d.ts` to `require()`
> users — it now has per-condition `types` (`index.d.cts` for CJS).

## 2. Broken gate and hygiene

| Item                             | Detail                                                                                                                                                                                                                                                                          | Fix                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `npm run format:check` **fails** | `builder-old/queryBuilder.ts` — a scratch dir at the repo root, invisible to git via an inner `.gitignore`, but not to Prettier/ESLint                                                                                                                                          | Delete `builder-old/` and `temp/`, or add both to `.prettierignore` + eslint `ignores` |
| README line 77 over-claims       | Features bullet says "`undefined` stripping **at any depth**" — but `filter()`/`where()` strip **shallow** only; deep stripping is `custom()`-only (line 146 states it correctly). No runtime harm (Prisma drops `undefined` itself), but the two bullets contradict each other | Reword line 77                                                                         |
| `initialArgs` bypasses hardening | The constructor stores the seed's `rest` without `deepStripUndefined`/`assertSafeKey` (2026-11-01 BUG-11 item) — `filter()` throws on `__proto__`, the seed silently accepts it                                                                                                 | Route the seed through the same strip/guard                                            |

## 3. Confirmed still open (from the 2026-11-01 round)

- **BUG-12** (MED) — strict probe ignores the cursor row itself (README limitation 2).
- **TYPE-03 remainder** — `initialArgs` / wide-variable `custom()` projections untracked; `omit`/`distinct`
  invisible to the result type.
- **TYPE-06/07, BUG-10/11** — LOW type and number edges: `exactOptionalPropertyTypes`, dialect-name cast,
  `clampLimit(Infinity)`, `range()` accepting `null`/`''`/`NaN` bounds, cyclic-input stack overflow in
  `deepStripUndefined`, a throwing detector not caught, `custom({ where })` nesting N deep, `buildArgs()`
  returning internal references.
- **API gaps** — no `omit()`, `distinct()`, `whereIf()`, `or()`/`not()`, `buildCountArgs()`; constants
  (`DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE`, `MAX_SKIP`) not exported; `NoResultError` has no context;
  `caseInsensitiveCollation` is declared but never read.
- **TOOL-04** — 53 dev advisories (2 critical) in the `vitest` 2.x tree; **TOOL-06** — CI has no
  `permissions:` block, tag-pinned actions, no npm cache, no `format:check` (verified in `.github/workflows/ci.yml`).
- **Test hardening** — the fake delegate ignores `where`/`select`/`orderBy` (asserts args, not behaviour);
  no negative (`@ts-expect-error`) type tests.

## 4. Plan: fixing the README "Known limitations"

A verdict and concrete plan for each of the 8 documented limitations:

| #   | Limitation                                                         | Verdict                | Plan                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `.execute()` after `.cursorPaginate()` returns raw over-fetch rows | **Fixable (breaking)** | Make `execute()` **throw** in cursor mode (symmetric with `executeWithMeta()`), or silently delegate to `executeWithCursor()`. Throw is safer and consistent. Ship as `feat!:`                                                                                                                                                                                                       |
| 2   | Strict flags ignore the cursor row (BUG-12)                        | **Fixable**            | Probe **without `skip: 1`**, fetch 1 nearest row; if its cursor value equals the supplied cursor → the cursor row is the dataset edge → flag `false`, else `true`. Needs the semantics decision recorded, one real-Prisma verification run (out-of-repo scratch, per invariant 1), and a fake-delegate update                                                                        |
| 3   | Projections not reflected in types                                 | **Partly fixable**     | (a) **`omit` tracking**: precise `Omit<Row, K>` threading — very doable. (b) **`initialArgs` projection**: infer via constructor generics or a `QueryBuilder.seed()` factory. (c) **`distinct`**: has _no_ row-shape effect — document as such, nothing to narrow. (d) **wide-variable `custom()` args**: not fixable (the literal type is lost before we see it) — stays documented |
| 4   | Wide types (`_count`, unknown relations)                           | **Partly fixable**     | Narrow `_count` when the spec is a literal: `_count: { select: { posts: true } }` → `{ _count: { posts: number } }` instead of `Record<string, number>` (+ type tests; a type break for consumers relying on the wide type — mark in the changelog). Unknown relations stay `unknown` — genuinely unknowable without Prisma types                                                    |
| 5   | Dot paths reach to-one relations only                              | **Not fixable — keep** | Runtime cannot detect to-many without Prisma knowledge (invariant 1); Prisma already fails loudly. Optional improvement: type `range()` keys as `WhereKeyOf<D>` (catches top-level typos; deeper paths keep the string escape)                                                                                                                                                       |
| 6   | No field allow-list                                                | **Fixable**            | (a) Opt-in runtime option `new QueryBuilder(delegate, { allowedFields: { sort: [...], range: [...], cursor: [...] } })` → throws on foreign keys — the actual security ask (works in JS too). (b) Remove the `(string & {})` escape from `sortBy`/`cursorField` → `OrderKeyOf<D>` becomes enforced (`feat!:`; breaking for cast-dependent users)                                     |
| 7   | `count()` ignores `distinct`                                       | **Fixable (loud)**     | The contract only guarantees `findMany` + `count` — no `groupBy` available. Best fix: when `distinct` is present and `includeTotal !== false`, `executeWithMeta()` **throws** with guidance (silent over-count → loud error). Breaking; the alternative is status quo plus louder docs                                                                                               |
| 8   | Typing edges                                                       | **All fixable**        | (a) add `\| undefined` to `paginate`/`sortBy`/`cursorPaginate` params (`fix:`, unblocks `exactOptionalPropertyTypes`); (b) widen `QueryBuilderOptions.dialect` to `Dialect \| (string & {})` (`feat:`); (c) `sortBy` default: add an opt-in `defaultSortOrder` builder option now; flip the default only in a future major                                                           |

## 5. Suggested execution order (semantic-release-aware)

1. **Phase 0 — quick wins (`fix:`/`chore:`, one PR each or one batch)**

   AUD-01, AUD-02, `builder-old`/`temp` cleanup (fixes `format:check`), README line 77 wording,
   `| undefined` params, `initialArgs` hardening, detector try/catch, `RangeBound` + `bigint`.

2. **Phase 1 — limitation fixes needing a decision (`feat:`/`feat!:`)**

   Limitation 2 (BUG-12 probe fix), 1 (`execute()` semantics), 6 (allow-list), 4 (`_count` narrowing),
   7 (distinct-aware throw), 8b (dialect widening), 8c (`defaultSortOrder`).

3. **Phase 2 — new API (`feat:`)**

   `omit()`, `distinct()`, `whereIf()`, `buildCountArgs()`, export the pagination constants,
   `NoResultError` context.

4. **Phase 3 — infra/tests (`chore:`/`test:`)**

   `vitest` major (TOOL-04), CI hardening (TOOL-06), behavioural fake delegate + the untested-gaps list +
   negative type tests. TypeScript 7 when typescript-eslint allows.

Every code change lands with: regression/type test + README (`Behavior contracts` / `Known limitations`)
updated in the same change, per AGENTS.md.

## 6. Decision points before Phase 1

- **Limitation 1** — should plain `execute()` throw or delegate when cursor mode is active?
- **Limitation 2** — confirm the neighbour semantics: the cursor row itself counts as a page edge (the
  probe drops `skip`, then compares values).
- **Limitation 7** — loud throw vs. documented over-count when `distinct` meets `executeWithMeta()`.
