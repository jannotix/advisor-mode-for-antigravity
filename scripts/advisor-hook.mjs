import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const FILE_EDIT_TOOLS = new Set(['write_file', 'edit_file', 'replace_file_content', 'multi_replace_file_content']);

function extractTargetFile(args) {
  return args?.Path || args?.TargetFile || args?.filePath || args?.path || '';
}

function computeFileVersionHash(filePath, args, fsImpl) {
  try {
    if (filePath && fsImpl?.existsSync(filePath)) {
      return crypto.createHash('sha256').update(fsImpl.readFileSync(filePath)).digest('hex');
    }
  } catch {}
  const fallback = { filePath: filePath || '', content: args?.Content ?? args?.Replacement ?? args?.ReplacementContent ?? args?.ReplacementChunks ?? args?.CodeContent ?? '' };
  return crypto.createHash('sha256').update(JSON.stringify(fallback)).digest('hex');
}

function isCommandFailure(p) {
  if (p?.error && String(p.error).trim()) return true;
  if (typeof p?.exitCode === 'number' && p.exitCode !== 0) return true;
  if (typeof p?.toolResult?.exitCode === 'number' && p.toolResult.exitCode !== 0) return true;
  if (p?.toolResult?.error && String(p.toolResult.error).trim()) return true;
  return p?.status === 'ERROR' || p?.toolResult?.status === 'ERROR';
}

function normalizeFailureSignature(p) {
  const cmd = String(p?.toolCall?.args?.CommandLine || p?.args?.CommandLine || '').trim().toLowerCase();
  const exitCode = p?.exitCode ?? p?.toolResult?.exitCode ?? (isCommandFailure(p) ? 1 : 0);
  const rawErr = String(p?.error || p?.toolResult?.error || p?.output || p?.toolResult?.output || p?.toolResult?.stderr || '').toLowerCase();
  const normErr = rawErr
    .replace(/\d{4}-\d{2}-\d{2}[t\s]\d{2}:\d{2}:\d{2}[^\s]*/gi, '<timestamp>')
    .replace(/[a-f0-9]{8,}/gi, '<hash>')
    .replace(/\b\d+\b/g, '<num>')
    .replace(/\s+/g, ' ')
    .trim();
  return `${cmd}::${exitCode}::${normErr}`;
}

export function runAdvisorHook({ event, payload = {}, pluginDir, fsImpl = fs }) {
  const safePluginDir = pluginDir || process.cwd();
  const neutralOutput = (ev) => (ev === 'PreToolUse' ? { decision: 'allow' } : {});
  try {
    const configPath = path.join(safePluginDir, 'advisor-config.json');
    if (!fsImpl.existsSync(configPath)) return neutralOutput(event);

    let cfg = {};
    try {
      cfg = JSON.parse(fsImpl.readFileSync(configPath, 'utf8'));
    } catch {
      return neutralOutput(event);
    }
    if (!cfg.enabled) return neutralOutput(event);

    const stateDir = path.join(safePluginDir, '.state');
    const fbSource = payload?.transcriptPath || payload?.artifactDirectoryPath || payload?.workspacePaths?.[0] || '';
    const convId = (payload?.conversationId && typeof payload.conversationId === 'string' && payload.conversationId.trim())
      ? payload.conversationId.trim()
      : (fbSource ? 'ctx_' + crypto.createHash('sha256').update(String(fbSource)).digest('hex').slice(0, 16) : 'default');
    const stateFile = path.join(stateDir, `${convId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);

    let state = {};
    if (fsImpl.existsSync(stateFile)) {
      try { state = JSON.parse(fsImpl.readFileSync(stateFile, 'utf8')); } catch { state = {}; }
    }
    state = (state && typeof state === 'object') ? state : {};
    state.modifiedFiles = state.modifiedFiles || {};
    state.verifiedFiles = state.verifiedFiles || {};
    state.circuitBreakerTripped = Boolean(state.circuitBreakerTripped);
    if (payload?.transcriptPath && !state.transcriptPath) state.transcriptPath = payload.transcriptPath;

    const persistState = () => {
      if (!fsImpl.existsSync(stateDir)) fsImpl.mkdirSync(stateDir, { recursive: true });
      fsImpl.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
    };

    const advisorLabel = cfg.roles?.advisor?.label || 'Frontier Advisor (Pro Tier)';
    const advisorSub = cfg.roles?.advisor?.subagentName || 'advisor-reviewer';
    const advisorTier = cfg.roles?.advisor?.subagentTier || 'pro';
    const execLabel = cfg.roles?.executor?.label || 'Fast Executor (Flash Tier)';
    const execSub = cfg.roles?.executor?.subagentName || 'flash-executor';
    const execTier = cfg.roles?.executor?.subagentTier || 'flash';

    const executorPatterns = (cfg.roles?.executor?.uiModelPatterns || ['flash', 'lite', 'fast']).map(p => String(p).toLowerCase());
    const advisorPatterns = (cfg.roles?.advisor?.uiModelPatterns || ['pro', 'argon', 'ultra', 'high']).map(p => String(p).toLowerCase());
    const unknownModelRole = cfg.roles?.unknownModelRole === 'advisor' ? 'advisor' : 'executor';

    const rawModel = (payload?.modelName && typeof payload.modelName === 'string') ? payload.modelName.trim().toLowerCase() : '';
    let role = state.role || '';
    if (rawModel && rawModel !== 'auto') {
      if (executorPatterns.some(p => rawModel.includes(p))) role = 'executor';
      else if (advisorPatterns.some(p => rawModel.includes(p))) role = 'advisor';
      else role = unknownModelRole;
    } else if (!role) {
      role = unknownModelRole;
    }
    state.role = role;

    const planBeforeComplexTask = cfg.gates?.planBeforeComplexTask !== false;
    const planGateMinFiles = Math.max(1, Number(cfg.gates?.planGateMinFiles ?? 2));
    const maxFail = cfg.gates?.maxConsecutiveFailures !== undefined ? Number(cfg.gates.maxConsecutiveFailures) : 2;
    const breakerEnabled = maxFail > 0;
    const mandatoryFinalReview = cfg.gates?.mandatoryFinalReview !== false;
    const simplicityIntensity = cfg.defaults?.simplicityIntensity || 'full';
    const actionFirstOutput = cfg.defaults?.actionFirstOutput !== false;

    if (event === 'SessionStart') {
      const activeGates = [];
      if (planBeforeComplexTask) activeGates.push('(1) planning and multi-file implementation');
      if (breakerEnabled) activeGates.push(`(2) after ${maxFail} consecutive failures`);
      if (mandatoryFinalReview) activeGates.push('(3) at the end of every coding task for mandatory final review');

      const defaultsDesc = `Defaults: simplicity=${simplicityIntensity}, actionFirst=${actionFirstOutput}.`;
      let msg = '';
      if (role === 'executor') {
        msg = activeGates.length === 0
          ? `[Advisor Mode: Executor UI (${rawModel || 'auto'})] You are running as Executor (${execLabel}). All operational gates are disabled. ${defaultsDesc}`
          : `[Advisor Mode: Executor UI (${rawModel || 'auto'})] You are running as Executor (${execLabel}). Invoke subagent '${advisorSub}' with Model='${advisorTier}' (${advisorLabel}) at enabled gates: ${activeGates.join(', ')}. ${defaultsDesc}`;
      } else {
        msg = `[Advisor Mode: Advisor/Architect UI (${rawModel || 'auto'})] You are running as Architect, Advisor, and Final Reviewer (${advisorLabel}). Delegate approved task implementation to subagent '${execSub}' with Model='${execTier}' (${execLabel}) and review its diff and command exit codes before closing any task. ${defaultsDesc}`;
      }

      state.sessionStartedAt = new Date().toISOString();
      persistState();
      return { injectSteps: [{ systemMessage: { systemMessage: msg } }] };
    }

    if (event === 'PreInvocation') {
      if (breakerEnabled && state.circuitBreakerTripped) {
        const breakerMsg = `[TWO-STRIKE CIRCUIT BREAKER] A command failed repeatedly (reason: ${state.circuitBreakerReason || 'same_error'}). Stop retrying blindly. If you are running on the Executor tier, immediately invoke subagent '${advisorSub}' with Model='${advisorTier}' (${advisorLabel}) and pass the error output. If you are the Advisor/Architect, stop and report Cause + Fix/Options to the user.`;
        return { injectSteps: [{ ephemeralMessage: breakerMsg }] };
      }
      return {};
    }

    const toolName = payload?.toolName || payload?.toolCall?.name || payload?.name || '';
    const args = payload?.toolCall?.args || payload?.args || {};

    if (event === 'PreToolUse') {
      if (breakerEnabled && state.circuitBreakerTripped && role === 'executor') {
        if (toolName === 'run_command' || FILE_EDIT_TOOLS.has(toolName)) {
          return { decision: 'deny', reason: `[TWO-STRIKE CIRCUIT BREAKER] Execution blocked after repeated command failure. Invoke subagent '${advisorSub}' (Model='${advisorTier}') with the error output before running further commands or edits.` };
        }
      }

      if (planBeforeComplexTask && role === 'executor' && FILE_EDIT_TOOLS.has(toolName)) {
        const targetFile = extractTargetFile(args);
        const distinct = new Set(Object.keys(state.modifiedFiles || {}));
        if (targetFile) distinct.add(targetFile);
        if (distinct.size >= planGateMinFiles && !state.planValidatedByAdvisor) {
          return { decision: 'deny', reason: `[PRE-TASK PLAN GATE] Multi-file edit blocked. Invoke subagent '${advisorSub}' (Model='${advisorTier}') to validate the architecture and plan before modifying multiple files.` };
        }
      }
      return { decision: 'allow' };
    }

    if (event === 'PostToolUse') {
      if (toolName === 'run_command') {
        const failed = isCommandFailure(payload);
        if (failed) {
          const sig = normalizeFailureSignature(payload);
          state.consecutiveFailures = (Number(state.consecutiveFailures) || 0) + 1;
          state.sameErrorFailures = (state.lastErrorSignature && state.lastErrorSignature === sig) ? ((Number(state.sameErrorFailures) || 0) + 1) : 1;
          state.lastErrorSignature = sig;
          state.lastError = String(payload?.error || payload?.toolResult?.error || payload?.output || `exit code ${payload?.exitCode ?? 1}`);
          const tripOnAny = Boolean(cfg.gates?.tripOnAnyConsecutiveFailure);
          const shouldTrip = tripOnAny ? (state.consecutiveFailures >= maxFail) : (state.sameErrorFailures >= maxFail);
          if (breakerEnabled && shouldTrip) {
            state.circuitBreakerTripped = true;
            state.circuitBreakerReason = (state.sameErrorFailures >= maxFail) ? 'same_error' : 'consecutive_errors';
          }
        } else {
          state.consecutiveFailures = 0;
          state.sameErrorFailures = 0;
          state.lastError = '';
          state.lastErrorSignature = '';
          state.circuitBreakerTripped = false;
          state.circuitBreakerReason = '';
        }
        persistState();
        return {};
      }

      if (FILE_EDIT_TOOLS.has(toolName)) {
        const hasErr = Boolean((payload.error && String(payload.error).trim()) || payload.status === 'ERROR' || payload.toolResult?.error || payload.toolResult?.status === 'ERROR');
        if (!hasErr) {
          const targetFile = extractTargetFile(args);
          if (targetFile) {
            state.modifiedFiles[targetFile] = { hash: computeFileVersionHash(targetFile, args, fsImpl), stepIdx: payload.stepIdx ?? 0, updatedAt: new Date().toISOString() };
            state.taskStatus = 'IN_PROGRESS';
            state.needsFinalReview = true;
            state.reviewStatus = (state.reviewStatus === 'APPROVED') ? 'STALE' : (state.reviewStatus || 'PENDING');
          }
        }
        persistState();
        return {};
      }

      const targetSub = args.TypeName || args.typeName || args.subagentName || '';
      const recipient = args.Recipient || args.recipient || '';
      const isAdvisorCall = (toolName === 'invoke_subagent' && targetSub === advisorSub) ||
        (toolName === 'send_message' && (recipient === advisorSub || (state.advisorConversationId && recipient === state.advisorConversationId)));

      if (isAdvisorCall) {
        state.advisorConversationId = payload.toolResult?.conversationId || payload.conversationIdFetched || payload.conversationId || state.advisorConversationId || '';
        state.lastAdvisorInvokeStep = payload.stepIdx ?? 0;
        if (payload.transcriptPath) state.transcriptPath = payload.transcriptPath;
        state.planValidatedByAdvisor = true;
        state.circuitBreakerTripped = false;
        state.circuitBreakerReason = '';
        state.consecutiveFailures = 0;
        state.sameErrorFailures = 0;
        state.lastError = '';
        state.lastErrorSignature = '';

        const hasSyncOutput = payload.toolResult !== undefined || payload.output !== undefined || payload.result !== undefined || payload.reviewVerdict !== undefined;
        const outputText = hasSyncOutput ? JSON.stringify(payload.toolResult ?? payload.output ?? payload.result ?? payload.reviewVerdict ?? '') : '';
        if (outputText.includes('CHANGES_REQUIRED')) {
          state.reviewStatus = 'CHANGES_REQUIRED';
          state.needsFinalReview = true;
          state.lastReview = { reviewer: advisorSub, tier: advisorTier, verdict: 'CHANGES_REQUIRED', stepIdx: payload.stepIdx ?? 0, reviewedAt: new Date().toISOString() };
        } else if (hasSyncOutput || !state.transcriptPath) {
          state.verifiedFiles = {};
          for (const [fp, meta] of Object.entries(state.modifiedFiles || {})) {
            let currentHash = meta.hash;
            try {
              if (fsImpl.existsSync(fp)) currentHash = crypto.createHash('sha256').update(fsImpl.readFileSync(fp)).digest('hex');
            } catch {}
            state.verifiedFiles[fp] = currentHash;
          }
          if (Object.keys(state.modifiedFiles || {}).length > 0) {
            state.reviewStatus = 'APPROVED';
            state.needsFinalReview = false;
            state.lastReview = { reviewer: advisorSub, tier: advisorTier, verdict: 'APPROVED', verifiedFiles: { ...state.verifiedFiles }, stepIdx: payload.stepIdx ?? 0, reviewedAt: new Date().toISOString() };
          }
        }
        persistState();
        return {};
      }
      return {};
    }

    if (event === 'Stop') {
      if (payload?.terminationReason === 'USER_CANCELED' || payload?.fullyIdle === false) return {};

      const tp = payload?.transcriptPath || state.transcriptPath;
      if (tp && fsImpl.existsSync(tp)) {
        try {
          const lines = fsImpl.readFileSync(tp, 'utf8').split(/\r?\n/).filter(l => l.trim());
          let latestVerdict = '';
          const maxModStep = Math.max(0, ...Object.values(state.modifiedFiles || {}).map(m => Number(m.stepIdx) || 0));
          const minStep = Math.max(Number(state.lastAdvisorInvokeStep) || 0, maxModStep);
          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              const sIdx = entry.step_index ?? entry.stepIdx;
              if (sIdx !== undefined && sIdx > minStep && (entry.type === 'SYSTEM_MESSAGE' || entry.source === 'SYSTEM')) {
                const txt = typeof entry.content === 'string' ? entry.content : JSON.stringify(entry);
                if (txt.includes('CHANGES_REQUIRED')) latestVerdict = 'CHANGES_REQUIRED';
                else if (txt.includes('APPROVED')) latestVerdict = 'APPROVED';
              }
            } catch {}
          }
          if (latestVerdict === 'CHANGES_REQUIRED') {
            state.reviewStatus = 'CHANGES_REQUIRED';
            state.needsFinalReview = true;
            state.lastReview = { reviewer: advisorSub, tier: advisorTier, verdict: 'CHANGES_REQUIRED', stepIdx: minStep, reviewedAt: new Date().toISOString() };
            persistState();
          } else if (latestVerdict === 'APPROVED' && Object.keys(state.modifiedFiles || {}).length > 0) {
            state.verifiedFiles = {};
            for (const [fp, meta] of Object.entries(state.modifiedFiles || {})) {
              let currentHash = meta.hash;
              try { if (fsImpl.existsSync(fp)) currentHash = crypto.createHash('sha256').update(fsImpl.readFileSync(fp)).digest('hex'); } catch {}
              state.verifiedFiles[fp] = currentHash;
            }
            state.reviewStatus = 'APPROVED';
            state.needsFinalReview = false;
            state.lastReview = { reviewer: advisorSub, tier: advisorTier, verdict: 'APPROVED', verifiedFiles: { ...state.verifiedFiles }, stepIdx: minStep, reviewedAt: new Date().toISOString() };
            persistState();
          }
        } catch {}
      }

      if (mandatoryFinalReview && role === 'executor') {
        const modifiedKeys = Object.keys(state.modifiedFiles || {});
        if (modifiedKeys.length > 0) {
          let verificationFailed = state.needsFinalReview === true || state.reviewStatus !== 'APPROVED' || state.lastReview?.reviewer !== advisorSub || !state.verifiedFiles;
          if (!verificationFailed) {
            for (const [fp, meta] of Object.entries(state.modifiedFiles)) {
              const verifiedHash = state.verifiedFiles[fp];
              if (!verifiedHash || verifiedHash !== meta.hash) { verificationFailed = true; break; }
              try {
                if (fsImpl.existsSync(fp) && crypto.createHash('sha256').update(fsImpl.readFileSync(fp)).digest('hex') !== verifiedHash) {
                  verificationFailed = true;
                  break;
                }
              } catch {
                verificationFailed = true;
                break;
              }
            }
          }

          if (verificationFailed) {
            state.needsFinalReview = true;
            persistState();
            return { decision: 'continue', reason: `[MANDATORY FINAL REVIEW GATE] Cannot complete task: modified files (${modifiedKeys.join(', ')}) do not have an approved final review from '${advisorSub}' matching their current file hashes (status: ${state.reviewStatus || 'PENDING'}). Invoke subagent '${advisorSub}' with Model='${advisorTier}' before stopping.` };
          }

          state.taskStatus = 'COMPLETED';
          persistState();
          return {};
        }
      }
      return {};
    }

    return {};
  } catch (err) {
    try {
      const stateDir = path.join(safePluginDir, '.state');
      if (!fsImpl.existsSync(stateDir)) fsImpl.mkdirSync(stateDir, { recursive: true });
      const logPath = path.join(stateDir, 'hook-errors.log');
      const logLine = `[${new Date().toISOString()}] [ERROR] event=${event}: ${err?.stack || err?.message || String(err)}\n`;
      if (fsImpl.appendFileSync) fsImpl.appendFileSync(logPath, logLine, 'utf8');
      else fsImpl.writeFileSync(logPath, (fsImpl.existsSync(logPath) ? fsImpl.readFileSync(logPath, 'utf8') : '') + logLine, 'utf8');
    } catch {}
    try { process.stderr.write(`[Advisor Mode Error] event=${event}: ${err?.stack || err?.message || String(err)}\n`); } catch {}
    return neutralOutput(event);
  }
}

if (process.argv[1] && process.argv[1].endsWith('advisor-hook.mjs')) {
  const event = process.argv[2] || '';
  const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let rawInput = '';
  try {
    if (!process.stdin.isTTY) {
      rawInput = await new Promise((resolve) => {
        let buf = '';
        const timer = setTimeout(() => resolve(buf), 50);
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { buf += chunk; });
        process.stdin.on('end', () => { clearTimeout(timer); resolve(buf); });
        process.stdin.on('error', () => { clearTimeout(timer); resolve(buf); });
        process.stdin.resume();
      });
    }
  } catch {
    rawInput = '';
  }
  let payload = {};
  if (rawInput && rawInput.trim()) {
    try { payload = JSON.parse(rawInput); } catch { payload = {}; }
  }
  const result = runAdvisorHook({ event, payload, pluginDir, fsImpl: fs });
  process.stdout.write(JSON.stringify(result || {}));
  process.exit(0);
}
