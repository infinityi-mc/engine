export interface DomainEvent<TName extends string = string> {
  readonly eventId: string;
  readonly eventName: TName;
  readonly occurredAt: Date;
}
