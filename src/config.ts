// Настройки процесса. Берутся из окружения и из файла .env.
// Если чего-то нет или формат кривой, конструктор бросает ошибку сразу:
// оркестратор не должен стартовать с половиной настроек.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Что нужно, чтобы поднять облачного агента Cursor.
export interface CursorSettings {
  // Ключ API. Им подписываются запросы к Cursor.
  apiKey: string;
  // Репозиторий, который агент откроет и будет читать.
  repoUrl: string;
  // Ветка, тег или коммит, с которого агент начинает.
  startingRef: string;
  // Имя модели, например composer-2.5.
  model: string;
  // true — быстрый режим модели, false — обычный.
  fast: boolean;
}

export class Config {
  // Токен GitHub с правом читать и менять issues.
  readonly token: string;
  // Репозиторий целиком, как в .env: owner/name.
  readonly repo: string;
  // Владелец: часть до слэша.
  readonly owner: string;
  // Имя репозитория: часть после слэша.
  readonly name: string;
  // Сколько секунд ждать между кругами опроса.
  readonly pollIntervalSeconds: number;
  // Ключ, модель и репозиторий для агента Cursor.
  readonly cursor: CursorSettings;

  // По умолчанию ищем .env в папке, откуда запущен процесс.
  constructor(path = resolve(process.cwd(), ".env")) {
    // Сначала подмешиваем файл в process.env.
    // Уже заданные переменные окружения не перетираем.
    Config.loadEnvFile(path);

    const token = process.env.GITHUB_TOKEN?.trim() ?? "";
    const repo = process.env.GITHUB_REPO?.trim() ?? "";

    if (!token) {
      throw new Error(
        "Не задан GITHUB_TOKEN. Укажите его в .env или в окружении.",
      );
    }

    // Ровно «слово/слово»: без пробелов и без лишних слэшей.
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

  // Читает KEY=VALUE построчно. Пустые строки и строки с # пропускает.
  private static loadEnvFile(path: string): void {
    // Файла нет — это нормально: настройки могли прийти из окружения.
    if (!existsSync(path)) {
      return;
    }

    const text = readFileSync(path, "utf8");

    // \r?\n понимает и Windows (\r\n), и Unix (\n).
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();

      if (!line || line.startsWith("#")) {
        continue;
      }

      const eq = line.indexOf("=");

      // Строка без «=» или с «=» в самом начале — не пара ключ/значение.
      if (eq <= 0) {
        continue;
      }

      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();

      // Снимаем одну пару кавычек: KEY="value" превращается в value.
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      // Окружение важнее файла: так можно переопределить .env снаружи.
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }

  // Нет переменной — опрос раз в минуту.
  // Меньше 5 секунд нельзя: легко упереться в лимит запросов GitHub.
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

    // Хвостовой слэш убираем, чтобы один и тот же URL не плодил варианты.
    const repoUrl = (process.env.CURSOR_REPO_URL?.trim() ?? "").replace(
      /\/$/,
      "",
    );

    if (!/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+$/.test(repoUrl)) {
      throw new Error(
        "CURSOR_REPO_URL должен быть https://github.com/owner/name.",
      );
    }

    // Ветка и модель имеют запасные значения, если в .env их не задали.
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
