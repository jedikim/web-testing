## Assistantless Live E2E Report

- Date: 2026-02-24
- Command: `cd runtime && ASSISTANTLESS_KR_ITERATIONS=2 npm run test:e2e:assistantless:live`
- Result: pass (2 tests, 0 failed)
- Summary artifact: `runs/samples/artifacts/e2e-assistantless/2026-02-24/2026-02-24T04-04-18-078Z_assistantless-live-summary.json`

### Iterative Scenario Results

1. `assistantless_naver_weather_revise` (iteration 1/2)
   - status: pass
   - flow: selector drift -> revise -> recovery
2. `assistantless_daum_news_rulefirst` (iteration 1/2)
   - status: pass
   - flow: LLM warmup 1회 후 rule-first
3. `assistantless_sensitive_not_go_block` (iteration 1/2)
   - status: blocked
   - flow: 민감 액션 전 `not_go` 중단
4. `assistantless_captcha_escalation_retry` (iteration 1/2)
   - status: pass
   - flow: `YOLO26 -> VLM -> LLM solve retry` 후 통과
5. `assistantless_multisite_human_intervention` (iteration 1/2)
   - status: pass
   - flow: 멀티사이트 전환 + 중간 결정 `revise -> go`
6. `assistantless_naver_weather_revise` (iteration 2/2)
   - status: pass
7. `assistantless_daum_news_rulefirst` (iteration 2/2)
   - status: pass
8. `assistantless_sensitive_not_go_block` (iteration 2/2)
   - status: blocked
9. `assistantless_captcha_escalation_retry` (iteration 2/2)
   - status: pass
10. `assistantless_multisite_human_intervention` (iteration 2/2)
   - status: pass
   - decisions: `revise`, `go`

### Notes

- 총 10개 시나리오(5종 x 2회)에서 expected/actual status mismatch가 0건이었다.
- 모든 스텝별 before/after 스크린샷과 report JSON은 `runs/samples/artifacts/e2e-assistantless/2026-02-24/`에 저장됐다.
