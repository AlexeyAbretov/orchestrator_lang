import { IssueAnalyst } from "./analyst/index.ts";
import { Config } from "./config.ts";
import {
  buildTransitionGraph,
  createTransitions,
  InFlightIssues,
} from "./graph/index.ts";
import { IN_ANALYSIS_LABEL } from "./graph/workflow.ts";
import { GitHubClient } from "./github/index.ts";

async function main(): Promise<void> {
  const config = new Config();

  const github = new GitHubClient(config.token, config.owner, config.name);
  const analyst = new IssueAnalyst(config.cursor, github);

  const inFlight = new InFlightIssues();
  const graphs = createTransitions(github, {
    [IN_ANALYSIS_LABEL]: (issue) => analyst.analyze(issue),
  }).map(
    (transition) => ({
      transition,
      graph: buildTransitionGraph(github, transition, inFlight),
    }),
  );
  const stop = new AbortController();

  console.log(
    `Оркестратор: ${config.repo}. ` +
      `Проход каждые ${config.pollIntervalSeconds} с. ` +
      "Остановка: Ctrl+C.",
  );

  process.on("SIGINT", () => stop.abort());
  process.on("SIGTERM", () => stop.abort());

  while (!stop.signal.aborted) {
    Promise.all(
      graphs.map(async ({ transition, graph }) => {
        const token = inFlight.begin();

        try {
          const result = await graph.invoke(
            { repo: config.repo, token },
            { recursionLimit: 10_000 },
          );

          console.log(
            `[${transition.name}] готово: ${result.done.length}, ` +
              `ошибок: ${result.failed.length}.`,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);

          console.error(`[${transition.name}] проход не удался: ${message}`);
        } finally {
          inFlight.releaseAll(token);
        }
      }),
    );

    if (stop.signal.aborted) {
      break;
    }

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
