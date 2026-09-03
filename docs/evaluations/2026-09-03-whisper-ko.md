# 한국어 Whisper 번들 평가 — 2026-09-03

## 결론

Movie Desk의 오프라인 자막 기본 모델은 영어 전용 `Xenova/whisper-tiny.en`
q8에서 다국어 `Xenova/whisper-base` q8로 바꾼다. 한국어/영어 음성 언어는 AI
패널에서 사용자가 명시적으로 고른다. 패키지 앱은 계속 원격 모델 폴백을 금지한다.

## 비교 방법

- 품질 측정: Apple Silicon Mac, Node.js + `@huggingface/transformers` 4.2.0,
  q8 ONNX.
- 입력: macOS Yuna 음성으로 만든 한국어 문장 2개(14.07초, 9.65초). 두 번째에는
  약한 pink noise를 섞었다.
- 측정: 공백·문장부호를 제거한 문자 오류율(CER), 모델 캐시 파일 크기, 웜 추론 시간.
- 한계: 합성 음성 2개뿐이므로 실제 사람 음성·생활 소음 품질을 대표하지 않는다.
  실제 촬영본 검증은 B7/B24 도그푸딩에서 닫는다.

## 결과

| 모델 | 로컬 파일 | 깨끗한 CER / 추론 | 잡음 CER / 추론 | 평균 CER |
| --- | ---: | ---: | ---: | ---: |
| `Xenova/whisper-tiny` q8 | 43.6MB | 19.5% / 0.92초 | 20.0% / 0.86초 | 19.8% |
| `Xenova/whisper-base` q8 | 79.7MB | 14.3% / 1.47초 | 15.0% / 1.28초 | 14.7% |

base는 tiny보다 약 36MB 크지만 평균 CER을 5.1%p, 상대 약 26% 줄였다. 두 입력
모두 실시간보다 충분히 빨랐다(입력 길이 대비 약 0.10~0.13배). 개인용 macOS
데스크톱 편집기의 오프라인 번들에서는 이 품질 차이가 용량 증가보다 중요하다고
판단했다.

## 근거와 후속 게이트

OpenAI Whisper 모델 카드에 따르면 tiny는 39M, base는 74M 파라미터이며 두 크기
모두 다국어 체크포인트가 있다. Transformers.js용 ONNX 저장소도 두 모델을 직접
지원한다.

- <https://huggingface.co/openai/whisper-tiny>
- <https://huggingface.co/Xenova/whisper-tiny>
- <https://huggingface.co/Xenova/whisper-base>

실제 사용자 음성에서 자막을 수정하는 시간이 과도하면 small급 모델을 검토하되,
그 전에는 번들 크기를 더 키우지 않는다.

## 브라우저·오프라인 검증

- Chrome 152의 새 프로필에서 외부 HTTP(S) 요청을 차단하고 14.07초 한국어 샘플을
  가져오기 → 타임라인 배치 → 자동 자막으로 실행했다.
- `whisper-base` q8 모델과 ONNX Web JSEP 런타임은 모두 로컬 `200` 응답이었고,
  외부 요청 0건으로 8.8초 만에 자막 클립 4개가 생성됐고 첫 자막의 핵심 지명
  `강릉`도 보존됐다.
- 모델 약 80MB 외에 ONNX Web 런타임 약 21MB를 앱에 동봉한다.
- 브라우저 경로는 `@huggingface/transformers` 3.8.1을 고정한다. 4.2.0의 ONNX Web
  런타임은 현재 Xenova q8 decoder 그래프를 열 때 필수 scale 누락 오류로 실패했다.
  모델 저장소를 새 ONNX 형식으로 옮기기 전까지 무심코 메이저 업그레이드하지 않는다.
