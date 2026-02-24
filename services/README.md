> Language: [English](./README.en.md) | [한국어](./README.md)

# services

Python 보조 서비스(DSPy/GEPA/Vision) 영역이다.

## 원칙

- 코어 실행 흐름은 `runtime`이 담당한다.
- `services`는 오프라인 학습/보조 추론/시각 해석에 한정한다.
- 보안 민감 구간(캡차/2FA/결제 우회)은 구현하지 않는다.
