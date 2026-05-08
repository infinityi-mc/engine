import type { BunServerProcessAdapter } from "../../../server/infrastructure/process/bun-server-process.adapter";

/**
 * Waits for a subprocess to exit within the given timeout.
 * Returns true if the process exited on its own, false if the timeout expired.
 */
export function waitForProcessExit(
  serverProcessAdapter: BunServerProcessAdapter,
): (instanceId: string, timeoutMs: number) => Promise<boolean> {
  return async (instanceId: string, timeoutMs: number): Promise<boolean> => {
    const subprocess = serverProcessAdapter.getSubprocess(instanceId);
    if (subprocess === undefined) {
      // Process already gone — treat as gracefully exited
      return true;
    }

    try {
      const exitResult = await Promise.race([
        subprocess.exited,
        new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
      ]);
      return exitResult !== false;
    } catch {
      return false;
    }
  };
}
