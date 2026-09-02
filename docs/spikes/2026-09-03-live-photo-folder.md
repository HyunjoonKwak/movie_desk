# B12 Live Photo·폴더 가져오기 구현 기록

상태: **1차 구현 완료, 실제 아이폰 DCIM 검증 대기** · 작성 2026-09-03

## 구현 범위

- 미디어 패널에 개별 파일과 별도의 폴더 선택 경로를 둔다. 폴더 입력의
  `webkitRelativePath`를 유지해 서로 다른 DCIM 하위 폴더에서 이름이 같은 파일을 섞지 않는다.
- 파일이나 폴더를 편집기 어디에 드롭해도 `FileSystemEntry` 트리를 끝까지 재귀 탐색한다.
  Chromium의 directory reader는 한 번에 일부 항목만 돌려줄 수 있으므로 빈 batch가 나올 때까지
  반복해서 읽는다.
- MIME이 비어 있는 카메라·외장 볼륨 파일도 알려진 확장자로 판별하고, 경로를 NFC로 정규화한 뒤
  자연 정렬한다. 가져오기는 기존처럼 파일별 직렬 처리하므로 한 파일 실패가 뒤 파일을 막지 않는다.
- 읽을 수 없는 파일이나 하위 폴더는 형제 탐색을 계속하되 개수를 사용자에게 알리고 파일 접근 권한을
  확인하도록 안내한다. 지원하지 않는 비미디어 파일은 실패로 세지 않는다.

## Live Photo 연결 규칙

Apple Photos의 “수정되지 않은 원본 내보내기”와 일반적인 DCIM 복사 결과를 대상으로, 같은 폴더에서
대소문자를 무시한 stem이 정확히 같은 HEIC/HEIF/JPEG 정지 이미지 하나와 MOV 하나만 있을 때 쌍으로
연결한다. 쌍의 두 파일이 모두 실제 가져오기에 성공했을 때만 공통 `pairId`와 `still`/`motion` 역할을
`MediaAsset.livePhoto`에 기록한다.

동일 stem의 정지 이미지가 둘 이상이거나 MOV가 둘 이상이면 오탐을 피하기 위해 자동 연결하지 않는다.
두 원본은 각각 독립적으로 타임라인에 넣을 수 있고, 미디어 카드의 `LIVE` 표시로 관계를 확인할 수 있다.

## 남은 검증

- 실제 iPhone Live Photo 원본에서 filename pair와 embedded asset identifier가 불일치하는 사례를 모은다.
  불일치가 확인되면 B11의 AVFoundation 검사 결과와 함께 content identifier 우선, stem fallback으로
  규칙을 올린다.
- B10 HEIC와 B11 HEVC/MOV 브랜치를 통합한 앱에서 DCIM 폴더를 통째로 넣어 누락, 회전, 재생,
  분석, 내보내기를 SET-01로 확인한다.
- 현재 B10 helper는 파일별 `sips`/`mdls`를 실행한다. 50~200개 기준 시간이 허용 범위를 넘으면
  Photo Desk와 공유할 ImageIO helper로 옮기고 bounded worker queue를 추가한다.
