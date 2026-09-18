"""One-shot: delete all classes/*/h2hMatches docs and clear class headToHead.

Usage (from repo root, with backend/.env loaded):
  cd backend && python wipe_h2h_matches.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Load backend/.env without printing values.
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
    match_deleted = 0
    classes_cleared = 0

    for class_doc in classes:
        class_id = class_doc.id
        matches = list(class_doc.reference.collection("h2hMatches").stream())
        for m in matches:
            m.reference.delete()
            match_deleted += 1
        data = class_doc.to_dict() or {}
        if data.get("headToHead") is not None:
            class_doc.reference.update({"headToHead": None})
            classes_cleared += 1
        print(f"  {class_id}: deleted {len(matches)} match(es)")

    print(
        f"Done. Deleted {match_deleted} h2hMatches across {len(classes)} class(es); "
        f"cleared headToHead on {classes_cleared}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
