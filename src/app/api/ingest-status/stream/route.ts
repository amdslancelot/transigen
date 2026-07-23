import type { NextRequest } from "next/server";
import { Client } from "pg";
import { getCurrentUser } from "@/lib/auth";
import { YOUTUBE_ID_RE } from "@/lib/validate";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;
// Every stream holds a dedicated Postgres connection; cap the id list so a
// single request can't be used to amplify load. Room sets are far smaller.
const MAX_IDS = 100;

// SSE stream of ingest progress for a set of video ids. A dedicated Postgres
// connection LISTENs on ingest_jobs_changed (NOTIFY fired by a trigger on
// ingest_jobs); every relevant change pushes a fresh {done,total} count.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const idsParam = request.nextUrl.searchParams.get("ids") ?? "";
  const ids = Array.from(
    new Set(
      idsParam
        .split(",")
        .map((s) => s.trim())
        .filter((v) => YOUTUBE_ID_RE.test(v)),
    ),
  );
  if (ids.length === 0 || ids.length > MAX_IDS) {
    return new Response("Missing or invalid ids", { status: 400 });
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("listen ingest_jobs_changed");

  const idSet = new Set(ids);
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    void client.end().catch(() => {});
    try {
      streamController?.close();
    } catch {
      /* already closed */
    }
  };

  const countDone = async (): Promise<number> => {
    const res = await client.query<{ done: number }>(
      `select count(*)::int as done
       from ingest_jobs
       where video_id = any($1::text[]) and status in ('done', 'failed')`,
      [ids],
    );
    return res.rows[0]?.done ?? 0;
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      streamController = controller;

      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          cleanup();
        }
      };

      const push = async () => {
        try {
          send({ done: await countDone(), total: ids.length });
        } catch {
          cleanup();
        }
      };

      client.on("notification", (msg) => {
        if (closed || msg.channel !== "ingest_jobs_changed" || !msg.payload) return;
        try {
          const payload = JSON.parse(msg.payload) as { video_id?: string };
          if (payload.video_id && idSet.has(payload.video_id)) void push();
        } catch {
          /* ignore malformed notifications */
        }
      });
      client.on("error", cleanup);

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, HEARTBEAT_MS);

      request.signal.addEventListener("abort", cleanup);

      await push();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
