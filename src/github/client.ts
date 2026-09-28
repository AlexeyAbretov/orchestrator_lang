import type {
  GitHub,
  GitHubComment,
  GitHubIssue,
  IssueDetails,
  IssueRef,
  LabelSpec,
} from "./types.ts";
import { errorFrom, githubFetch, githubRequest, repoPath } from "./utils.ts";

export class GitHubClient implements GitHub {
  private readonly token: string;
  private readonly owner: string;
  private readonly name: string;

  constructor(token: string, owner: string, name: string) {
    this.token = token;
    this.owner = owner;
    this.name = name;
  }

  async listOpenIssues(labels: readonly string[]): Promise<IssueRef[]> {
    const found: IssueRef[] = [];
    const labelQuery = labels
      .map((label) => encodeURIComponent(label))
      .join(",");

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
        if (issue.pull_request) {
          continue;
        }

        found.push({
          number: issue.number,
          title: issue.title,
          url: issue.html_url,
        });
      }

      if (issues.length < 100) {
        break;
      }
    }

    return found;
  }

  async getIssue(issueNumber: number): Promise<IssueDetails> {
    const issue = await githubRequest<GitHubIssue>(
      this.token,
      "GET",
      `/repos/${this.repo}/issues/${issueNumber}`,
    );

    return {
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      body: issue.body ?? "",
    };
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

    if (response.ok) {
      return;
    }

    if (response.status === 422) {
      const body = await response.text();

      if (body.includes("already_exists")) {
        return;
      }
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

  async hasComment(issueNumber: number, body: string): Promise<boolean> {
    const expected = body.trim();

    for (let page = 1; page <= 20; page += 1) {
      const params = new URLSearchParams({
        per_page: "100",
        page: String(page),
      });
      const comments = await githubRequest<GitHubComment[]>(
        this.token,
        "GET",
        `/repos/${this.repo}/issues/${issueNumber}/comments?${params}`,
      );

      if (
        comments.some((comment) => (comment.body ?? "").trim() === expected)
      ) {
        return true;
      }

      if (comments.length < 100) {
        break;
      }
    }

    return false;
  }

  async removeLabel(issueNumber: number, name: string): Promise<void> {
    const response = await githubFetch(
      this.token,
      "DELETE",
      `/repos/${this.repo}/issues/${issueNumber}/labels/` +
        encodeURIComponent(name),
    );

    if (response.ok || response.status === 404) {
      return;
    }

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
