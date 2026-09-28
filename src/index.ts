// Точка входа. Процесс живёт, пока его не остановят:
// раз в N секунд смотрит issue на GitHub и двигает их по пайплайну.
import { IssueAnalyst } from "./analyst/index.ts";
import { Config } from "./config.ts";
import {
  buildTransitionGraph,
  createTransitions,
  InFlightIssues,
} from "./graph/index.ts";
import { IN_ANALYSIS_LABEL } from "./graph/workflow.ts";
import { GitHubClient } from "./github/index.ts";

// Собирает клиентов и графы стадий, затем крутит опрос до Ctrl+C.
async function main(): Promise<void> {
  // .env и переменные окружения. Кривые настройки роняют процесс здесь.
  const config = new Config();

  // GitHub API и аналитик, который для issue поднимает агента Cursor.
  const github = new GitHubClient(config.token, config.owner, config.name);
  const analyst = new IssueAnalyst(config.cursor, github);

  // Память «эти issue уже взяты». Проходы идут внахлёст по времени,
  // и без неё один номер попал бы в работу дважды.
  const inFlight = new InFlightIssues();

  // У каждой стадии свой граф. Действие после смены метки сейчас
  // есть только у in-analysis: запустить аналитика.
  const graphs = createTransitions(github, {
    [IN_ANALYSIS_LABEL]: (issue) => analyst.analyze(issue),
  }).map(
    (transition) => ({
      transition,
      graph: buildTransitionGraph(github, transition, inFlight),
    }),
  );
  // Флаг остановки. abort() выставляет его из обработчиков сигналов.
  const stop = new AbortController();

  console.log(
    `Оркестратор: ${config.repo}. ` +
      `Проход каждые ${config.pollIntervalSeconds} с. ` +
      "Остановка: Ctrl+C.",
  );

  // SIGINT — это Ctrl+C. SIGTERM — просьба завершиться, например от ОС.
  process.on("SIGINT", () => stop.abort());
  process.on("SIGTERM", () => stop.abort());

  while (!stop.signal.aborted) {
    // Проход не ждём: графы работают в фоне, цикл сразу уходит в паузу.
    // Повторный захват той же issue отсекает inFlight.
    Promise.all(
      graphs.map(async ({ transition, graph }) => {
        // Номер этого запуска. По нему потом отпустим занятые issue.
        const token = inFlight.begin();

        try {
          // scan ищет issue, mark меняет метки. repo нужен только в логах.
          // recursionLimit обрывает граф, если он случайно зациклится.
          const result = await graph.invoke(
            { repo: config.repo, token },
            { recursionLimit: 10_000 },
          );

          console.log(
            `[${transition.name}] готово: ${result.done.length}, ` +
              `ошибок: ${result.failed.length}.`,
          );
        } catch (error) {
          // Сбой всего прохода, не одной issue: сеть, API или сам граф.
          const message =
            error instanceof Error ? error.message : String(error);

          console.error(`[${transition.name}] проход не удался: ${message}`);
        } finally {
          // Если граф упал до отпускания внутри mark, снимаем захват тут.
          inFlight.releaseAll(token);
        }
      }),
    );

    if (stop.signal.aborted) {
      break;
    }

    // Пауза между кругами. При сигнале остановки сон кончается сразу.
    await sleep(config.pollIntervalSeconds * 1000, stop.signal);
  }

  console.log("Оркестратор остановлен.");
}

// Ждёт ms миллисекунд. Если сигнал уже сработал или сработает
// во время ожидания, промис завершается сразу и таймер снимается.
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();

      return;
    }

    const timer = setTimeout(resolve, ms);

    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);

        resolve();
      },
      // Слушатель одноразовый: после первого abort он больше не нужен.
      { once: true },
    );
  });
}

// Ошибка до цикла (например, кривой .env) печатается,
// и процесс заканчивается с кодом 1.
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(message);

  process.exitCode = 1;
});
