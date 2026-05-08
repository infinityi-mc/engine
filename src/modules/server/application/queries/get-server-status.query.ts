import type { Query } from "../../../../shared/application/query-bus";

export const GET_SERVER_STATUS_QUERY = "server.instance.status" as const;

export class GetServerStatusQuery implements Query<typeof GET_SERVER_STATUS_QUERY> {
  readonly type = GET_SERVER_STATUS_QUERY;

  constructor(readonly instanceId: string) {}
}
