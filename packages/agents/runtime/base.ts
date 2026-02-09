import type { ChildProcess } from "child_process";
import { log } from "@/utils";

export type SessionEnvironment = Record<string, string>;

type SessionHandler = (event: unknown) => void;

type ActiveRequestEntry = {
  controller: AbortController;
  process?: ChildProcess;
};

export function normalizeSessionEnvironment(env?: SessionEnvironment | null): string {
  if (!env) return "";
  return Object.keys(env)
    .sort()
    .map((key) => `${key}=${env[key]}`)
    .join("\n");
}

export function formatShellCommand(args: string[]): string {
  return args
    .map((arg) => {
      if (arg.length === 0) return "''";
      if (/[^\w@%+=:,./-]/.test(arg)) {
        const escaped = arg.replace(/'/g, `"'"'"`);
        return `'${escaped}'`;
      }
      return arg;
    })
    .join(" ");
}

export abstract class BaseAgentRuntime {
  protected readonly sessionLocks = new Map<string, Promise<unknown>>();
  protected readonly sessionEnvironments = new Map<string, SessionEnvironment>();
  protected readonly sessionSubscribers = new Map<string, Set<SessionHandler>>();

  protected constructor(private readonly providerName: string) {}

  async withSessionLock<T>(sessionKey: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.sessionLocks.get(sessionKey);
    if (existing) {
      await existing.catch(() => {});
    }

    const promise = fn();
    this.sessionLocks.set(sessionKey, promise);

    try {
      return await promise;
    } finally {
      this.sessionLocks.delete(sessionKey);
    }
  }

  ensureSessionEnvironment(sessionId: string): void {
    if (!this.sessionEnvironments.has(sessionId)) {
      this.sessionEnvironments.set(sessionId, {});
    }
  }

  getSessionEnvironment(sessionId: string): SessionEnvironment {
    return this.sessionEnvironments.get(sessionId) ?? {};
  }

  setSessionEnvironment(sessionId: string, env: SessionEnvironment): void {
    this.sessionEnvironments.set(sessionId, env);
  }

  subscribeToSession(sessionId: string, handler: SessionHandler): () => void {
    const handlers = this.sessionSubscribers.get(sessionId) ?? new Set<SessionHandler>();
    handlers.add(handler);
    this.sessionSubscribers.set(sessionId, handlers);

    return () => {
      const activeHandlers = this.sessionSubscribers.get(sessionId);
      if (!activeHandlers) return;
      activeHandlers.delete(handler);
      if (activeHandlers.size === 0) {
        this.sessionSubscribers.delete(sessionId);
      }
    };
  }

  publishSessionEvent(sessionId: string, event: unknown): void {
    const handlers = this.sessionSubscribers.get(sessionId);
    if (!handlers || handlers.size === 0) return;
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
        log.warn(`${this.providerName} session subscriber failed`, {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  protected clearSharedState(): void {
    this.sessionLocks.clear();
    this.sessionSubscribers.clear();
  }
}

export class CliAgentRuntime extends BaseAgentRuntime {
  private readonly activeRequests = new Map<string, ActiveRequestEntry>();

  constructor(providerName: string) {
    super(providerName);
  }

  beginRequest(sessionKey: string): ActiveRequestEntry {
    const existingEntry = this.activeRequests.get(sessionKey);
    if (existingEntry) {
      existingEntry.controller.abort();
      existingEntry.process?.kill("SIGTERM");
    }

    const entry: ActiveRequestEntry = { controller: new AbortController() };
    this.activeRequests.set(sessionKey, entry);
    return entry;
  }

  endRequest(sessionKey: string): void {
    this.activeRequests.delete(sessionKey);
  }

  async ensureSession(sessionId: string): Promise<void> {
    this.ensureSessionEnvironment(sessionId);
  }

  async abortSession(sessionId: string): Promise<void> {
    for (const [sessionKey, entry] of this.activeRequests) {
      if (sessionKey.endsWith(`:${sessionId}`)) {
        entry.controller.abort();
        entry.process?.kill("SIGTERM");
        this.activeRequests.delete(sessionKey);
      }
    }
  }

  async cancelActiveRequest(channelId: string, sessionId: string): Promise<boolean> {
    const sessionKey = `${channelId}:${sessionId}`;
    const entry = this.activeRequests.get(sessionKey);
    if (!entry) return false;

    entry.controller.abort();
    entry.process?.kill("SIGTERM");
    this.activeRequests.delete(sessionKey);
    return true;
  }

  stopServer(): void {
    for (const entry of this.activeRequests.values()) {
      entry.controller.abort();
      entry.process?.kill("SIGTERM");
    }
    this.activeRequests.clear();
    this.clearSharedState();
  }
}

export class ServerAgentRuntime extends BaseAgentRuntime {
  private readonly activeRequests = new Map<string, AbortController>();

  constructor() {
    super("OpenCode");
  }

  beginRequest(sessionKey: string): AbortController {
    const existingController = this.activeRequests.get(sessionKey);
    if (existingController) {
      existingController.abort();
    }

    const controller = new AbortController();
    this.activeRequests.set(sessionKey, controller);
    return controller;
  }

  endRequest(sessionKey: string): void {
    this.activeRequests.delete(sessionKey);
  }

  async cancelActiveRequest(channelId: string, sessionId: string): Promise<boolean> {
    const sessionKey = `${channelId}:${sessionId}`;
    const controller = this.activeRequests.get(sessionKey);
    if (!controller) return false;
    controller.abort();
    this.activeRequests.delete(sessionKey);
    return true;
  }
}
