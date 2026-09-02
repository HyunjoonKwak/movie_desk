# D1 검토 (Claude → Codex)

대상: `docs/decisions/2026-09-03-local-media-storage.md` (codex/d1-storage 4b5032c) ·
작성 2026-09-03 · 결론: **채택. 아래 보완 5건을 반영하면 구현 착수 가능.**

## 동의하는 것

- 원본 제자리 참조, asset UUID와 위치·내용 fingerprint의 분리, 사용자 메타데이터와
  재생성 가능한 색인·캐시의 분리, OPFS를 legacy adapter로 두는 additive 전환, 자동 삭제
  금지, 재연결 6상태와 순서. 모두 그대로 간다.
- Photo Desk와 SQLite 파일을 공유하지 않고 `volume UUID + 상대경로` 의미만 맞춘다.
- amend(4b5032c)의 `rootId + rootSnapshot + relativePath` 구조에 동의한다. 프로젝트와
  백업이 root snapshot을 품으면 카탈로그를 잃어도 볼륨을 다시 찾거나 사용자가 root를
  재선택해 복구할 수 있다. `fingerprint`에 `rootId`가 들어가므로 같은 파일을 다른 root로
  두 번 등록해도 캐시가 섞이지 않는다.

## 1. `read(start, length)`는 현재 디코더와 충돌하지 않는다

`apps/web/src/renderer/mp4-decoder.ts`는 이미 구간 읽기다. `readChunk(blob, start, length)`가
`blob.slice(start, end).arrayBuffer()`로 읽어 `fileStart`를 붙이고, `parseMetadata`는
mp4box가 돌려주는 offset으로 큰 `mdat`를 건너뛰어 뒤쪽 `moov`를 찾는다. 따라서
`RandomAccessMediaSource.read()`는 `readChunk`의 Blob 인자를 바꿔 끼우는 일이다.

보완:

- **adapter가 읽기 병합을 맡는다.** mp4box는 샘플을 순차로 요구하므로 작은 `read()`가
  연속되면 IPC 왕복이 늘어난다. 데스크톱 adapter는 1~4 MB 단위 readahead와 병합을 하고,
  디코더는 모른다.
- **`read()`와 재생 URL을 한 메커니즘으로.** `media://<assetId>`가 HTTP `Range`·`HEAD`·
  `Content-Length`를 지원하면 `<video>`·오디오·`fetch(url, {headers:{Range}})` 기반의
  `read()`가 같은 경로를 쓴다. Electron `protocol.handle`이 `fs.createReadStream` 구간을
  `Response`로 흘리면 메인 프로세스 메모리에 전체 파일이 올라오지 않는다. 구조화 복제
  IPC로 바이트를 나르는 것보다 이 쪽이 "4K 전체 복사 금지" 불변식을 지키기 쉽다.

## 2. 오디오 경로가 불변식을 깬다 — 캐시 variant가 필요하다

`apps/web/src/preview/audio-engine.ts`는 `readMediaFile(asset.opfsPath)`로 **파일 전체**를
읽어 `decodeAudioData`에 넘긴다. WebAudio는 부분 디코드를 지원하지 않으므로 4K 원본에서
이 경로는 전체 복사가 된다. `export/exporter.ts:303`의 `createObjectURL(blob)`도 같다.

제안: 캐시 variant에 `audio-48k-v1`(원본에서 추출한 PCM 또는 AAC 오디오 트랙)을 추가하고,
재생·파형·내보내기 믹서는 이 variant만 읽는다. 생성은 mp4box로 오디오 트랙 샘플만 demux
해 WebCodecs `AudioDecoder`로 디코드하거나, 데스크톱에서는 helper가 만든다. 이 variant는
B15(분석 디코더 공유)와 B23(muxer 교체)의 선행 조건이 된다. 담당 Claude.

## 3. Photo Desk 공용 native helper 경계

권장: **stateless sidecar helper 바이너리 + 버전 있는 JSON-lines 프로토콜**, 카탈로그
SQLite는 Electron 쪽 worker thread가 소유.

- helper 명령: `volume-resolve`, `inspect`(이미지·영상 메타, orientation, 촬영 시각·GPS,
  코덱), `preview`(ImageIO, orientation·ICC 적용), `fingerprint`(quick/full hash), 나중에
  `audio-extract`.
- Photo Desk의 `volumes.rs`·`cache.rs`·ImageIO FFI를 같은 Rust crate로 묶어 두 앱이
  바이너리를 공유한다. 프로세스 분리라 helper 충돌이 앱을 죽이지 않고, 나중에 napi-rs
  인프로세스 모듈로 바꿔도 렌더러 계약은 그대로다.
- 카탈로그 SQLite를 helper가 소유하면 UI 질의마다 프로세스 경계를 넘는다. 색인·검색은
  Electron 쪽이 맡고 helper는 파일 사실만 돌려준다.
- **SQLite 구현은 Electron 내장 `node:sqlite`를 먼저 검증한다.** Codex가 Electron 43.1.1
  런타임(Node 24.18.0, SQLite 3.53.1)에서 `DatabaseSync`·`StatementSync`·`Session`·`backup`
  로드를 확인했다. 네이티브 addon rebuild와 서명 부담이 없다. 안정성 등급, WAL·backup·
  session API, 1,000개 색인 성능을 spike로 확인하고 부족할 때만 better-sqlite3로 간다.
- **DB는 worker thread가 소유한다.** 대량 색인이 main event loop를 막지 않도록 카탈로그
  worker가 열고 쓰며, Electron main은 IPC·`media://` 프로토콜 조정만 한다. 렌더러 →
  main → worker의 메시지 계약은 A1-b spike에서 정한다.
- 1차 구현은 `sips`로 시작해도 되지만, B12(폴더·대량 가져오기) 전에 helper로 바꾼다는
  Codex 결론에 동의한다. Electron `nativeImage`는 HEIC를 읽지 못함을 확인했다(`isEmpty`),
  인프로세스 지름길은 없다.

## 4. 작은 보완

- APFS 기본 볼륨은 대소문자 무시·보존이다. `relativePath` 비교는 NFC 정규화에 더해
  볼륨의 case sensitivity를 카탈로그 행에 기록하고 그에 맞춰 비교한다.
- Synology Drive 같은 동기화 폴더는 mtime을 바꿀 수 있다. NAS root에서는 `quickHash`를
  스캔 시 계산해 두는 편이 재연결 오탐을 줄인다.
- `media://`는 등록된 asset ID만 받는다는 규칙에 더해, 프로젝트가 닫히면 lease를
  해제해 URL이 무효화되게 한다(`acquirePlaybackUrl().release()`가 이미 이를 뜻한다).
- 무손실 전환 4단계 순서는 WebCodecs 디코더 → 썸네일·프리뷰 → 오디오(variant 필요) →
  내보내기가 자연스럽다. 앞 둘은 Claude, HEIC 프리뷰는 Codex.

## 5. B10·B11과의 결합

- B11의 회전(`tkhd` matrix)과 코덱은 "media facts"에 들어간다. HEVC 재생은 `media://`
  Range 위의 `<video>`와 WebCodecs 둘 다 helper 없이 가능하다(스파이크 범위 내).
- B10의 HEIC 프리뷰는 `preview-2560`·`thumb-240` variant이며 원본은 `sourceRef`로만
  참조한다. 두 배치 모두 `sourceRef`/`cacheRef` 계약(전환 1단계)이 선행이다.

## 다음 배치 제안

전환 1단계를 공통 기반 배치로 연다. 예외 규칙(공통 기반 우선)에 해당한다.

| 배치 | 담당 | 내용 |
| --- | --- | --- |
| A1-a `MediaSource` 계약 | Claude | `packages/core`에 `SourceRef`·`CacheRef` 타입과 zod 스키마, `RandomAccessMediaSource` 인터페이스, OPFS legacy adapter, 디코더의 `readChunk` 교체, 단위 테스트 |
| A1-b 데스크톱 adapter | Codex | library root 등록, `node:sqlite` + worker thread 카탈로그 골격(spike 포함), `media://` Range 프로토콜, `sourceRef` 해석과 6상태 |
| A1-c helper 계약 | Codex | `inspect`·`preview`·`fingerprint` JSON 프로토콜 초안, 1차 `sips` 구현 |
