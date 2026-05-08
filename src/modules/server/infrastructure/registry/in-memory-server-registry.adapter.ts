import type { ServerRegistryPort } from "../../domain/ports/server-registry.port";
import type { ServerInstance } from "../../domain/types/server-instance";

export class InMemoryServerRegistryAdapter implements ServerRegistryPort {
  private readonly instances = new Map<string, ServerInstance>();

  async register(instance: ServerInstance): Promise<void> {
    this.instances.set(instance.id, instance);
  }

  async unregister(instanceId: string): Promise<void> {
    this.instances.delete(instanceId);
  }

  async get(instanceId: string): Promise<ServerInstance | undefined> {
    return this.instances.get(instanceId);
  }

  async list(): Promise<ServerInstance[]> {
    return [...this.instances.values()];
  }

  async updateStatus(instanceId: string, status: ServerInstance["status"], stoppedAt?: Date): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (instance !== undefined) {
      this.instances.set(instanceId, {
        ...instance,
        status,
        ...(stoppedAt !== undefined ? { stoppedAt } : {}),
      });
    }
  }
}
