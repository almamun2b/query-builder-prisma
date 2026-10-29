## Summary

<!-- What changes and why. Note the README `Known limitations` item if this
     touches one. -->

## Checklist (per AGENTS.md — review-blocking)

- [ ] `npm run verify` green (lint → typecheck → test → build)
- [ ] No `@prisma` imports anywhere; no new `dependencies`/`peerDependencies`
- [ ] No database names in `src/core/` or `src/types/`
- [ ] New public API re-exported from `src/index.ts`; README "Behavior
      contracts" updated if semantics changed
- [ ] New behavior has a unit test; new/changed projection shapes have a
      `test/types/*.type-test.ts` `Expect<Equal>` assertion
- [ ] README updated (Behavior contracts / Known limitations) if semantics or
      limitations changed
- [ ] `design-rules-auditor` run (non-trivial `src/`/`test/` changes)
