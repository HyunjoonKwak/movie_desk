# D1: 로컬 미디어 저장·재연결 계약

상태: **제안 — Claude 검토 대기** · 작성 2026-09-03 · 구현 전 결정 문서

이 문서는 Movie Desk가 수백~수천 개 원본을 다룰 때의 목표 구조를 정한다. 현재 구현의
Yjs/IndexedDB 프로젝트와 OPFS 원본 복사는 즉시 폐기하지 않는다. 새 구조를 먼저 추가하고
검증한 뒤, 기존 프로젝트를 손실 없이 옮기는 것이 전제다.

## 결정

Movie Desk는 macOS 로컬 데스크톱 앱을 제품 기준으로 삼는다.

- 사용자가 선택한 사진·영상 원본은 **제자리에서 참조**한다. 가져오기는 기본적으로
  원본 복사·이동·수정을 하지 않는다.
- SQLite 카탈로그는 검색과 정리를 위한 로컬 색인이다. 태그·평점·컬렉션처럼 사용자가
  만든 정보는 재생성 가능한 파일 색인과 분리해 백업·내보낼 수 있어야 한다.
- 썸네일·프록시·파형·분석 결과는 앱 캐시다. 모두 지우고 다시 만들 수 있어야 한다.
- 프로젝트는 원본 디스크가 빠져도 열려야 한다. 캐시가 있으면 편집 내용을 보여 주고,
  없으면 어느 원본이 왜 오프라인인지 알려 준다.
- `apps/web`은 UI 개발과 호환 미리보기다. 데스크톱의 대용량 저장 구조를 OPFS 한계에
  맞추지 않는다.
- Photo Desk와 **경로 의미를 공유**하되 SQLite 파일을 함께 쓰지는 않는다. 한 앱의
  스키마 변경이나 쓰기 실패가 다른 앱을 손상시키지 않게 한다.

## 반드시 지킬 불변식

1. 단순 가져오기·검색·태그·편집·내보내기는 사용자 원본을 바꾸지 않는다.
2. 파일 위치와 파일 내용의 동일성을 같은 값으로 취급하지 않는다.
3. 카탈로그 또는 캐시가 손상돼도 원본과 프로젝트 편집 결정은 복구 가능하다.
4. 누락 파일을 비슷한 이름의 다른 파일로 조용히 바꾸지 않는다. 자동 재연결은 충분한
   근거가 있을 때만 하고, 나머지는 후보를 보여 주고 사용자가 확정한다.
5. 한 파일의 손상·권한 상실·디스크 오프라인이 나머지 일괄 가져오기와 프로젝트 열기를
   중단시키지 않는다.
6. 로컬 원본·프록시·분석 데이터는 사용자가 명시적으로 켠 기능 없이 네트워크로 나가지
   않는다.

## 위치와 동일성

절대경로 하나를 영구 식별자로 저장하지 않는다. macOS는 외장 볼륨 이름 충돌이나
재마운트 때문에 `/Volumes/<name>` 경로가 달라질 수 있다. Photo Desk가 검증한 것처럼
로컬/외장 볼륨은 `volume UUID + volume-relative path`로 푼다.

Movie Desk의 프로젝트가 저장하는 최소 참조는 다음 의미를 가진다.

```ts
interface DiskSourceRefV1 {
  readonly version: 1;
  readonly rootId: string;
  readonly rootSnapshot: {
    readonly volumeUuid?: string;
    readonly volumeRelativePath?: string;
    readonly lastKnownAbsolutePath?: string; // 복구 힌트, 동일성 판정에는 사용하지 않음
  };
  readonly relativePath: string;     // library root 기준, NFC 정규화
  readonly sizeBytes: number;
  readonly modifiedAtMs: number;
  readonly inode?: string;           // 같은 볼륨 내 이동 후보, 영구 ID는 아님
  readonly quickHash?: string;       // size + 앞/뒤 chunk
  readonly fullHash?: string;        // 충돌 확인·명시적 검증 때 지연 계산
}
```

`MediaAsset.id`는 프로젝트 안에서 변하지 않는 임의 UUID로 유지한다. 경로 또는 해시를
asset ID로 만들지 않는다. 파일을 편집해 내용이 바뀌어도 같은 자산으로 추적할 수 있어야
하고, 바이트가 같은 두 사본도 사용자가 따로 관리할 수 있어야 하기 때문이다.

`rootId`가 가리키는 카탈로그 행은 다음을 가진다. 프로젝트와 내보낸 백업에는 해당 root의
snapshot도 함께 남긴다. 그래야 카탈로그를 잃어도 볼륨을 다시 찾거나 사용자가 root를
재선택해 `relativePath`를 복구할 수 있다.

- 로컬/외장 디스크: volume UUID, 볼륨 안의 라이브러리 루트 상대경로, 마지막으로 확인한
  마운트 경로.
- UUID가 안정적이지 않은 네트워크 공유: 사용자가 다시 선택할 수 있는 논리적 root ID,
  마지막 경로, 필요할 때 보안 범위 bookmark. 마지막 경로는 힌트이지 동일성이 아니다.
- Photo Desk에서 온 자산: 선택적으로 Photo Desk library/file ID를 provenance로 저장한다.
  Movie Desk는 Photo Desk DB를 읽기 전용으로 가져오거나 명시적 교환 파일을 쓰며, 직접
  쓰지 않는다.

## 재연결 순서

원본을 열 때 아래 순서로 확인하고 결과를 `online`, `moved`, `changed`, `offline`,
`permission-denied`, `ambiguous`로 구분한다.

1. 등록된 source root + `relativePath`에 파일이 있고 size/mtime이 같으면 즉시 사용한다.
2. 같은 볼륨에서 inode가 일치하면 이동 후보로 삼고 size/quick hash로 확인한다.
3. 사용자가 새 root를 골랐거나 제한된 범위를 재검색하면 size + quick hash로 후보를
   좁힌다.
4. 후보가 여럿이거나 중요한 내보내기 직전이면 full SHA-256으로 확정한다.
5. 충분히 확정하지 못하면 후보와 차이를 보여 주고 사용자 선택을 기다린다.

inode는 APFS 같은 볼륨 안에서의 이동 추적에만 쓴다. 복사, NAS, 클라우드 동기화 폴더,
복원 이후에도 유지된다고 가정하지 않는다. full hash도 항상 선계산하지 않는다. 일반
스캔은 경로·크기·mtime과 필요한 메타만 갱신하고, 강한 해시는 필요할 때 계산한다.

## 데이터 경계

SQLite는 최소한 아래 책임을 나눈다. 실제 컬럼과 migration은 구현 배치에서 확정한다.

| 영역 | 예시 | 성격 |
| --- | --- | --- |
| libraries / locations | volume UUID, root, 상대경로, inode, size, mtime, hash | 다시 스캔 가능 |
| media facts | 코덱, 크기, 길이, 촬영 시각·GPS, orientation | 원본에서 재추출 가능 |
| user metadata | 태그, 평점, 컬렉션, 메모, 채택/제외 | **백업 필수, 자동 삭제 금지** |
| cache entries | 썸네일, 프록시, 파형, 분석 모델 버전 | 완전 재생성 가능 |
| project references | project ID ↔ asset ID, 마지막 확인 fingerprint | 편집 결정 복구에 필요 |

프로젝트 문서는 당분간 Yjs/IndexedDB를 유지한다. 카탈로그 전환과 프로젝트 저장 엔진
전환을 한 번에 하지 않는다. 프로젝트 내 `MediaAsset`에는 `sourceRef`를 additive로 넣고
기존 `opfsPath`를 legacy source로 계속 읽는다.

## 렌더러 접근 계약

렌더러에 절대경로나 Node 파일 API를 직접 노출하지 않는다. Electron main/preload가
원본 해석과 권한을 소유하고, UI와 디코더는 같은 추상화만 쓴다.

```ts
interface RandomAccessMediaSource {
  readonly assetId: string;
  readonly sizeBytes: number;
  readonly mime: string;
  read(start: number, length: number): Promise<ArrayBuffer>;
  acquirePlaybackUrl(): Promise<{ url: string; release(): void }>;
}
```

- 데스크톱 adapter는 SQLite `sourceRef`를 해석하고, byte-range를 지원하는 제한된
  `media://` 프로토콜 또는 동등한 IPC로 파일 일부만 읽는다.
- 웹 adapter는 기존 OPFS Blob을 감싼다.
- mp4box/WebCodecs는 `read()`로 필요한 구간만 읽는다. 큰 4K 원본 전체를 IPC 또는
  메모리로 복사하지 않는다.
- `<video>`와 오디오 재생은 range 가능한 URL을 쓴다. URL은 등록된 asset ID만 받고
  임의 파일 경로 traversal을 허용하지 않는다.
- HEIC는 같은 source를 ImageIO helper에 전달해 프리뷰를 만들고, 렌더러에는 호환 이미지
  캐시만 제공한다.

## 캐시 규칙

캐시 키는 최소한 `source fingerprint + variant + pipeline version`을 포함한다.

```text
fingerprint = rootId + relativePath + size + mtime + optional quickHash
variant     = thumb-240 | preview-2560 | proxy-1080p | waveform-v1 | analysis-<model>
```

경로·크기·mtime이 달라지면 기존 캐시를 재사용하지 않는다. 색상 변환, orientation 처리,
프록시 코덱 또는 AI 모델이 바뀌면 pipeline version을 올린다. 캐시 DB 행을 먼저 지우거나
파일을 먼저 지워도 다음 실행에서 정합성을 회복할 수 있어야 한다.

## 무손실 전환 순서

1. `MediaSource` adapter와 상태/오류 타입을 추가한다. 기존 OPFS 구현이 첫 adapter다.
2. Electron에 library root 등록, SQLite 카탈로그, `media://` range 접근을 추가한다.
3. 새 데스크톱 가져오기는 `sourceRef`를 만들되 기존 프로젝트 읽기는 그대로 유지한다.
4. 썸네일·프리뷰·WebCodecs·오디오·내보내기를 하나씩 source adapter로 옮긴다.
5. 기존 OPFS 원본은 새 참조와 fingerprint가 검증된 뒤에만 “공간 정리” 후보로 표시한다.
   자동 삭제하지 않는다.
6. 카탈로그 백업/복원과 누락 재연결 도그푸딩이 통과한 뒤 OPFS 원본 복사를 기본 경로에서
   제거한다.

## 구현 게이트

- 1,000개 파일을 가져와도 원본 바이트가 OPFS에 다시 복제되지 않는다.
- 앱 재실행과 외장 디스크 재마운트 후 같은 원본을 찾는다.
- 디스크가 빠진 상태에서 프로젝트가 열리고, 누락 수와 원인을 보여 준다.
- 같은 이름/크기의 다른 파일을 자동으로 잘못 연결하지 않는다.
- 4K 장편 소스를 재생·탐색할 때 전체 파일 크기만큼의 메모리 복사가 생기지 않는다.
- 카탈로그와 캐시를 삭제한 복구 실험에서 사용자 메타데이터와 프로젝트 편집 내용은
  백업으로 돌아오고, 재색인 후 미디어가 다시 연결된다.
- 기존 `cut_editor` 프로젝트가 migration 전후 동일하게 열리고 내보내진다.

## Photo Desk에서 재사용할 지식

현재 로컬 Photo Desk 구현에서 이미 검증된 기준은 다음과 같다.

- `src-tauri/src/db/volumes.rs`: volume UUID와 현재 mount 해석.
- `src-tauri/src/db/schema.sql`: libraries/folders/files 분리, inode·quick/full hash,
  사용자 메타데이터, 썸네일 무효화 정보.
- `src-tauri/src/media/cache.rs`: 상대경로 + size + mtime 캐시 키와 디렉터리 sharding.
- `src-tauri/src/api/photo_protocol.rs`: asset ID를 실제 경로와 캐시 프리뷰로 푸는 제한된
  프로토콜.

Movie Desk는 이 의미와 테스트 사례를 재사용한다. 다만 Electron/TypeScript에 코드를
복사해 두 구현을 장기적으로 따로 키우기보다, 공용 native helper 또는 명시적 교환
계약으로 합칠지는 D1 첫 구현 spike에서 비용을 비교한다.
