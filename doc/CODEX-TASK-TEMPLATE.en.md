> Language: [English](./CODEX-TASK-TEMPLATE.en.md) | [한국어](./CODEX-TASK-TEMPLATE.md)

# CODEX TASK TEMPLATE

## 1) Request Template (User -> Codex)

```md
### Goal
(1-2 lines)

### Constraints
- must:
- must-not:
- budget/latency:

### Inputs
- url:
- credentials source:
- target data:
- chat channel: telegram/slack
- user chat id:

### Done Criteria
- [ ] functional completion
- [ ] test completion
- [ ] review approval
```

## 2) Internal Execution Template (Codex)

```md
## Plan
1.
2.

## Build
- files:
- changes:

## Test
- unit:
- integration:
- scenario:

## Fix
- failure:
- patch:
- retest:

## Review
- decision: approve/rework
- blocker_major_count:
```

## 3) Evolution Template (Bug/Exception)

```md
## Evolution Trigger
- type: bug|exception
- source run:
- why now:

## Sandbox Candidate
- base branch:
- candidate branch:
- worktree path:
- scenario pack:

## Test/Fix Loop
- attempt-1:
- attempt-2:
- final status:

## Promotion
- approved by:
- active pointer path:
- version history path:
```
