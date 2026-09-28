// Стадии feature-issue. Метка на issue — это её текущий шаг:
// needs-plan → in-analysis → to-approve → ready-for-dev → in-dev.
// Человек или агент ставит следующий шаг, оркестратор его подхватывает.
import type { GitHub, IssueRef, LabelSpec } from "../github/types.ts";
import { pipelineLabelsComment } from "../pipeline/comments.ts";
import type { Transition } from "./types.ts";

// Имена меток. Сами метки в GitHub создаются по описаниям LabelSpec ниже.
export const FEATURE_LABEL = "feature";
export const NEEDS_PLAN_LABEL = "needs-plan";
export const IN_ANALYSIS_LABEL = "in-analysis";
export const NEEDS_HUMAN_LABEL = "needs-human";
export const TO_APPROVE_LABEL = "to-approve";
export const READY_FOR_DEVELOPMENT_LABEL = "ready-for-dev";
export const IN_DEVELOPMENT_LABEL = "in-dev";

// Цвет — 6 hex-символов без решётки: так ждёт GitHub API.
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

// Что сделать с одной issue после того, как стадия сменила метку.
export type IssueHandler = (issue: IssueRef) => Promise<void>;

// Три перехода, которые оркестратор умеет сейчас.
// handlers можно передать не для всех стадий:
// без after стадия только меняет метку.
export function createTransitions(
  github: GitHub,
  handlers: Partial<Record<string, IssueHandler>> = {},
): readonly Transition[] {
  return [
    // feature + needs-plan: снимаем needs-plan, ставим in-analysis,
    // затем зовём аналитика, если его передали в handlers.
    {
      name: IN_ANALYSIS_LABEL,
      match: [FEATURE_LABEL, NEEDS_PLAN_LABEL],
      from: NEEDS_PLAN_LABEL,
      to: IN_ANALYSIS_SPEC,
      after: handlers[IN_ANALYSIS_LABEL],
    },
    // feature + in-analysis, но только если в комментариях уже есть
    // строка PIPELINE_LABELS: to-approve. Её пишет аналитик.
    // Если он сам уже сменил метки, issue сюда не попадёт.
    // Если комментарий есть, а метка ещё in-analysis — граф доделает шаг.
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
    // feature + ready-for-dev → in-dev.
    // Обработчик разработки в точке входа пока не передан.
    {
      name: IN_DEVELOPMENT_LABEL,
      match: [FEATURE_LABEL, READY_FOR_DEVELOPMENT_LABEL],
      from: READY_FOR_DEVELOPMENT_LABEL,
      to: IN_DEVELOPMENT_SPEC,
      after: handlers[IN_DEVELOPMENT_LABEL],
    },
  ];
}
