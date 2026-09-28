// Состояние одного прохода графа и описание стадии пайплайна.
// Узлы графа не возвращают всё состояние целиком: только поля,
// которые хотят дописать. Остальное LangGraph сохраняет сам.
import { ReducedValue, StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import type { IssueRef, LabelSpec } from "../github/index.ts";

// Минимальная карточка issue, которую узлы передают друг другу.
const issueSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
});

// Схема полей прохода. zod здесь проверяет форму данных.
export const State = new StateSchema({
  // owner/name. В логике не участвует, только в текстах логов.
  repo: z.string(),
  // Номер прохода. По нему видно, кто занял issue.
  token: z.number().default(0),
  // Issue, которые этот проход реально взял. Пустой список — норма.
  issues: z.array(issueSchema).default(() => []),
  // Номера успешно сдвинутых issue.
  // reducer дописывает новый кусок в конец, а не заменяет весь список.
  done: new ReducedValue(z.array(z.number()).default(() => []), {
    inputSchema: z.array(z.number()),
    reducer: (current, update) => current.concat(update),
  }),
  // Тексты ошибок по issue, которые сдвинуть не удалось.
  failed: new ReducedValue(z.array(z.string()).default(() => []), {
    inputSchema: z.array(z.string()),
    reducer: (current, update) => current.concat(update),
  }),
});

// Тип объекта state, который видят узлы scan и mark.
export type TransitionState = typeof State.State;

// Одна стадия: какие метки искать и на какую метку перевести issue.
export interface Transition {
  // Короткое имя для логов. Обычно совпадает с целевой меткой.
  name: string;
  // Issue должна иметь все эти метки сразу, не любую из них.
  match: readonly string[];
  // Эту метку снимаем, когда стадия срабатывает.
  from: string;
  // Эту метку ставим вместо from. Цвет и описание нужны,
  // если такой метки в репозитории ещё нет.
  to: LabelSpec;
  // Дополнительный фильтр. false — issue пока не трогаем.
  accept?(issue: IssueRef): Promise<boolean>;
  // Действие после смены меток. Например, запуск аналитика.
  after?(issue: IssueRef): Promise<void>;
}
