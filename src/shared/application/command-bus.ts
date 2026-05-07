export interface Command<TType extends string = string> {
  readonly type: TType;
}

export interface CommandHandler<TCommand extends Command, TResult> {
  handle(command: TCommand): Promise<TResult> | TResult;
}

export class CommandBus {
  private readonly handlers = new Map<string, CommandHandler<Command, unknown>>();

  register<TCommand extends Command, TResult>(
    type: TCommand["type"],
    handler: CommandHandler<TCommand, TResult>,
  ): void {
    this.handlers.set(type, handler as CommandHandler<Command, unknown>);
  }

  async execute<TCommand extends Command, TResult>(command: TCommand): Promise<TResult> {
    const handler = this.handlers.get(command.type);

    if (!handler) {
      throw new Error(`No command handler registered for ${command.type}`);
    }

    return handler.handle(command) as Promise<TResult>;
  }
}
