# C3 로컬 첫 완성률 — 구현·검증 (2026-09-06)

기준 `origin/main` 354cd43, 작업 브랜치 `codex/c3-completion-funnel`. 2라운드는 229d5f4 위 리뷰 수정이다. 코디네이터가 baseline 제외 정의와 도구 단계의 install/OSV 요청을 승인했다. 앱 측정 코드의 네트워크 전송은 없다.

## 정의와 구현

[결정 문서](../decisions/2026-09-06-first-completion-metric.md)를 따른다. 측정이 켜진 뒤 생성되고 가져오기에 도달한 프로젝트만 분모로, 자산·클립 각 1개 이상인 실제 다운로드 성공 프로젝트만 분자로 센다. 기존 프로젝트/baseline 및 시작 행이 보관 상한으로 사라진 프로젝트는 제외한다. 토글 off 동안 처음 발생한 자산/클립 단계를 다시 활성화한 뒤 관찰한 경우도 baseline이다. 사람이 처음 쓰는지, 도움을 받았는지는 판별하지 않는다.

- 별도 `movie-desk.funnel.v1` Dexie DB. zod 화이트리스트를 통과한 숫자·불리언·열거값만 data에 저장하고 원래 프로젝트 ID도 SHA-256으로 치환한다.
- 프로젝트당 1,000행/전체 5,000행 초과 시 activity 및 비단계 행만 정리한다. 단계·복구 행은 보호하므로 보호 행만 초과하면 소프트 상한이다. 큐는 idle callback(최대 1초 대기, 타이머 폴백)으로 기록하며 50행 단위로 분할한다. DB 오류는 호출자에게 전파하지 않는다. 리포트 읽기 검증은 100행마다 이벤트 루프에 양보한다.
- off에서는 프로젝트 구독을 붙이지 않고 비동기 해시·미처리 쓰기를 epoch로 무효화한다. 언마운트·pagehide·hidden에서는 activity를 내보내고 대기 해시 후 flush를 시작하며, 종료 전 비동기 완료는 보장할 수 없다. 활성 상태에서 모두 삭제하면 기존 프로젝트의 baseline부터 다시 기록한다.
- 새 프로젝트/C1 종류, 자산 등록, 클립 배치, 내보내기 시작·실제 다운로드 성공·실패·취소, 5분 주기/리포트/숨김/종료 때 합산한 activity(commands, undos), 재연결·스냅샷·가져오기 재시도 결과를 수집한다. C2 안내는 해당 복구의 명시적 test id에 한정한다(재연결: media-missing-hint). 없는 힌트는 false이며 리포트·미디어 빈 상태 힌트는 제외한다.
- 저장 충돌 해결 UI는 기준 브랜치에 없어 해당 종류가 0이다. 복구 실패는 pending으로 남기고 같은 프로젝트/종류의 후속 성공·명시적 포기가 해결한다. 반복 시도는 같은 pending 에피소드다. 재연결은 숫자 episode로 pending과 최종 결과를 연결한다. 20개 중 19개 성공 후 닫으면 abandoned 1회(assets=20, resolved=19)이며, 모두 성공하면 success 1회다. 반복 취소·닫기는 무시한다.
- 프로젝트 메뉴 토글·설명, 리포트, JSON 다운로드, 확인 후 전체 삭제. 현재 프로젝트의 undo/명령 수와 최근 100개 퍼널 이벤트를 표시한다. JSON에는 보존된 모든 행이 들어간다.
- B'2 소유의 preview/audio-engine, export/audio-mixer, core speed, editor/speed-section은 수정하지 않았다. i18n 두 파일은 마지막 닫는 괄호 앞에 4칸 들여쓰기로만 추가했다.

## 자동 검증

- 1라운드 C3 단위 13개: 빈/가져오기/완성/다중/비정렬 입력, baseline·불가능한 단계 순서, pending 해결·안내 표시, 보관 상한, 실제 fake-indexeddb append·정리·실패 무시, off 구독 없음, 첫 클립 1회, off 비동기 무효화, undo/redo/새 명령.
- Playwright 신규 1개: 토글 켬 → 새 프로젝트 → PNG 가져오기 → 클립 배치 → 실제 VP9 MP4 다운로드 → 리포트 1/1 → JSON 이름 미포함·해시 ID → off에서 새 프로젝트 가져오기 후 JSON 불변 → 390px 폭·내부 넘침 없음 → 삭제 확인 후 0/0.
- 전체 gate 결과: [gate 원문](2026-09-06-c3-gate.md). 9/9 PASS — core 125 · web 571 · desktop 72 · scripts 11 = 단위 779개, Chromium E2E 55개(104.4초), OSV 167개 패키지 취약점 0건.

## 1,000자산 벤치

격리 Chrome 프로필, 저장소 fixture 영상 200개+합성 PNG 800개, 개발 서버 32123. 사용자 드라이브/프로필은 사용하지 않았다. `bench-library.mjs`의 `--funnel off|on` 옵션으로 같은 경로를 반복했다. 검색·필터는 각각 5회 중앙값, 복원은 5회 p50/p95. 복원 완료는 기존 `reload:*` marks로 판정한다.

```
NEXT_DIST_DIR=.next-bench pnpm --filter @movie-desk/web exec next dev --turbopack -H 127.0.0.1 -p 32123
node apps/web/scripts/bench-library.mjs --assets 1000 --url http://127.0.0.1:32123 --funnel off --out docs/evaluations/2026-09-06-c3-bench-off.json
node apps/web/scripts/bench-library.mjs --assets 1000 --url http://127.0.0.1:32123 --funnel on --out docs/evaluations/2026-09-06-c3-bench-on.json
```

| 지표 | off (1라운드 참고) | on (2라운드 재측정) |
| --- | ---: | ---: |
| 검색 중앙값 | 13.78ms | 13.21ms |
| 필터 중앙값 | 11.42ms | 12.06ms |
| 복원 p50 | 121.40ms | 130.24ms |
| 복원 p95 | 121.81ms | 133.08ms |
| 그리드 준비 p50 | 364.37ms | 374.47ms |
| 보존된 측정 행 | 0 | 15 |
| DOM 카드 | 16 | 16 |

2라운드 1,000자산에서는 리포트를 한 번 열어 activity를 flush한 뒤 5회 새로고침했다. 최초 관찰 start/import 각 1행이 살아 있고 전체는 start 7·import 6·path 1·activity 1 = 15행으로, 이전 1,000행 상한 도달 문제를 해소했다. 복원 p95는 150ms 예산 이내이며 5회 모두 백그라운드 작업이 그리드 이후 시작했다. off는 이전 실행 참고치라 미세 차이를 성능 개선/회귀로 단정하지 않는다. [off 원본](2026-09-06-c3-bench-off.json), [on 원본](2026-09-06-c3-bench-on.json).

## 2라운드 리뷰 반영

- 2라운드 C3 단위 20개: 보관 보호·종료/pagehide/hidden·1,000회 활동 집계·내보내기 저장 취소/다중 프리셋·에피소드 중복/부분 성공/관련 힌트 검증 포함.
- HIGH 보관: command/undo 개별 행을 activity 증분으로 합산한다. 실제 flush가 `trimFunnelRows`를 사용하며 단계·복구 머리 행은 프로젝트/전체 정리에서 모두 보호한다. fake-indexeddb 테스트에서 상한 초과 후 보호 행 생존을 확인한다.
- MEDIUM 종료: 언마운트에서 epoch를 무효화하지 않고 accepted export-success의 비동기 해시/큐를 drain한다. pagehide/hidden도 flush를 시작한다. 옵트아웃·삭제만 discard한다.
- MEDIUM 안내: 해당 복구 힌트만 질의하며 없으면 false다. 관련 없는 상태/개인정보 힌트가 있어도 false인 stub 단위 테스트를 추가했다.
- MEDIUM 에피소드: 재연결·스냅샷·재시도는 pending + 최종 1행, assets/resolved 숫자 포함. 전부 성공하기 전 닫기는 abandoned 1회이고 중복 terminal 결과는 수집기·계산기에서 무시한다. 프리셋 여러 개도 내보내기 episode당 success/failure 1행이며 저장 취소는 성공이 아니다. 첫 프리셋 저장 성공 즉시 success를 기록하여 다음 프리셋 처리 중 종료에도 이미 성공한 결과를 대기시키지 않는다.
- LOW: trim 함수를 실제 정리에 사용, useMemo([rows])/닫을 때 rows 해제, median 복사 정렬/seen 객체 교체, 복사 하니스 삭제 완료. 프로젝트 메뉴의 viewport clamp는 390px에서 측정 토글/리포트를 열기 위한 것으로 유지한다(커밋 메시지에도 명시).
- 미처리 LOW: 세션 간 같은 at의 전역 삽입 순서 키. 현재 로컬 sequence+UUID는 세션 내에서만 순서를 보장한다. 날짜+숫자 episode가 최종 복구 결과를 연결하므로 다른 세션의 at 동률을 결과 중복으로 해석하지 않는다. 전역 순서는 다중 탭 원자적 counter/DB 스키마 변경이 필요해 이번 소규모 정확성 수정에서 보류한다.
- 이전 임시 sync 하니스 수치는 1라운드 계측일 뿐이며 하니스 파일을 삭제했다.

## 3라운드 마지막 정리

- MEDIUM 성능: flush 직후 전체 count와 이번 batch 프로젝트별 인덱스 count로 상한 초과를 확인한 때만 정리한다. DB 스키마 v2의 `[projectId+at+event+id]` 복합 인덱스 키만 읽어 payload를 로드하지 않고 보호 판별·오래된 활동 정리를 수행한다. DB 이름은 유지하며 v1 행은 Dexie 인덱스 업그레이드로 보존한다.
- LOW 고아 pending: 단일 파일·폴더 복구 모두 새 에피소드 생성 전에 이전 미완료 에피소드를 abandoned로 닫는다. 이전 결과 콜백과 이미 끝난 에피소드의 중복 종료는 무시한다.
- LOW 순수 테스트 복원: fake-indexeddb 없는 9개 테스트로 프로젝트별/전체 상한, 보호 이벤트 전체 생존, 최신 activity 유지, legacy command/undo 정리, 0/음수 상한을 검증한다. DB 스파이 테스트는 상한 이하에서 toArray/orderBy/bulkDelete가 호출되지 않고 초과 시 메타데이터 keys 경로가 1회 실행되는지 확인한다. 에피소드 교체 테스트 2개는 1개/20개 자산의 pending → abandoned → 새 pending 순서를 확인한다.
- 선택 항목: 관련 C2 힌트가 없는 복구 종류의 리포트 힌트 열을 “—”로 표시하고 결정 문서에 의미를 명시했다.

- 3라운드 전체 gate: 9/9 PASS, core 125·web 583·desktop 72·scripts 11 = 단위 791개(C3 32개), Chromium E2E 55개, OSV 167개 패키지 취약점 0건. [3라운드 gate 원문](2026-09-06-c3-round3-gate.md).

## 남은 검증

Claude 교차 리뷰 및 B7 실제 사용자 완주가 남는다. 브라우저 로컬 관찰 통계는 첫 사용자 여부·도움 여부·기록 중지 중의 동작을 알 수 없고, 상한/삭제/저장 실패 때문에 장기 누적 통계를 대체하지 않는다.
