# Security Policy

## Reporting a vulnerability

Please report privately via GitHub Security Advisories (Security tab →
"Report a vulnerability") rather than a public issue. Include a minimal
reproduction — a fake delegate object is enough, no database required. A first
response is targeted within 7 days.

## Scope notes

The attack surface is intentionally small, and worth keeping that way:

- **Zero runtime dependencies**, no peerDependencies — nothing to inject via
  the supply chain.
- **No SQL or command construction** — every argument is passed to Prisma's
  parameterized engine; this package only assembles plain objects.
- **No network, filesystem, or process APIs in `src/`** (edge-safe by
  construction — verified by grep in the audit).
- **Publish hygiene** — the npm tarball contains exactly `dist/`,
  `README.md`, `LICENSE`, `package.json`; the `release-gate` agent verifies
  this on every release.

Known hardening items (e.g. prototype-key handling in `stripUndefined`) are
documented in the README (`Known limitations`).
