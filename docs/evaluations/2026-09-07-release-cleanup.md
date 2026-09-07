# 2026-09-07 릴리스 전 정리

기준: `git fetch origin` 후 `origin/main=cd8b653f5f21a9792694713fc1acea37fd8b1fdb` 확인.
작업 브랜치: `codex/release-cleanup`. push·main merge·다른 worktree 수정·사용자 드라이브 접근 없음.

## 문서와 버전 오류

- 누락 배지: `git log --follow` 및 `git show 173a4db`로 2026-09-04 도입 확인.
  당시 media-bin에서 렌더했고 `f355823`(같은 날)이 media-card로 분리했다.
- 백오프: `f1cb0f7`(2026-09-03)이 1초→30초 지수 백오프, `19d79c3`(같은 날)이
  자산 레코드 토큰 변경 시 즉시 재시도를 추가했다. 영구적인 재시도 자체를 제거한 것은 아니다.
- 스냅샷: `749a92e`(2026-09-04)가 저장/목록/복원/손상/삭제 단위 테스트를 추가했다.
- 작업 지시의 “버전 오류 i18n 키와 UI 연결이 없다”는 설명도 현재 코드와 달랐다.
  `git log -S 'project.importOlder'`와 `git show 749a92e`로 같은 커밋이
  en/ko 두 키 및 `project-menu.tsx`의 예외 분기를 이미 추가했음을 확인했다.
  따라서 기존 키를 재사용하고 카탈로그를 수정하거나 중복 키를 append하지 않았다.
- 이번 수정은 예외의 영어 자연어를 `PROJECT_VERSION_OLDER/NEWER:file=…:app=…`
  진단 코드로 바꾼다. direction/fileVersion/appVersion 필드는 유지한다.
  단위 테스트는 실제 파서가 양방향 오류와 필드를 반환하는지 검증한다.
  새 E2E 두 개는 en/ko 각각에서 오래된/새로운 파일을 거부하고 열린 프로젝트 이름을
  유지하며, UI가 기존 번역 문구와 실제 버전을 표시하는지 검증한다.
- docs/09 5절은 해결일·커밋·현재 파일/행 및 매 릴리스 코드 재확인 규칙을 담고,
  3절의 “누락 배지가 없다”는 모순도 제거했다. 마지막 예외 정리까지 반영했으므로
  과거 네 항목을 계속 미해결이라고 남기지 않는다.

## 분석 샘플러 간헐 실패

원래 실패 산출물이 없고 기존 8회 재실행이 통과했으므로 근본 원인을 확정하지 않는다.
`linear-decoder.ts:69`는 isConfigSupported를 await하고 configure 뒤 패킷을 넣으며,
flush/delivery drain과 finally의 decoder.close가 있다. `frame-sampler.ts`도 demux
입력 dispose, 보관 프레임 close, 요소 fallback의 pause/src 해제 및 URL lease 해제를 한다.
현재 코드에서 앞 테스트의 특정 누수를 입증하지 못했다.

기존 Playwright page/context는 테스트마다 새 저장소를 가지지만 브라우저 프로세스는
worker 내에서 공유한다. 전체 스위트 마지막 스펙에서 이전 export/compositor 작업의
GPU/decoder 프로세스 상태를 물려받지 않도록 해당 스펙만 소유하는 browser fixture를
추가했다(launch, finally close). 기본 context fixture를 유지해 스크린샷·비디오·trace
설정도 유지한다. 재시도 횟수는 변경하지 않았다.

완료 숫자 `1/1`은 미디어 요소 fallback 성공으로도 나올 수 있어 실제 decoder frames를
가져오기 전 기준보다 증가할 때까지 명시적으로 poll한다. 계측은 decoder error 콜백의 이름/메시지를 추가하고 성공·실패 모두
configure/frame/seek/error 통계를 Playwright attachment로 보존한다. 전체 브라우저/GPU
자원 압력의 근본 해결로 주장하지 않으며, **테스트 격리·진단 보강 완료**로 처리한다.

## 오디오 미터 부착 경합

제품의 첫 소리 경로는 수정하지 않았다. `MixerAudioGraph.enableMetering`이 모든 tap을
부착한 후 store.live=true로 바꾸고 `MixerMeter`가 이때 accessible label을
`Measured master`로 전환하므로 새로운 테스트 전용 제품 신호도 필요 없다.
E2E는 해당 미터를 최대 15초 기다린 다음 기존 5초 예산으로 값 > -60dB를 검증한다.

기존 fixture가 1초 톤이라 지연 부착 시 소리가 먼저 끝나는 문제도 있었다. 30초 톤으로
바꿔 대기 예산 동안 측정할 PCM을 유지하며, addModule에 테스트 전용 1.5초 지연을
주어 재생보다 부착이 늦는 조건을 실제 Chromium에서 검증한다. 재생을 워클릿 로딩에
종속시키지 않는 기존 `meter-startup.test.ts`도 전체 gate에서 검증한다.

## 선택 항목

- `apps/web/package.json` lint 대상에서 scripts가 실제 누락되어 추가했다.
  새 범위의 유일한 lint error였던 bench-library의 reduce 누적 객체 spread를 제자리
  필드 집계로 바꿔 O(n²) 복사를 없앴다. CLI 출력용 noConsole 경고는 기존 동작을 유지한다.
  다운로드 스크립트나 벤치마크를 실행하지 않았다.
- i18n 일괄 삭제는 하지 않았다. 동적 키도 허용되는 카탈로그라 단순 텍스트 미참조를
  미사용으로 단정할 수 없고, 이번 관련 두 키는 실제 사용 중이다.
- renderClipAudio 함수 분리는 보류했다. DSP·성능 동등성의 별도 기준을 확보한 배치에서
  처리할 선택 항목이며 이번 변경으로 해결됐다고 주장하지 않는다.
- pitchRevisions는 지시한 pitch-renderer.ts가 아니라 preview/audio-engine.ts에 있다.
  비동기 decode와 relink 세대 비교에 사용되므로 단순 Map 삭제는 stale decode의 재진입
  위험이 있다. 수명 정리·세대 검증은 후속으로 남긴다.
- B′2의 크롭 구간별 WSOLA 기준 채널 차이는 기존 열린 항목을 유지한다. 별도 청취 A/B 필요.

## 검증

전체 gate 결과는 [gate 표](2026-09-07-release-cleanup-gate.md)에 기록한다.
실행 전 `lsof -ti :32119` 출력 없음 확인. 전체 로그: `/tmp/release-cleanup-gate.log`.


최종 검증 중 추가한 프레임 증가 단언을 패널 클릭 직전 기준으로 잡은 오류를
단독 실행에서 발견했다(197→197, 1/1 분석 완료). analysis-store는 import/load 직후
백그라운드 분석을 하므로 클릭 전에 이미 끝날 수 있다. 기준을 가져오기 전으로
옮겼으며, 이 실패는 이번에 추가한 단언의 오류이고 과거 간헐 실패 재현으로 보지 않는다.
최초 gate는 9/9, 66/66이었고 수정 후 최종 전체 gate도 **9/9 PASS**다.


최종 결과: core **155** · web **711** · desktop **72** · scripts **11**, 총 **949** 단위
테스트 PASS; Chromium **66/66 PASS**(186.3초, retry 0), OSV **167** 패키지 취약점
**0**건, install/version/lint/typecheck/build/browser install 모두 PASS.
미터 지연 E2E와 기존 첫 소리 지연 E2E, 샘플러(가져오기 전 프레임 기준)도 포함한다.
실행 종료 후 32119는 비어 있고 `git diff --check`도 통과했다.
검토는 코디네이터 Claude에 인계하며 RC DMG 수동 검증은 사용자에게 남아 있다.
