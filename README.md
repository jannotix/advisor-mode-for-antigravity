# Advisor Mode for Antigravity

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

A universal dual-tier engineering workflow for Antigravity. Advisor Mode pairs a high-reasoning frontier Advisor and Reviewer (`pro` tier) with a fast implementation Executor (`flash` tier), guided by built-in minimalist engineering, clean prose, action-first communication, and UI craft standards.

## Architecture

Advisor Mode introduces a bivalent workflow that adapts based on the active UI model:

### 1. Executor UI Mode (Fast Model)
When the interactive session runs on the fast model tier, the agent acts as the Executor and must consult the Advisor subagent (`advisor-reviewer`, `pro` tier) at three mandatory gates:
- **Architecture, Planning & Pre-Task Gate**: Triggers whenever planning or designing a SaaS, product, system architecture, specification, or roadmap (even when no code is written yet), as well as before multi-file or sensitive edits. Validates architecture, boundaries, and acceptance checks.
- **Two-Strike Circuit Breaker**: Automatically triggers when two consecutive command failures occur, halting blind retry loops.
- **Mandatory Final Task Review Gate**: Requires an audit of diffs, security invariants, and complexity cuts before concluding any task.

### 2. Advisor/Architect UI Mode (Frontier Model)
When the interactive session runs on the frontier model tier, the agent acts directly as Architect, Advisor, and Final Reviewer. It delegates implementation tasks to the fast Executor subagent (`flash-executor`, `flash` tier) and audits results before closing tasks.

## Built-In Craft Standards

The plugin injects four non-negotiable disciplines into every task:
1. **Minimalist Engineering**: Comprehension before brevity, the 7-rung ladder, surgical edits, root-cause fixes, and failing-first acceptance checks.
2. **Clean Prose**: Active voice, human or system subjects, no filler phrases, and zero em dashes.
3. **Action-First Cognitive Ergonomics**: Leads with direct answers or actions on line 1, bounds multi-step tasks to five items, restates progress across turns, and outputs errors strictly as cause and fix.
4. **UI Direction**: Adheres to local brand tokens and palettes without loading external CDN assets.

## Installation

Clone or copy this repository into your Antigravity plugins directory:

```bash
git clone https://github.com/jannotix/advisor-mode-for-antigravity.git <antigravity-config-dir>/plugins/advisor-mode-for-antigravity
```

Note: On Windows, macOS, and Linux, `<antigravity-config-dir>` corresponds to your user home configuration directory for Antigravity.

Restart Antigravity or refresh plugins to activate.

## Configuration

Settings are stored in `advisor-config.json` inside the plugin directory:

```json
{
  "enabled": true,
  "roles": {
    "advisor": {
      "label": "Frontier Advisor (Pro Tier)",
      "subagentName": "advisor-reviewer",
      "subagentTier": "pro",
      "uiModelPatterns": ["pro", "argon", "ultra", "high"]
    },
    "executor": {
      "label": "Fast Executor (Flash Tier)",
      "subagentName": "flash-executor",
      "subagentTier": "flash",
      "uiModelPatterns": ["flash", "lite", "fast"]
    }
  },
  "gates": {
    "planBeforeComplexTask": true,
    "maxConsecutiveFailures": 2,
    "mandatoryFinalReview": true
  },
  "defaults": {
    "simplicityIntensity": "full",
    "actionFirstOutput": true
  }
}
```

## Repository Structure

- `plugin.json`: Plugin manifest for Antigravity.
- `hooks.json`: Lifecycle hook definitions for session startup, command tracking, and circuit breaker.
- `scripts/advisor-hook.mjs`: Lightweight cross-platform Node.js lifecycle hook runner.
- `rules/AGENTS.md`: Core rules enforced across all agent sessions.
- `agents/advisor-reviewer.md`: Frontier advisor, architect, and reviewer subagent specification.
- `agents/flash-executor.md`: Fast implementation executor subagent specification.
- `skills/advisor-mode/SKILL.md`: Configuration skill for adjusting models and thresholds.

## Testing the Hooks

Execute test runs against the Node.js hook runner:

```bash
node ./scripts/advisor-hook.mjs SessionStart
```

## Author and Developer

Created and maintained by **Gianluca Iannotta**.

## License

This project is licensed under the Apache License, Version 2.0. See the [LICENSE](LICENSE) and [NOTICE](NOTICE) files for details.

## Disclaimer

Advisor Mode for Antigravity is an independent open-source project created and maintained by Gianluca Iannotta. It is not affiliated with, endorsed by, sponsored by, or officially connected to Google LLC or Google Antigravity. All product and company names are trademarks or registered trademarks of their respective holders; their use does not imply any affiliation with or endorsement by them.
