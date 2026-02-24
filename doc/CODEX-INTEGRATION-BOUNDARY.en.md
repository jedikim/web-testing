> Language: [English](./CODEX-INTEGRATION-BOUNDARY.en.md) | [한국어](./CODEX-INTEGRATION-BOUNDARY.md)

# CODEX INTEGRATION BOUNDARY

## 0. Purpose

Define a strict responsibility boundary between this repository and the external AI-assistant project.

## 1. This Repository Owns (Web Automation Core)

1. workflow parsing/execution (`runtime/src/workflow`, `runtime/src/engine`)
2. selector/vision fallback and patch-only recovery
3. screenshot checkpoint core runtime (`runHumanLoop`)
4. artifact schema and validation
5. assistantless E2E simulation
6. bug/exception evolution backend with approval promotion pointer

## 2. External AI-Assistant Project Owns

1. Telegram/Slack webhook and signature validation
2. message/session routing
3. assistant prompts, tool orchestration, memory
4. deployment/runtime operations (systemd/launchd/secrets/network)

## 3. Port Contract

External project must implement:
1. `DecisionPort.requestDecision(...)` -> `go/not_go/revise/unknown`
2. inject `run` and `reviseWithLlm` into `runHumanLoop(...)`
3. adapt screenshot path/question text per channel payload format

## 4. Principles

1. no hard dependency on channel SDK inside this core
2. channel replacement should not require core logic rewrite
3. sensitive actions require explicit `go`
