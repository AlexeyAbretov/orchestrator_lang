// Типы, которыми пользуется остальной код.
// GitHubIssue и GitHubComment — сырой JSON ответа API.
// IssueRef и IssueDetails — то, что мы из него оставляем себе.
export interface IssueRef {
  // Номер в репозитории, как в адресе .../issues/12.
  number: number;
  title: string;
  // Ссылка html_url: её можно открыть в браузере.
  url: string;
}

// IssueRef плюс текст. Список issue текст не отдаёт, его читаем отдельно.
export interface IssueDetails extends IssueRef {
  // Пустая строка, если автор ничего не написал.
  body: string;
}

// Как создать метку, если её ещё нет в репозитории.
export interface LabelSpec {
  name: string;
  // Цвет без #, шесть hex-символов. Например d93f0b.
  color: string;
  description: string;
}

// Контракт клиента. Граф зависит от этих методов, а не от класса.
export interface GitHub {
  listOpenIssues(labels: readonly string[]): Promise<IssueRef[]>;
  getIssue(issueNumber: number): Promise<IssueDetails>;
  ensureLabel(label: LabelSpec): Promise<void>;
  comment(issueNumber: number, body: string): Promise<void>;
  hasComment(issueNumber: number, body: string): Promise<boolean>;
  removeLabel(issueNumber: number, name: string): Promise<void>;
  addLabel(issueNumber: number, name: string): Promise<void>;
}

// Поля ответа GitHub API, которые мы реально читаем.
export interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  body?: string | null;
  // Есть у pull request. Список issues отдаёт и их, мы такие пропускаем.
  pull_request?: unknown;
}

// Комментарий issue. Тело может отсутствовать.
export interface GitHubComment {
  body?: string | null;
}
