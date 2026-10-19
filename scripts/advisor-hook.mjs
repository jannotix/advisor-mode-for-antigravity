import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function writeSafeJson(obj) {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

try {
  const event = process.argv[2] || '';
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const pluginDir = path.resolve(__dirname, '..');
  const configPath = path.join(pluginDir, 'advisor-config.json');

  if (!fs.existsSync(configPath)) {
    writeSafeJson({});
  }

  const rawConfig = fs.readFileSync(configPath, 'utf8');
  const cfg = JSON.parse(rawConfig);
  if (!cfg.enabled) {
    writeSafeJson({});
  }

  let rawInput = '';
  try {
    rawInput = fs.readFileSync(0, 'utf8');
  } catch {
    rawInput = '';
  }

  let payload = {};
  if (rawInput && rawInput.trim()) {
    try {
      payload = JSON.parse(rawInput);
    } catch {
      payload = {};
    }
  }

  const convId = (payload.conversationId && typeof payload.conversationId === 'string')
    ? payload.conversationId
    : 'default';

  const modelName = (payload.modelName && typeof payload.modelName === 'string')
    ? payload.modelName.toLowerCase()
    : 'auto';

  const stateDir = path.join(pluginDir, '.state');
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  const safeConvId = convId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const stateFile = path.join(stateDir, `${safeConvId}.json`);

  const advisorLabel = cfg.roles?.advisor?.label || 'Frontier Advisor (Pro Tier)';
  const advisorSub = cfg.roles?.advisor?.subagentName || 'advisor-reviewer';
  const advisorTier = cfg.roles?.advisor?.subagentTier || 'pro';
  const execLabel = cfg.roles?.executor?.label || 'Fast Executor (Flash Tier)';
  const execSub = cfg.roles?.executor?.subagentName || 'flash-executor';
  const execTier = cfg.roles?.executor?.subagentTier || 'flash';
  const maxFail = Number(cfg.gates?.maxConsecutiveFailures || 2);

  const executorPatterns = cfg.roles?.executor?.uiModelPatterns || ['flash', 'lite', 'fast'];
  let isExecutorModel = false;
  for (const pat of executorPatterns) {
    if (modelName.includes(String(pat).toLowerCase())) {
      isExecutorModel = true;
      break;
    }
  }

  if (event === 'SessionStart') {
    let msg = '';
    if (isExecutorModel) {
      msg = `[Advisor Mode: Executor UI (${modelName})] You are running as Executor (${execLabel}). Invoke subagent '${advisorSub}' with Model='${advisorTier}' (${advisorLabel}) at 3 mandatory gates: (1) when planning a SaaS, product, system architecture, specification, or roadmap, and before multi-file/complex implementation, (2) after ${maxFail} consecutive failures, (3) at the end of every coding task for mandatory final review.`;
    } else {
      msg = `[Advisor Mode: Advisor/Architect UI (${modelName})] You are running as Architect, Advisor, and Final Reviewer (${advisorLabel}). Delegate approved task implementation to subagent '${execSub}' with Model='${execTier}' (${execLabel}) and review its diff and command exit codes before closing any task.`;
    }

    writeSafeJson({
      injectSteps: [
        {
          systemMessage: {
            systemMessage: msg
          }
        }
      ]
    });
  }

  if (event === 'PostToolUse') {
    const hasError = Boolean(payload.error && String(payload.error).trim());
    let count = 0;
    if (fs.existsSync(stateFile)) {
      try {
        const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        count = Number(st.consecutiveFailures) || 0;
      } catch {
        count = 0;
      }
    }

    let lastErr = '';
    if (hasError) {
      count += 1;
      lastErr = String(payload.error);
    } else {
      count = 0;
      lastErr = '';
    }

    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        consecutiveFailures: count,
        lastError: lastErr,
        updatedAt: new Date().toISOString()
      }),
      'utf8'
    );

    writeSafeJson({});
  }

  if (event === 'PreInvocation') {
    if (fs.existsSync(stateFile)) {
      let count = 0;
      try {
        const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        count = Number(st.consecutiveFailures) || 0;
      } catch {
        count = 0;
      }

      if (count >= maxFail) {
        fs.writeFileSync(
          stateFile,
          JSON.stringify({
            consecutiveFailures: 0,
            lastError: '',
            updatedAt: new Date().toISOString()
          }),
          'utf8'
        );

        const breakerMsg = `[TWO-STRIKE CIRCUIT BREAKER] A command failed ${count} times consecutively. Stop retrying blindly. If you are running on the Executor tier, immediately invoke subagent '${advisorSub}' with Model='${advisorTier}' (${advisorLabel}) and pass the error output. If you are the Advisor/Architect, stop and report Cause + Fix/Options to the user.`;

        writeSafeJson({
          injectSteps: [
            {
              ephemeralMessage: breakerMsg
            }
          ]
        });
      }
    }

    writeSafeJson({});
  }

  writeSafeJson({});
} catch {
  writeSafeJson({});
}
