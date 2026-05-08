import type { ServerInstance } from "../types/server-instance";

export interface ServerRegistryPort {
  register(instance: ServerInstance): Promise<void>;
  unregister(instanceId: string): Promise<void>;
  get(instanceId: string): Promise<ServerInstance | undefined>;
  list(): Promise<ServerInstance[]>;
  updateStatus(instanceId: string, status: ServerInstance["status"], stoppedAt?: Date): Promise<void>;
}
