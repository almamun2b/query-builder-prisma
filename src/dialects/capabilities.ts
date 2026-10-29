/**
 * Per-database capability sets (ARCHITECTURE.md, invariant 4).
 *
 * Prisma-supported databases disagree on filter operators — most importantly,
 * `mode: 'insensitive'` is only accepted on PostgreSQL, CockroachDB and MongoDB,
 * and *throws* on MySQL, MariaDB, SQLite and SQL Server. Capability records let
 * every builder method ask "what is allowed here?" instead of hardcoding
 * database names.
 */
export interface DialectCapabilities {
  /**
   * Prisma accepts `mode: 'insensitive'` on string filters for this dialect
   * (postgresql, cockroachdb, mongodb).
   */
  caseInsensitiveMode: boolean;
  /**
   * The database's default collation makes `contains` case-insensitive without
   * any extra argument (mysql, mariadb, sqlserver). For sqlite this is `false`:
   * ASCII `LIKE` is case-sensitive there, and Prisma offers no `mode`.
   */
  caseInsensitiveCollation: boolean;
}

/** Built-in capability sets, one per database Prisma supports (plus universal). */
export const DIALECT_CAPABILITIES = {
  postgresql: { caseInsensitiveMode: true, caseInsensitiveCollation: false },
  cockroachdb: { caseInsensitiveMode: true, caseInsensitiveCollation: false },
  mysql: { caseInsensitiveMode: false, caseInsensitiveCollation: true },
  mariadb: { caseInsensitiveMode: false, caseInsensitiveCollation: true },
  sqlite: { caseInsensitiveMode: false, caseInsensitiveCollation: false },
  sqlserver: { caseInsensitiveMode: false, caseInsensitiveCollation: true },
  mongodb: { caseInsensitiveMode: true, caseInsensitiveCollation: false },
  /**
   * Fallback used when no dialect is configured/detected. Only emits arguments
   * that are valid on EVERY Prisma-supported database.
   */
  universal: { caseInsensitiveMode: false, caseInsensitiveCollation: false },
} satisfies Record<string, DialectCapabilities>;

/** Names of the built-in dialects. */
export type Dialect = keyof typeof DIALECT_CAPABILITIES;
