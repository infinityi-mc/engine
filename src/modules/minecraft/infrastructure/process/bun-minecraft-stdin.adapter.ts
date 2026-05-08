import type { BunServerProcessAdapter } from "../../../server/infrastructure/process/bun-server-process.adapter";
import type { MinecraftStdinPort } from "../../domain/ports/minecraft-stdin.port";
import { MinecraftServerNotRunningError } from "../../domain/errors/minecraft-server-not-running.error";

export class BunMinecraftStdinAdapter implements MinecraftStdinPort {
  constructor(
    private readonly serverProcessAdapter: BunServerProcessAdapter,
  ) {}

  async sendCommand(serverId: string, command: string): Promise<void> {
    const subprocess = this.serverProcessAdapter.getSubprocess(serverId);
    if (subprocess === undefined) {
      throw new MinecraftServerNotRunningError(serverId);
    }

    const stdin = subprocess.stdin;
    if (typeof stdin === "number" || stdin === undefined) {
      throw new MinecraftServerNotRunningError(serverId);
    }

    // Bun.spawn with stdin: "pipe" returns a FileSink
    // FileSink has write() and flush() methods
    stdin.write(new TextEncoder().encode(command + "\n"));
    stdin.flush();
  }
}
