type RuntimeControllerOptions = {
  isRunning: () => boolean;
  startInternal: (reason: string) => Promise<boolean>;
  stopInternal: (reason: string) => Promise<void>;
};

export function createRuntimeController(options: RuntimeControllerOptions): {
  start: (reason: string) => Promise<boolean>;
  stop: (reason: string) => Promise<void>;
} {
  let startPromise: Promise<boolean> | null = null;

  return {
    async start(reason: string): Promise<boolean> {
      if (options.isRunning()) {
        return true;
      }
      if (startPromise) {
        return startPromise;
      }

      startPromise = options.startInternal(reason)
        .finally(() => {
          startPromise = null;
        });
      return startPromise;
    },

    async stop(reason: string): Promise<void> {
      startPromise = null;
      if (!options.isRunning()) return;
      await options.stopInternal(reason);
    },
  };
}
