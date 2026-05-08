export interface MinecraftStdinPort {
  sendCommand(serverId: string, command: string): Promise<void>;
}
