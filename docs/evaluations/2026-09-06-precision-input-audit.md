# B'1 프레임·수치 정밀 입력 감사

기준: `main 07d5d33`, 2026-09-06. 아래 표는 **구현 전 코드 감사**다. 전문 편집기 기둥의 정밀도와 되돌리기 예측 가능성을 개선하며, 기존 슬라이더와 로컬 원본을 유지한다. 첫 경로는 슬라이더, 정확한 수정은 옆 입력으로 제공한다.

## 입력 전수표

공통: NumberScrubber는 더블클릭/Enter로 숫자를 입력하고 blur/Enter에 커밋한다. 드래그는 Shift ×10/Alt ÷10, 화살표는 기본 step/Shift ×10이며 Alt는 누락됐다. parseFloat 때문에 `12garbage`도 승인하고 범위 밖 값은 안내 없이 clamp한다. 숫자 라벨과 오류 안내가 없다. HTML range/number는 브라우저 기본 화살표만 제공하고 Shift/Alt 규약이 없다.

| 표면·편집 값 | 현재 입력·단위·스냅 | 정밀도 | undo 단위 | 일관성 결함 / 우선순위 |
| --- | --- | --- | --- | --- |
| 인스펙터 클립 시작 | NumberScrubber, ms, step 10; 저장 시 fps 스냅 | 프로젝트 frame | 드래그/입력 1회 | 타임코드 입력 없음, 10ms와 frame 혼재 / P0 |
| 클립 길이 | NumberScrubber, ms, step 10; 스냅 없음 | 1ms 하한, 실수 저장 | 드래그/입력 1회 | 시작과 다른 그리드 / P0 |
| 소스 trimIn/trimOut | slip 슬라이더로 in 이동, out 직접 입력 없음 | 10ms, 소스 범위 clamp | onChange마다 | 트림과 슬립 구분·직접 입력 부족 / P0 |
| 클립 속도 | 정보 숫자 0.1–8×/0.01, 속도 섹션 slider 0.1–4×/0.05와 프리셋 | 배율 0.01 또는 0.05 | 숫자 1회, slider 이벤트마다 | 범위·증분 불일치 / P0 |
| 변형 X/Y | 숫자+slider, -1–1 중심 기준 비율 | 0.01(드래그 Alt 0.001) | history 우회(undo 없음) | 단위 설명 없음, px 입력 아님 / P0 |
| 크기·회전·투명도 | 숫자+slider, 배율 0.1–4, 도 -180–180(저장 rad), 비율 0–1 | 0.01 / 1도 / 0.01 | history 우회(undo 없음) | 표시 반올림, undo 미기록 / P0 |
| 오디오 볼륨 | slider 0–2, % 읽기 표시 | 0.01배=1% | history 우회(undo 없음) | 직접 입력 없음 / P1 |
| 오디오 페이드 | audio-fade 효과의 fadeInMs/fadeOutMs slider (0–5000ms, step 50) 또는 volume 키프레임 | 50ms 또는 그래프 연속 값 | 효과는 history 우회, graph 이동마다 | 수치/시간 편집 부족 / P1 |
| 효과 숫자 전체 | 효과 registry의 p.min/max/step slider, 값 읽기 표시 | 효과별 step (양/반경/각도 등) | history 우회(undo 없음) | 직접 수치 입력 없음 / P1 |
| 효과 색·boolean·선택·LUT | color/checkbox/select/file 선택 | 이산값·색상 | 파라미터 history 우회 | 이번 숫자 범위 외 |
| 마스크 X/Y/W/H/feather | slider, 비율 step 0.01; 종류/반전 선택 | 0.01 | 이벤트마다 | 숫자 입력 없음 / P1 |
| 텍스트 크기·외곽선·그림자 blur | slider, px 정수 | 1px | 이벤트마다 | 직접 입력 없음 / P1 |
| 텍스트 내용·폰트·굵기·정렬·색·애니메이션 | text/select/button/color; 애니 시간 number ms step 50 | 문자열/이산값/50ms | 입력·이벤트마다 | 텍스트 매 글자 undo, 애니 frame 미스냅 / P2 |
| 도형 stroke·corner·gradient angle | slider, px/도 step 1; 종류·fill·색 선택 | 1px/1도 | 이벤트마다 | 직접 입력 없음 / P1 |
| 전환 in/out 유형·길이 | select + number ms step 50 | 50ms, 최소 50ms | 입력 이벤트마다 | frame 미스냅 / P1 |
| 키프레임 시각·값·easing·Bezier | 플레이헤드에 추가, SVG 값 수직 드래그; easing select, Bezier number step .05 | 시각 정수 ms, 값 연속 | 이동/입력 이벤트마다 | 시각·값 직접 입력 없음; 33ms 키 탐색 고정 / P0 |
| 타임라인 위치·트랙 | 드래그+자석, 프로젝트 frame 스냅; 트랙 버튼/이름/음소거·잠금 | frame, 트랙 이산 | move 세션 1회 | 트림과 undo 규약 다름 / P1 |
| 타임라인 trim start/end | 양끝 핸들 드래그, px/zoom→ms, 최소 50ms | 연속 ms | 이동마다 | frame 미스냅, 원본 trim 필드와 별도 / P1 |
| 마커 시각·라벨·색 | 플레이헤드에 추가, 클릭 이동, 라벨 text/color; 시각 수정 UI 없음 | ms 저장, 목록 초 표시 | 추가/글자/색마다 | frame 정보 손실, 직접 시간 입력 없음 / P1 |
| 플레이헤드·트랜스포트 | 룰러/플레이헤드 드래그·시작/끝 버튼·키보드 탐색, HH:MM:SS:FF 표시만 | ms 및 frame 탐색 | transient, undo 없음 | 타임코드 직접 입력 없음 / P0 |
| 내보내기 in/out 범위 | 플레이헤드 I/O 단축키·range-band, 직접 필드 없음 | ms | transient, undo 없음 | 정확한 범위 입력 없음 / P1 |
| 타임라인 zoom | zoom 컨트롤/fit | px/ms | transient | 시간 입력과 다른 뷰 설정, 범위 외 |
| 내보내기 프리셋·정규화·ducking | preset/checkbox/LUFS select | 이산값 | 로컬 설정, undo 없음 | 범위 외 |

근거: `components/number-scrubber.tsx`, `editor/*-section.tsx`, `editor/keyframe-graph.tsx`, `editor/marker-panel.tsx`, `preview/transport-bar.tsx`, `timeline/components/{timeline-clip,timeline-ruler,range-band,marker-strip}.tsx`, `stores/{project-store,range-store,store-helpers}.ts`, `stores/actions/keyframe-actions.ts`, `packages/core/src/{utils/time,timeline/mutate-core,timeline/mutate-keyframe}.ts`。

## 선택한 구현 범위

P0 공용 커밋형 숫자/시간 입력, 인스펙터 시작·길이·소스 트림·속도·변형, 키프레임 값, 플레이헤드 타임코드 입력을 우선 적용한다. HH:MM:SS:FF는 기존 **non-drop-frame** 규칙(초당 표기 프레임은 round(fps), 실제 ms 변환은 프로젝트 fps)을 유지한다. 23.976/29.97에서 시계 시간과의 차이는 의도된 NDF 규칙이며 숨겨진 24/30fps 변환을 하지 않는다. 시간 필드는 Alt에서도 최소 1 frame을 유지한다.

원본 소스 트림은 타임라인 위치를 유지하고 소스 in/out 및 길이를 함께 갱신하는 한 번의 명령으로 추가한다. 이미지의 가상 소스 길이와 속도 램프는 기존 모델 의미를 따르며 별도 재설계하지 않는다. P1/P2의 나머지 입력·트림 드래그·키프레임 33ms 탐색 규약은 감사 잔여로 명시하고 이 배치를 전체 편집기 정밀 입력 완료로 표시하지 않는다.

## 효과 숫자 파라미터 세부 목록 (구현 전)

모든 행은 slider만 제공하고 `setEffectParamValue`로 history를 우회한다. 프레임 스냅·타임코드·직접 숫자·Shift/Alt 배수는 없으며, 단위가 없는 Amount 등은 효과별 정규화 수치다.

| 효과 | 키 | 표시 단위/라벨 | 범위 | step |
| --- | --- | --- | --- | --- |
| audio-eq | low | Low (dB) | -12…12 | 0.5 |
| audio-eq | mid | Mid (dB) | -12…12 | 0.5 |
| audio-eq | high | High (dB) | -12…12 | 0.5 |
| audio-fade | fadeInMs | Fade in (ms) | 0…5000 | 50 |
| audio-fade | fadeOutMs | Fade out (ms) | 0…5000 | 50 |
| audio-gain | db | Gain (dB) | -24…12 | 0.1 |
| audio-noise-gate | thresholdDb | Threshold (dB) | -80…0 | 1 |
| audio-noise-gate | rangeDb | Reduction (dB) | -80…0 | 1 |
| audio-noise-gate | attackMs | Attack (ms) | 0…100 | 1 |
| audio-noise-gate | releaseMs | Release (ms) | 10…1000 | 10 |
| audio-spectral-denoise | strength | Strength | 0…2 | 0.05 |
| audio-spectral-denoise | floor | Floor | 0…0.5 | 0.01 |
| audio-spectral-denoise | noiseEstimateMs | Noise estimate (ms) | 50…2000 | 25 |
| bg-remove | feather | Feather | 0…0.2 | 0.01 |
| brightness | amount | Amount | -1…1 | 0.01 |
| chroma-key | similarity | Similarity | 0…1 | 0.01 |
| chroma-key | smoothness | Smoothness | 0…0.5 | 0.01 |
| chroma-key | spill | Spill | 0…1 | 0.01 |
| color-wheels | liftR | Lift R | -0.5…0.5 | 0.01 |
| color-wheels | liftG | Lift G | -0.5…0.5 | 0.01 |
| color-wheels | liftB | Lift B | -0.5…0.5 | 0.01 |
| color-wheels | gammaR | Gamma R | -0.5…0.5 | 0.01 |
| color-wheels | gammaG | Gamma G | -0.5…0.5 | 0.01 |
| color-wheels | gammaB | Gamma B | -0.5…0.5 | 0.01 |
| color-wheels | gainR | Gain R | -0.5…0.5 | 0.01 |
| color-wheels | gainG | Gain G | -0.5…0.5 | 0.01 |
| color-wheels | gainB | Gain B | -0.5…0.5 | 0.01 |
| contrast | amount | Amount | -1…1 | 0.01 |
| exposure | stops | Stops | -3…3 | 0.05 |
| gaussian-blur | sigma | Sigma | 0…20 | 0.1 |
| grain | amount | Amount | 0…0.5 | 0.01 |
| hue | degrees | Degrees | -180…180 | 1 |
| invert | amount | Amount | 0…1 | 0.01 |
| levels | black | Black point | 0…0.5 | 0.01 |
| levels | white | White point | 0.5…1 | 0.01 |
| levels | gamma | Gamma | 0.2…3 | 0.01 |
| lut | intensity | Intensity | 0…1 | 0.01 |
| saturation | amount | Amount | -1…1 | 0.01 |
| sepia | amount | Amount | 0…1 | 0.01 |
| sharpen | amount | Amount | 0…2 | 0.05 |
| split-tone | amount | Amount | 0…1 | 0.01 |
| split-tone | balance | Balance | -0.5…0.5 | 0.01 |
| vibrance | amount | Amount | -1…1 | 0.01 |
| vignette | intensity | Intensity | 0…1 | 0.01 |
| vignette | softness | Softness | 0…1 | 0.01 |
| white-balance | temperature | Temperature | -1…1 | 0.01 |
| white-balance | tint | Tint | -1…1 | 0.01 |

## 1차 구현(c52851b)의 적용 결과

| 적용 표면 | 결과 | undo / 남은 제약 |
| --- | --- | --- |
| 공용 PrecisionInput | 직접 숫자·엄격한 HH:MM:SS:FF, 프로젝트 fps, 화살표/Shift/Alt, 별도 ↔ 스크럽, Enter/blur, Esc/포인터 취소, 오류 안내 | 로컬 draft → 커밋 1회, 변경 없음/거부/취소는 명령 0회 |
| 시작·길이 | fps 타임코드, 길이 최소 1frame | 커밋 1회; 타임라인 핸들 드래그 경로는 이번 범위 밖 |
| 소스 in/out | fps 타임코드, 원본 범위 거부, 시작 보존·길이 재계산 | 단일 명령; 일정 속도는 span/speed, 램프는 기존 10ms 적분의 역변환 뒤 frame 스냅 |
| 속도 | 두 인스펙터 경로 모두 0.1–8×/step .01 | 숫자/슬라이더 커밋 1회; 기존 속도 변경의 길이 정책은 유지 |
| 변형 | X/Y 중심 비율 ×W/×H, 크기/투명도 배율 ×, 회전 °; 기존 슬라이더 유지 | 숫자/슬라이더/리셋/PIP 1회; preview gizmo의 transient setTransform은 유지 |
| 키프레임 값·Bezier | 같은 입력과 파라미터 범위, 회전 °↔rad; 키 시각 선택 메뉴로 키보드 접근 | 값/Bezier/그래프 제스처 1회, easing 보존; 시각 이동은 후속 |
| 트랜스포트·마커 | 플레이헤드 타임코드 직접 입력; ruler/asset duration/마커 표시도 기존 formatter | 플레이헤드 transient; 외부 챕터 파일은 요구 형식 H:MM:SS 유지 |

범위 내 입력에는 aria-label, aria-valuetext, aria-invalid와 연결된 도움말/오류를 제공한다. 슬라이더는 기본 경로로 남고 숫자 필드는 옆에 항상 표시된다. 소스 슬립은 기존 10ms step을 유지하며 한 제스처 한 undo로 바꿨다.

## 검증 기록

- 순수 함수: 타임코드 파싱/포맷/라운드트립·시간/분/시 경계·23.976/29.97 반 프레임 반올림·잘못된 fps/형식, 숫자 파싱·Shift/Alt·클램프·빈 프레임 범위.
- store: 소스 트림 경계 거부/프레임 스냅/속도·램프 역변환, 변형 커밋과 undo 복원.
- Chromium E2E 2건: 숫자 길이 입력 → 커밋 전 타임라인 보존 → 길이 반영 → undo 한 번 복원; invalid/Esc/화살표/Shift/Alt/blur 한 번 커밋.
- 한국어 1440×900 실제 렌더 화면 확인: 시간 문자열, 단위, 숫자 필드와 기존 슬라이더가 인스펙터 안에 배치됨.
- 첫 전체 gate는 install부터 build/browsers까지 PASS, 다른 워커의 32119 포트 사용으로 E2E precondition이 차단됐다. 해당 서버를 종료하지 않고 비워진 후 전체 gate를 재실행했다. 최종 결과는 [gate 기록](2026-09-06-precision-input-gate.md)에 둔다.

`c52851b` 1차 구현 검증: `pnpm gate --report docs/evaluations/2026-09-06-precision-input-gate.md`: **9/9 PASS**, 단위 718(core 125/web 526/desktop 56/scripts 11), Chromium E2E 49건 PASS. 이번 배치에 순수 함수/store 42건과 E2E 2건을 추가했다. 사용처가 없어진 기존 NumberScrubber를 제거한 뒤 lint도 재확인했다. 브랜치만 커밋하며 push/main merge는 하지 않았다.


## c52851b 리뷰 반영

- 챕터 파일 생성은 `chapterExportLines` 순수 함수의 M:SS/H:MM:SS로 복구했다. 마커 목록은 HH:MM:SS:FF를 유지하며, 분/시 경계와 0:00 자동 추가를 회귀 테스트한다.
- 스크럽 버튼은 Tab 순서에서 제외하고 자신의 키 입력을 흡수하며, 전역 단축키도 `[data-precision-scrub]`을 편집 대상으로 취급한다. Tab으로 옆 숫자 필드에 이동할 수 있고 Backspace/Delete가 클립으로 누출되지 않는다.
- 변형·속도·소스 슬립 slider 및 변형/속도/키프레임 숫자 스크럽·키프레임 그래프는 무이력 값을 즉시 store에 반영해 캔버스와 오디오가 라이브 값을 받는다. 시작 스냅샷과 세션 토큰을 보관하고 종료에 `recordApplied` 한 번, Esc/포인터 취소/입력 unmount에는 시작 상태를 복원한다. 다른 프로젝트 로드 또는 중간 history 변경 뒤의 오래된 세션은 쓰기/복원을 하지 않는다.
- `slipClipBy` 자체도 undo 가능한 명령으로 바꾸고 드래그는 별도 transient 액션으로 연결했다. 기존 transient `setTransform`은 슬라이더·숫자 스크럽에 재사용한다.
- 인스펙터 전체의 clip key를 제거하고 입력/NumRow/KeyframeGraph 단위에만 key를 둬 InspectorSection 접힘과 AiPanel 상태를 유지한다. 잘못된 Enter 입력은 안내를 유지하고 잘못된 blur 입력은 모델 값으로 복귀하며 IME 조합 중 Enter는 커밋하지 않는다.
- 이미지에는 fit 설정만 유지하고 소스 트림·슬립 UI를 숨긴다. store도 이미지 source trim/slip을 거부해 가상 5000ms 소스가 표시 길이를 바꾸지 않는다.
- 플레이헤드 입력의 상한을 프로젝트 길이로 제한하고 슬라이더 접근 이름에 한국어/영어 별도 접미사를 붙인다. 기존 8개 수정 파일은 biome format으로 복구했고 i18n은 4칸 append-only를 유지했다.

### 추가 후속 감사 목록

- `SpeedSection.applyRamp`: 트랙 clear 1회 + keyframe 추가 N회로 undo가 N+1개로 나뉜다. 램프 프리셋을 한 명령으로 묶는 후속이 필요하다.
- 현재 타임코드는 엄격한 HH:MM:SS:FF 입력만 받는다. 초/프레임 숫자·오른쪽 채움 같은 약식 입력은 정책과 파서 테스트를 갖춘 후 추가한다.
- 키프레임 시각 선택 메뉴는 클립 상대 시각이다. 상대 시각을 명시하는 라벨과 프로젝트 절대 시각 병기, 시각 이동 입력은 후속이다.


리뷰 회귀 검증은 챕터 순수 함수 3건, live preview/undo/취소/세션 무효화/이미지 보호 store 테스트 9건을 추가하고 E2E를 2→4건으로 확장했다. 기존 E2E에는 invalid blur와 IME 조합 중 Enter도 추가했으며, 새로운 E2E는 슬라이더 드래그 중 인접 숫자 값 갱신·스크럽 중 슬라이더 값 갱신·한 번 undo·Backspace/Delete 격리·Tab 이동과 클립 전환 시 섹션 접힘 보존을 확인한다. 중간 전체 gate의 컬렉션 E2E 한 건은 소스 보강과 실행이 겹친 상태에서 실패했으므로 최종 코드를 고정하고 전체 gate를 다시 실행했다.

리뷰 반영 최종 검증: `pnpm gate` **9/9 PASS**, 단위 **730**(core 125/web 538/desktop 56/scripts 11), Chromium E2E **51**건 PASS. 앞서 실패한 컬렉션 E2E도 최종 코드 고정 실행에서 통과했다. `biome format` 대상 8개 파일 검사와 `git diff --check`도 PASS이며, i18n 변경은 한국어/영어 각 1키 append뿐이다.


## 1b13e6b 확인 리뷰 반영

- 챕터 첫 마커가 1초 미만이면 자동 인트로를 생략하고, 같은 초의 마커는 첫 항목만 유지한다. 타임스탬프를 임의로 뒤로 밀지 않는 정책을 코드 주석과 400ms/동일 초 회귀 테스트로 고정했다.
- 스크럽 종료·취소 시 핸들 포커스를 해제하고 Cmd/Ctrl 조합은 전역 명령으로 통과시킨다. E2E는 release 직후 키보드 Cmd+Z/Shift+Cmd+Z를 사용하며, 드래그 중 Backspace/Delete 격리는 유지한다.
- 열린 제스처에 runWith 명령이 들어오면 직전 live 값을 먼저 undo에 기록하고 명령 후 같은 토큰의 시작 스냅샷을 갱신한다. 이후 프리뷰와 Escape가 유효하며, 드문 경합에서는 제스처가 명령 앞뒤 두 undo로 나뉜다. 중간 명령은 Escape로 취소하지 않는다.
- Precision 세션 동안 Yjs 쓰기를 미루고 종료·취소·dispose·프로젝트 전환 때 최종 상태를 한 번 flush한다. 입력 unmount의 취소와 기존 토큰 보호를 유지한다.
- 시작값으로 돌아온 정상 제스처는 history를 추가하지 않는다. 제스처 라벨은 입력 이름을 사용하며, IME 조합 중 Enter/화살표/Escape는 무시한다. 슬라이더 Escape 이후에는 pointerup까지 값 변경을 중단하고 still 이미지의 Spatial fit 컨트롤 가시성도 E2E로 확인한다.

### 1,000자산 프레임 비용 측정

실제 store와 Yjs/project-crdt를 사용하는 Vitest에서 합성 비디오 메타데이터 자산 1,000개·클립 1,000개에 변형 60프레임을 적용했다. IndexedDB provider만 mock이며 렌더러/GPU·디스크 I/O를 포함하지 않는 CPU 측정이다. 실행별 시간 변동이 있어 성능 수치 자체를 테스트 임계치로 삼지 않고 flush 횟수를 검증한다.

| 경로 | 프레임 p50 | 프레임 p95 | Yjs flush | 종료 flush |
| --- | ---: | ---: | ---: | ---: |
| 기존 프레임별 flush | 1.462ms | 1.751ms | 60회 | — |
| 세션 종료에 flush | 0.045ms | 0.047ms | 드래그 중 0회, 종료 1회 | 1.587ms |

확인 리뷰의 집중 검증: 순수 함수/store/persistence 27건 및 Chromium 정밀 입력 E2E 5건 PASS. 전체 gate 결과는 아래 최종 기록과 [gate 보고서](2026-09-06-precision-input-gate.md)에 남긴다.

최종 전체 gate: **9/9 PASS**, 단위 **739**(core 125/web 547/desktop 56/scripts 11), Chromium E2E **52**건 PASS. 전체 gate 안의 별도 측정은 기존 p50 1.994ms/p95 8.920ms → 세션 p50 0.049ms/p95 0.072ms, 종료 flush 1.984ms로 같은 flush 횟수 감소를 확인했다. `git diff --check`도 PASS이며 이번 확인 리뷰에는 i18n 변경이 없다.
