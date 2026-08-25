"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOpeninary } from "../provider/openinary-provider";
import type { OpeninaryConfig } from "../provider/openinary-provider";
import type { MediaType } from "../types";
import { applyFolderSummaryEpoch } from "./folder-summary-cache";

export type FolderSummary = {
  itemCount: number;
  truncated: boolean;
  previewItems: { path: string; type: MediaType }[];
  coverPath?: string | null;
};

const BATCH_DELAY_MS = 40;

export const FOLDER_SUMMARIES_QUERY_KEY = ["openinary", "folder-summaries"] as const;

async function fetchFolderSummaries(
  { apiBaseUrl, fetch }: OpeninaryConfig,
  paths: string[],
): Promise<Record<string, FolderSummary>> {
  const res = await fetch(
    `${apiBaseUrl}/storage/folder-summaries?paths=${paths.map(encodeURIComponent).join(",")}`,
  );
  if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
  const json: { summaries: Record<string, FolderSummary> } = await res.json();
  return json.summaries;
}

/**
 * Fetches folder summaries (item count + preview thumbnails) only for the
 * given paths. `invalidateStorage` bumps `FOLDER_SUMMARIES_QUERY_KEY` so
 * this cache is dropped after mutations.
 */
export function useFolderSummaries(visiblePaths: string[]): Record<string, FolderSummary> {
  const openinary = useOpeninary();
  const [summaries, setSummaries] = useState<Record<string, FolderSummary>>({});
  const knownRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEpoch = useRef(0);
  const { dataUpdatedAt } = useQuery({
    queryKey: FOLDER_SUMMARIES_QUERY_KEY,
    queryFn: () => 0,
    staleTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    if (
      applyFolderSummaryEpoch(
        dataUpdatedAt,
        lastEpoch,
        knownRef.current,
        pendingRef.current,
      )
    ) {
      setSummaries({});
    }
  }, [dataUpdatedAt]);

  useEffect(() => {
    const toFetch = visiblePaths.filter((p) => !knownRef.current.has(p));
    if (toFetch.length === 0) return;

    for (const p of toFetch) {
      knownRef.current.add(p);
      pendingRef.current.add(p);
    }

    if (timerRef.current) return;

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const batch = [...pendingRef.current];
      pendingRef.current.clear();
      if (batch.length === 0) return;

      fetchFolderSummaries(openinary, batch)
        .then((fetched) => {
          setSummaries((prev) => ({ ...prev, ...fetched }));
        })
        .catch(() => {
          for (const p of batch) knownRef.current.delete(p);
        });
    }, BATCH_DELAY_MS);
  }, [visiblePaths, openinary, dataUpdatedAt]);

  return summaries;
}
