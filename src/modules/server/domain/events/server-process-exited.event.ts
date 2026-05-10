import type { DomainEvent } from "../../../../shared/domain/domain-event";

export const SERVER_PROCESS_EXITED = "server.process.exited" as const;

export class ServerProcessExited implements DomainEvent<typeof SERVER_PROCESS_EXITED> {
  readonly eventId: string;
  readonly eventName = SERVER_PROCESS_EXITED;
  readonly occurredAt: Date;

  constructor(
    readonly instanceId: string,
    readonly exitCode: number,
    readonly wasIntentional: boolean,
  ) {
    this.eventId = crypto.randomUUID();
    this.occurredAt = new Date();
  }
}
