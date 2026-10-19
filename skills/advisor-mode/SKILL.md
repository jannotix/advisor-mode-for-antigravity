---
name: advisor-mode
description: "Configure, inspect, or switch models and gates in Advisor Mode for Antigravity (advisor-config.json). Use when the user asks to change the Advisor or Executor model, adjust failure thresholds, or check Advisor Mode status."
---

# Advisor Mode Configuration Skill

Manage the Advisor Mode configuration stored at `<antigravity-config-dir>/plugins/advisor-mode-for-antigravity/advisor-config.json`. Note that on Windows, macOS, and Linux, `<antigravity-config-dir>` corresponds to the user's home configuration folder for Antigravity.

## Configuration Structure

`advisor-config.json` controls:
- `enabled` (boolean): toggles lifecycle hook injections without uninstalling the plugin.
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
- `gates.maxConsecutiveFailures`: number of consecutive `run_command` errors before the hook fires the Two-Strike Circuit Breaker (default: `2`).

## Updating Configuration

When the user asks to update models or thresholds:
1. Edit `<antigravity-config-dir>/plugins/advisor-mode-for-antigravity/advisor-config.json` to update `label`, `subagentTier`, or `uiModelPatterns`.
2. Update display labels or pattern lists as requested.
3. Verify the hook with a dry run using `node ./scripts/advisor-hook.mjs SessionStart`.
