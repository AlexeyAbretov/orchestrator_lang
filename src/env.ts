import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface Config {
  token: string;
  repo: string;
  owner: string;
  name: string;
  pollIntervalSeconds: number;
}

export function loadEnvFile(path = resolve(process.cwd(), ".env")): void {
  if (!existsSync(path)) return;

  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function loadConfig(): Config {
  loadEnvFile();

  const token = process.env.GITHUB_TOKEN?.trim() ?? "";
  const repo = process.env.GITHUB_REPO?.trim() ?? "";

  if (!token) {
    throw new Error(
      "Не задан GITHUB_TOKEN. Укажите его в .env или в окружении.",
    );
  }

  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(repo);
  const owner = match?.[1];
  const name = match?.[2];
  if (!owner || !name) {
    throw new Error(
      "GITHUB_REPO должен быть в формате owner/name, например AlexeyAbretov/orchestrator_lang.",
    );
  }

  return {
    token,
    repo,
    owner,
    name,
    pollIntervalSeconds: readPollIntervalSeconds(),
  };
}

function readPollIntervalSeconds(): number {
  const raw = process.env.POLL_INTERVAL_SECONDS?.trim();
  if (!raw) return 60;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 5) {
    throw new Error(
      "POLL_INTERVAL_SECONDS должен быть целым числом не меньше 5.",
    );
  }

  return value;
}
