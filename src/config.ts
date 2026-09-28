import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface CursorSettings {
  apiKey: string;
  repoUrl: string;
  startingRef: string;
  model: string;
  fast: boolean;
}

export class Config {
  readonly token: string;
  readonly repo: string;
  readonly owner: string;
  readonly name: string;
  readonly pollIntervalSeconds: number;
  readonly cursor: CursorSettings;

  constructor(path = resolve(process.cwd(), ".env")) {
    Config.loadEnvFile(path);

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
        "GITHUB_REPO должен быть в формате owner/name, " +
          "например AlexeyAbretov/orchestrator_lang.",
      );
    }

    this.token = token;
    this.repo = repo;
    this.owner = owner;
    this.name = name;
    this.pollIntervalSeconds = Config.readPollIntervalSeconds();
    this.cursor = Config.readCursorSettings();
  }

  private static loadEnvFile(path: string): void {
    if (!existsSync(path)) {
      return;
    }

    const text = readFileSync(path, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();

      if (!line || line.startsWith("#")) {
        continue;
      }

      const eq = line.indexOf("=");

      if (eq <= 0) {
        continue;
      }

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

  private static readPollIntervalSeconds(): number {
    const raw = process.env.POLL_INTERVAL_SECONDS?.trim();

    if (!raw) {
      return 60;
    }

    const value = Number(raw);

    if (!Number.isInteger(value) || value < 5) {
      throw new Error(
        "POLL_INTERVAL_SECONDS должен быть целым числом не меньше 5.",
      );
    }

    return value;
  }

  private static readCursorSettings(): CursorSettings {
    const apiKey = process.env.CURSOR_API_KEY?.trim() ?? "";

    if (!apiKey) {
      throw new Error(
        "Не задан CURSOR_API_KEY. Укажите его в .env или в окружении.",
      );
    }

    const repoUrl = (process.env.CURSOR_REPO_URL?.trim() ?? "").replace(
      /\/$/,
      "",
    );

    if (!/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+$/.test(repoUrl)) {
      throw new Error(
        "CURSOR_REPO_URL должен быть https://github.com/owner/name.",
      );
    }

    const startingRef = process.env.CURSOR_STARTING_REF?.trim() || "main";
    const model = process.env.CURSOR_MODEL?.trim() || "composer-2.5";
    const fast = process.env.CURSOR_FAST?.trim() || "false";

    if (fast !== "true" && fast !== "false") {
      throw new Error("CURSOR_FAST должен быть true или false.");
    }

    return {
      apiKey,
      repoUrl,
      startingRef,
      model,
      fast: fast === "true",
    };
  }
}
