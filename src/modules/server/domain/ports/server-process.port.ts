import type { ServerInstance } from "../types/server-instance";
import type { ServerRegistryPort } from "./server-registry.port";

export interface SpawnInput {
  readonly id: string;
  readonly command: string;
  readonly args?: string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
}

export interface ServerProcessPort {
  spawn(input: SpawnInput): Promise<ServerInstance>;
  kill(instanceId: string): Promise<void>;
  reconcile(registry: ServerRegistryPort): Promise<void>;
}
