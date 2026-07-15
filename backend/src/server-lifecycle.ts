export interface ShutdownDependencies {
  stopHttp(): Promise<void>;
  closeSocketIo(): Promise<void>;
  closeOrchestrator(): void;
  closeLlm(): Promise<void>;
  disconnectPrisma(): Promise<void>;
  logError(error: unknown): void;
  setExitCode(code: number): void;
}

type ShutdownSignal = "SIGINT" | "SIGTERM";

function invoke(operation: () => void | Promise<void>): Promise<void> {
  try {
    return Promise.resolve(operation());
  } catch (error) {
    return Promise.reject(error);
  }
}

export function createGracefulShutdown(
  dependencies: ShutdownDependencies,
): (signal: ShutdownSignal) => Promise<void> {
  let shutdownPromise: Promise<void> | null = null;

  return (_signal: ShutdownSignal): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      let failed = false;
      const settle = async (operation: Promise<void>): Promise<void> => {
        try {
          await operation;
        } catch (error) {
          failed = true;
          dependencies.logError(error);
        }
      };

      const http = invoke(dependencies.stopHttp);
      const socketIo = invoke(dependencies.closeSocketIo);
      const orchestrator = invoke(dependencies.closeOrchestrator);
      const llm = invoke(dependencies.closeLlm);

      await Promise.all([
        settle(http),
        settle(socketIo),
        settle(orchestrator),
        settle(llm),
      ]);
      await settle(invoke(dependencies.disconnectPrisma));

      if (failed) dependencies.setExitCode(1);
    })();

    return shutdownPromise;
  };
}
