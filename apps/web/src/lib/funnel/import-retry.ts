import { useProjectStore } from "@/stores/project-store";
import { useImportFailureStore } from "@/media/import-failure-store";
import { recordRecovery, funnelEnabled } from "./collector";

export const trackImportRetry = async (retry: () => Promise<void>): Promise<void> => {
  if (!funnelEnabled()) {
    await retry();
    return;
  }
  const project = useProjectStore.getState().project;
  const failures = useImportFailureStore.getState().failures.length;
  recordRecovery("import-retry", "pending", project.id);
  try {
    await retry();
    if (
      useProjectStore.getState().project.id === project.id &&
      useProjectStore.getState().project.mediaLibrary.length > project.mediaLibrary.length &&
      useImportFailureStore.getState().failures.length === failures
    ) {
      recordRecovery("import-retry", "success", project.id);
    }
  } catch {
    /* Existing import UI owns its errors; unresolved attempts stay pending. */
  }
};
export const abandonImportFailures = (count: number): void => {
  if (count > 0) recordRecovery("import-retry", "abandoned");
};
