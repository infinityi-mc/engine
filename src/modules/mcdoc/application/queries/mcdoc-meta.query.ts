import type { Query, QueryHandler } from "../../../../shared/application/query-bus";
import type { McdocRepositoryPort } from "../../domain/ports/mcdoc-repository.port";
import type { McdocMeta } from "../../domain/types/mcdoc.types";

export const MCDOC_META_QUERY = "mcdoc.meta" as const;

export class McdocMetaQuery implements Query<typeof MCDOC_META_QUERY> {
  readonly type = MCDOC_META_QUERY;
}

export class McdocMetaHandler implements QueryHandler<McdocMetaQuery, McdocMeta> {
  constructor(private readonly repo: McdocRepositoryPort) {}

  handle(): McdocMeta {
    return this.repo.meta();
  }
}
