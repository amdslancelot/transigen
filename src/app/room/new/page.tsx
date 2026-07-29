import { redirect } from "next/navigation";
import { createRoom } from "@/app/actions";
import { requireUser } from "@/lib/auth";

export default async function NewRoomPage() {
  await requireUser();

  async function createRoomAction(formData: FormData) {
    "use server";
    const roomId = await createRoom(formData);
    redirect(`/room/${roomId}`);
  }

  return (
    <main className="container col" style={{ gap: "1rem" }}>
      <h1>Create room set</h1>
      <section className="panel col">
        <form action={createRoomAction} className="col">
          <label htmlFor="title">Set title</label>
          <input id="title" name="title" required placeholder="Friday night house set" />

          <label htmlFor="slug">URL slug</label>
          <input id="slug" name="slug" required placeholder="friday-house" />

          <label htmlFor="firstSong">First song YouTube URL/ID (Song A)</label>
          <input id="firstSong" name="firstSong" required />

          <div className="row">
            <button type="submit">Create room</button>
          </div>
        </form>
      </section>
    </main>
  );
}
