import { HarnessRedisStore } from "../redis-store";
import { renderStatusesFromRun } from "../renderer";

function parseArg(name: string): string | undefined {
  const exact = `--${name}`;
  const prefix = `--${name}=`;
  const index = Bun.argv.findIndex((value) => value === exact || value.startsWith(prefix));
  if (index < 0) return undefined;
  const value = Bun.argv[index] ?? "";
  if (value.startsWith(prefix)) return value.slice(prefix.length);
  return Bun.argv[index + 1];
}

async function main(): Promise<void> {
  const runIdArg = parseArg("run-id");
  const redisPrefix = parseArg("redis-prefix");
  const store = new HarnessRedisStore(redisPrefix);
  await store.connect();

  try {
    const runId = runIdArg || await store.getLatestRunId();
    if (!runId) {
      throw new Error("No harness run found in Redis. Capture a run first.");
    }

    const meta = await store.getRunMeta(runId);
    if (!meta) {
      throw new Error(`Run metadata missing for ${runId}`);
    }

    const events = await store.getRunEvents(runId);
    const statuses = renderStatusesFromRun(meta, events);
    await store.saveRenderedStatuses(runId, statuses);

    process.stdout.write(`${JSON.stringify({ runId, provider: meta.provider, eventCount: events.length, statusCount: statuses.length }, null, 2)}\n`);

    for (const status of statuses) {
      process.stdout.write(`\n--- status #${status.index} @ ${new Date(status.timestamp).toISOString()} ---\n`);
      process.stdout.write(`${status.text}\n`);
    }
  } finally {
    await store.close();
  }
}

await main();
