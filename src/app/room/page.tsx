import Image from "next/image";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { query as sql } from "@/lib/db";
import { youtubeMqThumbnailUrl } from "@/lib/youtubeThumb";
import type { Room } from "@/types/db";
import type { MediaRef } from "@/types/media";

const PAGE_SIZE = 10;

type Params = Promise<{ q?: string; page?: string }>;

type DirectoryRow = Pick<Room, "id" | "owner_id" | "title" | "slug" | "start_media" | "created_at"> & {
  play_count: number;
};

function parseTotalCount(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function buildRoomsHref(q: string, page: number): string {
  const p = new URLSearchParams();
  const t = q.trim();
  if (t) p.set("q", t);
  if (page > 0) p.set("page", String(page));
  const s = p.toString();
  return s ? `/room?${s}` : "/room";
}

export default async function RoomsIndexPage(props: { searchParams: Params }) {
  await requireUser();
  const sp = await props.searchParams;
  const query = (sp.q ?? "").trim();
  const page = Math.max(0, parseInt(sp.page ?? "0", 10) || 0);
  const offset = page * PAGE_SIZE;

  let rooms: DirectoryRow[] = [];
  let total = 0;
  let listErrMsg: string | undefined;
  try {
    const [rows, countRows] = await Promise.all([
      sql<DirectoryRow>(
        `select id, owner_id, title, slug, start_media, created_at::text as created_at, play_count
         from list_rooms_directory($1, $2, $3)`,
        [query, PAGE_SIZE, offset],
      ),
      sql<{ count: unknown }>(`select count_rooms_directory($1) as count`, [query]),
    ]);
    rooms = rows;
    total = parseTotalCount(countRows[0]?.count);
  } catch (e: unknown) {
    listErrMsg = e instanceof Error ? e.message : "Failed to load rooms.";
  }

  const hasPrev = page > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <main className="container col" style={{ gap: "1.25rem", paddingTop: "0.5rem" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="col" style={{ gap: "0.25rem" }}>
          <h1 style={{ margin: 0 }}>Rooms</h1>
          <p className="muted" style={{ margin: 0 }}>
            依房間播放次數排序；搜尋會比對開場曲與 set 內歌曲標題（含 YouTube 快取標題）。
          </p>
        </div>
        <Link className="pill" href="/transition">
          Transition page
        </Link>
      </div>

      <section className="panel col" style={{ gap: "0.75rem" }}>
        <h2 style={{ margin: 0 }}>建立新房間</h2>
        <p className="muted" style={{ margin: 0 }}>
          建立一組可分享的 DJ set（含過門與 1 小時長度上限）。
        </p>
        <div>
          <Link className="pill" href="/room/new">
            New room
          </Link>
        </div>
      </section>

      <section className="panel col" style={{ gap: "1rem" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>熱門房間</h2>
          <span className="muted">
            {query ? `搜尋「${query}」· ` : null}
            共 {total} 個 · 第 {page + 1} 頁
          </span>
        </div>

        <form action="/room" method="get" className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="輸入歌名模糊搜尋…"
            aria-label="依歌名搜尋房間"
            style={{ minWidth: "min(100%, 280px)", flex: "1 1 220px" }}
          />
          <button type="submit">搜尋</button>
          {query ? (
            <Link className="pill" href="/room" style={{ borderColor: "#303544", background: "#303544" }}>
              清除
            </Link>
          ) : null}
        </form>

        {listErrMsg ? (
          <p style={{ color: "#f87171" }}>
            無法載入房間列表：{listErrMsg}。若尚未套用資料庫 migration，請執行{" "}
            <code>npm run migrate</code>。
          </p>
        ) : rooms.length === 0 ? (
          <p className="muted">{query ? "沒有包含此歌名的房間。" : "尚無房間，先建立一個吧。"}</p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: "1rem",
              alignItems: "stretch",
            }}
          >
            {rooms.map((room) => {
              const media = room.start_media as MediaRef;
              const vid = media.videoId;
              const thumb = youtubeMqThumbnailUrl(vid);
              const plays = room.play_count ?? 0;
              return (
                <Link
                  key={room.id}
                  href={`/room/${room.id}`}
                  className="col panel"
                  style={{
                    gap: "0.5rem",
                    padding: "0.75rem",
                    textDecoration: "none",
                    border: "1px solid #2a2f3a",
                    transition: "border-color 0.15s ease",
                  }}
                >
                  <div
                    style={{
                      position: "relative",
                      aspectRatio: "16 / 9",
                      width: "100%",
                      borderRadius: 8,
                      overflow: "hidden",
                      background: "#0f1115",
                    }}
                  >
                    {thumb ? (
                      <Image src={thumb} alt="" fill sizes="(max-width: 720px) 50vw, 240px" style={{ objectFit: "cover" }} />
                    ) : (
                      <div className="muted col" style={{ height: "100%", justifyContent: "center", alignItems: "center" }}>
                        無縮圖
                      </div>
                    )}
                  </div>
                  <strong style={{ lineHeight: 1.35 }}>{room.title}</strong>
                  <span className="muted" style={{ fontSize: "0.85rem" }}>
                    播放 {plays} 次 · {room.slug}
                  </span>
                </Link>
              );
            })}
          </div>
        )}

        {!listErrMsg && total > PAGE_SIZE ? (
          <div className="row" style={{ justifyContent: "flex-end", gap: "0.5rem" }}>
            {hasPrev ? (
              <Link className="pill" href={buildRoomsHref(query, page - 1)} style={{ borderColor: "#303544", background: "#303544" }}>
                上一頁（前 {PAGE_SIZE} 個）
              </Link>
            ) : (
              <span className="pill muted" style={{ opacity: 0.45 }}>
                上一頁（前 {PAGE_SIZE} 個）
              </span>
            )}
            {hasNext ? (
              <Link className="pill" href={buildRoomsHref(query, page + 1)}>
                下一頁（後 {PAGE_SIZE} 個）
              </Link>
            ) : (
              <span className="pill muted" style={{ opacity: 0.45 }}>
                下一頁（後 {PAGE_SIZE} 個）
              </span>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}
