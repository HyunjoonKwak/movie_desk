import type { ID, LivePhotoLink, MediaAsset } from "@movie-desk/core";

export interface MediaImportCandidate {
  readonly file: File;
  readonly relativePath: string;
}

export interface CollectedMediaFiles {
  readonly candidates: readonly MediaImportCandidate[];
  readonly unreadablePaths: readonly string[];
}

export interface PlannedLivePhotoLink extends Omit<LivePhotoLink, "pairId"> {
  readonly pairKey: string;
}

interface DroppedEntry {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly name: string;
  readonly fullPath?: string;
}

interface DroppedFileEntry extends DroppedEntry {
  file(success: (file: File) => void, failure?: (error: DOMException) => void): void;
}

interface DroppedDirectoryReader {
  readEntries(
    success: (entries: readonly DroppedEntry[]) => void,
    failure?: (error: DOMException) => void,
  ): void;
}

interface DroppedDirectoryEntry extends DroppedEntry {
  createReader(): DroppedDirectoryReader;
}

const MEDIA_EXTENSIONS = new Set([
  "aac",
  "aif",
  "aiff",
  "flac",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "m4a",
  "m4v",
  "mov",
  "mp3",
  "mp4",
  "png",
  "tif",
  "tiff",
  "wav",
  "webm",
]);

const STILL_EXTENSIONS = new Set(["heic", "heif", "jpeg", "jpg"]);

const extensionOf = (name: string): string => {
  const match = /\.([^.]+)$/.exec(name);
  return match?.[1]?.toLocaleLowerCase("en-US") ?? "";
};

export const isSupportedMediaFile = (file: Pick<File, "name" | "type">): boolean =>
  /^(video|audio|image)\//.test(file.type.toLocaleLowerCase("en-US")) ||
  MEDIA_EXTENSIONS.has(extensionOf(file.name));

const normalizedRelativePath = (value: string, fallback: string): string => {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "").normalize("NFC");
  return normalized || fallback.normalize("NFC");
};

export const toMediaImportCandidate = (
  file: File,
  relativePath?: string,
): MediaImportCandidate => ({
  file,
  relativePath: normalizedRelativePath(
    relativePath || file.webkitRelativePath || file.name,
    file.name,
  ),
});

const readFileEntry = (entry: DroppedFileEntry): Promise<File> =>
  new Promise((resolve, reject) => entry.file(resolve, reject));

const readDirectory = async (entry: DroppedDirectoryEntry): Promise<readonly DroppedEntry[]> => {
  const reader = entry.createReader();
  const result: DroppedEntry[] = [];
  while (true) {
    const batch = await new Promise<readonly DroppedEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) return result;
    result.push(...batch);
  }
};

const entryFromItem = (item: DataTransferItem): DroppedEntry | null => {
  const getEntry = (
    item as DataTransferItem & {
      webkitGetAsEntry?: () => DroppedEntry | null;
    }
  ).webkitGetAsEntry;
  return typeof getEntry === "function" ? getEntry.call(item) : null;
};

export const collectDroppedMediaFiles = async (
  transfer: Pick<DataTransfer, "files" | "items">,
): Promise<CollectedMediaFiles> => {
  const roots = Array.from(transfer.items).map(entryFromItem).filter(Boolean) as DroppedEntry[];
  if (roots.length === 0) {
    return {
      candidates: Array.from(transfer.files)
        .filter(isSupportedMediaFile)
        .map((file) => toMediaImportCandidate(file)),
      unreadablePaths: [],
    };
  }

  const queue = [...roots];
  const result: MediaImportCandidate[] = [];
  const unreadablePaths: string[] = [];
  while (queue.length > 0) {
    const entry = queue.shift();
    if (!entry) continue;
    if (entry.isDirectory) {
      try {
        queue.push(...(await readDirectory(entry as DroppedDirectoryEntry)));
      } catch {
        unreadablePaths.push(entry.fullPath ?? entry.name);
      }
      continue;
    }
    if (!entry.isFile) continue;
    try {
      const file = await readFileEntry(entry as DroppedFileEntry);
      if (isSupportedMediaFile(file)) {
        result.push(toMediaImportCandidate(file, entry.fullPath ?? file.name));
      }
    } catch {
      unreadablePaths.push(entry.fullPath ?? entry.name);
    }
  }
  return {
    candidates: result.sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    ),
    unreadablePaths,
  };
};

export const planLivePhotoLinks = (
  candidates: readonly MediaImportCandidate[],
): ReadonlyMap<number, PlannedLivePhotoLink> => {
  const groups = new Map<string, { still: number[]; motion: number[] }>();
  candidates.forEach((candidate, index) => {
    const extension = extensionOf(candidate.file.name);
    const role = STILL_EXTENSIONS.has(extension) ? "still" : extension === "mov" ? "motion" : null;
    if (!role) return;
    const relativePath = normalizedRelativePath(candidate.relativePath, candidate.file.name);
    const slash = relativePath.lastIndexOf("/");
    const directory = slash >= 0 ? relativePath.slice(0, slash + 1) : "";
    const name = slash >= 0 ? relativePath.slice(slash + 1) : relativePath;
    const stem = name.slice(0, Math.max(0, name.length - extension.length - 1));
    const pairKey = `${directory}${stem}`.normalize("NFC").toLocaleLowerCase("en-US");
    const group = groups.get(pairKey) ?? { still: [], motion: [] };
    group[role].push(index);
    groups.set(pairKey, group);
  });

  const links = new Map<number, PlannedLivePhotoLink>();
  for (const [pairKey, group] of groups) {
    if (group.still.length !== 1 || group.motion.length !== 1) continue;
    links.set(group.still[0]!, { pairKey, role: "still" });
    links.set(group.motion[0]!, { pairKey, role: "motion" });
  }
  return links;
};

export const linkImportedLivePhotos = (
  imported: readonly { readonly asset: MediaAsset; readonly candidateIndex: number }[],
  plan: ReadonlyMap<number, PlannedLivePhotoLink>,
  createPairId: () => ID,
): readonly MediaAsset[] => {
  const successfulRoles = new Map<string, Set<LivePhotoLink["role"]>>();
  for (const item of imported) {
    const link = plan.get(item.candidateIndex);
    if (!link) continue;
    const roles = successfulRoles.get(link.pairKey) ?? new Set<LivePhotoLink["role"]>();
    roles.add(link.role);
    successfulRoles.set(link.pairKey, roles);
  }

  const pairIds = new Map<string, ID>();
  for (const [pairKey, roles] of successfulRoles) {
    if (roles.has("still") && roles.has("motion")) pairIds.set(pairKey, createPairId());
  }

  return imported.map((item) => {
    const link = plan.get(item.candidateIndex);
    const pairId = link ? pairIds.get(link.pairKey) : undefined;
    return pairId && link ? { ...item.asset, livePhoto: { pairId, role: link.role } } : item.asset;
  });
};
