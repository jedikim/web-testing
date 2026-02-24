> Language: [English](./2026-02-24-chat-driven-web-automation-mvp.en.md) | [한국어](./2026-02-24-chat-driven-web-automation-mvp.md)

# Chat-Driven Web Automation MVP Plan (EN)

Goal:
- Prepare single-node operational MVP where chat channels drive automation with checkpoint approvals.

Readiness summary:
- Current codebase is strong for library/simulation, but webhook transport, persistence, and production wiring were identified as major gaps at planning time.

Planned tasks:
1. Runtime webhook host skeleton
2. Telegram/Slack transport and signature checks
3. Persistent checkpoint/run store (SQLite)
4. Workflow-node to Playwright bridge
5. Screenshot artifact pipeline
6. End-to-end quality gate
