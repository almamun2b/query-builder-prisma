/**
 * query-builder-prisma
 *
 * Zero-coupling, fluent, fully type-safe query builder for any Prisma model
 * delegate. Works with every Prisma version (5/6/7/8 tested; future versions by
 * design) and every database Prisma supports. See ARCHITECTURE.md for the
 * architecture and AGENTS.md for the working rules.
 */

// Core
export { QueryBuilder, NoResultError } from './core/query-builder';
export type { QueryBuilderOptions } from './core/query-builder';

// Dialects
export {
  configQueryBuilder,
  registerDialect,
  resolveDialect,
  resetDialectConfig,
  setDialectDetector,
} from './dialects/registry';
export { DIALECT_CAPABILITIES } from './dialects/capabilities';
export { detectDialect } from './dialects/detect';
export type { Dialect, DialectCapabilities } from './dialects/capabilities';
export type { ResolvedDialect } from './dialects/registry';

// Structural types (for advanced wiring by consumers)
export type {
  FindManyArgsOf,
  IncludeOf,
  OrderByOf,
  OrderKeyOf,
  PrismaModelDelegate,
  RowElementOf,
  RowsOf,
  SelectOf,
  WhereKeyOf,
  WhereOf,
} from './types/delegate';
export type {
  ApplyInclude,
  ApplyProjection,
  ApplySelect,
  FindResultOf,
} from './types/projection';

// Public option/meta types
export type {
  CursorDirection,
  CursorMeta,
  FilterInput,
  PaginationMeta,
  PaginationMetaNoTotal,
  RangeBound,
  RangeInput,
  SortOrder,
} from './types/public';
