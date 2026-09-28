export interface IssueRef {
  number: number;
  title: string;
  url: string;
}

export interface LabelSpec {
  name: string;
  color: string;
  description: string;
}

export interface GitHub {
  listOpenIssues(labels: readonly string[]): Promise<IssueRef[]>;
  ensureLabel(label: LabelSpec): Promise<void>;
  comment(issueNumber: number, body: string): Promise<void>;
  removeLabel(issueNumber: number, name: string): Promise<void>;
  addLabel(issueNumber: number, name: string): Promise<void>;
}

export interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  pull_request?: unknown;
}
