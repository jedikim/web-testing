## Assistantless Live E2E Report

- Date: 2026-02-24
- Command: `cd runtime && ASSISTANTLESS_KR_ITERATIONS=5 npm run test:e2e:assistantless:live`
- Result: pass (2 tests, 0 failed)
- Summary artifact: `runs/samples/artifacts/e2e-assistantless/2026-02-24/2026-02-24T04-08-42-861Z_assistantless-live-summary.json`

### Scenario Matrix

- Scenario types: 5
  - `assistantless_naver_weather_revise`
  - `assistantless_daum_news_rulefirst`
  - `assistantless_sensitive_not_go_block`
  - `assistantless_captcha_escalation_retry`
  - `assistantless_multisite_human_intervention`
- Iterations: 5
- Total scenario runs: 25
- Mismatch(expected vs actual): 0

### Complex Flow Evidence

1. 멀티 사이트 + 중간 개입 시나리오(`assistantless_multisite_human_intervention`)에서 `revise -> go` 개입이 반복적으로 재현되었다.
2. 캡차 시나리오(`assistantless_captcha_escalation_retry`)에서 `RFDETR -> VLM -> LLM solve retry` 체인이 수행된 뒤 pass 상태를 반환했다.
3. 민감 액션 시나리오(`assistantless_sensitive_not_go_block`)는 반복마다 `blocked`로 귀결되어 handoff 정책이 유지됐다.

### Artifacts

- 시나리오별 스텝 스크린샷: `runs/samples/artifacts/e2e-assistantless/2026-02-24/*_{scenario}_it{n}_step{k}_{before|after}.png`
- 시나리오별 리포트: `runs/samples/artifacts/e2e-assistantless/2026-02-24/*_{scenario}_it{n}_report.json`
