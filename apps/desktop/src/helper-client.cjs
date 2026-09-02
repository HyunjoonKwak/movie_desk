const crypto = require("node:crypto");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const { HELPER_PROTOCOL_VERSION } = require("./helper-protocol.cjs");

const MAX_RESPONSE_LINE_BYTES = 1024 * 1024;

class MediaHelperClient {
  #child;
  #lines;
  #pending = new Map();
  #closed = false;

  constructor({
    executable = process.execPath,
    script = path.join(__dirname, "media-helper.cjs"),
  } = {}) {
    const env = { ...process.env };
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
    this.#child = spawn(executable, [script], { env, stdio: ["pipe", "pipe", "pipe"] });
    this.#lines = readline.createInterface({
      input: this.#child.stdout,
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    this.#lines.on("line", (line) => this.#onLine(line));
    // Command errors use structured stdout responses. Drain unexpected runtime
    // diagnostics so a noisy child can never block on a full stderr pipe.
    this.#child.stderr.resume();
    this.#child.on("error", (error) => this.#failAll(error));
    this.#child.on("exit", (code) => {
      if (!this.#closed) this.#failAll(new Error(`media helper exited with code ${code}`));
    });
  }

  request(command, input, { timeoutMs = 30_000 } = {}) {
    if (this.#closed) return Promise.reject(new Error("media helper is closed"));
    const id = crypto.randomUUID();
    const request = { version: HELPER_PROTOCOL_VERSION, id, command, input };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`media helper timed out running ${command}`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timeout });
      this.#child.stdin.write(`${JSON.stringify(request)}\n`);
    });
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#lines.close();
    this.#child.stdin.end();
    await new Promise((resolve) => {
      if (this.#child.exitCode !== null) resolve();
      else this.#child.once("exit", resolve);
    });
    this.#failAll(new Error("media helper is closed"));
  }

  #onLine(line) {
    let response;
    try {
      if (Buffer.byteLength(line) > MAX_RESPONSE_LINE_BYTES) {
        throw new Error("media helper response is too large");
      }
      response = JSON.parse(line);
    } catch {
      this.#failAll(new Error("media helper returned invalid JSON"));
      return;
    }
    const pending = this.#pending.get(response.id);
    if (!pending) return;
    this.#pending.delete(response.id);
    clearTimeout(pending.timeout);
    if (response.version !== HELPER_PROTOCOL_VERSION) {
      pending.reject(new Error(`unsupported media helper response version: ${response.version}`));
    } else if (response.ok) {
      pending.resolve(response.result);
    } else {
      const error = new Error(response.error?.message ?? "media helper failed");
      error.code = response.error?.code ?? "HELPER_ERROR";
      pending.reject(error);
    }
  }

  #failAll(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

module.exports = { MediaHelperClient };
