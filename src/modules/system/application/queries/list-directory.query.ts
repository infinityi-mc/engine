import type { Query } from "../../../../shared/application/query-bus";

export const LIST_DIRECTORY_QUERY = "system.files.list-directory" as const;

export class ListDirectoryQuery implements Query<typeof LIST_DIRECTORY_QUERY> {
  readonly type = LIST_DIRECTORY_QUERY;

  constructor(readonly path: string) {}
}
