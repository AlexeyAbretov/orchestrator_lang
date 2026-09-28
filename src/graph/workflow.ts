import type { LabelSpec } from "../github/types.js";
import type { Transition } from "./types.js";

export const FEATURE_LABEL = "feature";
export const NEEDS_PLAN_LABEL = "needs-plan";
export const IN_ANALYSIS_LABEL = "in-analysis";
export const TO_APPROVE_LABEL = "to-approve";
export const READY_FOR_DEVELOPMENT_LABEL = "ready-for-dev";
export const IN_DEVELOPMENT_LABEL = "in-dev";

const IN_ANALYSIS_SPEC: LabelSpec = {
  name: IN_ANALYSIS_LABEL,
  color: "f537e1",
  description: "Аналитик работает",
};

const TO_APPROVE_SPEC: LabelSpec = {
  name: TO_APPROVE_LABEL,
  color: "d4c5f9",
  description: "План ждёт подтверждения человека",
};

const IN_DEVELOPMENT_SPEC: LabelSpec = {
  name: IN_DEVELOPMENT_LABEL,
  color: "1d76db",
  description: "Разработчик работает",
};

export const transitions: readonly Transition[] = [
  {
    name: IN_ANALYSIS_LABEL,
    match: [FEATURE_LABEL, NEEDS_PLAN_LABEL],
    from: NEEDS_PLAN_LABEL,
    to: IN_ANALYSIS_SPEC,
  },
  {
    name: TO_APPROVE_LABEL,
    match: [FEATURE_LABEL, IN_ANALYSIS_LABEL],
    from: IN_ANALYSIS_LABEL,
    to: TO_APPROVE_SPEC,
  },
  {
    name: IN_DEVELOPMENT_LABEL,
    match: [FEATURE_LABEL, READY_FOR_DEVELOPMENT_LABEL],
    from: READY_FOR_DEVELOPMENT_LABEL,
    to: IN_DEVELOPMENT_SPEC,
  },
];