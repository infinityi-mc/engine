import type { LogContext, LogLevel, LoggerPort } from "./logger.port";

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class ConsoleLoggerAdapter implements LoggerPort {
  constructor(private readonly minimumLevel: LogLevel = parseLogLevel(Bun.env.LOG_LEVEL ?? "info")) {}

  debug(message: string, context?: LogContext): void {
    this.write("debug", message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write("info", message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write("warn", message, context);
  }

  error(message: string, context?: LogContext): void {
    this.write("error", message, context);
  }

  private write(level: LogLevel, message: string, context: LogContext = {}): void {
    if (levelPriority[level] < levelPriority[this.minimumLevel]) {
      return;
    }

    const payload = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context,
    });

    if (level === "error") {
      console.error(payload);
      return;
    }

    if (level === "warn") {
      console.warn(payload);
      return;
    }

    if (level === "debug") {
      console.debug(payload);
      return;
    }

    console.info(payload);
  }
}

function parseLogLevel(value: string): LogLevel {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }

  return "info";
}
