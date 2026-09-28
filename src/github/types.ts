export interface IssueRef {
  number: number;
  title: string;
  url: string;
}

export interface IssueDetails extends IssueRef {
  body: string;
}

export interface LabelSpec {
  name: string;
  color: string;
  description: string;
}

export interface GitHub {
  listOpenIssues(labels: readonly string[]): Promise<IssueRef[]>;
  getIssue(issueNumber: number): Promise<IssueDetails>;
  ensureLabel(label: LabelSpec): Promise<void>;
  comment(issueNumber: number, body: string): Promise<void>;
  hasComment(issueNumber: number, body: string): Promise<boolean>;
  removeLabel(issueNumber: number, name: string): Promise<void>;
  addLabel(issueNumber: number, name: string): Promise<void>;
}

export interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  body?: string | null;
  pull_request?: unknown;
}

export interface GitHubComment {
  body?: string | null;
}
