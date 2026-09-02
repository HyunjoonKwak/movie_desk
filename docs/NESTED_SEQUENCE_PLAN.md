# 중첩 시퀀스 구현 계획

작성 2026-07-30 · 대상 main

README의 "2~3일 MVP" 견적을 코드 조사로 재검증한 결과다. **그 견적은 성립하지 않는다.**
컴포지터가 재진입 불가능하게 설계돼 있고, `Timeline`에 id가 없으며, 사이클 방어 코드가 전무하다.
7단계로 나누고 각 단계를 독립 배포 가능한 단위로 잡는다.

---

## 왜 견적이 깨지는가 — 세 가지 구조적 장애물

### 1. `Timeline`에 id가 없다

`packages/core/src/model/project.ts:12-18`의 `Timeline`은 `{tracks, playhead, zoom, duration, markers?}`뿐이고
`Project:20-29`는 `timeline: Timeline` **단수**를 갖는다.
`SequenceClip.timelineId`를 만들어도 **해석할 대상이 존재하지 않는다.**

`project.timeline` / `timeline.tracks` 직접 접근이 `apps/web`에 119개(39파일),
`packages/core`에 57개(9파일) 있다. 한 번에 고치면 폭발한다.

### 2. 컴포지터가 재진입 불가능하다

`apps/web/src/renderer/compositor.ts`가 네 가지를 하드코딩한다.

| 항목 | 위치 |
|---|---|
| 렌더 타깃 `null` | `:138`, `:197`, `:238`, `:311` |
| 프레임 크기 `gl.drawingBufferWidth/Height` | `:139`, `:198`, `:232-233`, `:261-263`, `:301-302` |
| 플레이헤드 **두 개의 독립 소스** | `renderFrame`은 `project.timeline.playhead`, `uploadClipSource:489`는 `this.playheadFn()` |
| 배경색 불투명 검정 | `:140` `clearColor(0,0,0,1)` — 자식은 `(0,0,0,0)`이어야 함 |

여기에 `ping-pong.ts:11-26`은 **정확히 2개 버퍼의 단일 상태 머신**이고,
`scratch-pool.ts:9-10` 주석이 재귀가 깨뜨릴 전제를 이미 명시하고 있다 —
*"Concurrent use of the SAME slot in one frame would alias."*

**구체적 손상**: 부모와 자식이 둘 다 `fit`을 가지면 `applyFit`(`:265`)이 양쪽 다 슬롯 1을 잡아
같은 텍스처를 읽으며 같은 FBO에 쓴다. overlay/soft-light 블렌드의 `copyTexImage2D`(`:236`)는
자식 FBO가 아니라 화면에서 복사한 뒤 `:238`에서 `null`을 바인딩해 자식 내용을 화면에 직접 합성한다.
둘 다 **조용히 화면이 깨지는** 종류다.

### 3. 사이클 방어 코드가 하나도 없다

`cycle|circular|visited|acyclic|dfs` 전수 검색 결과 의미 있는 히트 **0건**.
그런데 자식으로 내려가야 하는 독립 열거자가 **다섯 개**다.

`query.ts:20-31 clipsAt`(렌더) · `query.ts:17-18 computeDuration` ·
`export/audio-mixer.ts:271` · `preview/audio-engine.ts:164` · `preview/playhead-level.ts:21`

셋은 rAF 루프 안(`preview-viewport.tsx:109-131`)이라 사이클이 생기면 **탭이 즉시 멈춘다.**

---

## 가장 위험한 지점: CRDT가 프로젝트를 재조립한다

`persistence/project-crdt.ts:130-145`의 `candidate` 리터럴은 Yjs에서 프로젝트를 **처음부터 다시 만든다.**
반면 `persistence/project-export.ts:121-144`의 zod는 `.passthrough()`라 모르는 필드를 **통과시킨다.**

이 비대칭 때문에 `timelines` 필드는 "저장은 되지만 CRDT 왕복에서 사라지는" 상태가 된다.
`live-doc.ts:104`가 재조립본으로 `loadProject()`를 호출하고,
`project-menu.tsx:43`의 디바운스 `upsertProject`가 그 손실본을 IndexedDB에 덮어쓴다.

**원격 편집 1회 또는 새로고침 1회면 서브 시퀀스가 경고 없이 증발한다.**

게다가 `live-doc.ts:116-134`의 변경 감지가 6개 필드만 참조 비교하므로,
**비활성 타임라인에서 한 편집은 flush 자체가 안 된다** — 사용자는 저장된 줄 알고 실제로는 아무것도 저장되지 않는다.

> **철칙: zod(Phase 1)와 CRDT(Phase 7)를 같은 커밋에 넣는다. 절대 zod만 먼저 열지 않는다.**
> 그리고 `read()`가 `timelines`를 못 내보내면 명시적으로 throw 해서
> 조용한 손실을 시끄러운 실패로 바꾼다.

---

## Phase 0 — 모델 기반 (선행조건)

이것 없이는 아무것도 못 한다. 중첩 기능과 무관하게 독립 배포 가능하다.

1. `model/project.ts:12` `Timeline`에 `readonly id: ID` 추가
2. `Project`에 `readonly timelines: readonly Timeline[]` + `readonly rootTimelineId: ID` 추가.
   **`timeline`은 파생 필드로 당분간 유지** — 176개 호출부의 폭발을 막는다
3. `model/factory.ts:5-43` `createEmptyProject`가 root 타임라인을 시드
4. `timeline/mutate-internal.ts:14-18` `recompute`를 타임라인 인지형으로
   (18개 mutate 함수의 공통 관문이라 여기만 고치면 된다)
5. `query.ts`에 `findTimeline(project, id)` 추가

## Phase 1 — 클립 kind + 영속성 (원자적으로)

6. `clip.ts:138` 유니온에 `SequenceClip { kind:"sequence"; timelineId: ID; trimIn; trimOut; volume? }` + `isSequenceClip`
7. **`project-export.ts:44-83` zod `discriminatedUnion`에 5번째 variant 추가.**
   이 유니온은 **닫혀 있어** 미지의 `kind`가 오면 파싱이 통째로 실패하고
   `project-menu.tsx:102-105`가 corrupt 토스트를 띄운다 — 프로젝트가 안 열린다
8. `projectSchema:121-144`에 `timelines` 추가
9. `PROJECT_VERSION`을 2로 올리고 **실제 마이그레이션 함수 작성**
   (`project-export.ts:169-178`은 현재 버전 불일치 시 마이그레이션 없이 throw).
   IndexedDB 행에는 버전 필드가 아예 없으므로(`project-library.ts:11-16`)
   JSON 형태 추론 또는 Dexie `version(2)` 업그레이드가 필요하다

## Phase 2 — 사이클 방어 (렌더러보다 먼저)

10. 신규 `packages/core/src/timeline/sequence-graph.ts` —
    `collectSequenceRefs`, `wouldCreateCycle(project, parentId, childId)`, `sequenceDepth`, `MAX_SEQUENCE_DEPTH`
11. 삽입/이동/붙여넣기 지점에 `wouldCreateCycle` 게이트
12. `inspect.ts:26` 옆에 `missing-sequence` / `cyclic-sequence` / `depth-exceeded` 린트
13. **런타임 방문 집합도 함께 넣는다.** 편집 시 검증만으로는 부족하다 —
    CRDT 병합이 각각 합법적인 두 편집을 합쳐 사이클을 만들 수 있다
    (A가 "T1에 T2 삽입", B가 동시에 "T2에 T1 삽입").
    `clipsMap`이 평평한 전역 맵이고 id가 `nanoid(12)` 단일 네임스페이스라 실제로 성립한다
14. `computeDuration`(`query.ts:17-18`) 재귀화 — **첫 무한루프 후보**

**설계 원칙**: 사이클을 "막는" 게 아니라 "생겨도 죽지 않는" 구조여야 한다.
캡을 넘으면 검은 프레임을 반환하고 린트로 표면화한다.

## Phase 3 — 컴포지터 재진입화 (중첩과 분리해 선행 리팩터링)

이 단계만으로 하루 이상이다. **중첩 기능을 얹기 전에 기존 테스트로 회귀를 먼저 잡는다.**
`docs/02-architecture.md:16-17`의 "One compositor" 원칙 때문에
이 리팩터링은 프리뷰와 익스포트를 **동시에** 위험에 빠뜨린다.

15. `renderFrame(project, getAsset)` → `renderFrame(project, getAsset, target?, playheadMs?)`.
    `bindFramebuffer(null)` 4곳과 `drawingBuffer*` 6곳을 타깃 기준으로 치환
16. `playheadFn`(`:98-101`) 단일 클로저 제거, 플레이헤드를 인자로 스레드
17. `PingPong`을 깊이별 인스턴스로, `ScratchPool` 슬롯 인덱스를 `depth*2 + role`로
18. 자식 렌더용 FBO 풀 신설 + `clearColor(0,0,0,0)` (부모는 `(0,0,0,1)` 유지)

## Phase 4 — 재귀 렌더링

19. `uploadClip:327-341`에 `isSequenceClip` 분기.
    자식 시간 = `clip.trimIn + sourceOffsetForRamp(clip, playhead - clip.start)`.
    `speed.ts:19-30`은 `MediaClip`이 아니라 `Clip`을 받으므로 **그대로 재사용 가능**
20. `renderFrame:117-128`의 retain 집합을 **전체 타임라인 트리 순회**로 확장.
    안 하면 자식 텍스처가 매 프레임 파괴/재생성된다
    (`MAX_ASSET_TEXTURES = 24`, `MAX_TEXT_TEXTURES = 64`)

## Phase 5 — 오디오 (3곳, 각각 독립)

21. `export/audio-mixer.ts:261-274` — 자식 클립 `start`를 `parent.start - parent.trimIn`만큼 오프셋,
    `[parent.start, parent.start+parent.duration]`로 클리핑
22. `preview/audio-engine.ts:164` 게이트 재귀화
23. `preview/playhead-level.ts:21` 게이트 재귀화

## Phase 6 — 편집 시맨틱 + UI

24. `split.ts:31-33`, `three-point.ts:72`, `mutate-edit.ts:190-196/220-227/246`의
    `isMediaClip` 게이트를 "trimIn을 가진 클립" 개념으로 일반화
25. `timeline-panel.tsx:155` 위에 탭 스트립. `TimelinePanel`에 `timelineId` prop
    (현재 props 없이 모듈 스토어에서 직접 읽는다)
26. **활성 타임라인 id는 `Project` 밖의 UI 스토어에 둔다** —
    안 그러면 undo가 탭 전환까지 되돌린다
27. `clip-context-menu.tsx:57` 뒤에 "컴파운드 만들기".
    다중 선택이 필요하므로 `:24`에서 `clipIds`도 읽어야 한다
28. `timeline-clip.tsx:109-118` 드롭 호환성(현재 시퀀스는 "not media"로 분류되어
    text/overlay 트랙에만 놓인다), `:152-158` 색상, `:185` 라벨

## Phase 7 — 영속화 문서 스키마 (Phase 1과 같은 커밋)

(2026-09-02: 실시간 협업은 제거됐고 `yjs-bridge.ts`는 `persistence/live-doc.ts`로
옮겨졌다. 아래 줄 번호는 옮기기 전 기준이다.)

29. `project-crdt.ts:43-50` 루트 핸들을 타임라인별 네임스페이스로
    (`clipOrderFor:50`의 동적 루트 네이밍이 템플릿)
30. `PROJECT_CRDT_SCHEMA_VERSION`을 3으로 + v2→v3 마이그레이션
    (`live-doc.ts:150-165`가 유일한 선례)
31. `read()`의 `candidate` 리터럴(`:130-145`)이 `timelines`를 내보내도록
32. **`live-doc.ts:116-134`와 `project-menu.tsx:53-61`의 6-필드 참조 비교 확장**
33. `clipsMap` 키 충돌 방지 — 타임라인 스코프 프리픽스

---

## 좋은 소식

**undo는 이미 공짜다.** `commands/history.ts:23-44`가 `{before, after}` 전체 Project 스냅샷을
저장하므로 N개 타임라인 undo/redo가 구조적으로 동작한다.

**`clip.kind`에 대한 `switch` 문이 코드베이스에 하나도 없다.** 전부 `if`/삼항이라
새 variant 추가가 컴파일 에러를 일으키지 않는다 — 양날이지만 점진적 적용에는 유리하다.

**`speed.ts`의 시간 변환 함수 세 개가 `Clip` 유니온 전체를 받는다.** 그대로 재사용된다.
