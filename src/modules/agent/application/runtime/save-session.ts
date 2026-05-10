import type { AgentSession } from "../../domain/types/agent.types";
import type { SessionRepositoryPort } from "../../domain/ports/session-repository.port";
import type { LoggerPort } from "../../../../shared/observability/logger.port";

export async function saveSession(
  sessionRepository: SessionRepositoryPort,
  session: AgentSession,
  logger: LoggerPort,
): Promise<void> {
  try {
    await sessionRepository.save(session);
  } catch (error) {
    logger.error("agent.session.save_error", {
      sessionId: session.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
