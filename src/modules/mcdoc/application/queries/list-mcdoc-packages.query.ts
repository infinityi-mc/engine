import type { Query, QueryHandler } from "../../../../shared/application/query-bus";
import type { McdocRepositoryPort } from "../../domain/ports/mcdoc-repository.port";
import type { PackageListing } from "../../domain/types/mcdoc.types";

export const LIST_MCDOC_PACKAGES_QUERY = "mcdoc.packages.list" as const;

export class ListMcdocPackagesQuery implements Query<typeof LIST_MCDOC_PACKAGES_QUERY> {
  readonly type = LIST_MCDOC_PACKAGES_QUERY;
  constructor(readonly prefix?: string) {}
}

export class ListMcdocPackagesHandler
  implements QueryHandler<ListMcdocPackagesQuery, PackageListing>
{
  constructor(private readonly repo: McdocRepositoryPort) {}

  handle(query: ListMcdocPackagesQuery): PackageListing {
    return this.repo.listPackages(query.prefix);
  }
}
