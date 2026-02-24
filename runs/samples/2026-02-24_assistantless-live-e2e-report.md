## Assistantless Live E2E Report

- Date: 2026-02-24
- Command: `cd runtime && ASSISTANTLESS_KR_ITERATIONS=3 npm run test:e2e:assistantless:live`
- Result: pass (2 tests, 0 failed)
- Summary artifact: `runs/samples/artifacts/e2e-assistantless/2026-02-24/2026-02-24T03-57-40-045Z_assistantless-live-summary.json`

### Iterative Scenario Results

1. `assistantless_naver_weather_revise` (iteration 1/3)
   - status: pass
   - flow: initial selector drift -> YOLO26 힌트 -> revise -> pass
   - decisions: `revise`
2. `assistantless_daum_news_rulefirst` (iteration 1/3)
   - status: pass
   - flow: LLM warmup 1회 후 rule-first 반복
3. `assistantless_sensitive_not_go_block` (iteration 1/3)
   - status: blocked
   - flow: 민감 액션 전 사용자 `not_go`로 중단
4. `assistantless_captcha_escalation_retry` (iteration 1/3)
   - status: pass
   - flow: `YOLO26 -> VLM -> LLM solve retry` 후 진행
5. `assistantless_naver_weather_revise` (iteration 2/3)
   - status: pass
   - decisions: `revise`
6. `assistantless_daum_news_rulefirst` (iteration 2/3)
   - status: pass
7. `assistantless_sensitive_not_go_block` (iteration 2/3)
   - status: blocked
   - decisions: `not_go`
8. `assistantless_captcha_escalation_retry` (iteration 2/3)
9. `assistantless_naver_weather_revise` (iteration 3/3)
   - status: pass
10. `assistantless_daum_news_rulefirst` (iteration 3/3)
   - status: pass
11. `assistantless_sensitive_not_go_block` (iteration 3/3)
   - status: blocked
12. `assistantless_captcha_escalation_retry` (iteration 3/3)
   - status: pass
   - flow: captcha escalation retry success

### Notes

- 총 12개 시나리오(4종 x 3회) 모두 expected status와 actual status가 일치했다.
- 각 step의 before/after 스크린샷과 scenario별 JSON report는 `runs/samples/artifacts/e2e-assistantless/2026-02-24/`에 저장됐다.
