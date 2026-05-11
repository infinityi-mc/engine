import type { Query, QueryHandler } from "../../../../shared/application/query-bus";
import type {
  McdocRepositoryPort,
  SchemaProjection,
} from "../../domain/ports/mcdoc-repository.port";
import type {
  RawSchemaEntry,
  SchemaFieldsOnly,
  SchemaSummary,
} from "../../domain/types/mcdoc.types";

export const GET_MCDOC_SCHEMA_QUERY = "mcdoc.schema.get" as const;

export type GetMcdocSchemaResult = SchemaSummary | SchemaFieldsOnly | RawSchemaEntry;

export class GetMcdocSchemaQuery implements Query<typeof GET_MCDOC_SCHEMA_QUERY> {
  readonly type = GET_MCDOC_SCHEMA_QUERY;
  constructor(
    readonly path: string,
    readonly projection: SchemaProjection = "summary",
  ) {}
}

export class GetMcdocSchemaHandler
  implements QueryHandler<GetMcdocSchemaQuery, GetMcdocSchemaResult>
{
  constructor(private readonly repo: McdocRepositoryPort) {}

  handle(query: GetMcdocSchemaQuery): GetMcdocSchemaResult {
    return this.repo.getSchema(query.path, query.projection);
  }
}
