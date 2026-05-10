import type { DomainEvent } from "./domain-event";

/**
 * Base class for domain aggregates in Event-Driven Architecture.
 * Subclasses call record() to enqueue domain events, then infrastructure
 * drains them via pullDomainEvents() after persistence.
 */
export abstract class AggregateRoot {
  private readonly domainEvents: DomainEvent[] = [];

  protected record(event: DomainEvent): void {
    this.domainEvents.push(event);
  }

  pullDomainEvents(): DomainEvent[] {
    const events = [...this.domainEvents];
    this.domainEvents.length = 0;

    return events;
  }
}
