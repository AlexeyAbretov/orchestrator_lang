import { loadConfig } from "./env.js";
import { buildGraph } from "./graph.js";
import { GitHubClient } from "./github.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const github = new GitHubClient(config.token, config.owner, config.name);
  const graph = buildGraph(github);
  const stop = new AbortController();

  console.log(
    `Оркестратор: ${config.repo}. Проход каждые ${config.pollIntervalSeconds} с. Остановка: Ctrl+C.`,
  );

  process.on("SIGINT", () => stop.abort());
  process.on("SIGTERM", () => stop.abort());

  while (!stop.signal.aborted) {
    try {
      const result = await graph.invoke(
        { repo: config.repo },
        { recursionLimit: 10_000 },
      );

      console.log(
        `Проход завершён. passed: ${result.passed.length}, ошибок: ${result.failed.length}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Проход не удался: ${message}`);
    }

    if (stop.signal.aborted) break;

    console.log(`Следующий проход через ${config.pollIntervalSeconds} с.`);
    await sleep(config.pollIntervalSeconds * 1000, stop.signal);
  }

  console.log("Оркестратор остановлен.");
}

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
      { once: true },
    );
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
