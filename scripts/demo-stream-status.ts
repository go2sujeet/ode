#!/usr/bin/env bun
// Demo script: drive Slack's chat.startStream / appendStream / stopStream
// directly against the current thread to show what task_update / plan_update
// renders as. Bypasses Ode runtime entirely — pure API call sanity check.
//
// Usage:
//   SLACK_BOT_TOKEN=xoxb-... SLACK_RECIPIENT_USER_ID=U... \
//     SLACK_RECIPIENT_TEAM_ID=T... \
//     bun run scripts/demo-stream-status.ts C0... 1779....
//
// Channel (non-DM) streams require recipient_user_id + recipient_team_id;
// for a DM you can omit those. The stream is mode-locked to "chunks" at
// startStream time — once locked you cannot mix in markdown_text on
// appendStream/stopStream (returns cannot_provide_both_markdown_text_and_chunks
// / streaming_mode_mismatch).

const [channel, threadTs] = Bun.argv.slice(2);
const token = process.env.SLACK_BOT_TOKEN;
if (!channel || !threadTs || !token) {
  console.error("Usage: SLACK_BOT_TOKEN=xoxb-... bun run scripts/demo-stream-status.ts <channelId> <threadTs>");
  process.exit(1);
}

async function call(method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const json: any = await res.json();
  if (!json.ok) {
    console.error(`[${method}] FAILED`, json);
    throw new Error(`${method}: ${json.error}`);
  }
  console.log(`[${method}] ok`, json.ts ? `ts=${json.ts}` : "");
  return json;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Helper: an appendStream call with chunks only. The API treats
// `markdown_text` and `chunks` as mutually exclusive (returns
// `cannot_provide_both_markdown_text_and_chunks` if you send both), even
// though the docs imply markdown_text is always required.
function append(ts: string, chunks: unknown[]) {
  return call("chat.appendStream", {
    channel,
    ts,
    chunks,
  });
}

async function main() {
  // 1. Start the stream. task_display_mode "plan" groups everything into one
  //    unified plan block instead of separate task_card messages.
  //    Channel (non-DM) streams require recipient_user_id + recipient_team_id.
  const recipientUserId = process.env.SLACK_RECIPIENT_USER_ID;
  const recipientTeamId = process.env.SLACK_RECIPIENT_TEAM_ID;
  if (!recipientUserId || !recipientTeamId) {
    console.error("Set SLACK_RECIPIENT_USER_ID and SLACK_RECIPIENT_TEAM_ID for channel streams");
    process.exit(1);
  }
  const started = await call("chat.startStream", {
    channel,
    thread_ts: threadTs,
    task_display_mode: "plan",
    recipient_user_id: recipientUserId,
    recipient_team_id: recipientTeamId,
    chunks: [{ type: "plan_update", title: "Thinking…" }],
  });
  const ts: string = started.ts;

  // (plan_update was already sent in startStream above)
  await sleep(900);

  // 3. Start a task — pending.
  await append(ts, [{
    type: "task_update",
    id: "tool-1",
    title: "bash `git status`",
    status: "pending",
  }]);
  await sleep(800);

  // 4. Flip it to in_progress (spinner).
  await append(ts, [{
    type: "task_update",
    id: "tool-1",
    title: "bash `git status`",
    status: "in_progress",
    details: "Reading working tree",
  }]);
  await sleep(1400);

  // 5. Complete + start another.
  await append(ts, [
    {
      type: "task_update",
      id: "tool-1",
      title: "bash `git status`",
      status: "complete",
      output: "3 files modified",
    },
    {
      type: "task_update",
      id: "tool-2",
      title: "read packages/ims/slack/client.ts",
      status: "in_progress",
    },
  ]);
  await sleep(1500);

  // 6. Complete second, kick off a longer-looking third.
  await append(ts, [
    {
      type: "task_update",
      id: "tool-2",
      title: "read packages/ims/slack/client.ts",
      status: "complete",
      output: "750 lines",
    },
    {
      type: "task_update",
      id: "tool-3",
      title: "grep \"chat.update\" in packages/",
      status: "in_progress",
    },
  ]);
  await sleep(1800);

  // 7. Rename the plan (phase change) + finish last task.
  await append(ts, [
    { type: "plan_update", title: "Drafting response" },
    {
      type: "task_update",
      id: "tool-3",
      title: "grep \"chat.update\" in packages/",
      status: "complete",
      output: "12 matches across 5 files",
    },
  ]);
  await sleep(1200);

  // 8. Stop the stream. Don't pass markdown_text here because we started in
  //    chunks mode; the streaming-mode lock applies to stop too.
  await call("chat.stopStream", {
    channel,
    ts,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
