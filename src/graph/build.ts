import { END, START, StateGraph } from "@langchain/langgraph";
import type { GitHub } from "../github/index.ts";
import { State, type Transition, type TransitionState } from "./types.ts";
import type { InFlightIssues } from "./utils.ts";

export function buildTransitionGraph(
  github: GitHub,
  transition: Transition,
  inFlight: InFlightIssues,
) {
  const scan = async (state: TransitionState) => {
    await github.ensureLabel(transition.to);

    const listed = await github.listOpenIssues(transition.match);

    const eligible = [];
    for (const issue of listed) {
      if (transition.accept && !(await transition.accept(issue))) {
        continue;
      }

      eligible.push(issue);
    }

    const issues = inFlight.take(state.token, eligible);
    const skipped = eligible.length - issues.length;
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

    return { issues };
  };

  const mark = async (state: TransitionState) => {
    const results = await Promise.all(
      state.issues.map(async (issue) => {
        try {
          await github.removeLabel(issue.number, transition.from);
          await github.addLabel(issue.number, transition.to.name);

          console.log(
            `[${transition.name}] #${issue.number} ${issue.title}: ` +
              `${transition.from} → ${transition.to.name}`,
          );

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
          inFlight.release(state.token, issue.number);
        }
      }),
    );

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
    .addEdge(START, "scan")
    .addConditionalEdges("scan", (state) =>
      state.issues.length === 0 ? END : "mark",
    )
    .addEdge("mark", END)
    .compile();
}
