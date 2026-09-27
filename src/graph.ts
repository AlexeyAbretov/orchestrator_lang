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
  token: z.number().default(0),
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

/** Номера issue, которые уже взяты текущим проходом и не должны попасть в следующий, пока обработка не закончится. */
export class InFlightIssues {
  private readonly claims = new Map<number, number>();
  private nextToken = 1;

  begin(): number {
    const token = this.nextToken;
    this.nextToken += 1;
    return token;
  }

  take(token: number, issues: readonly IssueRef[]): IssueRef[] {
    const fresh: IssueRef[] = [];
    for (const issue of issues) {
      if (this.claims.has(issue.number)) continue;
      this.claims.set(issue.number, token);
      fresh.push(issue);
    }
    return fresh;
  }

  release(token: number, issueNumber: number): void {
    if (this.claims.get(issueNumber) === token) {
      this.claims.delete(issueNumber);
    }
  }

  releaseAll(token: number): void {
    for (const [issueNumber, owner] of this.claims) {
      if (owner === token) this.claims.delete(issueNumber);
    }
  }
}

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
