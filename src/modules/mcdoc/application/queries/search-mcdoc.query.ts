import type { Query, QueryHandler } from "../../../../shared/application/query-bus";
import type { McdocRepositoryPort } from "../../domain/ports/mcdoc-repository.port";
import type { SchemaKind, SearchHit } from "../../domain/types/mcdoc.types";

export const SEARCH_MCDOC_QUERY = "mcdoc.search" as const;

export interface SearchMcdocFilters {
  readonly kind?: SchemaKind;
  readonly package?: string;
  readonly limit?: number;
}

export class SearchMcdocQuery implements Query<typeof SEARCH_MCDOC_QUERY> {
  readonly type = SEARCH_MCDOC_QUERY;
  constructor(readonly query: string, readonly filters: SearchMcdocFilters = {}) {}
}

export class SearchMcdocHandler
  implements QueryHandler<SearchMcdocQuery, readonly SearchHit[]>
{
  constructor(private readonly repo: McdocRepositoryPort) {}

  handle(query: SearchMcdocQuery): readonly SearchHit[] {
    return this.repo.search(query.query, query.filters);
  }
}
