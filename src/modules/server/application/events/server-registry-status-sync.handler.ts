import type { EventHandler } from "../../../../shared/application/event-bus";
import type { LoggerPort } from "../../../../shared/observability/logger.port";
import type { ServerRegistryPort } from "../../domain/ports/server-registry.port";
import type { ServerProcessExited } from "../../domain/events/server-process-exited.event";
import { getErrorMessage } from "../../../../shared/observability/error-utils";

export class ServerRegistryStatusSyncHandler implements EventHandler<ServerProcessExited> {
  constructor(
    private readonly registry: ServerRegistryPort,
    private readonly logger: LoggerPort,
  ) {}

  async handle(event: ServerProcessExited): Promise<void> {
    const status = event.wasIntentional ? "stopped" : "crashed";
    try {
      await this.registry.updateStatus(event.instanceId, status, event.occurredAt);
    } catch (error) {
      this.logger.error("server.registry.sync_failed", {
        module: "server",
        operation: "registry.sync",
        instanceId: event.instanceId,
        desiredStatus: status,
        error: getErrorMessage(error),
      });
    }
  }
}
