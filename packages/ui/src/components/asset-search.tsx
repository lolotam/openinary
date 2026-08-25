"use client";

import { File, FileImage, FileVideo, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "../lib/utils";
import { useOpeninary } from "../provider/openinary-provider";
import { Input } from "../ui/input";
import type { MediaType } from "../types";

export type AssetSearchHit = {
  path: string;
  filename: string;
  folder: string;
  mediaType: MediaType;
};

export function AssetSearch({
  folder,
  onNavigate,
}: {
  folder?: string | null;
  onNavigate: (target: { folder: string | null; asset: string }) => void;
}) {
  const { apiBaseUrl, fetch } = useOpeninary();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<MediaType | "all">("all");
  const [scopeEverywhere, setScopeEverywhere] = useState(false);
  const [hits, setHits] = useState<AssetSearchHit[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchFolder = useMemo(() => {
    if (scopeEverywhere || !folder) return undefined;
    return folder;
  }, [folder, scopeEverywhere]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const q = query.trim();
    if (!q) {
      setHits([]);
      setDegraded(false);
      setOpen(false);
      return;
    }

    debounce.current = setTimeout(async () => {
      const params = new URLSearchParams({ q });
      if (type !== "all") params.set("type", type);
      if (searchFolder) params.set("folder", searchFolder);
      try {
        const res = await fetch(`${apiBaseUrl}/assets/search?${params}`);
        const json = (await res.json()) as {
          results?: AssetSearchHit[];
          degraded?: boolean;
          error?: string;
        };
        if (!res.ok) {
          setHits([]);
          setDegraded(true);
          setOpen(true);
          return;
        }
        setHits(json.results ?? []);
        setDegraded(Boolean(json.degraded));
        setOpen(true);
        setActive(0);
      } catch {
        setHits([]);
        setDegraded(true);
        setOpen(true);
      }
    }, 200);

    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [apiBaseUrl, fetch, query, type, searchFolder]);

  const go = (hit: AssetSearchHit) => {
    onNavigate({
      folder: hit.folder || null,
      asset: hit.path,
    });
    setOpen(false);
  };

  return (
    <div role="search" className="relative min-w-0 flex-1 max-w-md">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search assets"
          aria-label="Search assets"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          className="h-8 pl-7"
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && hits[active]) {
              e.preventDefault();
              go(hits[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-1 shadow-md">
          <div className="flex flex-wrap gap-1 p-1">
            {(["all", "image", "video", "raw"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={cn(
                  "rounded px-2 py-0.5 text-xs capitalize",
                  type === value
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
                onClick={() => setType(value)}
              >
                {value === "all" ? "All" : value}
              </button>
            ))}
            {folder ? (
              <button
                type="button"
                className="ml-auto rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                onClick={() => setScopeEverywhere((v) => !v)}
              >
                {scopeEverywhere ? "This folder" : "Everywhere"}
              </button>
            ) : null}
          </div>
          <ul id={listId} role="listbox" className="max-h-72 overflow-auto">
            {degraded && hits.length === 0 ? (
              <li className="px-2 py-3 text-sm text-muted-foreground">
                Search index unavailable
              </li>
            ) : hits.length === 0 ? (
              <li className="px-2 py-3 text-sm text-muted-foreground">
                No results
              </li>
            ) : (
              hits.map((hit, i) => {
                const Icon =
                  hit.mediaType === "video"
                    ? FileVideo
                    : hit.mediaType === "raw"
                      ? File
                      : FileImage;
                return (
                  <li
                    key={hit.path}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm",
                      i === active && "bg-muted",
                    )}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      go(hit);
                    }}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">{hit.filename}</span>
                    <span className="ml-auto max-w-[40%] truncate text-xs text-muted-foreground">
                      {hit.folder || "/"}
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
