import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { runAdvisorHook } from '../scripts/advisor-hook.mjs';

function createTestEnv(customConfig = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-test-'));
  const baseConfig = {
    enabled: true,
    roles: {
      unknownModelRole: 'executor',
      advisor: {
        label: 'Frontier Advisor (Pro Tier)',
        subagentName: 'advisor-reviewer',
        subagentTier: 'pro',
        uiModelPatterns: ['pro', 'argon', 'ultra', 'high']
      },
      executor: {
        label: 'Fast Executor (Flash Tier)',
        subagentName: 'flash-executor',
        subagentTier: 'flash',
        uiModelPatterns: ['flash', 'lite', 'fast']
      }
    },
    gates: {
      planBeforeComplexTask: true,
      maxConsecutiveFailures: 2,
      mandatoryFinalReview: true
    },
    defaults: { simplicityIntensity: 'full', actionFirstOutput: true }
  };

  const finalConfig = {
    ...baseConfig,
    ...customConfig,
    roles: { ...baseConfig.roles, ...(customConfig.roles || {}) },
    gates: { ...baseConfig.gates, ...(customConfig.gates || {}) },
    defaults: { ...baseConfig.defaults, ...(customConfig.defaults || {}) }
  };

  fs.writeFileSync(path.join(tmpDir, 'advisor-config.json'), JSON.stringify(finalConfig, null, 2), 'utf8');
  return {
    pluginDir: tmpDir,
    cleanup: () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }
  };
}

test('1. Role recognition: flash, pro, argon, unknown, and auto models', (t) => {
  const env = createTestEnv();
  t.after(env.cleanup);

  const resFlash = runAdvisorHook({ event: 'SessionStart', payload: { conversationId: 'c-flash', modelName: 'antigravity-flash' }, pluginDir: env.pluginDir });
  assert.ok(resFlash.injectSteps?.[0]?.systemMessage?.systemMessage?.includes('Executor UI'));

  const resPro = runAdvisorHook({ event: 'SessionStart', payload: { conversationId: 'c-pro', modelName: 'frontier-pro-model' }, pluginDir: env.pluginDir });
  assert.ok(resPro.injectSteps?.[0]?.systemMessage?.systemMessage?.includes('Advisor/Architect UI'));

  const resArgon = runAdvisorHook({ event: 'SessionStart', payload: { conversationId: 'c-argon', modelName: 'argon-preview' }, pluginDir: env.pluginDir });
  assert.ok(resArgon.injectSteps?.[0]?.systemMessage?.systemMessage?.includes('Advisor/Architect UI'));

  const resUnknown = runAdvisorHook({ event: 'SessionStart', payload: { conversationId: 'c-unk', modelName: 'custom-mystery-v1' }, pluginDir: env.pluginDir });
  assert.ok(resUnknown.injectSteps?.[0]?.systemMessage?.systemMessage?.includes('Executor UI'));

  const resAuto = runAdvisorHook({ event: 'SessionStart', payload: { conversationId: 'c-auto', modelName: 'auto' }, pluginDir: env.pluginDir });
  assert.ok(resAuto.injectSteps?.[0]?.systemMessage?.systemMessage?.includes('Executor UI'));

  runAdvisorHook({ event: 'PreInvocation', payload: { conversationId: 'c-pro', modelName: 'auto' }, pluginDir: env.pluginDir });
  const statePro = JSON.parse(fs.readFileSync(path.join(env.pluginDir, '.state', 'c-pro.json'), 'utf8'));
  assert.equal(statePro.role, 'advisor');
});

test('2. Config gates governance: disabling gates updates prompt and behavior', (t) => {
  const env = createTestEnv({ gates: { planBeforeComplexTask: false, maxConsecutiveFailures: 0, mandatoryFinalReview: false } });
  t.after(env.cleanup);

  const resStart = runAdvisorHook({ event: 'SessionStart', payload: { conversationId: 'c-disabled', modelName: 'flash-tier' }, pluginDir: env.pluginDir });
  assert.ok(resStart.injectSteps?.[0]?.systemMessage?.systemMessage?.includes('All operational gates are disabled'));

  const statePath = path.join(env.pluginDir, '.state', 'c-disabled.json');
  fs.writeFileSync(statePath, JSON.stringify({ role: 'executor', modifiedFiles: { 'C:/project/file1.txt': { hash: 'h1' } }, planValidatedByAdvisor: false }), 'utf8');

  const resEdit = runAdvisorHook({ event: 'PreToolUse', payload: { conversationId: 'c-disabled', toolName: 'write_file', args: { Path: 'C:/project/file2.txt' } }, pluginDir: env.pluginDir });
  assert.equal(resEdit.decision, 'allow');

  const resStop = runAdvisorHook({ event: 'Stop', payload: { conversationId: 'c-disabled' }, pluginDir: env.pluginDir });
  assert.deepEqual(resStop, {});
});

test('3. Error detection and failure signature tracking (same vs different error comparison)', (t) => {
  const env = createTestEnv();
  t.after(env.cleanup);

  const convDiff = 'c-diff-errors';
  runAdvisorHook({ event: 'PostToolUse', payload: { conversationId: convDiff, toolName: 'run_command', args: { CommandLine: 'npm test' }, error: 'fail 1' }, pluginDir: env.pluginDir });
  runAdvisorHook({ event: 'PostToolUse', payload: { conversationId: convDiff, toolName: 'run_command', args: { CommandLine: 'git status' }, error: 'fatal: not a git repo' }, pluginDir: env.pluginDir });
  let stateDiff = JSON.parse(fs.readFileSync(path.join(env.pluginDir, '.state', `${convDiff}.json`), 'utf8'));
  assert.equal(stateDiff.consecutiveFailures, 2);
  assert.equal(stateDiff.sameErrorFailures, 1);
  assert.equal(stateDiff.circuitBreakerTripped, false, 'Two different errors must NOT trip circuit breaker');

  const convSame = 'c-same-exitcode';
  runAdvisorHook({ event: 'PostToolUse', payload: { conversationId: convSame, toolName: 'run_command', args: { CommandLine: 'npm test' }, exitCode: 1 }, pluginDir: env.pluginDir });
  runAdvisorHook({ event: 'PostToolUse', payload: { conversationId: convSame, toolName: 'run_command', args: { CommandLine: 'npm test' }, exitCode: 1 }, pluginDir: env.pluginDir });
  let stateSame = JSON.parse(fs.readFileSync(path.join(env.pluginDir, '.state', `${convSame}.json`), 'utf8'));
  assert.equal(stateSame.consecutiveFailures, 2);
  assert.equal(stateSame.sameErrorFailures, 2);
  assert.equal(stateSame.circuitBreakerTripped, true, 'Two same-way failures with exitCode: 1 must trip breaker');

  runAdvisorHook({ event: 'PostToolUse', payload: { conversationId: convSame, toolName: 'run_command', args: { CommandLine: 'npm test' }, exitCode: 0 }, pluginDir: env.pluginDir });
  stateSame = JSON.parse(fs.readFileSync(path.join(env.pluginDir, '.state', `${convSame}.json`), 'utf8'));
  assert.equal(stateSame.consecutiveFailures, 0);
  assert.equal(stateSame.sameErrorFailures, 0);
  assert.equal(stateSame.circuitBreakerTripped, false);
});

test('4. Persistent Circuit Breaker across PreInvocation and PreToolUse until Advisor consultation', (t) => {
  const env = createTestEnv();
  t.after(env.cleanup);

  const convId = 'c-breaker';
  for (let i = 0; i < 2; i++) {
    runAdvisorHook({ event: 'PostToolUse', payload: { conversationId: convId, toolName: 'run_command', args: { CommandLine: 'make build' }, exitCode: 2, error: 'compiler error' }, pluginDir: env.pluginDir });
  }

  const preInvRes = runAdvisorHook({ event: 'PreInvocation', payload: { conversationId: convId }, pluginDir: env.pluginDir });
  assert.ok(preInvRes.injectSteps?.[0]?.ephemeralMessage?.includes('[TWO-STRIKE CIRCUIT BREAKER]'));

  let state = JSON.parse(fs.readFileSync(path.join(env.pluginDir, '.state', `${convId}.json`), 'utf8'));
  assert.equal(state.circuitBreakerTripped, true);

  const preCmd = runAdvisorHook({ event: 'PreToolUse', payload: { conversationId: convId, toolName: 'run_command', args: { CommandLine: 'git status' } }, pluginDir: env.pluginDir });
  assert.equal(preCmd.decision, 'deny');
  assert.ok(preCmd.reason.includes('[TWO-STRIKE CIRCUIT BREAKER]'));

  const preEdit = runAdvisorHook({ event: 'PreToolUse', payload: { conversationId: convId, toolName: 'replace_file_content', args: { TargetFile: 'C:/project/code.js' } }, pluginDir: env.pluginDir });
  assert.equal(preEdit.decision, 'deny');

  runAdvisorHook({ event: 'PostToolUse', payload: { conversationId: convId, toolName: 'invoke_subagent', args: { TypeName: 'advisor-reviewer' }, toolResult: { output: 'Fix advice' } }, pluginDir: env.pluginDir });
  state = JSON.parse(fs.readFileSync(path.join(env.pluginDir, '.state', `${convId}.json`), 'utf8'));
  assert.equal(state.circuitBreakerTripped, false);

  const preCmdAllowed = runAdvisorHook({ event: 'PreToolUse', payload: { conversationId: convId, toolName: 'run_command', args: { CommandLine: 'make build' } }, pluginDir: env.pluginDir });
  assert.equal(preCmdAllowed.decision, 'allow');
});

test('5. Task, Reviewer, Verdict and File Hash Verification', (t) => {
  const env = createTestEnv();
  t.after(env.cleanup);

  const convId = 'c-task-flow';
  const fileA = path.join(env.pluginDir, 'fileA.txt');
  const fileB = path.join(env.pluginDir, 'fileB.txt');
  fs.writeFileSync(fileA, 'initial file A content', 'utf8');
  fs.writeFileSync(fileB, 'initial file B content', 'utf8');

  const preEdit1 = runAdvisorHook({ event: 'PreToolUse', payload: { conversationId: convId, toolName: 'write_file', args: { Path: fileA } }, pluginDir: env.pluginDir });
  assert.equal(preEdit1.decision, 'allow');

  fs.writeFileSync(fileA, 'updated file A content', 'utf8');
  runAdvisorHook({ event: 'PostToolUse', payload: { conversationId: convId, toolName: 'write_file', args: { Path: fileA } }, pluginDir: env.pluginDir });

  const preEdit2 = runAdvisorHook({ event: 'PreToolUse', payload: { conversationId: convId, toolName: 'write_file', args: { Path: fileB } }, pluginDir: env.pluginDir });
  assert.equal(preEdit2.decision, 'deny');
  assert.ok(preEdit2.reason.includes('[PRE-TASK PLAN GATE]'));

  runAdvisorHook({ event: 'PostToolUse', payload: { conversationId: convId, toolName: 'invoke_subagent', args: { TypeName: 'advisor-reviewer' }, toolResult: { output: 'Architecture plan validated' } }, pluginDir: env.pluginDir });

  const preEdit2Allowed = runAdvisorHook({ event: 'PreToolUse', payload: { conversationId: convId, toolName: 'write_file', args: { Path: fileB } }, pluginDir: env.pluginDir });
  assert.equal(preEdit2Allowed.decision, 'allow');

  fs.writeFileSync(fileB, 'updated file B content', 'utf8');
  runAdvisorHook({ event: 'PostToolUse', payload: { conversationId: convId, toolName: 'write_file', args: { Path: fileB } }, pluginDir: env.pluginDir });

  const stopPending = runAdvisorHook({ event: 'Stop', payload: { conversationId: convId }, pluginDir: env.pluginDir });
  assert.equal(stopPending.decision, 'continue');
  assert.ok(stopPending.reason.includes('[MANDATORY FINAL REVIEW GATE]'));

  // fullyIdle: false permits subagent async yield without blocking Stop
  const stopYield = runAdvisorHook({ event: 'Stop', payload: { conversationId: convId, fullyIdle: false }, pluginDir: env.pluginDir });
  assert.deepEqual(stopYield, {}, 'Stop must yield when fullyIdle is false');

  runAdvisorHook({ event: 'PostToolUse', payload: { conversationId: convId, toolName: 'invoke_subagent', args: { TypeName: 'advisor-reviewer' }, toolResult: { output: 'CHANGES_REQUIRED: Add input validation' } }, pluginDir: env.pluginDir });
  const stopChangesReq = runAdvisorHook({ event: 'Stop', payload: { conversationId: convId }, pluginDir: env.pluginDir });
  assert.equal(stopChangesReq.decision, 'continue');
  assert.ok(stopChangesReq.reason.includes('CHANGES_REQUIRED'));

  runAdvisorHook({ event: 'PostToolUse', payload: { conversationId: convId, toolName: 'invoke_subagent', args: { TypeName: 'advisor-reviewer' }, toolResult: { output: 'APPROVED. All checks pass and code is lean.' } }, pluginDir: env.pluginDir });
  const stopApproved = runAdvisorHook({ event: 'Stop', payload: { conversationId: convId }, pluginDir: env.pluginDir });
  assert.deepEqual(stopApproved, {});

  fs.writeFileSync(fileA, 'tampered content after approval', 'utf8');
  const stopTampered = runAdvisorHook({ event: 'Stop', payload: { conversationId: convId }, pluginDir: env.pluginDir });
  assert.equal(stopTampered.decision, 'continue');
  assert.ok(stopTampered.reason.includes('[MANDATORY FINAL REVIEW GATE]'));

  const stopCanceled = runAdvisorHook({ event: 'Stop', payload: { conversationId: convId, terminationReason: 'USER_CANCELED' }, pluginDir: env.pluginDir });
  assert.deepEqual(stopCanceled, {});
});

test('6. CLI execution: verifies standalone stdin/stdout process execution', () => {
  const scriptPath = path.resolve('scripts', 'advisor-hook.mjs');
  const input = JSON.stringify({ conversationId: 'c-cli-test', modelName: 'antigravity-flash' });
  const output = execFileSync(process.execPath, [scriptPath, 'SessionStart'], { input, encoding: 'utf8' });
  const parsed = JSON.parse(output.trim());
  assert.ok(parsed.injectSteps);
  assert.ok(parsed.injectSteps[0].systemMessage.systemMessage.includes('Executor UI'));
});
