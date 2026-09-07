import { createEmptyProject, toLegacyProject } from "@movie-desk/core";
import { expect, it, vi } from "vitest";
import { toast } from "sonner";
import { parseStoredProject } from "@/persistence/project-io";
import { useLocaleStore } from "@/i18n/store";
import { useProjectStore } from "../project-store";
vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));
it.each(["ko", "en"] as const)(
  "shows one recovery notice on actual project load in %s",
  (locale) => {
    vi.mocked(toast.warning).mockClear();
    useLocaleStore.setState({ locale });
    const base = createEmptyProject();
    const project = parseStoredProject({
      ...toLegacyProject(base),
      audio: { buses: [], master: { gainDb: 100 } },
    });
    expect(toast.warning).not.toHaveBeenCalled();
    useProjectStore.getState().loadProject(project);
    expect(useProjectStore.getState().project).toEqual(base);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith(
      locale === "ko"
        ? "오디오 믹서 설정을 읽을 수 없어 기본값으로 프로젝트를 열었습니다."
        : "The audio mixer settings could not be read; the project opened with defaults.",
      { id: `audio-recovery:${base.id}` },
    );
    useProjectStore.getState().loadProject(project);
    expect(toast.warning).toHaveBeenCalledTimes(1);
  },
);
