# 공유 프리셋 내보내기 검증 — 2026-09-03

## 결론

B20 공유 프리셋의 기본 추천인 **가족 메신저 720p**(1280×720 · 30fps · H.264/AAC ·
2500/128kbps)를 실제 Chrome에서 내보낸 결과 파일이 규격대로 만들어지고 끝까지
디코드된다. 대화상자의 예상 용량(16초 → "예상 5 MB · 분당 20 MB")은 실제 5.15MB와
일치했다.

## 방법

- 환경: Apple Silicon Mac, Google Chrome 152(Playwright MCP로 구동), `next dev`
  개발 서버. Chrome은 `VideoEncoder.isConfigSupported(avc1.42001F)`와
  `AudioEncoder.isConfigSupported(mp4a.40.2)` 모두 `supported: true`.
- 입력: ffmpeg `testsrc2` 1920×1080 30fps 8초 + 440Hz 사인파, H.264/AAC MP4(7.7MB).
  타임라인에 두 번 배치해 16초 프로젝트(미디어 카드 선택 후 `e` 한 번에 클립이
  두 개 붙는 기존 현상, `07-work-order.md` 인계 메모 참고).
- 확인: 저장된 MP4를 `ffprobe`로 스트림·컨테이너를 읽고, `ffmpeg -xerror -f null`로
  전체 디코드, `-count_frames`로 프레임 수를 셌다.

## 결과

| 항목 | 값 |
| --- | --- |
| 파일 크기 | 5,146,017 B (5.15MB) · 대화상자 예상 5MB |
| 컨테이너 | MP4, 16.064초, 2,563kbps, `moov`가 `mdat` 앞(fast start) |
| 비디오 | H.264 Baseline L3.1, 1280×720 yuv420p, 30fps, 480프레임, 2,483kbps |
| 오디오 | AAC LC, 48kHz 스테레오, 753프레임, 87kbps |
| 전체 디코드 | 오류 0 (`ffmpeg -v error -xerror`), 읽은 프레임 비디오 480 · 오디오 753 |
| 내보내기 시간 | 약 6초 |

## 아직 확인하지 않은 것

- 실제 메신저(카카오톡 등) 전송과 TV·태블릿 재생은 실기기에서 하지 않았다.
  B24 수동 도그푸딩 항목(`09-release-checklist.md` 3절)으로 남긴다.
- 4K 프리셋(YouTube 4K · TV/태블릿 4K)은 대화상자 표시와 단위 테스트만 확인했고
  실제 4K 인코딩 시간·품질은 도그푸딩에서 측정한다.
