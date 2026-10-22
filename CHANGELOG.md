# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

## [1.1.0] - 2026-10-23

### Added
- Runtime operational gate enforcement via `PreToolUse` and `Stop` lifecycle hooks.
- SHA-256 file hash verification ensuring modified files have an approved review matching disk contents before task completion.
- Persistent Two-Strike Circuit Breaker blocking commands and edits until consultation with the Advisor subagent.
- Fail-closed role classification via `unknownModelRole` defaulting unknown and auto models to the executor role.
- Comprehensive command error detection capturing non-zero exit codes, error payloads, and normalized error signatures.
- Automated Node.js test suite in `tests/advisor-hook.test.mjs` verifying all lifecycle hooks, gates, and circuit breaker transitions.

## [1.0.0] - 2026-10-19

### Added
- Initial public release of Advisor Mode for Antigravity by Gianluca Iannotta.
- Dual-tier role configuration separating frontier reasoning (`pro` tier) and fast execution (`flash` tier).
- Three mandatory operational gates: Architecture, Planning & Pre-Task Gate, Two-Strike Circuit Breaker, and Mandatory Final Task Review Gate.
- Cross-platform Node.js lifecycle hook runner in `scripts/advisor-hook.mjs`.
- Universal craft rules covering minimalist engineering, clean prose, action-first cognitive ergonomics, and UI direction in `rules/AGENTS.md`.
- Subagent configurations for `advisor-reviewer` and `flash-executor`.
- Configuration skill in `skills/advisor-mode/SKILL.md`.
- Apache 2.0 open-source license and notice.
