import type { DomainEvent } from "../domain/domain-event";

/**
 * Event bus for Event-Driven Architecture.
 * Publishes domain events to registered handlers.
 */
export interface EventHandler<TEvent extends DomainEvent> {
  handle(event: TEvent): Promise<void> | void;
}

export class EventBus {
  private readonly handlers = new Map<string, EventHandler<DomainEvent>[]>();

  subscribe<TEvent extends DomainEvent>(
    eventName: TEvent["eventName"],
    handler: EventHandler<TEvent>,
  ): void {
    const handlers = this.handlers.get(eventName) ?? [];
    handlers.push(handler as EventHandler<DomainEvent>);
    this.handlers.set(eventName, handlers);
  }

  async publish(events: DomainEvent | DomainEvent[]): Promise<void> {
    const eventList = Array.isArray(events) ? events : [events];

    for (const event of eventList) {
      const handlers = this.handlers.get(event.eventName) ?? [];
      await Promise.all(handlers.map((handler) => handler.handle(event)));
    }
  }
}
