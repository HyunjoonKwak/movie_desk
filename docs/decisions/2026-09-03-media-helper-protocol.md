# A1-c: macOS 미디어 helper 프로토콜

상태: **초기 계약 구현** · 버전 1 · 작성 2026-09-03

Movie Desk의 Electron main은 SQLite 카탈로그와 `media://` lease를 소유한다. 이미지·영상의
플랫폼별 해석만 상태 없는 sidecar helper에 위임한다. Photo Desk와 공유할 대상은 데이터베이스가
아니라 이 명령 의미와 향후 Rust/ImageIO 바이너리다.

## 전송 계약

- 표준 입력과 표준 출력으로 한 줄에 JSON 객체 하나를 주고받는다(JSON Lines).
- 모든 요청과 응답은 `version: 1`과 호출별 `id`를 가진다.
- 성공 응답은 `{ version, id, ok: true, result }`, 실패 응답은
  `{ version, id, ok: false, error: { code, message } }`다.
- helper는 사용자 원본을 수정하지 않는다. `preview`만 main이 지정한 캐시 출력 경로를 만든다.
- 절대경로는 Electron main과 helper 사이에서만 이동한다. preload와 렌더러에는 노출하지 않는다.
- 한 요청 실패는 프로세스를 종료하거나 뒤 요청을 취소하지 않는다.

## 버전 1 명령

| 명령 | 입력 | 핵심 결과 | 현재 구현 |
| --- | --- | --- | --- |
| `volume-resolve` | `path` | volume UUID, mount, volume-relative path, filesystem | macOS `diskutil` |
| `inspect` | `path` | 종류, 크기, 형식, 색공간, orientation | 이미지: macOS `sips` |
| `preview` | source/output path, max dimension, JPEG/PNG | 출력 크기·pipeline version | macOS `sips` |
| `fingerprint` | `path`, quick/full | 알고리즘, 크기, SHA-256 | Node streaming I/O |

Quick fingerprint는 `SHA-256(size + NUL + first 1 MiB + last 1 MiB)`로 고정한다. 파일이 1 MiB보다
작으면 같은 전체 바이트가 head와 tail에 각각 들어간다. 알고리즘 이름은
`sha256-size-head-tail-v1`이며 변경 시 이름도 올린다.

## 교체 경계와 남은 일

현재 sidecar는 계약 검증용 Node 프로세스다. B12 대량 가져오기 전 Photo Desk의 volume resolver와
ImageIO 코드를 공용 Rust helper로 옮기되 JSON 의미는 유지한다. 그때 `inspect`에 AVFoundation 영상
코덱·회전·촬영시각·GPS를 추가하고, 이후 `audio-extract`를 새 명령으로 확장한다. 기존 버전 1 필드를
삭제하거나 의미를 바꾸지 않는다.
