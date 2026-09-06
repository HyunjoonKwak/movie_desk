import { useProjectStore } from "@/stores/project-store";
import { recordRecovery, funnelEnabled } from "./collector";

const episodes = new Map<string, ReturnType<typeof recordRecovery>>();
export const trackImportRetry = async (
  retry: () => Promise<void>,
  assets: number,
): Promise<void> => {
  if (!funnelEnabled()) {
    await retry();
    return;
  }
  const project = useProjectStore.getState().project;
  const measurement =
    episodes.get(project.id) ?? recordRecovery("import-retry", assets, null, project.id);
  episodes.set(project.id, measurement);
  try {
    await retry();
    if (useProjectStore.getState().project.id === project.id) {
      measurement.resolve(
        Math.max(
          0,
          useProjectStore.getState().project.mediaLibrary.length - project.mediaLibrary.length,
        ),
      );
      if (measurement.finished) episodes.delete(project.id);
    }
  } catch {
    /* Existing import UI owns its errors; unresolved attempts stay pending. */
  }
};
export const abandonImportFailures = (count: number): void => {
  const id = useProjectStore.getState().project.id;
  if (count > 0) (episodes.get(id) ?? recordRecovery("import-retry", count, null, id)).abandon();
  episodes.delete(id);
};
