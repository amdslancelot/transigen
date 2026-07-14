import glob
import os
import time
import subprocess
import traceback

import librosa
import numpy as np
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
POLL_INTERVAL = 5  # seconds

db = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def poll_one():
    # line 18: pick oldest pending job
    row = (
        db.table("ingest_jobs")
        .select("id, video_id")
        .eq("status", "pending")
        .order("created_at", desc=False)
        .limit(1)
        .execute()
    )
    return row.data[0] if row.data else None


def mark(job_id, status, **extra):
    payload = {"status": status, "updated_at": "now()"}
    payload.update(extra)
    db.table("ingest_jobs").update(payload).eq("id", job_id).execute()


def download(video_id):
    # line 33: download audio to /tmp via yt-dlp
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


def write_analysis(video_id, result):
    # line 62: upsert track_analysis, then mark job done
    db.table("track_analysis").upsert({"video_id": video_id, **result}).execute()


def process(job):
    video_id = job["video_id"]
    job_id = job["id"]
    path = f"/tmp/{video_id}.m4a"
    try:
        mark(job_id, "processing")
        download(video_id)       # line 71: download
        result = analyze(path)   # line 72: analyze
        write_analysis(video_id, result)  # line 73: write
        mark(job_id, "done")
    except Exception as e:
        mark(job_id, "failed", error_message=str(e)[:500])
        traceback.print_exc()
    finally:
        for f in glob.glob(f"/tmp/{video_id}.*"):
            os.remove(f)


def main():
    print("Worker started. Polling every", POLL_INTERVAL, "s.")
    while True:
        try:
            job = poll_one()
            if job:
                print(f"Processing job {job['id']} video_id={job['video_id']}")
                process(job)
            else:
                time.sleep(POLL_INTERVAL)
        except Exception as e:
            # ponytail: catch-all keeps loop alive on DB hiccup; individual job errors handled in process()
            print("Poll error:", e)
            time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
