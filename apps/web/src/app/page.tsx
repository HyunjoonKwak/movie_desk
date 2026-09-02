import Link from "next/link";
import {
  ArrowRight,
  Check,
  Film,
  FolderInput,
  ListChecks,
  LockKeyhole,
  Sparkles,
  WandSparkles,
} from "lucide-react";

const features = [
  {
    icon: FolderInput,
    title: "던지면 정리",
    body: "폴더째 넣으면 촬영 시간과 장소로 묶고, 흔들리거나 노출이 나쁜 장면을 골라냅니다.",
  },
  {
    icon: ListChecks,
    title: "방향을 제안",
    body: "사용할 수 있는 분량과 이야기 흐름을 분석해 영상 모드, 길이, 구성 이유를 제안합니다.",
  },
  {
    icon: WandSparkles,
    title: "초안은 AI, 결정은 내가",
    body: "AI가 러프컷을 만들면 장면을 살리거나 빼고 직접 마무리합니다. 모든 작업은 내 기기에 남습니다.",
  },
];

export default function HomePage() {
  return (
    <main className="landing-surface relative h-full overflow-y-auto">
      <div className="landing-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg border border-line-strong bg-panel-2 text-accent">
              <Film className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold tracking-[0.16em] text-ink-1">MOVIE DESK</p>
              <p className="mt-0.5 text-3xs uppercase tracking-[0.16em] text-ink-3">
                Personal film workspace
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-md border border-ok/25 bg-ok/[0.06] px-3 py-1.5 text-2xs text-ok sm:flex">
            <LockKeyhole className="size-3" />
            Local AI · No upload
          </div>
        </header>

        <section className="grid items-center gap-14 pb-16 pt-20 lg:grid-cols-[1.15fr_0.85fr] lg:pb-24 lg:pt-28">
          <div className="max-w-3xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-md border border-line-strong bg-panel-2 px-3 py-1.5 text-2xs font-medium text-ink-2">
              <Sparkles className="size-3 text-accent" />
              편집을 시작하기 가장 쉬운 방법
            </div>
            <h1 className="text-balance text-5xl font-semibold leading-[1.05] tracking-[-0.04em] text-ink-1 md:text-7xl">
              흩어진 순간을
              <br />한 편의{" "}
              <span className="bg-gradient-to-r from-accent-hover to-indigo-300 bg-clip-text text-transparent">
                영화
              </span>
              로.
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-7 text-ink-2 md:text-lg md:leading-8">
              편집을 몰라도 괜찮습니다. 영상을 넣으면 Movie Desk가 정리하고 방향을 제안하고 초안까지
              만듭니다. 최종 결정은 내가 하고, 영상은 내 기기를 떠나지 않습니다.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/editor" className="btn-primary min-h-11 px-5 text-sm">
                편집 시작
                <ArrowRight className="size-4" />
              </Link>
              <a
                href="#workflow"
                className="btn-ghost min-h-11 border border-line-strong px-5 text-sm"
              >
                작동 방식
              </a>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-md lg:mx-0 lg:justify-self-end">
            <div className="absolute -inset-10 rounded-full bg-accent/[0.08] blur-3xl" />
            <div className="landing-card relative overflow-hidden rounded-lg p-3">
              <div className="flex items-center justify-between border-b border-line px-2 pb-3 pt-1">
                <div className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-red-400/70" />
                  <span className="size-2 rounded-full bg-amber-300/70" />
                  <span className="size-2 rounded-full bg-emerald-400/70" />
                </div>
                <span className="text-3xs uppercase tracking-[0.18em] text-ink-3">
                  AI FIRST CUT
                </span>
              </div>
              <div className="space-y-2 p-2 pt-4">
                {features.map(({ icon: Icon, title }, index) => (
                  <div
                    key={title}
                    className="flex items-center gap-3 rounded-lg border border-line bg-panel-1 p-3"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-panel-3 text-accent">
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-meta font-medium text-ink-1">{title}</span>
                        <Check className="size-3.5 text-ok" />
                      </div>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-panel-0">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-accent to-accent-hover"
                          style={{ width: `${72 + index * 11}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mx-2 mb-2 mt-1 flex items-center justify-between rounded-md bg-accent px-4 py-3 text-meta font-semibold text-white">
                <span>여행 하이라이트 · 03:42</span>
                <span>초안 준비됨</span>
              </div>
            </div>
          </div>
        </section>

        <section
          id="workflow"
          className="grid scroll-mt-8 gap-4 border-t border-line py-12 md:grid-cols-3 md:py-16"
        >
          {features.map(({ icon: Icon, title, body }, index) => (
            <div key={title} className="landing-card group rounded-lg p-6">
              <div className="flex items-start justify-between">
                <span className="flex size-10 items-center justify-center rounded-lg border border-line-strong bg-panel-1 text-accent transition-colors group-hover:bg-panel-2">
                  <Icon className="size-5" />
                </span>
                <span className="font-mono text-2xs text-ink-3">0{index + 1}</span>
              </div>
              <h3 className="mt-6 text-base font-semibold text-ink-1">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-ink-2">{body}</p>
            </div>
          ))}
        </section>

        <footer className="flex flex-col gap-2 border-t border-line py-8 text-2xs text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <span>AI drafts. You decide.</span>
          <span>모든 분석과 저장은 내 기기에서 처리됩니다.</span>
        </footer>
      </div>
    </main>
  );
}
