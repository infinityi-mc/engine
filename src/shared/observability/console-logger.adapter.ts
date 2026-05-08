import type { LogContext, LogLevel, LoggerPort } from "./logger.port";

const LEVELS = new Set(["debug", "info", "warn", "error"]);

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const COLORS: Record<LogLevel, string> = {
  debug: "\x1b[96m",
  info: "\x1b[92m",
  warn: "\x1b[93m",
  error: "\x1b[91m",
};
const RESET = "\x1b[0m";
const TIMESPAN = "\x1b[90m";
const CONTEXT = "\x1b[2m";

const CONSOLE_METHODS: Record<LogLevel, "error" | "warn" | "debug" | "info"> = {
  error: "error",
  warn: "warn",
  debug: "debug",
  info: "info",
};

export class ConsoleLoggerAdapter implements LoggerPort {
  constructor(
    private readonly minimumLevel: LogLevel = parseLogLevel(
      Bun.env.LOG_LEVEL ?? "info",
    ),
  ) {}

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

  private write(
    level: LogLevel,
    message: string,
    context: LogContext = {},
  ): void {
    if (levelPriority[level] < levelPriority[this.minimumLevel]) return;

    const payload = logParser(level, message, context); // pass context too
    console[CONSOLE_METHODS[level]](payload);
  }
}

function logParser(
  level: LogLevel,
  message: string,
  context: LogContext = {},
): string {
  const time = new Date().toLocaleTimeString("en-GB");
  const ctx = Object.keys(context).length ? ` ${JSON.stringify(context)}` : "";
  return `${TIMESPAN}[${time}]${RESET} ${COLORS[level]}${level}${RESET}: ${message}${CONTEXT}${ctx}${RESET}`;
}

function parseLogLevel(value: string): LogLevel {
  return LEVELS.has(value) ? (value as LogLevel) : "info";
}
