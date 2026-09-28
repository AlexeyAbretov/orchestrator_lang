import type { GitHub, IssueRef, LabelSpec } from "../github/types.ts";
import { pipelineLabelsComment } from "../pipeline/comments.ts";
import type { Transition } from "./types.ts";

export const FEATURE_LABEL = "feature";
export const NEEDS_PLAN_LABEL = "needs-plan";
export const IN_ANALYSIS_LABEL = "in-analysis";
export const NEEDS_HUMAN_LABEL = "needs-human";
export const TO_APPROVE_LABEL = "to-approve";
export const READY_FOR_DEVELOPMENT_LABEL = "ready-for-dev";
export const IN_DEVELOPMENT_LABEL = "in-dev";

const IN_ANALYSIS_SPEC: LabelSpec = {
  name: IN_ANALYSIS_LABEL,
  color: "f537e1",
  description: "Аналитик работает",
};

export const NEEDS_HUMAN_SPEC: LabelSpec = {
  name: NEEDS_HUMAN_LABEL,
  color: "d93f0b",
  description: "Нужен человек",
};

export const TO_APPROVE_SPEC: LabelSpec = {
  name: TO_APPROVE_LABEL,
  color: "d4c5f9",
  description: "План ждёт подтверждения человека",
};

const IN_DEVELOPMENT_SPEC: LabelSpec = {
  name: IN_DEVELOPMENT_LABEL,
  color: "1d76db",
  description: "Разработчик работает",
};

export type IssueHandler = (issue: IssueRef) => Promise<void>;

export function createTransitions(
  github: GitHub,
  handlers: Partial<Record<string, IssueHandler>> = {},
): readonly Transition[] {
  return [
    {
      name: IN_ANALYSIS_LABEL,
      match: [FEATURE_LABEL, NEEDS_PLAN_LABEL],
      from: NEEDS_PLAN_LABEL,
      to: IN_ANALYSIS_SPEC,
      after: handlers[IN_ANALYSIS_LABEL],
    },
    {
      name: TO_APPROVE_LABEL,
      match: [FEATURE_LABEL, IN_ANALYSIS_LABEL],
      from: IN_ANALYSIS_LABEL,
      to: TO_APPROVE_SPEC,
      accept: (issue) =>
        github.hasComment(
          issue.number,
          pipelineLabelsComment(TO_APPROVE_LABEL),
        ),
    },
    {
      name: IN_DEVELOPMENT_LABEL,
      match: [FEATURE_LABEL, READY_FOR_DEVELOPMENT_LABEL],
      from: READY_FOR_DEVELOPMENT_LABEL,
      to: IN_DEVELOPMENT_SPEC,
      after: handlers[IN_DEVELOPMENT_LABEL],
    },
  ];
}