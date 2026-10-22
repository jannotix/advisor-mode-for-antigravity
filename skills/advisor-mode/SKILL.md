---
name: advisor-mode
description: "Configure, inspect, or switch models and gates in Advisor Mode for Antigravity (advisor-config.json). Use when the user asks to change the Advisor or Executor model, adjust failure thresholds, or check Advisor Mode status."
---

# Advisor Mode Configuration Skill

Manage the Advisor Mode configuration stored at `<antigravity-config-dir>/plugins/advisor-mode-for-antigravity/advisor-config.json`. Note that on Windows, macOS, and Linux, `<antigravity-config-dir>` corresponds to the user's home configuration folder for Antigravity.

## Configuration Structure

`advisor-config.json` controls:
- `enabled` (boolean): toggles lifecycle hook injections without uninstalling the plugin.
- `roles.unknownModelRole`: default role (`"executor"` or `"advisor"`) for unrecognized UI model names (fail-closed default is `"executor"`).
- `roles.advisor`:
  - `label`: human-readable label for the frontier Advisor and Reviewer model (for example, `"Frontier Advisor (Pro Tier)"`).
  - `subagentName`: `"advisor-reviewer"`.
  - `subagentTier`: tier passed when invoking the subagent (`"pro"`).
  - `uiModelPatterns`: substrings matched against `modelName` at session start to detect when the UI already runs the frontier Advisor model.
- `roles.executor`:
  - `label`: human-readable label for the fast Executor model (for example, `"Fast Executor (Flash Tier)"`).
  - `subagentName`: `"flash-executor"`.
  - `subagentTier`: tier passed when invoking the subagent (`"flash"`).
  - `uiModelPatterns`: substrings matched against `modelName` at session start to detect when the UI runs the Executor model.
- `gates.planBeforeComplexTask`: enforces pre-task architecture validation before multi-file edits (default: `true`).
- `gates.maxConsecutiveFailures`: number of consecutive command errors before the hook fires the Two-Strike Circuit Breaker (default: `2`, set to `0` to disable).
- `gates.mandatoryFinalReview`: enforces approved final review and file hash verification before task completion (default: `true`).
- `defaults.simplicityIntensity`: baseline minimalist engineering rigor (`"full"`).
- `defaults.actionFirstOutput`: lead with direct action on line 1 (`true`).

## Lifecycle Hooks Enforced

The plugin registers five lifecycle hooks:
1. `SessionStart`: Injects active operational gate directives based on detected model tier.
2. `PreToolUse`: Prevents unvalidated multi-file edits and blocks tool calls when the circuit breaker is tripped.
3. `PostToolUse`: Tracks failure signatures, records file modification hashes, and verifies Advisor reviews.
4. `PreInvocation`: Injects ephemeral circuit breaker warnings while preserving breaker status.
5. `Stop`: Enforces mandatory final review and on-disk SHA-256 hash matching before task completion.

## Updating Configuration and Verifying

When the user asks to update models or thresholds:
1. Edit `<antigravity-config-dir>/plugins/advisor-mode-for-antigravity/advisor-config.json` to update `label`, `subagentTier`, `uiModelPatterns`, or gate switches.
2. Run test suite: `node --test tests/advisor-hook.test.mjs`.
3. Verify the hook with a dry run using `node ./scripts/advisor-hook.mjs SessionStart`.
