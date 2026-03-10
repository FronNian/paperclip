import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdapterExecutionContext, AdapterExecutionResult } from "../types.js";
import {
  asString,
  asNumber,
  asStringArray,
  parseObject,
  buildPaperclipEnv,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  redactEnvForLogs,
  renderTemplate,
  runChildProcess,
} from "../utils.js";

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function hasNonEmptyEnvValue(env: Record<string, string>, key: string): boolean {
  const raw = env[key];
  return typeof raw === "string" && raw.trim().length > 0;
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, config, context, onLog, onMeta, authToken } = ctx;

  const promptTemplate = asString(
    config.promptTemplate,
    "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.",
  );
  const command = asString(config.command, "trae-cli");

  const configuredCwd = asString(config.cwd, "");
  const cwd = configuredCwd || process.cwd();
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const envConfig = parseObject(config.env);
  const hasExplicitApiKey =
    typeof envConfig.PAPERCLIP_API_KEY === "string" && envConfig.PAPERCLIP_API_KEY.trim().length > 0;
  const env: Record<string, string> = { ...buildPaperclipEnv(agent) };
  env.PAPERCLIP_RUN_ID = runId;
  for (const [k, v] of Object.entries(envConfig)) {
    if (typeof v === "string") env[k] = v;
  }
  if (!hasExplicitApiKey && authToken) {
    env.PAPERCLIP_API_KEY = authToken;
  }

  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });
  await ensureCommandResolvable(command, cwd, runtimeEnv);

  const timeoutSec = asNumber(config.timeoutSec, 0);
  const graceSec = asNumber(config.graceSec, 20);
  const configFilePath = asString(config.configFilePath, "").trim();
  const extraArgs = (() => {
    const fromExtraArgs = asStringArray(config.extraArgs);
    if (fromExtraArgs.length > 0) return fromExtraArgs;
    return asStringArray(config.args);
  })();

  const renderedPrompt = renderTemplate(promptTemplate, {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    company: { id: agent.companyId },
    agent,
    run: { id: runId, source: "on_demand" },
    context,
  });

  const workingDirArg = ["--working-dir", cwd];
  const baseArgs = ["run", "--console-type", "simple", ...workingDirArg];
  if (configFilePath) {
    baseArgs.push("--config-file-path", configFilePath);
  }
  if (extraArgs.length > 0) {
    baseArgs.push(...extraArgs);
  }

  const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-trae-"));
  const taskPath = path.join(taskDir, `task-${runId}.md`);
  await fs.writeFile(taskPath, renderedPrompt, "utf8");
  const args = [...baseArgs, "--file", taskPath];

  if (onMeta) {
    await onMeta({
      adapterType: agent.adapterType ?? "trae",
      command,
      cwd,
      commandArgs: args,
      env: redactEnvForLogs(env),
      prompt: renderedPrompt,
      context,
    });
  }

  try {
    const proc = await runChildProcess(runId, command, args, {
      cwd,
      env,
      timeoutSec,
      graceSec,
      onLog,
    });

    if (proc.timedOut) {
      return {
        exitCode: proc.exitCode,
        signal: proc.signal,
        timedOut: true,
        errorMessage: `Timed out after ${timeoutSec}s`,
        resultJson: {
          stdout: proc.stdout,
          stderr: proc.stderr,
        },
      };
    }

    const apiKeyPresent =
      hasNonEmptyEnvValue(env, "OPENAI_API_KEY") ||
      hasNonEmptyEnvValue(env, "ANTHROPIC_API_KEY") ||
      hasNonEmptyEnvValue(env, "GOOGLE_API_KEY") ||
      hasNonEmptyEnvValue(env, "OPENROUTER_API_KEY") ||
      hasNonEmptyEnvValue(env, "DOUBAO_API_KEY");

    const summary = firstNonEmptyLine(proc.stderr) || firstNonEmptyLine(proc.stdout);

    if ((proc.exitCode ?? 0) !== 0) {
      return {
        exitCode: proc.exitCode,
        signal: proc.signal,
        timedOut: false,
        errorMessage: summary || `Trae exited with code ${proc.exitCode ?? -1}`,
        resultJson: {
          stdout: proc.stdout,
          stderr: proc.stderr,
          apiKeyPresent,
        },
        summary: summary || null,
      };
    }

    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: false,
      resultJson: {
        stdout: proc.stdout,
        stderr: proc.stderr,
        apiKeyPresent,
      },
      summary: summary || null,
    };
  } finally {
    await fs.rm(taskDir, { recursive: true, force: true }).catch(() => {});
  }
}

