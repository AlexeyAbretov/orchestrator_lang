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

const COMMENT_LIMIT = 60_000;
const PROMPT_BODY_LIMIT = 20_000;

export class IssueAnalyst {
  private readonly cursor: CursorSettings;
  private readonly github: GitHub;

  constructor(cursor: CursorSettings, github: GitHub) {
    this.cursor = cursor;
    this.github = github;
  }

  async analyze(issue: IssueRef): Promise<void> {
    const model = this.modelSelection();
    let agent: SDKAgent | undefined;
    let run: Run | undefined;
    let reported = false;

    console.log(
      `[${IN_ANALYSIS_LABEL}] #${issue.number}: запускаю аналитика.`,
    );

    try {
      const details = await this.github.getIssue(issue.number);
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

      run = await agent.send(analysisPrompt(details));

      console.log(
        `[${IN_ANALYSIS_LABEL}] #${details.number}: ` +
          `агент ${agent.agentId}, прогон ${run.id}.`,
      );

      await this.github.comment(
        details.number,
        analystComment({
          status: "running",
          agentId: agent.agentId,
          runId: run.id,
        }),
      );

      const result = await run.wait();
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
        reported = true;

        throw new Error(message);
      }

      const plan =
        result.result?.trim() || "Агент завершился без текста анализа.";

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

      await this.github.ensureLabel(TO_APPROVE_SPEC);
      await this.github.addLabel(details.number, TO_APPROVE_LABEL);
      await this.github.removeLabel(details.number, IN_ANALYSIS_LABEL);

      console.log(
        `[${IN_ANALYSIS_LABEL}] #${details.number}: анализ завершён, ` +
          `${IN_ANALYSIS_LABEL} → ${TO_APPROVE_LABEL}.`,
      );
    } catch (error) {
      await this.stop(run);

      if (!reported) {
        await this.postError(issue.number, error, {
          agentId: agent?.agentId,
          runId: run?.id,
          model: run?.model ?? (agent ? model : undefined),
          usage: run?.usage,
        });
      }

      await this.handToHuman(issue.number);

      throw error;
    } finally {
      await agent?.[Symbol.asyncDispose]()?.catch((error: unknown) => {
        console.error(
          `[${IN_ANALYSIS_LABEL}] #${issue.number}: ` +
            `не удалось закрыть агента: ${brief(error)}`,
        );
      });
    }
  }

  private modelSelection(): ModelSelection {
    return {
      id: this.cursor.model,
      params: [{ id: "fast", value: this.cursor.fast ? "true" : "false" }],
    };
  }

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

function counts(usage: TokenUsage | undefined): TokenCounts {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens: usage?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
  };
}

function fastOf(model: ModelSelection, fallback: boolean): string {
  const value = model.params?.find((param) => param.id === "fast")?.value;

  if (value === "true" || value === "false") {
    return value;
  }

  return fallback ? "true" : "false";
}

function fit(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max)}\n…текст обрезан.`;
}

function brief(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message.length > 2_000 ? `${message.slice(0, 2_000)}…` : message;
}
