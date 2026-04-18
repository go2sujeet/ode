import type { Elysia } from "elysia";
import {
  createCronJob,
  deleteCronJob,
  getCronJobById,
  listCronJobChannelOptions,
  listCronJobs,
  patchCronJob,
  updateCronJob,
  type PatchCronJobParams,
} from "@/config/local/cron-jobs";
import {
  CronJobAlreadyRunningError,
  CronJobNotFoundError,
  beginTriggerCronJobNow,
} from "@/core/cron/scheduler";
import { log } from "@/utils";
import { jsonResponse, readJsonBody, runRoute } from "../http";

function getString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function getBoolean(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key];
  return typeof value === "boolean" ? value : undefined;
}

function parseCronJobPayload(payload: Record<string, unknown>) {
  return {
    title: getString(payload, "title"),
    cronExpression: getString(payload, "cronExpression"),
    channelId: getString(payload, "channelId"),
    messageText: getString(payload, "messageText"),
    enabled: getBoolean(payload, "enabled"),
  };
}

function parseCronJobPatchPayload(payload: Record<string, unknown>): PatchCronJobParams {
  const patch: PatchCronJobParams = {};
  if ("title" in payload && typeof payload.title === "string") patch.title = payload.title;
  if ("cronExpression" in payload && typeof payload.cronExpression === "string") {
    patch.cronExpression = payload.cronExpression;
  }
  if ("channelId" in payload && typeof payload.channelId === "string") patch.channelId = payload.channelId;
  if ("messageText" in payload && typeof payload.messageText === "string") patch.messageText = payload.messageText;
  const enabled = getBoolean(payload, "enabled");
  if (enabled !== undefined) patch.enabled = enabled;
  return patch;
}

export function registerCronJobRoutes(app: Elysia): void {
  app.get("/api/cron-jobs", async () => {
    return runRoute(
      async () => ({
        jobs: listCronJobs(),
        channels: listCronJobChannelOptions(),
      }),
      (result) => jsonResponse(200, { ok: true, result }),
      { fallbackMessage: "Internal server error", status: 500 }
    );
  });

  app.get("/api/cron-jobs/:id", async ({ params }: { params: { id?: string } }) => {
    return runRoute(
      async () => {
        const id = params.id?.trim();
        if (!id) throw new Error("Missing cron job id");
        const job = getCronJobById(id);
        if (!job) throw new Error("Cron job not found");
        return { job };
      },
      (result) => jsonResponse(200, { ok: true, result }),
      {
        fallbackMessage: "Failed to load cron job",
        resolveStatus: (message) => {
          if (message === "Missing cron job id") return 400;
          if (message === "Cron job not found") return 404;
          return 500;
        },
      }
    );
  });

  app.post("/api/cron-jobs", async ({ request }: { request: Request }) => {
    return runRoute(
      async () => {
        const body = await readJsonBody(request);
        const payload = parseCronJobPayload(body);
        const runImmediately = getBoolean(body, "runImmediately") === true;
        const job = createCronJob(payload);

        // Kick off an immediate run in the background when requested. We do
        // NOT await this so the HTTP response returns quickly and the UI can
        // refresh the job list; the scheduler's own `runningJobIds` guard
        // prevents a duplicate run from the polling loop.
        if (runImmediately) {
          try {
            const runPromise = beginTriggerCronJobNow(job.id);
            runPromise.catch((error) => {
              log.warn("Immediate cron job run after create failed", {
                cronJobId: job.id,
                error: String(error),
              });
            });
          } catch (error) {
            // An immediate run failing (e.g. scheduler race) should not fail
            // the create itself — the job was saved successfully.
            log.warn("Unable to start immediate cron job run after create", {
              cronJobId: job.id,
              error: String(error),
            });
          }
        }

        return {
          job,
          jobs: listCronJobs(),
          channels: listCronJobChannelOptions(),
        };
      },
      (result) => jsonResponse(200, { ok: true, result }),
      { fallbackMessage: "Invalid cron job payload", status: 400 }
    );
  });

  app.put("/api/cron-jobs/:id", async ({ params, request }: { params: { id?: string }; request: Request }) => {
    return runRoute(
      async () => {
        const id = params.id?.trim();
        if (!id) {
          throw new Error("Missing cron job id");
        }
        const payload = parseCronJobPayload(await readJsonBody(request));
        const job = updateCronJob(id, payload);
        return {
          job,
          jobs: listCronJobs(),
          channels: listCronJobChannelOptions(),
        };
      },
      (result) => jsonResponse(200, { ok: true, result }),
      {
        fallbackMessage: "Invalid cron job payload",
        resolveStatus: (message) => {
          if (message === "Missing cron job id") return 400;
          if (message === "Cron job not found") return 404;
          return 400;
        },
      }
    );
  });

  app.patch("/api/cron-jobs/:id", async ({ params, request }: { params: { id?: string }; request: Request }) => {
    return runRoute(
      async () => {
        const id = params.id?.trim();
        if (!id) {
          throw new Error("Missing cron job id");
        }
        const patch = parseCronJobPatchPayload(await readJsonBody(request));
        const job = patchCronJob(id, patch);
        return {
          job,
          jobs: listCronJobs(),
          channels: listCronJobChannelOptions(),
        };
      },
      (result) => jsonResponse(200, { ok: true, result }),
      {
        fallbackMessage: "Invalid cron job payload",
        resolveStatus: (message) => {
          if (message === "Missing cron job id") return 400;
          if (message === "Cron job not found") return 404;
          return 400;
        },
      }
    );
  });

  app.delete("/api/cron-jobs/:id", async ({ params }: { params: { id?: string } }) => {
    return runRoute(
      async () => {
        const id = params.id?.trim();
        if (!id) {
          throw new Error("Missing cron job id");
        }
        deleteCronJob(id);
        return {
          jobs: listCronJobs(),
          channels: listCronJobChannelOptions(),
        };
      },
      (result) => jsonResponse(200, { ok: true, result }),
      {
        fallbackMessage: "Failed to delete cron job",
        resolveStatus: (message) => (message === "Missing cron job id" ? 400 : 400),
      }
    );
  });

  app.post("/api/cron-jobs/:id/run", async ({ params }: { params: { id?: string } }) => {
    return runRoute(
      async () => {
        const id = params.id?.trim();
        if (!id) {
          throw new Error("Missing cron job id");
        }
        // `beginTriggerCronJobNow` validates the job exists and isn't already
        // running synchronously, then returns a detached promise for the
        // actual agent turn. We observe and log that promise but don't await
        // it — the HTTP response returns immediately and the UI can refresh
        // the job list to show the "running" state.
        try {
          const runPromise = beginTriggerCronJobNow(id);
          runPromise.catch((error) => {
            log.warn("Manually triggered cron job run failed", {
              cronJobId: id,
              error: String(error),
            });
          });
        } catch (error) {
          if (error instanceof CronJobAlreadyRunningError) {
            throw new Error("Cron job already running");
          }
          if (error instanceof CronJobNotFoundError) {
            throw new Error("Cron job not found");
          }
          throw error;
        }
        return {
          jobs: listCronJobs(),
          channels: listCronJobChannelOptions(),
        };
      },
      (result) => jsonResponse(200, { ok: true, result }),
      {
        fallbackMessage: "Failed to run cron job",
        resolveStatus: (message) => {
          if (message === "Missing cron job id") return 400;
          if (message === "Cron job not found") return 404;
          if (message === "Cron job already running") return 409;
          return 500;
        },
      }
    );
  });
}
