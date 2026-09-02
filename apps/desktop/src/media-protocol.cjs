const crypto = require("node:crypto");
const fs = require("node:fs");
const { Readable } = require("node:stream");
const { resolveAssetSource } = require("./source-resolver.cjs");

// Core currently uses nanoid, whose alphabet permits '_' and '-' in the first
// position. Keep the protocol token path-safe without assuming UUID syntax.
const ASSET_ID_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;

class MediaLeaseRegistry {
  #leases = new Map();

  acquire(assetId, source = null) {
    assertAssetId(assetId);
    const leaseId = crypto.randomUUID();
    this.#leases.set(leaseId, { assetId, source });
    return {
      leaseId,
      url: `media://asset/${encodeURIComponent(assetId)}?lease=${encodeURIComponent(leaseId)}`,
    };
  }

  release(leaseId) {
    return this.#leases.delete(leaseId);
  }

  releaseAll() {
    this.#leases.clear();
  }

  validates(assetId, leaseId) {
    return typeof leaseId === "string" && this.#leases.get(leaseId)?.assetId === assetId;
  }

  lookup(assetId, leaseId) {
    const lease = this.#leases.get(leaseId);
    return lease?.assetId === assetId ? lease : null;
  }
}

const parseByteRange = (header, sizeBytes) => {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new RangeError("sizeBytes must be a non-negative safe integer");
  }
  if (header == null) {
    return sizeBytes === 0
      ? { start: 0, end: -1, length: 0, partial: false }
      : { start: 0, end: sizeBytes - 1, length: sizeBytes, partial: false };
  }
  if (typeof header !== "string" || !header.startsWith("bytes=") || header.includes(",")) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (match[1] === "" && match[2] === "") || sizeBytes === 0) return null;

  let start;
  let end;
  if (match[1] === "") {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, sizeBytes - suffixLength);
    end = sizeBytes - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? sizeBytes - 1 : Math.min(Number(match[2]), sizeBytes - 1);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
    if (start >= sizeBytes || start > end) return null;
  }
  return { start, end, length: end - start + 1, partial: true };
};

const createMediaProtocolHandler = ({
  catalog,
  leases,
  resolveSource = resolveAssetSource,
  open = fs.promises.open,
}) => {
  if (!catalog || typeof catalog.getAsset !== "function")
    throw new TypeError("catalog is required");
  if (!leases || typeof leases.lookup !== "function") throw new TypeError("leases are required");

  return async (request) => {
    let parsed;
    try {
      parsed = parseMediaUrl(request.url);
    } catch {
      return textResponse("Not found", 404);
    }
    if (!parsed) return textResponse("Not found", 404);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return textResponse("Method not allowed", 405, { Allow: "GET, HEAD" });
    }
    const lease = leases.lookup(parsed.assetId, parsed.leaseId);
    if (!lease) {
      return textResponse("Media lease expired", 403);
    }

    const asset = lease.source?.asset ?? (await catalog.getAsset(parsed.assetId));
    if (!asset) return sourceStateResponse("offline", 404, "Media asset not found");
    const resolved = lease.source?.resolved ?? (await resolveSource(asset));
    if (resolved.state !== "online" && resolved.state !== "moved") {
      const status =
        resolved.state === "permission-denied" ? 403 : resolved.state === "offline" ? 404 : 409;
      return sourceStateResponse(resolved.state, status, `Media source is ${resolved.state}`);
    }

    let file;
    try {
      file = await open(resolved.absolutePath, "r");
      const currentStat = await file.stat();
      const currentSize = Number(currentStat.size);
      if (
        !currentStat.isFile() ||
        currentSize !== asset.sizeBytes ||
        Math.trunc(currentStat.mtimeMs) !== Math.trunc(asset.modifiedAtMs)
      ) {
        await file.close();
        return sourceStateResponse("changed", 409, "Media source changed before reading");
      }

      const range = parseByteRange(request.headers.get("range"), currentSize);
      if (!range) {
        await file.close();
        return textResponse("Range not satisfiable", 416, {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes */${currentSize}`,
        });
      }
      const headers = mediaHeaders(asset.mime, range, currentSize);
      if (request.method === "HEAD" || range.length === 0) {
        await file.close();
        return new Response(null, { status: range.partial ? 206 : 200, headers });
      }

      const stream = file.createReadStream({ start: range.start, end: range.end, autoClose: true });
      const abort = () => stream.destroy(new Error("media request aborted"));
      request.signal?.addEventListener("abort", abort, { once: true });
      stream.once("close", () => request.signal?.removeEventListener("abort", abort));
      return new Response(Readable.toWeb(stream), {
        status: range.partial ? 206 : 200,
        headers,
      });
    } catch (error) {
      if (file) await file.close().catch(() => {});
      if (error?.code === "EACCES" || error?.code === "EPERM") {
        return sourceStateResponse("permission-denied", 403, "Media source permission denied");
      }
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
        return sourceStateResponse("offline", 404, "Media source is offline");
      }
      throw error;
    }
  };
};

const installMediaProtocol = (electronProtocol, dependencies) => {
  const handler = createMediaProtocolHandler(dependencies);
  electronProtocol.handle("media", handler);
  return handler;
};

const parseMediaUrl = (value) => {
  const url = new URL(value);
  if (url.protocol !== "media:" || url.hostname !== "asset") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return null;
  const assetId = decodeURIComponent(segments[0]);
  assertAssetId(assetId);
  return { assetId, leaseId: url.searchParams.get("lease") };
};

const assertAssetId = (assetId) => {
  if (typeof assetId !== "string" || !ASSET_ID_PATTERN.test(assetId)) {
    throw new TypeError("assetId is invalid");
  }
};

const mediaHeaders = (mime, range, sizeBytes) => {
  const headers = {
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Length": String(range.length),
    "Content-Type": mime || "application/octet-stream",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff",
  };
  if (range.partial) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${sizeBytes}`;
  return headers;
};

const sourceStateResponse = (state, status, message) =>
  textResponse(message, status, { "X-Movie-Desk-Source-State": state });

const textResponse = (body, status, headers = {}) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...headers },
  });

module.exports = {
  MediaLeaseRegistry,
  createMediaProtocolHandler,
  installMediaProtocol,
  parseByteRange,
  parseMediaUrl,
};
