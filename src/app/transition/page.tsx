import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fetchSavedTransitionPairsPage } from "@/lib/savedTransitionPairs";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { MediaRef } from "@/types/media";

const PAGE_SIZE = 20;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pickParam(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

function youtubeWatchUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function formatArtistTrack(meta: { title: string; channelTitle: string } | undefined, videoId: string): string {
  const title = (meta?.title ?? "").trim();
  const ch = (meta?.channelTitle ?? "").trim();
  if (ch && title) return `${ch} — ${title}`;
  if (title) return title;
  return videoId;
}

function mediaLabel(m: MediaRef, labels: Map<string, { title: string; channelTitle: string }>): string {
  const id = m.videoId ?? "";
  if (!id) return "—";
  return formatArtistTrack(labels.get(id), id) || (m.title?.trim() ? m.title : id);
}

export default async function TransitionIndexPage(props: { searchParams: SearchParams }) {
  await requireUser();
  const sp = await props.searchParams;
  const rawQ = pickParam(sp.q);
  const meaningful = rawQ.trim().replace(/[%_,\s]/g, "");
  const q = meaningful.length > 0 ? rawQ.trim() : "";
  const pageRaw = pickParam(sp.page);
  const page = Math.max(1, Math.min(10_000, parseInt(pageRaw || "1", 10) || 1));

  const supabase = await getSupabaseServerClient();
  const { rows, total } = await fetchSavedTransitionPairsPage(supabase, { page, pageSize: PAGE_SIZE, q });

  const videoIds = new Set<string>();
  for (const r of rows) {
    const a = r.from_media?.videoId;
    const b = r.to_media?.videoId;
    if (a) videoIds.add(a);
    if (b) videoIds.add(b);
  }
  const labels = new Map<string, { title: string; channelTitle: string }>();
  if (videoIds.size > 0) {
    const { data: cacheRows } = await supabase
      .from("youtube_video_cache")
      .select("video_id,title,channel_title")
      .in("video_id", [...videoIds]);
    for (const row of cacheRows ?? []) {
      const id = String(row.video_id ?? "");
      if (!id) continue;
      labels.set(id, {
        title: (row.title as string) ?? "",
        channelTitle: (row.channel_title as string) ?? "",
      });
    }
  }

  const hasNext = page * PAGE_SIZE < total;
  const hasPrev = page > 1;
  const qParam = q ? `&q=${encodeURIComponent(q)}` : "";

  return (
    <main className="container col" style={{ gap: "1rem" }}>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <h1>Saved transitions</h1>
        <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          <Link className="pill" href="/transition/new">
            New transition
          </Link>
          <Link className="pill" href="/">
            Home
          </Link>
          <Link className="pill" href="/room/new">
            Create room
          </Link>
        </div>
      </div>

      <section className="panel col" style={{ gap: "0.75rem" }}>
        <form method="get" action="/transition" className="row" style={{ gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <label htmlFor="transition-search" className="muted">
            Search
          </label>
          <input
            id="transition-search"
            name="q"
            type="search"
            placeholder="Video ID, title, channel…"
            defaultValue={rawQ}
            style={{ flex: "1 1 220px", minWidth: 180, maxWidth: 480 }}
            autoComplete="off"
          />
          <input type="hidden" name="page" value="1" />
          <button type="submit">Search</button>
          {q ? (
            <Link className="secondary" href="/transition" style={{ fontSize: "0.9rem" }}>
              Clear
            </Link>
          ) : null}
        </form>
        <p className="muted" style={{ margin: 0 }}>
          {total === 0
            ? q
              ? "No transitions match your search."
              : "No saved transition pairs yet."
            : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
        </p>
      </section>

      <section className="panel col" style={{ gap: 0 }}>
        {rows.length === 0 ? null : (
          <ul className="col" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rows.map((row) => {
              const fromId = row.from_media?.videoId ?? "";
              const toId = row.to_media?.videoId ?? "";
              const href =
                fromId && toId
                  ? `/transition/new?fromVideo=${encodeURIComponent(youtubeWatchUrl(fromId))}&toVideo=${encodeURIComponent(youtubeWatchUrl(toId))}`
                  : "/transition/new";
              return (
                <li
                  key={row.id}
                  className="row"
                  style={{
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: "0.75rem",
                    borderBottom: "1px solid #2a2f3a",
                    padding: "0.65rem 0",
                  }}
                >
                  <div className="col" style={{ flex: 1, gap: "0.25rem" }}>
                    <span>{mediaLabel(row.from_media, labels)}</span>
                    <span className="muted">→ {mediaLabel(row.to_media, labels)}</span>
                  </div>
                  <Link className="pill" href={href}>
                    Open
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {(hasPrev || hasNext) && total > 0 ? (
        <div className="row" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
          {hasPrev ? (
            <Link className="pill" href={`/transition?page=${page - 1}${qParam}`}>
              Previous page
            </Link>
          ) : null}
          {hasNext ? (
            <Link className="pill" href={`/transition?page=${page + 1}${qParam}`}>
              Next page
            </Link>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
