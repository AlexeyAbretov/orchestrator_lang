// Граф одной стадии пайплайна.
// LangGraph здесь — цепочка из двух шагов:
// scan ищет подходящие issue, mark меняет им метки.
// START и END — служебные точки «вход» и «выход».
import { END, START, StateGraph } from "@langchain/langgraph";
import type { GitHub } from "../github/index.ts";
import { State, type Transition, type TransitionState } from "./types.ts";
import type { InFlightIssues } from "./utils.ts";

export function buildTransitionGraph(
  github: GitHub,
  transition: Transition,
  inFlight: InFlightIssues,
) {
  // Шаг 1. Какие открытые issue пора двигать на эту стадию.
  const scan = async (state: TransitionState) => {
    // Метки может не быть в репозитории — создаём её, если надо.
    await github.ensureLabel(transition.to);

    // Открытые issue, у которых есть все метки из match.
    const listed = await github.listOpenIssues(transition.match);

    const eligible = [];

    for (const issue of listed) {
      // accept — необязательный фильтр. Например, ждать комментарий
      // с сигналом, прежде чем двигать issue дальше.
      if (transition.accept && !(await transition.accept(issue))) {
        continue;
      }

      eligible.push(issue);
    }

    // take выкидывает номера, которые уже обрабатывает другой проход.
    const issues = inFlight.take(state.token, eligible);
    // Нашли, но они уже в работе.
    const skipped = eligible.length - issues.length;
    // Метки совпали, но accept ещё не пустил.
    const waiting = listed.length - eligible.length;

    const labels = transition.match.join(" и ");
    const skippedNote = skipped > 0
      ? ` Пропущено ${skipped}: уже обрабатываются.`
      : "";
    const waitingNote = waiting > 0
      ? ` Ещё ${waiting} без сигнала пайплайна.`
      : "";
    const headline = issues.length === 0
      ? `В ${state.repo} нет новых открытых issue с метками ${labels}.`
      : `В ${state.repo} найдено ${issues.length} issue.`;

    console.log(
      `[${transition.name}] ${headline}${skippedNote}${waitingNote}`,
    );

    // Узел возвращает только кусок состояния. Его впишут в общий state.
    return { issues };
  };

  // Шаг 2. Для каждой взятой issue меняем метку и зовём after.
  const mark = async (state: TransitionState) => {
    // Issue этой стадии идут параллельно.
    // Ошибка одной не отменяет остальные: её ловим внутри map.
    const results = await Promise.all(
      state.issues.map(async (issue) => {
        try {
          // Сначала снимаем старую метку, потом ставим новую.
          await github.removeLabel(issue.number, transition.from);
          await github.addLabel(issue.number, transition.to.name);

          console.log(
            `[${transition.name}] #${issue.number} ${issue.title}: ` +
              `${transition.from} → ${transition.to.name}`,
          );

          // after может длиться долго, например пока агент пишет план.
          // Если он упадёт, метка уже будет новой, а issue попадёт в failed.
          if (transition.after) {
            await transition.after(issue);
          }

          return { done: issue.number };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);

          console.error(
            `[${transition.name}] #${issue.number} ${issue.title}: ${message}`,
          );

          return { failed: `#${issue.number}: ${message}` };
        } finally {
          // Отпускаем номер и при успехе, и при ошибке.
          inFlight.release(state.token, issue.number);
        }
      }),
    );

    // У успеха нет поля failed, у ошибки нет done.
    // flatMap выбрасывает пустые массивы и собирает два списка.
    return {
      done: results.flatMap((result) =>
        result.done === undefined ? [] : [result.done],
      ),
      failed: results.flatMap((result) =>
        result.failed === undefined ? [] : [result.failed],
      ),
    };
  };

  return new StateGraph(State)
    .addNode("scan", scan)
    .addNode("mark", mark)
    // Каждый запуск начинается с поиска issue.
    .addEdge(START, "scan")
    // Пустой список — выходим. Иначе идём менять метки.
    .addConditionalEdges("scan", (state) =>
      state.issues.length === 0 ? END : "mark",
    )
    .addEdge("mark", END)
    // compile собирает описание в граф с методом invoke.
    .compile();
}
