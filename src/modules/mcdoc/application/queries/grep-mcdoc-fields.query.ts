import type { Query, QueryHandler } from "../../../../shared/application/query-bus";
import type { McdocRepositoryPort } from "../../domain/ports/mcdoc-repository.port";
import type { GrepFieldMatch } from "../../domain/types/mcdoc.types";

export const GREP_MCDOC_FIELDS_QUERY = "mcdoc.fields.grep" as const;

export class GrepMcdocFieldsQuery implements Query<typeof GREP_MCDOC_FIELDS_QUERY> {
  readonly type = GREP_MCDOC_FIELDS_QUERY;
  constructor(readonly pattern: string, readonly limit?: number) {}
}

export class GrepMcdocFieldsHandler
  implements QueryHandler<GrepMcdocFieldsQuery, readonly GrepFieldMatch[]>
{
  constructor(private readonly repo: McdocRepositoryPort) {}

  handle(query: GrepMcdocFieldsQuery): readonly GrepFieldMatch[] {
    return this.repo.grepFields(query.pattern, query.limit);
  }
}
