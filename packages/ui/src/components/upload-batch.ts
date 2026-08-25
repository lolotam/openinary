export const UPLOAD_BATCH_SIZE = 20;
export const UPLOAD_MAX_ATTEMPTS = 3;
export const RETRY_WAIT_MIN_MS = 1000;
export const RETRY_WAIT_MAX_MS = 60_000;

export interface UploadResult {
  filename: string;
  path: string;
  size: number;
  url: string;
}

export interface UploadError {
  filename: string;
  error: string;
}

export interface UploadResponse {
  success: boolean;
  files?: UploadResult[];
  errors?: UploadError[];
  error?: string;
}

export function chunkFiles<T>(files: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < files.length; i += size) {
    batches.push(files.slice(i, i + size));
  }
  return batches;
}

export function retryAfterMs(res: Response, now = Date.now()): number {
  const retryAfter = res.headers.get("Retry-After");
  const reset = res.headers.get("X-RateLimit-Reset");
  let ms = RETRY_WAIT_MIN_MS;

  if (retryAfter) {
    const trimmed = retryAfter.trim();
    if (/^\d+$/.test(trimmed)) {
      ms = Number(trimmed) * 1000;
    } else {
      const parsed = Date.parse(trimmed);
      ms = Number.isNaN(parsed) ? RETRY_WAIT_MIN_MS : parsed - now;
    }
  } else if (reset) {
    const n = Number(reset);
    if (Number.isFinite(n)) {
      const absMs = n > 1e12 ? n : n * 1000;
      ms = absMs - now;
    }
  }

  if (!Number.isFinite(ms) || ms < RETRY_WAIT_MIN_MS) {
    ms = RETRY_WAIT_MIN_MS;
  }
  return Math.min(ms, RETRY_WAIT_MAX_MS);
}

export async function parseUploadResponse(res: Response): Promise<UploadResponse> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error("Empty upload response");
  }
  try {
    return JSON.parse(text) as UploadResponse;
  } catch {
    throw new Error("Malformed upload response");
  }
}

function fileLabel(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string })
    .webkitRelativePath;
  return relative || file.name;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function uploadFilesInBatches(opts: {
  files: File[];
  folder?: string;
  fetch: typeof fetch;
  url: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<UploadResponse> {
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const batches = chunkFiles(opts.files, UPLOAD_BATCH_SIZE);
  const files: UploadResult[] = [];
  const errors: UploadError[] = [];

  for (const batch of batches) {
    let lastError: string | null = null;
    let parsed: UploadResponse | null = null;
    let stoppedByRateLimit = false;

    for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt++) {
      const formData = new FormData();
      if (opts.folder) formData.append("folder", opts.folder);
      for (const file of batch) {
        formData.append("files", file);
        formData.append("names", fileLabel(file));
      }

      const response = await opts.fetch(opts.url, {
        method: "POST",
        body: formData,
      });

      if (response.status === 429) {
        lastError = "Rate limited";
        if (attempt === UPLOAD_MAX_ATTEMPTS) {
          stoppedByRateLimit = true;
          break;
        }
        await sleep(retryAfterMs(response, now()));
        continue;
      }

      try {
        parsed = await parseUploadResponse(response);
      } catch (error) {
        lastError =
          error instanceof Error ? error.message : "Malformed upload response";
        parsed = null;
      }
      break;
    }

    if (stoppedByRateLimit) {
      for (const file of batch) {
        errors.push({ filename: fileLabel(file), error: lastError || "Rate limited" });
      }
      break;
    }

    if (parsed) {
      if (parsed.files) files.push(...parsed.files);
      if (parsed.errors) errors.push(...parsed.errors);
      if (!parsed.success && !parsed.files && parsed.error) {
        for (const file of batch) {
          errors.push({ filename: fileLabel(file), error: parsed.error });
        }
      }
    } else {
      for (const file of batch) {
        errors.push({
          filename: fileLabel(file),
          error: lastError || "Upload failed",
        });
      }
    }
  }

  return {
    success: files.length > 0,
    files,
    errors: errors.length > 0 ? errors : undefined,
    error:
      files.length === 0 && errors.length > 0
        ? errors[0].error
        : undefined,
  };
}
