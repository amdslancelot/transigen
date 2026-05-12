"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRoomTitle } from "@/app/actions";

type Props = {
  roomId: string;
  initialTitle: string;
};

export function RoomTitleBar({ roomId, initialTitle }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialTitle);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setTitle(initialTitle);
    if (!editing) setDraft(initialTitle);
  }, [initialTitle, editing]);

  const startEdit = () => {
    setDraft(title);
    setErr(null);
    setEditing(true);
  };

  const cancel = () => {
    setDraft(title);
    setEditing(false);
    setErr(null);
  };

  const save = () => {
    const next = draft.trim();
    if (!next) {
      setErr("Name cannot be empty.");
      return;
    }
    if (next === title) {
      setEditing(false);
      return;
    }
    setErr(null);
    startTransition(async () => {
      try {
        await updateRoomTitle(roomId, next);
        setTitle(next);
        setEditing(false);
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not update name");
      }
    });
  };

  return (
    <div className="col" style={{ gap: "0.35rem", flex: "1 1 auto", minWidth: 0 }}>
      {!editing ? (
        <div className="row" style={{ alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0 }}>{title}</h1>
          <button type="button" className="secondary" onClick={startEdit}>
            Rename room
          </button>
        </div>
      ) : (
        <div className="col" style={{ gap: "0.5rem" }}>
          <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={isPending}
              maxLength={200}
              aria-label="Room name"
              style={{ flex: "1 1 12rem", minWidth: 0 }}
            />
            <button type="button" onClick={save} disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </button>
            <button type="button" className="secondary" onClick={cancel} disabled={isPending}>
              Cancel
            </button>
          </div>
          {err ? <p style={{ color: "#f87171", margin: 0 }}>{err}</p> : null}
        </div>
      )}
    </div>
  );
}
