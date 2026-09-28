import { ReducedValue, StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import type { LabelSpec } from "../github/index.js";

const issueSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
});

export const State = new StateSchema({
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

export interface Transition {
  name: string;
  match: readonly string[];
  from: string;
  to: LabelSpec;
}
