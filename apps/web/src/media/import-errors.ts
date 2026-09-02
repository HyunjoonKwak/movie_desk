import { newId } from "@movie-desk/core";
import type { MediaImportCandidate } from "./folder-import";

export type MediaImportFailureCode =
  | "unsupported-media"
  | "damaged-file"
  | "storage-full"
  | "permission-denied"
  | "source-missing"
  | "desktop-required"
  | "unknown";

export interface MediaImportFailure {
  readonly id: string;
  readonly candidate: MediaImportCandidate;
  readonly code: MediaImportFailureCode;
  readonly retryable: boolean;
}

const readErrorFact = (error: unknown, key: "code" | "name" | "message"): string => {
  if (!error || typeof error !== "object" || !(key in error)) return "";
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
};

export const classifyMediaImportError = (
  error: unknown,
): Pick<MediaImportFailure, "code" | "retryable"> => {
  const systemCode = readErrorFact(error, "code").toLocaleUpperCase("en-US");
  const name = readErrorFact(error, "name");
  const message = readErrorFact(error, "message").toLocaleLowerCase("en-US");

  if (systemCode === "DESKTOP_REQUIRED") return { code: "desktop-required", retryable: false };
  if (
    systemCode === "UNSUPPORTED_FORMAT" ||
    systemCode === "UNSUPPORTED_MEDIA" ||
    systemCode === "UNSUPPORTED_CODEC"
  ) {
    return { code: "unsupported-media", retryable: false };
  }
  if (
    systemCode === "QUOTA_EXCEEDED" ||
    systemCode === "ENOSPC" ||
    systemCode === "EDQUOT" ||
    name === "QuotaExceededError" ||
    /quota|no space left|disk full/.test(message)
  ) {
    return { code: "storage-full", retryable: true };
  }
  if (
    systemCode === "PERMISSION_DENIED" ||
    systemCode === "EACCES" ||
    systemCode === "EPERM" ||
    ["NotAllowedError", "NotReadableError", "SecurityError"].includes(name)
  ) {
    return { code: "permission-denied", retryable: true };
  }
  if (
    systemCode === "SOURCE_NOT_FOUND" ||
    systemCode === "NOT_A_FILE" ||
    systemCode === "ENOENT" ||
    name === "NotFoundError"
  ) {
    return { code: "source-missing", retryable: true };
  }
  if (
    systemCode === "DECODE_FAILED" ||
    systemCode === "PREVIEW_FAILED" ||
    ["DataError", "EncodingError"].includes(name) ||
    /corrupt|could not be decoded|decode failed/.test(message)
  ) {
    return { code: "damaged-file", retryable: false };
  }
  return { code: "unknown", retryable: true };
};

export const createMediaImportFailure = (
  candidate: MediaImportCandidate,
  error: unknown,
): MediaImportFailure => ({
  id: newId(),
  candidate,
  ...classifyMediaImportError(error),
});
