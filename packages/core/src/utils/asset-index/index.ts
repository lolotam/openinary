export { ensureAssetIndexSchema } from "./schema";
export { SqliteAssetIndex } from "./store";
export { reconcileAssetIndex, type ReconcileResult } from "./reconcile";
export {
  sanitizeFtsQuery,
  escapeLike,
  encodeSearchCursor,
  decodeSearchCursor,
} from "./fts-query";
export type {
  AssetIndex,
  AssetRecord,
  SearchParams,
  SearchResult,
  MediaType as AssetMediaType,
} from "./types";
