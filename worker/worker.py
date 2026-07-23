import glob
import os
import time
import subprocess
import traceback

import librosa
import numpy as np
import psycopg
from psycopg.types.json import Jsonb
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]
POLL_INTERVAL = 5  # seconds


def poll_one(conn):
    # pick oldest pending job
    with conn.cursor() as cur:
        cur.execute(
            "select id, video_id from ingest_jobs"
            " where status = 'pending' order by created_at asc limit 1"
        )
        row = cur.fetchone()
    return {"id": row[0], "video_id": row[1]} if row else None


def mark(conn, job_id, status, error_message=None):
    # updated_at is maintained by a DB trigger; the same trigger NOTIFYs the app.
    with conn.cursor() as cur:
        cur.execute(
            "update ingest_jobs set status = %s, error_message = %s where id = %s",
            (status, error_message, job_id),
        )


def download(video_id):
    # download audio to /tmp via yt-dlp
    out_path = f"/tmp/{video_id}.m4a"
    subprocess.run(
        [
            "yt-dlp",
            "-x",
            "--audio-format", "m4a",
            "-o", f"/tmp/{video_id}.%(ext)s",
            f"https://www.youtube.com/watch?v={video_id}",
        ],
        check=True,
        timeout=120,
    )
    return out_path


def analyze(audio_path: str) -> dict:
    y, sr = librosa.load(audio_path, sr=None, mono=True)
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
    beat_offset = beat_times[0] if beat_times else 0.0
    duration = float(librosa.get_duration(y=y, sr=sr))
    # librosa >= 0.10.2 returns tempo as a 1-element array instead of a scalar
    bpm = float(np.atleast_1d(tempo)[0])
    return {"bpm": bpm, "beat_offset": beat_offset, "beats": beat_times, "duration": duration}


def write_analysis(conn, video_id, result):
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into track_analysis (video_id, bpm, beat_offset, beats, duration)
            values (%s, %s, %s, %s, %s)
            on conflict (video_id) do update set
              bpm = excluded.bpm,
              beat_offset = excluded.beat_offset,
              beats = excluded.beats,
              duration = excluded.duration
            """,
            (
                video_id,
                result["bpm"],
                result["beat_offset"],
                Jsonb(result["beats"]),
                result["duration"],
            ),
        )


def process(conn, job):
    video_id = job["video_id"]
    job_id = job["id"]
    path = f"/tmp/{video_id}.m4a"
    try:
        mark(conn, job_id, "processing")
        download(video_id)
        result = analyze(path)
        write_analysis(conn, video_id, result)
        mark(conn, job_id, "done")
    except Exception as e:
        mark(conn, job_id, "failed", error_message=str(e)[:500])
        traceback.print_exc()
    finally:
        for f in glob.glob(f"/tmp/{video_id}.*"):
            os.remove(f)


def main():
    print("Worker started. Polling every", POLL_INTERVAL, "s.")
    conn = None
    while True:
        try:
            if conn is None or conn.closed:
                conn = psycopg.connect(DATABASE_URL, autocommit=True)
            job = poll_one(conn)
            if job:
                print(f"Processing job {job['id']} video_id={job['video_id']}")
                process(conn, job)
            else:
                time.sleep(POLL_INTERVAL)
        except Exception as e:
            # catch-all keeps the loop alive on DB hiccups; reconnect next round
            print("Poll error:", e)
            try:
                if conn is not None:
                    conn.close()
            except Exception:
                pass
            conn = None
            time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
