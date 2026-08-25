export type MediaType = "image" | "video" | "raw";

export interface AssetRecord {
  id: string;
  path: string;
  filename: string;
  size: number;
  mime: string;
  mediaType: MediaType;
  folder: string;
  contentHash: string | null;
  thumbnailPath: string | null;
  customMetadata: Record<string, unknown>;
  mtime: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface SearchParams {
  q: string;
  type?: MediaType;
  folder?: string;
  limit?: number;
  cursor?: string;
}

export interface SearchResult {
  results: AssetRecord[];
  nextCursor: string | null;
  degraded: boolean;
}

export interface AssetIndex {
  ftsAvailable: boolean;
  upsertFromUpload(
    input: Omit<AssetRecord, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): AssetRecord;
  /**
   * File rename/move. Rewrites assets.path/folder/filename.
   * Same-folder rename: also rewrite folder_covers.cover_path that equal `from`.
   * Cross-folder move: DELETE folder_covers WHERE cover_path = from
   * (the image is no longer inside the folder that selected it).
   */
  movePath(from: string, to: string): void;
  /** File copy. Inserts a new row cloned from `from` with path `to`. Covers are not copied. */
  copyPath(from: string, to: string): void;
  /** Folder rename/move. Rewrites every assets.path/folder and folder_covers.folder/cover_path with that prefix. */
  moveFolderPrefix(from: string, to: string): void;
  /** File delete. Also DELETE FROM folder_covers WHERE cover_path = path. */
  removeByPath(path: string): void;
  /** Folder delete. Removes assets under prefix and covers whose folder or cover_path is under the prefix. */
  removeByFolderPrefix(folder: string): void;
  search(params: SearchParams): SearchResult;
  getCover(folder: string): string | null;
  setCover(folder: string, coverPath: string): void;
  clearCover(folder: string): void;
  coversFor(folders: string[]): Map<string, string>;
  getByPath(path: string): AssetRecord | null;
  /** Local reconcile only. Paginated. Do not load the whole table for S3. */
  iterPaths(batchSize: number): Iterable<string>;
  /** Drop cover rows whose cover_path is not in `existingPaths`. Local reconcile only. */
  clearCoversMissingFrom?(existingPaths: Set<string>): void;
}
