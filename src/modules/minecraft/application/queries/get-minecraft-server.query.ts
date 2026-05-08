import type { Query } from "../../../../shared/application/query-bus";

export const GET_MINECRAFT_SERVER_QUERY = "minecraft.server.get" as const;

export interface MinecraftServerDetails {
  readonly id: string;
  readonly name: string;
  readonly directory: string;
  readonly javaPath: string;
  readonly jarFile: string;
  readonly jvmArgs: string[];
  readonly serverArgs: string[];
  readonly status: "running" | "stopped" | "crashed";
  readonly pid: number | undefined;
  readonly startedAt: Date | undefined;
  readonly stoppedAt: Date | undefined;
}

export class GetMinecraftServerQuery implements Query<typeof GET_MINECRAFT_SERVER_QUERY> {
  readonly type = GET_MINECRAFT_SERVER_QUERY;

  constructor(readonly serverId: string) {}
}
