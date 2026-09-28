import type { IssueRef } from "../github/index.ts";

// Память «issue уже в работе».
// Круг опроса короче, чем разбор одной issue. Следующий круг
// не должен схватить номер, который ещё обрабатывает предыдущий.
export class InFlightIssues {
  // Номер issue → номер прохода, который её занял.
  private readonly claims = new Map<number, number>();
  // Следующий свободный номер прохода. Ноль остаётся «пустым» token.
  private nextToken = 1;

  // Открывает проход и возвращает его номер.
  begin(): number {
    const token = this.nextToken;
    this.nextToken += 1;

    return token;
  }

  // Оставляет только свободные issue и сразу помечает их занятыми.
  take(token: number, issues: readonly IssueRef[]): IssueRef[] {
    const fresh: IssueRef[] = [];

    for (const issue of issues) {
      // Номер уже в карте — его обрабатывает другой проход.
      if (this.claims.has(issue.number)) {
        continue;
      }

      this.claims.set(issue.number, token);
      fresh.push(issue);
    }

    return fresh;
  }

  // Отпускает одну issue, только если её держит этот же проход.
  // Чужой token её не снимет: поздний finally не затрёт новый захват.
  release(token: number, issueNumber: number): void {
    if (this.claims.get(issueNumber) === token) {
      this.claims.delete(issueNumber);
    }
  }

  // Отпускает всё, что держит этот проход.
  // Нужен, если граф упал раньше finally внутри обработки issue.
  releaseAll(token: number): void {
    for (const [issueNumber, owner] of this.claims) {
      if (owner === token) {
        this.claims.delete(issueNumber);
      }
    }
  }
}
