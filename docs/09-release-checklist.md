# 릴리스 체크리스트 (B24)

v0.4.0 계열 릴리스 전에 확인하는 항목이다. **자동 항목**은 `pnpm gate` 한 번으로
돌리고, **수동 항목**은 사용자가 RC DMG에서 완주한다. 작업 순서와 상태는
[`07-work-order.md`](07-work-order.md)의 B5·B24·B25 행을 따른다.

## 1. 자동 게이트 — `pnpm gate`

`scripts/release-gate.mjs`가 `.github/workflows/ci.yml`과 같은 순서로 아래 단계를
실행하고 마크다운 표 하나로 요약한다. 로컬에서 초록이면 CI도 초록이어야 한다.

| 단계 | 명령 | 확인하는 것 |
| --- | --- | --- |
| version policy | `pnpm check:versions` | 네 매니페스트의 버전이 `apps/desktop/package.json`과 같다 (D2) |
| lint | `pnpm lint` | biome lint(web·core·desktop) + 루트 `scripts/` `biome check` |
| typecheck | `pnpm typecheck` | `tsc --noEmit` 전 워크스페이스 |
| unit tests | `pnpm test` | vitest(web·core), node:test(desktop·scripts) |
| OSV audit | `pnpm audit:prod` | 프로덕션 의존성에 알려진 취약점 0건 (네트워크 필요) |
| web production build | `pnpm --filter @movie-desk/web build` | Next 프로덕션 빌드. `NEXT_DIST_DIR=.next-gate`라 `next dev` 캐시를 건드리지 않는다 |
| browser e2e | `pnpm test:e2e` | Playwright Chromium. 포트 32119가 비어 있어야 시작한다 (`lsof -ti :32119 \| xargs kill`) |

옵션: `--continue`(첫 실패 뒤에도 끝까지 돌려 실패를 모두 보고), `--skip e2e,build`,
`--only lint,test`, `--report gate.md`(요약 표를 파일로). 실패하면 종료 코드 1.

## 2. 자동화된 체크리스트 항목 (Playwright, `apps/web/e2e/`)

| 항목 | 스펙 | 확인하는 것 |
| --- | --- | --- |
| 충돌 복구 | `recovery.spec.ts` | 명시적 저장 없이 편집(클립 2개·프로젝트 이름)한 뒤 즉시 새로고침해도 타임라인·이름·미디어가 그대로다. "저장됨" 배지가 아니라 y-indexeddb 기록 수를 기다린다 |
| 손상 프로젝트 파일 | `recovery.spec.ts` | 깨진 JSON·형식이 다른 JSON을 가져오면 "Import failed" 안내만 나오고 열린 프로젝트(이름·클립 수)는 변하지 않는다 |
| 손상 저장 프로젝트 | `recovery.spec.ts` | 라이브러리의 손상 행을 열면 안내가 뜨고 현재 프로젝트가 유지된다. 마지막 프로젝트가 손상돼 있으면 새 프로젝트로 열고 가져오기가 계속 동작한다 |
| 저장 공간 부족 | `storage-full.spec.ts` | 한 파일의 OPFS 쓰기가 `QuotaExceededError`로 실패하면 파일별로 "저장 공간 부족" 안내, 나머지 파일은 정상 가져오기, 부분 파일이 남지 않으며, 공간 확보 뒤 파일별 재시도가 성공한다 |
| 누락 미디어 | `missing-media.spec.ts` | 클립이 참조하는 OPFS 파일을 지운 뒤 내보내면 파일 이름을 들어 거부하고, 다운로드가 생기지 않으며, 대화상자는 다시 쓸 수 있다 (`export/preflight.ts`) |
| 내보내기·취소·스냅샷 | `export.spec.ts` | VP9 내보내기 결과 파일, 렌더 중 취소, 스냅샷 복원 (B22) |
| 손상 미디어 파일 | `media-import-failure.spec.ts` | 디코드 불가 파일을 같은 배치의 정상 파일과 분리해 안내 (B9) |
| 자동 편집 | `autoedit.spec.ts` | 분석 → 초안 → 타임라인 (B17) |
| 디코더 | `webcodecs-sampler.spec.ts` | WebCodecs 샘플러가 실제로 configure·프레임을 낸다 (B15) |
| 편집기 기본 | `editor.spec.ts`, `timeline-marquee.spec.ts` | 프로젝트 유지, 레이아웃, 선택 |

## 3. 수동 항목 — RC DMG에서 사용자가 완주

`docs/dogfood/TEMPLATE.md`의 절차와 P0 기준(완주 불가·데이터 손실·원본 훼손·재생 불가·
복구 불가 충돌)을 그대로 쓴다.

- [ ] arm64·x64 DMG를 새 사용자 프로필에서 설치·첫 실행. 아이콘·DMG 배경·앱 이름이 맞다.
- [ ] 네트워크를 끊고 첫 실행 → 가져오기 → 분석 → 내보내기가 된다 (B4 모델 번들).
- [ ] `~/Library/Application Support/cut_editor`가 있는 Mac이면 옛 프로젝트가 열린다.
      (이관 미구현 — `07-work-order.md` 인계 메모의 Codex 확인 항목. 없는 Mac은 해당 없음.)
- [ ] 업데이트 안내: 이전 버전에서 실행해 새 릴리스를 안내한다.
      (rc 접미사 비교 결함 — 같은 메모의 Codex 확인 항목.)
- [ ] **강제 종료 복구:** 편집 중 `kill -9`로 앱을 죽이고 다시 실행 → 타임라인·이름이 그대로다.
- [ ] **누락 미디어:** 원본을 담은 외장 드라이브를 분리 → 내보내기가 파일 이름을 들어 거부한다
      → 다시 연결 → 내보내기가 성공한다. 미디어 카드의 누락 표시는 아직 없다 (5절).
- [ ] **저장 공간 부족:** 데스크톱 참조 가져오기에서 `ENOSPC`가 "저장 공간 부족"으로 분류되고
      원본은 그대로다. (브라우저 쪽은 2절의 e2e가 대신한다.)
- [ ] **두 번째 촬영본 세트 완주**, 손실 0: 종료 후 대표 원본 10개의 크기·수정 시각이 동일하다.
- [ ] 릴리스 노트에 ad-hoc 서명(우클릭 → 열기) 안내가 있다.

## 4. 릴리스 절차

1. `git fetch` 뒤 깨끗한 `origin/main`에서 시작한다. 열린 통합 대기 브랜치가 없어야 한다.
2. 버전: `apps/desktop/package.json`을 올리고 `pnpm sync:versions`.
3. `pnpm gate --report gate.md` 전체 초록. 요약 표를 `07-work-order.md` 상태 행에 옮긴다.
4. 사용자가 태그 `vX.Y.Z[-rc.N]`를 push → `release.yml`이 GitHub Release **초안**에
   `Movie Desk-<v>-arm64.dmg`와 `Movie Desk-<v>.dmg`(x64)를 올린다. 두 파일과 버전을 확인한다.
5. 3절 수동 항목을 완주하고 P0가 0이면 Release를 공개한다.
6. `07-work-order.md`의 B5/B25 행과 `06-master-plan.md`의 "지금 위치"를 갱신한다.

## 5. 알려진 빈틈 (2026-09-03 B24에서 확인)

- 미디어 카드는 자산에 인라인된 썸네일을 그리므로 파일이 사라져도 정상처럼 보인다.
  카드에 누락 상태를 표시하려면 소스 상태 조회가 필요하다 — media-bin UI(Codex).
- 컴포지터는 소스를 열 수 없는 자산을 1초 간격으로 무한 재시도한다(`renderer/compositor.ts`).
  미리보기에서는 검은 프레임, 내보내기는 사전 점검이 막는다 — renderer(Claude).
- `persistence/project-export.ts`의 버전 불일치 메시지가 영어 하드코딩이다(i18n 밖).
- 스냅샷 저장·복원은 e2e만 있고 단위 테스트가 없다.
