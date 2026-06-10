import { KernelRuntimeFacade, type RuntimeDeps } from "@/core/kernel/runtime-facade";

export function createCoreRuntime(deps: RuntimeDeps) {
  const facade = new KernelRuntimeFacade(deps);
  return {
    handleInboundEvent: (event: Parameters<KernelRuntimeFacade["handleInboundEvent"]>[0]) =>
      facade.handleInboundEvent(event),
    handleButtonSelection: (params: Parameters<KernelRuntimeFacade["handleButtonSelection"]>[0]) =>
      facade.handleButtonSelection(params),
    recoverPendingRequests: (options?: Parameters<KernelRuntimeFacade["recoverPendingRequests"]>[0]) =>
      facade.recoverPendingRequests(options),
  };
}
