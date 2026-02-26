import {
  createProcessorRuntimeRegistry,
  type ProcessorRuntimeRegistry,
} from "@/ims/shared/processor-runtime-registry";

export type ProcessorManager<T> = {
  getRuntime: (processorId?: string) => T;
  clear: () => void;
  size: () => number;
};

export function createProcessorManager<T>(params: {
  createRuntime: (processorId: string) => T;
  defaultProcessorId?: string;
}): ProcessorManager<T> {
  const registry: ProcessorRuntimeRegistry<T> = createProcessorRuntimeRegistry(params.createRuntime);
  const defaultProcessorId = params.defaultProcessorId ?? "default";

  return {
    getRuntime: (processorId?: string): T => registry.get(processorId?.trim() || defaultProcessorId),
    clear: (): void => registry.clear(),
    size: (): number => registry.size(),
  };
}
