import type { ServerAdapterModule } from "../types.js";
import { execute } from "./execute.js";
import { testEnvironment } from "./test.js";

export const traeAdapter: ServerAdapterModule = {
  type: "trae",
  execute,
  testEnvironment,
  models: [],
  supportsLocalAgentJwt: true,
  agentConfigurationDoc: `# trae agent configuration

Adapter: trae

Use when:
- You want Paperclip to run Trae CLI locally as the agent runtime

Core fields:
- cwd (string, optional): absolute working directory
- promptTemplate (string, optional): run prompt template
- command (string, optional): defaults to "trae-cli"
- configFilePath (string, optional): path to Trae config file (passed as --config-file-path)
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- Runs are executed with: trae-cli run --console-type simple --working-dir <cwd> --file <taskfile>
- The task prompt is written to a temp file and passed via --file.
`,
};

export const traeCnAdapter: ServerAdapterModule = {
  ...traeAdapter,
  type: "trae_cn",
  agentConfigurationDoc: `# trae_cn agent configuration

Adapter: trae_cn

Same runtime behavior as the trae adapter, but intended for Trae CN environments.

Core fields:
- cwd (string, optional): absolute working directory
- promptTemplate (string, optional): run prompt template
- command (string, optional): defaults to "trae-cli"
- configFilePath (string, optional): path to Trae config file (passed as --config-file-path)
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables
`,
};

