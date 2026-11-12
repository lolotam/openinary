const MIB = 1024 * 1024;

// Per-file limit: configurable via MAX_FILE_SIZE_MB env var, defaults to 50MB
export const MAX_FILE_SIZE =
  (parseInt(process.env.MAX_FILE_SIZE_MB ?? "50", 10) || 50) * MIB;

// One file plus multipart overhead. Presigned (unauthenticated) uploads always
// carry a single file, so their body is checked against this before parsing.
export const MAX_UPLOAD_BODY_SIZE = MAX_FILE_SIZE + MIB;

// Whole-request cap for authenticated batch uploads (the dashboard sends up to
// 20 files per request). Never below a single maximal file. nginx enforces a
// fixed ceiling just above the default (docker/nginx.conf, /api/upload).
export const MAX_UPLOAD_REQUEST_SIZE = Math.max(
  MAX_UPLOAD_BODY_SIZE,
  (parseInt(process.env.MAX_UPLOAD_REQUEST_MB ?? "1024", 10) || 1024) * MIB,
);
