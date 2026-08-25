"use client";

import { File } from "lucide-react";
import { VideoThumbnail } from "../components/video-thumbnail";
import type { MediaFile } from "../types";

interface AssetPreviewProps {
  asset: MediaFile;
  previewUrl: string;
}

export function AssetPreview({ asset, previewUrl }: AssetPreviewProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Preview</h3>
      <div className="relative aspect-square rounded-lg overflow-hidden border border-border bg-muted">
        {asset.type === "raw" || !previewUrl ? (
          <div className="flex h-full w-full items-center justify-center">
            <File className="h-1/3 w-1/3 text-muted-foreground" strokeWidth={1.5} />
          </div>
        ) : null}
        {/*
          Both media types go through the same component, which owns the
          skeleton, the fade and the retry.

          This used to keep its own state for stills, remembering the URL that
          failed - and never clearing it. Nothing reset that flag on a
          successful load, so once a preview 404'd (which it does by design
          while its thumbnail is still being generated in the browser) the
          error stayed true for that URL forever: the image showed up on a
          later attempt and painted underneath "Failed to load preview", and
          reselecting the asset brought the message straight back.
        */}
        {asset.type !== "raw" && previewUrl ? (
        <VideoThumbnail
          src={previewUrl}
          alt={asset.name}
          className="object-contain"
          loading="eager"
          errorLabel="Failed to load preview"
        />
        ) : null}
      </div>
    </div>
  );
}
