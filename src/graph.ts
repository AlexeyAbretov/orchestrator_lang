import {
  END,
  ReducedValue,
  START,
  StateGraph,
  StateSchema,
} from "@langchain/langgraph";
import { z } from "zod";
import type { GitHub, IssueRef } from "./github.js";

export const FEATURE_LABEL = "feature";
export const NEED_PLAN_LABEL = "need-plan";
export const PASSED_LABEL = "passed!";
export const PASSED_COMMENT = "PASSED";

const issueSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
});

const State = new StateSchema({
  repo: z.string(),
  issues: z.array(issueSchema).default(() => []),
  cursor: z.number().default(0),
  passed: new ReducedValue(z.array(z.number()).default(() => []), {
    inputSchema: z.array(z.number()),
    reducer: (current, update) => current.concat(update),
  }),
  failed: new ReducedValue(z.array(z.string()).default(() => []), {
    inputSchema: z.array(z.string()),
    reducer: (current, update) => current.concat(update),
  }),
});

export type OrchestratorState = typeof State.State;

export function buildGraph(github: GitHub) {
  const scan = async (state: OrchestratorState) => {
    await github.ensureLabel(PASSED_LABEL);
    const issues: IssueRef[] = await github.listOpenIssues([
      FEATURE_LABEL,
      NEED_PLAN_LABEL,
    ]);

    console.log(
      issues.length === 0
        ? `В ${state.repo} нет открытых issue с метками ${FEATURE_LABEL} и ${NEED_PLAN_LABEL}.`
        : `В ${state.repo} найдено ${issues.length} issue.`,
    );

    return { issues, cursor: 0 };
  };

  const markPassed = async (state: OrchestratorState) => {
    const issue = state.issues[state.cursor];
    if (!issue) {
      return {
        cursor: state.cursor + 1,
        failed: [`Пустая позиция очереди ${state.cursor}.`],
      };
    }

    try {
      await github.comment(issue.number, PASSED_COMMENT);
      await github.removeLabel(issue.number, NEED_PLAN_LABEL);
      await github.addLabel(issue.number, PASSED_LABEL);
      console.log(
        `#${issue.number} ${issue.title}: комментарий ${PASSED_COMMENT}, ${NEED_PLAN_LABEL} → ${PASSED_LABEL}`,
      );
      return { cursor: state.cursor + 1, passed: [issue.number] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`#${issue.number} ${issue.title}: ${message}`);
      return {
        cursor: state.cursor + 1,
        failed: [`#${issue.number}: ${message}`],
      };
    }
  };

  return new StateGraph(State)
    .addNode("scan", scan)
    .addNode("markPassed", markPassed)
    .addEdge(START, "scan")
    .addConditionalEdges("scan", (state) =>
      state.issues.length === 0 ? END : "markPassed",
    )
    .addConditionalEdges("markPassed", (state) =>
      state.cursor < state.issues.length ? "markPassed" : END,
    )
    .compile();
}
