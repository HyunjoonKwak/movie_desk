const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const { errorResponse, successResponse, validateHelperRequest } = require("./helper-protocol.cjs");

const MAX_LINE_BYTES = 1024 * 1024;
const QUICK_HASH_CHUNK_BYTES = 1024 * 1024;

const executeHelperRequest = async (untrustedRequest) => {
  const request = validateHelperRequest(untrustedRequest);
  const handler = handlers[request.command];
  return successResponse(request, await handler(request.input));
};

const handlers = {
  async "volume-resolve"(input) {
    requireMacOS("volume-resolve");
    const sourcePath = absoluteInputPath(input.path, "input.path");
    const { stdout: dfOutput } = await runExecutable("/bin/df", ["-P", sourcePath]);
    const detectedMountPoint = parseDfMountPoint(dfOutput);
    const { stdout } = await runExecutable("/usr/sbin/diskutil", ["info", detectedMountPoint]);
    const properties = parseKeyValueOutput(stdout);
    const mountPoint = properties.get("Mount Point") ?? detectedMountPoint;
    if (!mountPoint || !path.isAbsolute(mountPoint)) {
      throw helperError("VOLUME_NOT_FOUND", "diskutil did not return a mount point");
    }
    const volumeRelativePath = volumeRelativePathFor(sourcePath, mountPoint);
    return {
      volumeUuid: nullableValue(properties.get("Volume UUID")),
      mountPoint,
      volumeRelativePath,
      fileSystem: nullableValue(
        properties.get("File System Personality") ?? properties.get("Type (Bundle)"),
      ),
      readOnly:
        properties.get("Media Read-Only") === "Yes" ||
        properties.get("Volume Read-Only")?.startsWith("Yes") === true,
    };
  },

  async "volume-mount"(input) {
    requireMacOS("volume-mount");
    if (typeof input.volumeUuid !== "string" || !/^[A-Fa-f0-9-]{8,64}$/.test(input.volumeUuid)) {
      throw helperError("INVALID_REQUEST", "input.volumeUuid is invalid");
    }
    const { stdout } = await runExecutable("/usr/sbin/diskutil", ["info", input.volumeUuid]);
    const properties = parseKeyValueOutput(stdout);
    const mountPoint = properties.get("Mount Point");
    if (!mountPoint || !path.isAbsolute(mountPoint)) {
      throw helperError("VOLUME_NOT_FOUND", "volume is not currently mounted");
    }
    return {
      volumeUuid: nullableValue(properties.get("Volume UUID")),
      mountPoint,
      readOnly:
        properties.get("Media Read-Only") === "Yes" ||
        properties.get("Volume Read-Only")?.startsWith("Yes") === true,
    };
  },

  async inspect(input) {
    requireMacOS("inspect");
    const sourcePath = absoluteInputPath(input.path, "input.path");
    const { stdout } = await runExecutable("/usr/bin/sips", [
      "-g",
      "pixelWidth",
      "-g",
      "pixelHeight",
      "-g",
      "format",
      "-g",
      "space",
      "-g",
      "orientation",
      sourcePath,
    ]);
    const properties = parseKeyValueOutput(stdout);
    return {
      kind: "image",
      width: nullableNumber(properties.get("pixelWidth")),
      height: nullableNumber(properties.get("pixelHeight")),
      format: nullableValue(properties.get("format")),
      colorSpace: nullableValue(properties.get("space")),
      orientation: nullableNumber(properties.get("orientation")),
    };
  },

  async preview(input) {
    requireMacOS("preview");
    const sourcePath = absoluteInputPath(input.sourcePath, "input.sourcePath");
    const outputPath = absoluteInputPath(input.outputPath, "input.outputPath");
    const maxDimension = integerInRange(
      input.maxDimension ?? 2560,
      16,
      16_384,
      "input.maxDimension",
    );
    const format = input.format ?? "jpeg";
    if (format !== "jpeg" && format !== "png") {
      throw helperError("INVALID_REQUEST", "input.format must be jpeg or png");
    }
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await runExecutable("/usr/bin/sips", [
      "-s",
      "format",
      format,
      "-Z",
      String(maxDimension),
      sourcePath,
      "--out",
      outputPath,
    ]);
    const outputStat = await fs.promises.stat(outputPath);
    return {
      outputPath,
      sizeBytes: outputStat.size,
      format,
      pipelineVersion: "sips-preview-v1",
    };
  },

  async fingerprint(input) {
    const sourcePath = absoluteInputPath(input.path, "input.path");
    const mode = input.mode ?? "quick";
    if (mode !== "quick" && mode !== "full") {
      throw helperError("INVALID_REQUEST", "input.mode must be quick or full");
    }
    const fileStat = await fs.promises.stat(sourcePath);
    if (!fileStat.isFile()) throw helperError("NOT_A_FILE", "fingerprint source is not a file");
    const hash =
      mode === "full" ? await fullHash(sourcePath) : await quickHash(sourcePath, fileStat.size);
    return {
      mode,
      algorithm: mode === "full" ? "sha256-v1" : "sha256-size-head-tail-v1",
      sizeBytes: fileStat.size,
      hash: `sha256:${hash}`,
    };
  },
};

const quickHash = async (sourcePath, sizeBytes) => {
  const file = await fs.promises.open(sourcePath, "r");
  try {
    const chunkLength = Math.min(QUICK_HASH_CHUNK_BYTES, sizeBytes);
    const head = Buffer.alloc(chunkLength);
    const tail = Buffer.alloc(chunkLength);
    if (chunkLength > 0) {
      await file.read(head, 0, chunkLength, 0);
      await file.read(tail, 0, chunkLength, Math.max(0, sizeBytes - chunkLength));
    }
    return crypto
      .createHash("sha256")
      .update(String(sizeBytes))
      .update("\0")
      .update(head)
      .update(tail)
      .digest("hex");
  } finally {
    await file.close();
  }
};

const fullHash = (sourcePath) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(sourcePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });

const runExecutable = (executable, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: { ...process.env, LC_ALL: "C" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    const timeout = setTimeout(() => {
      child.kill();
      reject(helperError("COMMAND_TIMEOUT", `${path.basename(executable)} timed out`));
    }, 30_000);
    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_LINE_BYTES) {
        child.kill();
        reject(helperError("OUTPUT_TOO_LARGE", `${executable} produced too much output`));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (code === 0) resolve({ stdout: stdoutText, stderr: stderrText });
      else
        reject(
          helperError(
            "COMMAND_FAILED",
            `${path.basename(executable)} failed: ${stderrText.trim()}`,
          ),
        );
    });
  });

const runJsonLinesServer = () => {
  const lines = readline.createInterface({
    input: process.stdin,
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  lines.on("line", async (line) => {
    let request;
    try {
      if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
        throw helperError("INVALID_REQUEST", "request line is too large");
      }
      request = JSON.parse(line);
      writeResponse(await executeHelperRequest(request));
    } catch (error) {
      writeResponse(errorResponse(request?.id, error));
    }
  });
};

const writeResponse = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

const parseKeyValueOutput = (value) => {
  const result = new Map();
  for (const line of value.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    result.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return result;
};

const parseDfMountPoint = (value) => {
  const lines = value.trim().split(/\r?\n/);
  const row = lines.at(-1);
  const match = /^(?:\S+\s+){4}\d+%\s+(.+)$/.exec(row ?? "");
  if (!match || !path.isAbsolute(match[1])) {
    throw helperError("VOLUME_NOT_FOUND", "df did not return a mount point");
  }
  return match[1];
};

const volumeRelativePathFor = (sourcePath, mountPoint) => {
  const relative = path.relative(mountPoint, sourcePath);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return relative.normalize("NFC");
  }
  // macOS presents the writable Data volume at logical paths such as /Users,
  // while df reports its physical mount at /System/Volumes/Data.
  if (mountPoint === "/System/Volumes/Data" && !sourcePath.startsWith("/System/Volumes/")) {
    return path.relative("/", sourcePath).normalize("NFC");
  }
  throw helperError("VOLUME_NOT_FOUND", "source path is outside the detected mount point");
};

const absoluteInputPath = (value, label) => {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) {
    throw helperError("INVALID_REQUEST", `${label} must be an absolute path`);
  }
  return path.normalize(value).normalize("NFC");
};

const integerInRange = (value, min, max, label) => {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw helperError("INVALID_REQUEST", `${label} must be an integer from ${min} to ${max}`);
  }
  return value;
};

const requireMacOS = (command) => {
  if (process.platform !== "darwin") {
    throw helperError("UNSUPPORTED_PLATFORM", `${command} currently requires macOS`);
  }
};

const nullableNumber = (value) => {
  if (value == null || value === "<nil>") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const nullableValue = (value) => (value == null || value === "<nil>" ? null : value);
const helperError = (code, message) => Object.assign(new Error(message), { code });

if (require.main === module) runJsonLinesServer();

module.exports = {
  executeHelperRequest,
  fullHash,
  parseDfMountPoint,
  parseKeyValueOutput,
  quickHash,
  runJsonLinesServer,
  volumeRelativePathFor,
};
