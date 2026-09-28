import { END, START, StateGraph } from "@langchain/langgraph";
import type { GitHub } from "../github/index.js";
import { State, type Transition, type TransitionState } from "./types.js";
import type { InFlightIssues } from "./utils.js";

export function buildTransitionGraph(
  github: GitHub,
  transition: Transition,
  inFlight: InFlightIssues,
) {
  const scan = async (state: TransitionState) => {
    await github.ensureLabel(transition.to);

    const listed = await github.listOpenIssues(transition.match);
    const issues = inFlight.take(state.token, listed);
    const skipped = listed.length - issues.length;
    const labels = transition.match.join(" и ");
    const skippedNote =
      skipped > 0 ? ` Пропущено ${skipped}: уже обрабатываются.` : "";

    console.log(
      issues.length === 0
        ? `[${transition.name}] В ${state.repo} нет новых открытых issue с метками ${labels}.${skippedNote}`
        : `[${transition.name}] В ${state.repo} найдено ${issues.length} issue.${skippedNote}`,
    );

    return { issues, cursor: 0 };
  };

  const mark = async (state: TransitionState) => {
    const issue = state.issues[state.cursor];

    if (!issue) {
      return {
        cursor: state.cursor + 1,
        failed: [`Пустая позиция очереди ${state.cursor}.`],
      };
    }

    try {
      await github.removeLabel(issue.number, transition.from);
      await github.addLabel(issue.number, transition.to.name);

      console.log(
        `[${transition.name}] #${issue.number} ${issue.title}: ${transition.from} → ${transition.to.name}`,
      );

      return { cursor: state.cursor + 1, done: [issue.number] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      console.error(`[${transition.name}] #${issue.number} ${issue.title}: ${message}`);

      return {
        cursor: state.cursor + 1,
        failed: [`#${issue.number}: ${message}`],
      };
    } finally {
      inFlight.release(state.token, issue.number);
    }
  };

  return new StateGraph(State)
    .addNode("scan", scan)
    .addNode("mark", mark)
    .addEdge(START, "scan")
    .addConditionalEdges("scan", (state) =>
      state.issues.length === 0 ? END : "mark",
    )
    .addConditionalEdges("mark", (state) =>
      state.cursor < state.issues.length ? "mark" : END,
    )
    .compile();
}
