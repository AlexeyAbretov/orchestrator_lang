export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

export function pipelineLabelsComment(label: string): string {
  return `PIPELINE_LABELS: ${label}`;
}

export function analystComment(input: {
  status: "running" | "finished" | "error";
  agentId?: string;
  runId?: string;
  modelId?: string;
  fast?: string;
  tokens?: TokenCounts;
  decision?: string;
  error?: string;
}): string {
  const lines = [
    `Пайплайн: роль analyst, статус ${input.status}.`,
  ];

  if (input.agentId) {
    lines.push(`agentId: ${input.agentId}`);
  }

  if (input.runId) {
    lines.push(`runId: ${input.runId}`);
  }

  if (input.modelId !== undefined && input.fast !== undefined) {
    lines.push(`model: ${input.modelId} fast=${input.fast}`);
  }

  if (input.tokens) {
    const tokens = input.tokens;
    lines.push(
      `tokens: in=${tokens.inputTokens} out=${tokens.outputTokens} ` +
        `cacheR=${tokens.cacheReadTokens} ` +
        `cacheW=${tokens.cacheWriteTokens} total=${tokens.totalTokens}`,
    );
  }

  if (input.decision) {
    lines.push(`Решение: ${input.decision}.`);
  }

  if (input.error) {
    lines.push(`Ошибка: ${input.error}`);
  }

  return lines.join("\n");
}
