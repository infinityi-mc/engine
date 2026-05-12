export interface LogListenerPort {
  startListening(serverId: string): void | Promise<void>;
  stopListening(serverId: string): void;
  refreshConfig(serverId: string): void | Promise<void>;
}
