"""One-shot: delete all classes/*/crewJobs docs (clears the Job board).

Usage (from backend/, with .env / service account configured):
  python wipe_crew_jobs.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

env_path = Path(__file__).resolve().parent / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        os.environ.setdefault(key, val)

import firestore_ledger as fs_ledger


def main() -> int:
    try:
        db = fs_ledger.db()
    except Exception as exc:
        print("Firestore init failed:", exc, file=sys.stderr)
        print("config:", fs_ledger.config_error(), file=sys.stderr)
        return 1

    classes = list(db.collection("classes").stream())
    deleted = 0

    for class_doc in classes:
        class_id = class_doc.id
        jobs = list(class_doc.reference.collection("crewJobs").stream())
        for job in jobs:
            job.reference.delete()
            deleted += 1
        print(f"  {class_id}: deleted {len(jobs)} crew job(s)")

    print(f"Done. Deleted {deleted} crewJobs across {len(classes)} class(es).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
