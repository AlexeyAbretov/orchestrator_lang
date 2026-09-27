import {
  END,
  ReducedValue,
  START,
  StateGraph,
  StateSchema,
} from "@langchain/langgraph";
import { z } from "zod";
import type { GitHub, IssueRef, LabelSpec } from "./github.js";

export const FEATURE_LABEL = "feature";
export const NEED_PLAN_LABEL = "need-plan";
export const PASSED_LABEL = "passed!";
export const PASSED_COMMENT = "PASSED";
export const DEV_LABEL = "dev";
export const DEV_COMMENT = "DEV";

const PASSED_SPEC: LabelSpec = {
  name: PASSED_LABEL,
  color: "0E8A16",
  description: "План принят",
};

const DEV_SPEC: LabelSpec = {
  name: DEV_LABEL,
  color: "1D76DB",
  description: "В разработке",
};

const issueSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
});

const State = new StateSchema({
  repo: z.string(),
  issues: z.array(issueSchema).default(() => []),
  cursor: z.number().default(0),
  done: new ReducedValue(z.array(z.number()).default(() => []), {
    inputSchema: z.array(z.number()),
    reducer: (current, update) => current.concat(update),
  }),
  failed: new ReducedValue(z.array(z.string()).default(() => []), {
    inputSchema: z.array(z.string()),
    reducer: (current, update) => current.concat(update),
  }),
});

export type TransitionState = typeof State.State;

export interface Transition {
  name: string;
  match: readonly string[];
  from: string;
  to: LabelSpec;
  comment: string;
}

export const transitions: readonly Transition[] = [
  {
    name: PASSED_COMMENT,
    match: [FEATURE_LABEL, NEED_PLAN_LABEL],
    from: NEED_PLAN_LABEL,
    to: PASSED_SPEC,
    comment: PASSED_COMMENT,
  },
  {
    name: DEV_COMMENT,
    match: [FEATURE_LABEL, PASSED_LABEL],
    from: PASSED_LABEL,
    to: DEV_SPEC,
    comment: DEV_COMMENT,
  },
];

export function buildTransitionGraph(github: GitHub, transition: Transition) {
  const scan = async (state: TransitionState) => {
    await github.ensureLabel(transition.to);
    const issues: IssueRef[] = await github.listOpenIssues(transition.match);
    const labels = transition.match.join(" и ");

    console.log(
      issues.length === 0
        ? `[${transition.name}] В ${state.repo} нет открытых issue с метками ${labels}.`
        : `[${transition.name}] В ${state.repo} найдено ${issues.length} issue.`,
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
      await github.comment(issue.number, transition.comment);
      await github.removeLabel(issue.number, transition.from);
      await github.addLabel(issue.number, transition.to.name);
      console.log(
        `[${transition.name}] #${issue.number} ${issue.title}: комментарий ${transition.comment}, ${transition.from} → ${transition.to.name}`,
      );
      return { cursor: state.cursor + 1, done: [issue.number] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${transition.name}] #${issue.number} ${issue.title}: ${message}`);
      return {
        cursor: state.cursor + 1,
        failed: [`#${issue.number}: ${message}`],
      };
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
