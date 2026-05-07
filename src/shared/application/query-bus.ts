export interface Query<TType extends string = string> {
  readonly type: TType;
}

export interface QueryHandler<TQuery extends Query, TResult> {
  handle(query: TQuery): Promise<TResult> | TResult;
}

export class QueryBus {
  private readonly handlers = new Map<string, QueryHandler<Query, unknown>>();

  register<TQuery extends Query, TResult>(
    type: TQuery["type"],
    handler: QueryHandler<TQuery, TResult>,
  ): void {
    this.handlers.set(type, handler as QueryHandler<Query, unknown>);
  }

  async execute<TQuery extends Query, TResult>(query: TQuery): Promise<TResult> {
    const handler = this.handlers.get(query.type);

    if (!handler) {
      throw new Error(`No query handler registered for ${query.type}`);
    }

    return handler.handle(query) as Promise<TResult>;
  }
}
