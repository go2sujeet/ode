export type ProcessorRuntimeRegistry<T> = {
  get: (processorId: string) => T;
  clear: () => void;
  size: () => number;
};

export function createProcessorRuntimeRegistry<T>(
  createRuntime: (processorId: string) => T
): ProcessorRuntimeRegistry<T> {
  const runtimes = new Map<string, T>();

  return {
    get(processorId: string): T {
      const key = processorId.trim() || "default";
      const existing = runtimes.get(key);
      if (existing) return existing;
      const runtime = createRuntime(key);
      runtimes.set(key, runtime);
      return runtime;
    },
    clear(): void {
      runtimes.clear();
    },
    size(): number {
      return runtimes.size;
    },
  };
}
