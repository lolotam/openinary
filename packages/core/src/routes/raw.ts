import { Hono } from "hono";
import { TransformService } from "../services/transform.service";
import type { RouteDeps } from "../config/deps";
import { remoteSourceUrl } from "./transform-helpers";
import { contentTypeForExt } from "../utils/upload-validation";
import { isTransformSegment } from "../utils/parser";
import logger, { serializeError } from "../utils/logger";

/**
 * /raw/<path> is original-only delivery. Transform segments are rejected
 * rather than silently dropped, matching /t/w_500/file.zip.
 */
export function createRawRoute(deps: RouteDeps) {
  const transformService = new TransformService(deps.storage, deps.queue);
  const raw = new Hono();

  raw.get("/*", async (c) => {
    const requestPath = c.req.path;
    const rest = requestPath.replace(/^\/raw\/?/, "");
    const userAgent = c.req.header("User-Agent") ?? "";
    const acceptHeader = c.req.header("Accept");

    if (!rest) {
      return c.text("File path is required", 400);
    }

    const segments = rest.split("/").filter(Boolean);
    if (segments.length > 0 && isTransformSegment(segments[0])) {
      const originalPath = segments.slice(1).join("/");
      const message = originalPath
        ? `${segments[0]} can't be transformed. Request /raw/${originalPath} for the original.`
        : "Raw delivery does not apply transformations.";
      return c.text(message, 400);
    }

    try {
      const result = await transformService.transform({
        path: `/t/${rest}`,
        userAgent,
        acceptHeader,
        context: c,
        sourceUrl: remoteSourceUrl(c),
        originalsOnly: true,
      });

      Object.entries(result.headers).forEach(([key, value]) => {
        if (key.toLowerCase() === "content-length" && !result.stream) return;
        c.header(key, value);
      });

      c.header("X-Content-Type-Options", "nosniff");
      c.header(
        "Content-Type",
        result.contentType || contentTypeForExt(rest.split(".").pop()),
      );

      if (result.stream) {
        if (result.status) c.status(result.status as 200);
        return c.body(result.stream);
      }
      if (result.status === 202) {
        return c.body(new Uint8Array(result.buffer!), 202);
      }
      if (result.status === 206) {
        return c.body(new Uint8Array(result.buffer!), 206);
      }
      if (result.status === 400) {
        return c.text(result.buffer!.toString(), 400);
      }
      if (
        result.contentType === "text/plain" &&
        result.buffer!.toString().includes("failed")
      ) {
        const errorMessage = result.buffer!.toString();
        if (errorMessage.includes("File not found")) {
          return c.text(errorMessage, 404);
        }
        return c.text(errorMessage, 500);
      }

      return c.body(new Uint8Array(result.buffer!));
    } catch (error) {
      logger.error(
        { error: serializeError(error), path: requestPath },
        "Raw delivery route error",
      );
      return c.text("Internal server error", 500);
    }
  });

  return raw;
}
