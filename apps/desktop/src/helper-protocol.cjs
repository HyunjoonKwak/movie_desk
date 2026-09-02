const HELPER_PROTOCOL_VERSION = 1;
const HELPER_COMMANDS = new Set(["volume-resolve", "inspect", "preview", "fingerprint"]);

const validateHelperRequest = (value) => {
  if (!isRecord(value)) throw protocolError("request must be an object");
  if (value.version !== HELPER_PROTOCOL_VERSION) {
    throw protocolError(`unsupported helper protocol version: ${value.version}`);
  }
  if (typeof value.id !== "string" || value.id.length === 0 || value.id.length > 128) {
    throw protocolError("request.id must be a non-empty string of at most 128 characters");
  }
  if (!HELPER_COMMANDS.has(value.command)) {
    throw protocolError(`unsupported helper command: ${value.command}`);
  }
  if (!isRecord(value.input)) throw protocolError("request.input must be an object");
  return value;
};

const successResponse = (request, result) => ({
  version: HELPER_PROTOCOL_VERSION,
  id: request.id,
  ok: true,
  result,
});

const errorResponse = (id, error) => ({
  version: HELPER_PROTOCOL_VERSION,
  id: typeof id === "string" ? id : "unknown",
  ok: false,
  error: {
    code: typeof error?.code === "string" ? error.code : "HELPER_ERROR",
    message: error?.message ?? String(error),
  },
});

const protocolError = (message) => Object.assign(new Error(message), { code: "INVALID_REQUEST" });
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

module.exports = {
  HELPER_COMMANDS,
  HELPER_PROTOCOL_VERSION,
  errorResponse,
  successResponse,
  validateHelperRequest,
};
