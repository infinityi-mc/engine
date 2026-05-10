export interface LogListenerPort {
  startListening(serverId: string): void;
  stopListening(serverId: string): void;
}
