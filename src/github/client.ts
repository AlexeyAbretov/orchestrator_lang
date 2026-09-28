import type { GitHub, GitHubIssue, IssueRef, LabelSpec } from "./types.js";
import { errorFrom, githubFetch, githubRequest, repoPath } from "./utils.js";

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
      const issues = await githubRequest<GitHubIssue[]>(
        this.token,
        "GET",
        `/repos/${this.repo}/issues?${params.toString()}&labels=${labelQuery}`,
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

  async ensureLabel(label: LabelSpec): Promise<void> {
    const response = await githubFetch(
      this.token,
      "POST",
      `/repos/${this.repo}/labels`,
      {
        name: label.name,
        color: label.color,
        description: label.description,
      },
    );

    if (response.ok) return;
    if (response.status === 422) {
      const body = await response.text();
      if (body.includes("already_exists")) return;
    }

    throw await errorFrom(response);
  }

  async comment(issueNumber: number, body: string): Promise<void> {
    await githubRequest(
      this.token,
      "POST",
      `/repos/${this.repo}/issues/${issueNumber}/comments`,
      { body },
    );
  }

  async removeLabel(issueNumber: number, name: string): Promise<void> {
    const response = await githubFetch(
      this.token,
      "DELETE",
      `/repos/${this.repo}/issues/${issueNumber}/labels/${encodeURIComponent(name)}`,
    );

    if (response.ok || response.status === 404) return;
    throw await errorFrom(response);
  }

  async addLabel(issueNumber: number, name: string): Promise<void> {
    await githubRequest(
      this.token,
      "POST",
      `/repos/${this.repo}/issues/${issueNumber}/labels`,
      { labels: [name] },
    );
  }

  private get repo(): string {
    return repoPath(this.owner, this.name);
  }
}
