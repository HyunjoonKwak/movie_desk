# C3 로컬 첫 완성률 — 구현·검증 (2026-09-06)

기준 `origin/main` 354cd43, 작업 브랜치 `codex/c3-completion-funnel`. 코디네이터가 baseline 제외 정의와 도구 단계의 install/OSV 요청을 승인했다. 앱 측정 코드의 네트워크 전송은 없다.

## 정의와 구현

[결정 문서](../decisions/2026-09-06-first-completion-metric.md)를 따른다. 측정이 켜진 뒤 생성되고 가져오기에 도달한 프로젝트만 분모로, 자산·클립 각 1개 이상인 실제 다운로드 성공 프로젝트만 분자로 센다. 기존 프로젝트/baseline 및 시작 행이 보관 상한으로 사라진 프로젝트는 제외한다. 토글 off 동안 처음 발생한 자산/클립 단계를 다시 활성화한 뒤 관찰한 경우도 baseline이다. 사람이 처음 쓰는지, 도움을 받았는지는 판별하지 않는다.

- 별도 `movie-desk.funnel.v1` Dexie DB. zod 화이트리스트를 통과한 숫자·불리언·열거값만 data에 저장하고 원래 프로젝트 ID도 SHA-256으로 치환한다.
- 프로젝트당 1,000행/전체 5,000행, 인덱스로 오래된 행부터 정리. 큐는 idle callback(최대 1초 대기, 타이머 폴백)으로 기록하며 50행 단위로 분할한다. DB 오류는 호출자에게 전파하지 않는다. 리포트 읽기 검증은 100행마다 이벤트 루프에 양보한다.
- off에서는 프로젝트 구독을 붙이지 않고 비동기 해시·미처리 쓰기를 epoch로 무효화한다. 활성 상태에서 모두 삭제하면 기존 프로젝트의 baseline부터 다시 기록한다.
- 새 프로젝트/C1 종류, 자산 등록, 클립 배치, 내보내기 시작·실제 다운로드 성공·실패·취소, undo/새 history 명령, 재연결·스냅샷·가져오기 재시도 결과를 수집한다. C2 안내는 결과 시점의 화면 표시 여부만 기록한다.
- 저장 충돌 해결 UI는 기준 브랜치에 없어 해당 종류가 0이다. 복구 실패는 pending으로 남기고 같은 프로젝트/종류의 후속 성공·명시적 포기가 해결한다. 반복 시도는 같은 pending 에피소드다. 재연결 일괄 결과는 성공 행별로, 닫기는 남은 항목에 대한 포기로 센다.
- 프로젝트 메뉴 토글·설명, 리포트, JSON 다운로드, 확인 후 전체 삭제. 현재 프로젝트의 undo/명령 수와 최근 100개 퍼널 이벤트를 표시한다. JSON에는 보존된 모든 행이 들어간다.
- B'2 소유의 preview/audio-engine, export/audio-mixer, core speed, editor/speed-section은 수정하지 않았다. i18n 두 파일은 마지막 닫는 괄호 앞에 4칸 들여쓰기로만 추가했다.

## 자동 검증

- C3 단위 13개: 빈/가져오기/완성/다중/비정렬 입력, baseline·불가능한 단계 순서, pending 해결·안내 표시, 보관 상한, 실제 fake-indexeddb append·정리·실패 무시, off 구독 없음, 첫 클립 1회, off 비동기 무효화, undo/redo/새 명령.
- Playwright 신규 1개: 토글 켬 → 새 프로젝트 → PNG 가져오기 → 클립 배치 → 실제 VP9 MP4 다운로드 → 리포트 1/1 → JSON 이름 미포함·해시 ID → off에서 새 프로젝트 가져오기 후 JSON 불변 → 390px 폭·내부 넘침 없음 → 삭제 확인 후 0/0.
- 전체 gate 결과: [gate 원문](2026-09-06-c3-gate.md). 9/9 PASS — core 125 · web 564 · desktop 72 · scripts 11 = 단위 772개, Chromium E2E 55개(104.7초), OSV 167개 패키지 취약점 0건.

## 1,000자산 벤치

격리 Chrome 프로필, 저장소 fixture 영상 200개+합성 PNG 800개, 개발 서버 32123. 사용자 드라이브/프로필은 사용하지 않았다. `bench-library.mjs`의 `--funnel off|on` 옵션으로 같은 경로를 반복했다. 검색·필터는 각각 5회 중앙값, 복원은 5회 p50/p95. 복원 완료는 기존 `reload:*` marks로 판정한다.

```
NEXT_DIST_DIR=.next-bench pnpm --filter @movie-desk/web exec next dev --turbopack -H 127.0.0.1 -p 32123
node apps/web/scripts/bench-library.mjs --assets 1000 --url http://127.0.0.1:32123 --funnel off --out docs/evaluations/2026-09-06-c3-bench-off.json
node apps/web/scripts/bench-library.mjs --assets 1000 --url http://127.0.0.1:32123 --funnel on --out docs/evaluations/2026-09-06-c3-bench-on.json
```

| 지표 | off | on |
| --- | ---: | ---: |
| 검색 중앙값 | 13.78ms | 13.61ms |
| 필터 중앙값 | 11.42ms | 11.01ms |
| 복원 p50 | 121.40ms | 120.70ms |
| 복원 p95 | 121.81ms | 130.31ms |
| 그리드 준비 p50 | 364.37ms | 364.80ms |
| 보존된 측정 행 | 0 | 1,000 |
| DOM 카드 | 16 | 16 |

필터·복원 중앙값 회귀 없음. 복원 p95는 8.5ms 증가했지만 기존 150ms 예산 안이며, 5회 모두 백그라운드 작업이 그리드 이후 시작했다. wall-clock/dev/GC 변동을 포함하므로 미세한 차이를 성능 개선으로 해석하지 않는다. [off 원본](2026-09-06-c3-bench-off.json), [on 원본](2026-09-06-c3-bench-on.json).

## 동기 구간 계측

1,000개 합성 자산 상태에서 구독 콜백·enqueue를 각각 1,000회 실행했다. 최대 콜백 0.049ms, 최대 zod 검증+enqueue 0.833ms, 5,000행 순수 정리 0.369ms, 5,000행 퍼널 계산 1.834ms였다. 이 환경의 계측 동기 구간은 16ms 이내였다. DB 완료 시간은 비동기이므로 이 숫자에 포함하지 않으며 OS/GC 정지까지 보장하는 수치는 아니다. 재현용 [계측 하니스](2026-09-06-c3-sync-bench.txt)를 `apps/web/src/lib/funnel/__tests__/sync-bench.test.ts`로 복사하여 Vitest로 실행한 뒤 임시 파일을 제거한다.

## 남은 검증

Claude 교차 리뷰 및 B7 실제 사용자 완주가 남는다. 브라우저 로컬 관찰 통계는 첫 사용자 여부·도움 여부·기록 중지 중의 동작을 알 수 없고, 상한/삭제/저장 실패 때문에 장기 누적 통계를 대체하지 않는다.
