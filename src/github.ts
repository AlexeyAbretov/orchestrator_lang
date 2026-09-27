export interface IssueRef {
  number: number;
  title: string;
  url: string;
}

export interface GitHub {
  listOpenIssues(labels: readonly string[]): Promise<IssueRef[]>;
  ensureLabel(name: string): Promise<void>;
  comment(issueNumber: number, body: string): Promise<void>;
  removeLabel(issueNumber: number, name: string): Promise<void>;
  addLabel(issueNumber: number, name: string): Promise<void>;
}

interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  pull_request?: unknown;
}

export class GitHubClient implements GitHub {
  constructor(
    private readonly token: string,
    private readonly owner: string,
    private readonly name: string,
  ) {}

  async listOpenIssues(labels: readonly string[]): Promise<IssueRef[]> {
    const found: IssueRef[] = [];
    const labelQuery = labels.map((label) => encodeURIComponent(label)).join(",");

    for (let page = 1; page <= 20; page += 1) {
      const params = new URLSearchParams({
        state: "open",
        per_page: "100",
        page: String(page),
      });
      const issues = await this.request<GitHubIssue[]>(
        "GET",
        `/repos/${this.repoPath}/issues?${params.toString()}&labels=${labelQuery}`,
      );

      for (const issue of issues) {
        if (issue.pull_request) continue;
        found.push({
          number: issue.number,
          title: issue.title,
          url: issue.html_url,
        });
      }

      if (issues.length < 100) break;
    }

    return found;
  }

  async ensureLabel(name: string): Promise<void> {
    const response = await this.raw("POST", `/repos/${this.repoPath}/labels`, {
      name,
      color: "0E8A16",
      description: "План принят",
    });

    if (response.ok) return;
    if (response.status === 422) {
      const body = await response.text();
      if (body.includes("already_exists")) return;
    }

    throw await errorFrom(response);
  }

  async comment(issueNumber: number, body: string): Promise<void> {
    await this.request(
      "POST",
      `/repos/${this.repoPath}/issues/${issueNumber}/comments`,
      { body },
    );
  }

  async removeLabel(issueNumber: number, name: string): Promise<void> {
    const response = await this.raw(
      "DELETE",
      `/repos/${this.repoPath}/issues/${issueNumber}/labels/${encodeURIComponent(name)}`,
    );

    if (response.ok || response.status === 404) return;
    throw await errorFrom(response);
  }

  async addLabel(issueNumber: number, name: string): Promise<void> {
    await this.request(
      "POST",
      `/repos/${this.repoPath}/issues/${issueNumber}/labels`,
      { labels: [name] },
    );
  }

  private get repoPath(): string {
    return `${encodeURIComponent(this.owner)}/${encodeURIComponent(this.name)}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.raw(method, path, body);
    if (!response.ok) throw await errorFrom(response);
    return (await response.json()) as T;
  }

  private raw(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "orchestrator-lang",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
}

async function errorFrom(response: Response): Promise<Error> {
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
