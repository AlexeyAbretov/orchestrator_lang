// Аналитик: облачный агент Cursor в режиме plan.
// Он читает репозиторий и issue, пишет план в комментарий
// и переводит метку с in-analysis на to-approve.
// Код агент не меняет: правки и pull request в настройках выключены.
import {
  Agent,
  type ModelSelection,
  type Run,
  type SDKAgent,
  type TokenUsage,
} from "@cursor/sdk";
import type { CursorSettings } from "../config.ts";
import type { GitHub, IssueDetails, IssueRef } from "../github/index.ts";
import {
  IN_ANALYSIS_LABEL,
  NEEDS_HUMAN_LABEL,
  NEEDS_HUMAN_SPEC,
  TO_APPROVE_LABEL,
  TO_APPROVE_SPEC,
} from "../graph/workflow.ts";
import {
  analystComment,
  pipelineLabelsComment,
  type TokenCounts,
} from "../pipeline/comments.ts";

// GitHub плохо переваривает огромный комментарий, поэтому режем сами.
const COMMENT_LIMIT = 60_000;
// В промпт кладём не всё тело issue, чтобы не раздувать запрос.
const PROMPT_BODY_LIMIT = 20_000;

export class IssueAnalyst {
  private readonly cursor: CursorSettings;
  private readonly github: GitHub;

  constructor(cursor: CursorSettings, github: GitHub) {
    this.cursor = cursor;
    this.github = github;
  }

  // Полный разбор одной issue: агент, комментарии, смена меток.
  // Ошибку пробрасываем наверх — граф запишет номер в failed.
  async analyze(issue: IssueRef): Promise<void> {
    const model = this.modelSelection();
    let agent: SDKAgent | undefined;
    let run: Run | undefined;
    // true — ошибку уже написали в issue, второй раз не пишем.
    let reported = false;

    console.log(
      `[${IN_ANALYSIS_LABEL}] #${issue.number}: запускаю аналитика.`,
    );

    try {
      // В списке issue нет текста. Для промпта нужно тело.
      const details = await this.github.getIssue(issue.number);

      // mode: "plan" — только план, без правок файлов.
      // autoCreatePR: false ещё раз запрещает создавать pull request.
      agent = await Agent.create({
        apiKey: this.cursor.apiKey,
        name: `analyst #${details.number}`,
        model,
        mode: "plan",
        cloud: {
          repos: [
            {
              url: this.cursor.repoUrl,
              startingRef: this.cursor.startingRef,
            },
          ],
          autoCreatePR: false,
          skipReviewerRequest: true,
          metadata: {
            role: "analyst",
            issue: String(details.number),
          },
        },
      });

      // send не ждёт конца работы. Результат забирает wait() ниже.
      run = await agent.send(analysisPrompt(details));

      console.log(
        `[${IN_ANALYSIS_LABEL}] #${details.number}: ` +
          `агент ${agent.agentId}, прогон ${run.id}.`,
      );

      // Сразу пишем в issue, что анализ идёт и где его смотреть.
      await this.github.comment(
        details.number,
        analystComment({
          status: "running",
          agentId: agent.agentId,
          runId: run.id,
        }),
      );

      const result = await run.wait();
      // В ответе модель может отличаться от той, что просили.
      const resolved = result.model ?? model;

      if (result.status !== "finished") {
        const message = brief(
          result.error?.message ??
            `Агент завершился со статусом ${result.status}.`,
        );

        await this.postError(details.number, message, {
          agentId: agent.agentId,
          runId: run.id,
          model: resolved,
          usage: result.usage,
        });
        // catch ниже увидит флаг и не отправит ту же ошибку ещё раз.
        reported = true;

        throw new Error(message);
      }

      const plan =
        result.result?.trim() || "Агент завершился без текста анализа.";

      // Три комментария: служебный статус, сам план
      // и сигнал PIPELINE_LABELS: to-approve для графа.
      await this.github.comment(
        details.number,
        analystComment({
          status: "finished",
          agentId: agent.agentId,
          runId: run.id,
          modelId: resolved.id,
          fast: fastOf(resolved, this.cursor.fast),
          tokens: counts(result.usage),
          decision: TO_APPROVE_LABEL,
        }),
      );
      await this.github.comment(details.number, fit(plan, COMMENT_LIMIT));
      await this.github.comment(
        details.number,
        pipelineLabelsComment(TO_APPROVE_LABEL),
      );

      // Метки двигаем сразу, не дожидаясь следующего круга опроса.
      // Если этот кусок упадёт, граф увидит сигнал в комментарии
      // и сможет сам перевести issue на to-approve.
      await this.github.ensureLabel(TO_APPROVE_SPEC);
      await this.github.addLabel(details.number, TO_APPROVE_LABEL);
      await this.github.removeLabel(details.number, IN_ANALYSIS_LABEL);

      console.log(
        `[${IN_ANALYSIS_LABEL}] #${details.number}: анализ завершён, ` +
          `${IN_ANALYSIS_LABEL} → ${TO_APPROVE_LABEL}.`,
      );
    } catch (error) {
      // Если прогон ещё идёт, просим его остановиться.
      await this.stop(run);

      if (!reported) {
        await this.postError(issue.number, error, {
          agentId: agent?.agentId,
          runId: run?.id,
          model: run?.model ?? (agent ? model : undefined),
          usage: run?.usage,
        });
      }

      // Рабочие метки снимаем и ставим needs-human: нужен человек.
      await this.handToHuman(issue.number);

      throw error;
    } finally {
      // Закрываем агента на стороне Cursor. Сбой закрытия только логируем:
      // на результат анализа он уже не влияет.
      await agent?.[Symbol.asyncDispose]()?.catch((error: unknown) => {
        console.error(
          `[${IN_ANALYSIS_LABEL}] #${issue.number}: ` +
            `не удалось закрыть агента: ${brief(error)}`,
        );
      });
    }
  }

  // Какую модель просить и включён ли быстрый режим.
  private modelSelection(): ModelSelection {
    return {
      id: this.cursor.model,
      params: [{ id: "fast", value: this.cursor.fast ? "true" : "false" }],
    };
  }

  // Отменять можно только живой прогон и только если SDK это умеет.
  private async stop(run: Run | undefined): Promise<void> {
    if (!run || run.status !== "running" || !run.supports("cancel")) {
      return;
    }

    await run.cancel().catch((error: unknown) => {
      console.error(
        `[${IN_ANALYSIS_LABEL}] не удалось остановить ` +
          `${run.id}: ${brief(error)}`,
      );
    });
  }

  // Пишет ошибку анализа в комментарий issue.
  // Если сам комментарий не записался, исходную ошибку не затираем.
  private async postError(
    issueNumber: number,
    error: unknown,
    source: {
      agentId?: string;
      runId?: string;
      model?: ModelSelection;
      usage?: TokenUsage;
    },
  ): Promise<void> {
    try {
      await this.github.comment(
        issueNumber,
        analystComment({
          status: "error",
          agentId: source.agentId,
          runId: source.runId,
          modelId: source.model?.id,
          fast: source.model
            ? fastOf(source.model, this.cursor.fast)
            : undefined,
          tokens: source.usage ? counts(source.usage) : undefined,
          error: brief(error),
        }),
      );
    } catch (commentError) {
      console.error(
        `[${IN_ANALYSIS_LABEL}] #${issueNumber}: ` +
          `не удалось записать ошибку: ${brief(commentError)}`,
      );
    }
  }

  // Снимает метки анализа и ставит needs-human.
  // to-approve тоже снимаем: план мог успеть проставиться наполовину.
  private async handToHuman(issueNumber: number): Promise<void> {
    try {
      await this.github.ensureLabel(NEEDS_HUMAN_SPEC);
      await this.github.addLabel(issueNumber, NEEDS_HUMAN_LABEL);
      await this.github.removeLabel(issueNumber, IN_ANALYSIS_LABEL);
      await this.github.removeLabel(issueNumber, TO_APPROVE_LABEL);

      console.log(
        `[${IN_ANALYSIS_LABEL}] #${issueNumber}: анализ остановлен, ` +
          `метка ${NEEDS_HUMAN_LABEL}.`,
      );
    } catch (error) {
      console.error(
        `[${IN_ANALYSIS_LABEL}] #${issueNumber}: не удалось поставить ` +
          `${NEEDS_HUMAN_LABEL}: ${brief(error)}`,
      );
    }
  }
}

// Промпт простыми правилами: изучи код, ничего не меняй, верни план.
function analysisPrompt(issue: IssueDetails): string {
  const description = issue.body.trim() || "Описание пустое.";

  return [
    "Ты аналитик. Репозиторий уже открыт: изучи код " +
      "и составь план реализации issue.",
    "Код не меняй. Коммиты и pull request не создавай.",
    "Ответ — сам план: что сделать, в каких местах кода, " +
      "какие риски и как проверить.",
    "",
    `Issue #${issue.number}: ${issue.title}`,
    issue.url,
    "",
    fit(description, PROMPT_BODY_LIMIT),
  ].join("\n");
}

// SDK может не прислать usage. Тогда в комментарии будут нули.
function counts(usage: TokenUsage | undefined): TokenCounts {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens: usage?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
  };
}

// Берём fast из ответа модели. Если параметра нет — из настроек .env.
function fastOf(model: ModelSelection, fallback: boolean): string {
  const value = model.params?.find((param) => param.id === "fast")?.value;

  if (value === "true" || value === "false") {
    return value;
  }

  return fallback ? "true" : "false";
}

// Обрезает текст и ставит пометку, что хвост не влез.
function fit(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max)}\n…текст обрезан.`;
}

// Короткий текст ошибки для комментария и лога. Длинный текст режем.
function brief(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message.length > 2_000 ? `${message.slice(0, 2_000)}…` : message;
}
