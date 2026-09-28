export function repoPath(owner: string, name: string): string {
  return `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

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

export async function githubRequest<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await githubFetch(token, method, path, body);
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as T;
}

export async function errorFrom(response: Response): Promise<Error> {
  const body = await response.text();
  const retryAfter = response.headers.get("retry-after");
  const limited =
    response.status === 403 || response.status === 429
      ? ` GitHub ограничил запросы${retryAfter ? ` (retry-after: ${retryAfter})` : ""}.`
      : "";
  return new Error(
    `GitHub API ${response.status} ${response.statusText}.${limited} ${body}`.trim(),
  );
}
