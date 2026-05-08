import type { Query } from "../../../../shared/application/query-bus";

export const LIST_SERVERS_QUERY = "server.instance.list" as const;

export class ListServersQuery implements Query<typeof LIST_SERVERS_QUERY> {
  readonly type = LIST_SERVERS_QUERY;
}
