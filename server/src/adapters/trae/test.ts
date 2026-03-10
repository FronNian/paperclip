import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "../types.js";
import {
  asNumber,
  asString,
  asStringArray,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  parseObject,
  runChildProcess,
} from "../utils.js";
import path from "node:path";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function commandLooksLike(command: string, expected: string): boolean {
  const base = path.basename(command).toLowerCase();
  return base === expected || base === `${expected}.cmd` || base === `${expected}.exe`;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, "trae-cli");
  const cwd = asString(config.cwd, process.cwd());
  const configFilePath = asString(config.configFilePath, "").trim();

  try {
    await ensureAbsoluteDirectory(cwd, { createIfMissing: true });
    checks.push({
      code: "trae_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "trae_cwd_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }
  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });

  try {
    await ensureCommandResolvable(command, cwd, runtimeEnv);
    checks.push({
      code: "trae_command_resolvable",
      level: "info",
      message: `Command is executable: ${command}`,
    });
  } catch (err) {
    checks.push({
      code: "trae_command_unresolvable",
      level: "error",
      message: err instanceof Error ? err.message : "Command is not executable",
      detail: command,
    });
  }

  if (configFilePath) {
    checks.push({
      code: "trae_config_file_path_set",
      level: "info",
      message: "Trae config file path is set.",
      detail: configFilePath,
    });
  }

  const keysPresent =
    isNonEmpty(env.OPENAI_API_KEY) ||
    isNonEmpty(process.env.OPENAI_API_KEY) ||
    isNonEmpty(env.ANTHROPIC_API_KEY) ||
    isNonEmpty(process.env.ANTHROPIC_API_KEY) ||
    isNonEmpty(env.GOOGLE_API_KEY) ||
    isNonEmpty(process.env.GOOGLE_API_KEY) ||
    isNonEmpty(env.OPENROUTER_API_KEY) ||
    isNonEmpty(process.env.OPENROUTER_API_KEY) ||
    isNonEmpty(env.DOUBAO_API_KEY) ||
    isNonEmpty(process.env.DOUBAO_API_KEY);
  if (keysPresent) {
    checks.push({
      code: "trae_api_key_present",
      level: "info",
      message: "Detected at least one supported provider API key in environment.",
    });
  } else {
    checks.push({
      code: "trae_api_key_missing",
      level: "warn",
      message: "No provider API key detected in environment variables.",
      hint: "Configure provider API keys via env or Trae config file, then retry.",
    });
  }

  const canRunProbe =
    checks.every((check) => check.code !== "trae_cwd_invalid" && check.code !== "trae_command_unresolvable");
  if (canRunProbe) {
    if (!commandLooksLike(command, "trae-cli")) {
      checks.push({
        code: "trae_help_probe_skipped_custom_command",
        level: "info",
        message: "Skipped help probe because command is not `trae-cli`.",
        detail: command,
      });
    } else {
      const extraArgs = (() => {
        const fromExtraArgs = asStringArray(config.extraArgs);
        if (fromExtraArgs.length > 0) return fromExtraArgs;
        return asStringArray(config.args);
      })();
      const timeoutSec = asNumber(config.timeoutSec, 15);
      const graceSec = asNumber(config.graceSec, 2);
      const args = ["--help", ...extraArgs];
      const probe = await runChildProcess(
        `trae-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        command,
        args,
        {
          cwd,
          env,
          timeoutSec,
          graceSec,
          onLog: async () => {},
        },
      );

      if (probe.timedOut) {
        checks.push({
          code: "trae_help_probe_timed_out",
          level: "warn",
          message: "Trae help probe timed out.",
        });
      } else if ((probe.exitCode ?? 1) === 0) {
        checks.push({
          code: "trae_help_probe_passed",
          level: "info",
          message: "Trae CLI responded to --help.",
        });
      } else {
        checks.push({
          code: "trae_help_probe_failed",
          level: "warn",
          message: "Trae CLI returned a non-zero exit code for --help.",
          detail: `exitCode=${probe.exitCode ?? -1}`,
        });
      }
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}

