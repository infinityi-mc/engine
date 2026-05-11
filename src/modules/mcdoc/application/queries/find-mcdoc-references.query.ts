import type { Query, QueryHandler } from "../../../../shared/application/query-bus";
import type { McdocRepositoryPort } from "../../domain/ports/mcdoc-repository.port";

export const FIND_MCDOC_REFERENCES_QUERY = "mcdoc.references.find" as const;

export class FindMcdocReferencesQuery implements Query<typeof FIND_MCDOC_REFERENCES_QUERY> {
  readonly type = FIND_MCDOC_REFERENCES_QUERY;
  constructor(readonly path: string, readonly limit?: number) {}
}

export class FindMcdocReferencesHandler
  implements QueryHandler<FindMcdocReferencesQuery, readonly string[]>
{
  constructor(private readonly repo: McdocRepositoryPort) {}

  handle(query: FindMcdocReferencesQuery): readonly string[] {
    return this.repo.findReferences(query.path, query.limit);
  }
}
