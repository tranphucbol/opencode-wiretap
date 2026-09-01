import path from "node:path";
import os from "node:os";

const DEFAULT_LOG_DIR = path.join(
  os.homedir(),
  ".config/opencode/logs/wiretap",
);

export const USAGE = `opencode-wiretap-viewer — inspect captured OpenCode LLM requests

Usage: opencode-wiretap-viewer [options]

Options:
  -p, --port <n>       port to listen on            (env PORT / API_PORT, default 3001)
  -l, --log-dir <dir>  wiretap capture directory    (env LOG_DIR, default ${DEFAULT_LOG_DIR})
      --db <file>      OpenCode SQLite database     (env OPENCODE_DB)
  -h, --help           show this message
`;

export interface Options {
  port: number;
  logDir: string;
}

/**
 * Resolve runtime options. Precedence: CLI flag > environment > default.
 * `--db` is folded back into OPENCODE_DB because db.ts reads it at import
 * time, so it must be applied before that module is loaded.
 */
export function parseArgs(argv: string[]): Options | "help" {
  let port: string | undefined;
  let logDir: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} requires a value`);
      return v;
    };
    switch (arg) {
      case "-h":
      case "--help":
        return "help";
      case "-p":
      case "--port":
        port = next();
        break;
      case "-l":
      case "--log-dir":
        logDir = next();
        break;
      case "--db":
        process.env.OPENCODE_DB = next();
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }

  const rawPort = port ?? process.env.PORT ?? process.env.API_PORT ?? "3001";
  const parsedPort = Number(rawPort);
  if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
    throw new Error(`invalid port: ${rawPort}`);
  }

  return {
    port: parsedPort,
    logDir: path.resolve(logDir ?? process.env.LOG_DIR ?? DEFAULT_LOG_DIR),
  };
}
