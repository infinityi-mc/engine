import type { Query } from "../../../../shared/application/query-bus";

export const GET_SERVER_METADATA_QUERY = "minecraft.server.metadata" as const;

export class GetServerMetadataQuery implements Query<typeof GET_SERVER_METADATA_QUERY> {
  readonly type = GET_SERVER_METADATA_QUERY;

  constructor(readonly serverId: string) {}
}
