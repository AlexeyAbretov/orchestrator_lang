import type { IssueRef, LabelSpec } from "../github/index.ts";

/** Номера issue, которые уже взяты текущим проходом
 * и не должны попасть в следующий, пока обработка не закончится. */
export class InFlightIssues {
  private readonly claims = new Map<number, number>();
  private nextToken = 1;

  begin(): number {
    const token = this.nextToken;
    this.nextToken += 1;

    return token;
  }

  take(token: number, issues: readonly IssueRef[]): IssueRef[] {
    const fresh: IssueRef[] = [];

    for (const issue of issues) {
      if (this.claims.has(issue.number)) {
        continue;
      }

      this.claims.set(issue.number, token);
      fresh.push(issue);
    }

    return fresh;
  }

  release(token: number, issueNumber: number): void {
    if (this.claims.get(issueNumber) === token) {
      this.claims.delete(issueNumber);
    }
  }

  releaseAll(token: number): void {
    for (const [issueNumber, owner] of this.claims) {
      if (owner === token) {
        this.claims.delete(issueNumber);
      }
    }
  }
}
