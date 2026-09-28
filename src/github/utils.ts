// Мелкие функции HTTP-слоя. Их вызывает GitHubClient.
// Наружу из папки github они не отдаются: см. index.ts.

// owner/name для пути API. Кодирование нужно, если в имени есть
// символы, которые в URL нельзя писать как есть.
export function repoPath(owner: string, name: string): string {
  return `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

// Низкоуровневый запрос. Сам статус не проверяет — это делает вызывающий.
// Accept говорит GitHub, что мы ждём JSON их формата.
// Content-Type ставим только когда есть тело, иначе лишний заголовок.
export function githubFetch(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "orchestrator-lang",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// То же, что githubFetch, плюс проверка статуса и разбор JSON.
export async function githubRequest<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await githubFetch(token, method, path, body);

  if (!response.ok) {
    throw await errorFrom(response);
  }

  return (await response.json()) as T;
}

// Текст ошибки для лога: статус, тело ответа и, если GitHub
// ограничил частоту запросов, подсказка retry-after.
export async function errorFrom(response: Response): Promise<Error> {
  const body = await response.text();
  const retryAfter = response.headers.get("retry-after");
  // 403 и 429 часто значат «слишком много запросов», не «нет прав».
  const limited =
    response.status === 403 || response.status === 429
      ? " GitHub ограничил запросы" +
        `${retryAfter ? ` (retry-after: ${retryAfter})` : ""}.`
      : "";

  return new Error(
    (
      `GitHub API ${response.status} ${response.statusText}.` +
      `${limited} ${body}`
    ).trim(),
  );
}
