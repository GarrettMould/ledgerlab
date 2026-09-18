"""Privileged AI closet creator: Claude/OpenAI parts recipe → blocky GLB (Meshy optional)."""

from __future__ import annotations

import base64
import json
import os
import re
import time
import uuid
from typing import Any

import requests

import firestore_ledger as fs_ledger
from closet_glb import build_billboard_glb
from closet_blocky import build_blocky_glb, fallback_parts, normalize_parts, parts_look_weak

MESHY_BASE = "https://api.meshy.ai/openapi/v2"

CLOSET_CREATOR_EMAIL = "test@gmail.com"
# Legacy name kept for responses; payroll replaces the flat fee on approve.
CREATOR_PUBLISH_FEE = 2000

# Hire classmates instead of a flat fee.
# 1 = partnership (profit share, small max price)
# 3 = small wage crew (bigger max price)
# 5 = large crew / "3+" (biggest max price)
CREW_TIERS = {
    1: {
        "slots": 1,
        "wageEach": 0,
        "maxSellPrice": 1500,
        "label": "Partnership (1)",
        "payMode": "profit_share",
        "profitSharePct": 50,
        "blurb": "One partner — you split profits 50/50. Smallest sell-price cap.",
    },
    3: {
        "slots": 3,
        "wageEach": 700,
        "maxSellPrice": 4500,
        "label": "Team of 3",
        "payMode": "wages",
        "profitSharePct": 0,
        "blurb": "Three employees paid wages when approved. Bigger sell-price cap.",
    },
    5: {
        "slots": 5,
        "wageEach": 900,
        "maxSellPrice": 12000,
        "label": "Crew of 3+",
        "payMode": "wages",
        "profitSharePct": 0,
        "blurb": "Five employees (3+ scale). Highest wages and biggest sell-price cap.",
    },
}
MAX_PUBLISHES_PER_DAY = 8


def _openai_api_key() -> str:
    return (os.environ.get("OPENAI_API_KEY") or "").strip()


def _openai_model() -> str:
    return (os.environ.get("OPENAI_MODEL") or "gpt-4o-mini").strip()


def _openai_image_model() -> str:
    return (os.environ.get("OPENAI_IMAGE_MODEL") or "gpt-image-1").strip()


def _openai_image_model_candidates() -> list[str]:
    primary = _openai_image_model()
    # Prefer modern GPT Image models; many new keys no longer include dall-e-3.
    fallbacks = ["gpt-image-1", "gpt-image-1-mini", "dall-e-2", "dall-e-3"]
    out: list[str] = []
    for name in [primary, *fallbacks]:
        if name and name not in out:
            out.append(name)
    return out


def _anthropic_api_key() -> str:
    return (os.environ.get("ANTHROPIC_API_KEY") or "").strip()


def _anthropic_model() -> str:
    # Fast + strong enough for structured parts JSON.
    return (os.environ.get("ANTHROPIC_MODEL") or "claude-sonnet-4-5").strip()


def _meshy_api_key() -> str:
    return (os.environ.get("MESHY_API_KEY") or "").strip()


def _generation_engine() -> str:
    """Prefer Meshy when keyed; else Claude blocky; else OpenAI blocky."""
    if _meshy_api_key():
        return "meshy"
    if _anthropic_api_key():
        return "claude_blocky"
    if _openai_api_key():
        return "openai_blocky"
    raise RuntimeError(
        "AI closet needs ANTHROPIC_API_KEY (preferred) or OPENAI_API_KEY in backend/.env "
        "for blocky 3D, or MESHY_API_KEY for organic text-to-3D."
    )
ACCESSORY_KINDS = ("hat", "glasses", "neck", "jersey", "backpack", "bag", "prop")
KIND_TO_CATEGORY = {
    "hat": "accessories",
    "glasses": "accessories",
    "jersey": "accessories",
    "backpack": "accessories",
    "neck": "accessories",
    "bag": "accessories",
    "prop": "accessories",
}
KIND_DEFAULTS = {
    "hat": {"attach": "headTop", "scale": 0.38, "color": "#888888"},
    "glasses": {"attach": "eyes", "scale": 0.9, "color": "#222222"},
    "neck": {"attach": "neck", "scale": 0.85, "color": "#d4ad35"},
    "jersey": {"attach": "torso", "scale": 1.0, "color": "#3f8f68"},
    "backpack": {"attach": "torsoBack", "scale": 0.85, "color": "#245933"},
    "bag": {"attach": "shoulderL", "scale": 0.75, "color": "#9e6b3d"},
    "prop": {"attach": "handR", "scale": 0.55, "color": "#b88547"},
}

_VALID_ATTACH = {
    "headTop",
    "eyes",
    "neck",
    "torso",
    "torsoBack",
    "shoulderL",
    "handR",
}


def normalize_email(email: str | None) -> str:
    return (email or "").strip().lower()


def is_closet_creator_email(email: str | None) -> bool:
    return normalize_email(email) == CLOSET_CREATOR_EMAIL


def require_creator(class_id: str, student_id: str) -> tuple[dict | None, str | None]:
    if not class_id or not student_id:
        return None, "classId and studentId are required"
    student = fs_ledger.get_student(class_id, student_id)
    if not student:
        return None, "Student not found"
    if not is_closet_creator_email(student.get("email")):
        return None, "This account cannot create closet items"
    return student, None


def _jobs_col(class_id: str):
    return fs_ledger.db().collection("classes").document(class_id).collection("closetJobs")


def _job_ref(class_id: str, job_id: str):
    return _jobs_col(class_id).document(job_id)


def _crew_jobs_col(class_id: str):
    return fs_ledger.db().collection("classes").document(class_id).collection("crewJobs")


def _crew_job_ref(class_id: str, crew_job_id: str):
    return _crew_jobs_col(class_id).document(crew_job_id)


def crew_tier(slots) -> dict:
    try:
        n = int(slots)
    except (TypeError, ValueError):
        n = 1
    if n not in CREW_TIERS:
        # Map legacy / out-of-range values onto nearest supported tier.
        if n <= 1:
            n = 1
        elif n <= 3:
            n = 3
        else:
            n = 5
    base = CREW_TIERS[n]
    wage = int(base["wageEach"])
    slots_n = int(base["slots"])
    pay_mode = str(base.get("payMode") or "wages")
    payroll = 0 if pay_mode == "profit_share" else wage * slots_n
    return {
        "slots": slots_n,
        "wageEach": wage,
        "maxSellPrice": int(base["maxSellPrice"]),
        "label": base["label"],
        "payroll": payroll,
        "payMode": pay_mode,
        "profitSharePct": int(base.get("profitSharePct") or 0),
        "blurb": base.get("blurb") or "",
    }


def list_crew_tiers() -> dict:
    return {"tiers": [crew_tier(n) for n in (1, 3, 5)]}


def job_title_from_product(label: str = "", prompt: str = "") -> str:
    """Short Job-board title tied to the product the student described."""
    name = str(label or "").strip()
    if not name:
        words = str(prompt or "").strip().split()
        name = " ".join(words[:5]).strip()
    name = name[:42] or "Class creation"
    # Soft title-case without wrecking acronyms the model already set.
    if name == name.lower() or name == name.upper():
        name = name.title()
    return name


def _today_key() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


def _publishes_today(class_id: str, student_id: str) -> int:
    snap = (
        fs_ledger.class_ref(class_id)
        .collection("closetPublishLog")
        .document(f"{student_id}_{_today_key()}")
        .get()
    )
    if not snap.exists:
        return 0
    return int((snap.to_dict() or {}).get("count") or 0)


def _bump_publish_log(class_id: str, student_id: str) -> None:
    from firebase_admin import firestore as fs

    ref = (
        fs_ledger.class_ref(class_id)
        .collection("closetPublishLog")
        .document(f"{student_id}_{_today_key()}")
    )
    ref.set(
        {
            "studentId": student_id,
            "day": _today_key(),
            "count": fs.Increment(1),
            "updatedAt": fs.SERVER_TIMESTAMP,
        },
        merge=True,
    )


def _parts_system_prompt() -> str:
    return (
        "You design Roblox-style BLOCKY avatar accessories for a classroom game. "
        "Reply with JSON only. School-safe (no weapons, hate, NSFW).\n"
        "kind: hat|glasses|neck|jersey|backpack|bag|prop. "
        "attach: headTop|eyes|neck|torso|torsoBack|shoulderL|handR. "
        "price: integer 500-8000.\n"
        "CRITICAL — parts rules (this is how built-in items like TopHat / BaseballBat are made):\n"
        "- Prefer BOXES. Animals and characters must be almost all boxes.\n"
        "- Cylinders only for hats, handles, speakers, wheels.\n"
        "- Spheres sparingly (eyeballs only). NEVER build a whole animal from spheres.\n"
        "- NEVER put a forward cone/cylinder on a round head (that looks like a beak).\n"
        "- Cats/dogs: box body + box head + two triangle-ish BOX ears + box eyes + tiny box nose + box tail.\n"
        "- 5–10 parts. Origin at attach point. Y-up. pos/rot in degrees. Keep within ~2 units.\n"
        "- Each part: shape, color (#rrggbb), pos[x,y,z], rot[rx,ry,rz], "
        "plus size[sx,sy,sz] for box, radius+height for cylinder, radius for sphere.\n"
        "Example cat (handheld prop):\n"
        '{"shape":"box","size":[0.7,0.55,0.55],"pos":[0,0.28,0.05],"rot":[0,0,0],"color":"#d4a574"},'
        '{"shape":"box","size":[0.48,0.42,0.45],"pos":[0,0.72,0.12],"rot":[0,0,0],"color":"#d4a574"},'
        '{"shape":"box","size":[0.16,0.22,0.1],"pos":[-0.16,0.98,0.05],"rot":[0,0,-18],"color":"#d4a574"},'
        '{"shape":"box","size":[0.16,0.22,0.1],"pos":[0.16,0.98,0.05],"rot":[0,0,18],"color":"#d4a574"},'
        '{"shape":"box","size":[0.1,0.1,0.06],"pos":[-0.12,0.74,0.34],"rot":[0,0,0],"color":"#1a1a1a"},'
        '{"shape":"box","size":[0.1,0.1,0.06],"pos":[0.12,0.74,0.34],"rot":[0,0,0],"color":"#1a1a1a"},'
        '{"shape":"box","size":[0.1,0.08,0.08],"pos":[0,0.64,0.36],"rot":[0,0,0],"color":"#ff8fab"},'
        '{"shape":"box","size":[0.18,0.14,0.55],"pos":[0.28,0.22,-0.35],"rot":[0,25,0],"color":"#d4a574"}\n'
        "meshyPrompt: backup text-to-3D string with the same blocky look."
    )


def _parse_llm_json(raw: str) -> dict:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


def _claude_parts_json(system: str, user: str) -> dict | None:
    key = _anthropic_api_key()
    if not key:
        return None
    try:
        res = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": _anthropic_model(),
                "max_tokens": 2500,
                "temperature": 0.2,
                "system": system,
                "messages": [{"role": "user", "content": user}],
            },
            timeout=60,
        )
        res.raise_for_status()
        blocks = res.json().get("content") or []
        raw = ""
        for block in blocks:
            if isinstance(block, dict) and block.get("type") == "text":
                raw += str(block.get("text") or "")
        return _parse_llm_json(raw)
    except Exception:
        return None


def _openai_parts_json(system: str, user: str) -> dict | None:
    if not _openai_api_key():
        return None
    try:
        res = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {_openai_api_key()}",
                "Content-Type": "application/json",
            },
            json={
                "model": _openai_model(),
                "temperature": 0.2,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            },
            timeout=45,
        )
        res.raise_for_status()
        raw = res.json()["choices"][0]["message"]["content"]
        return _parse_llm_json(raw)
    except Exception:
        return None


def _llm_metadata(user_prompt: str) -> dict:
    """Ask Claude (preferred) or OpenAI for catalog fields + blocky parts recipe."""
    defaults = KIND_DEFAULTS["prop"]
    prompt_text = user_prompt.strip()[:400]
    fallback = {
        "label": (prompt_text[:32] or "Class item").title(),
        "kind": "prop",
        "attach": defaults["attach"],
        "price": 2000,
        "color": defaults["color"],
        "meshyPrompt": (
            f"Roblox-style blocky low-poly game accessory: {prompt_text}. "
            "Only cubes, cylinders, and spheres. Flat colors, chunky proportions, "
            "single centered object, no character body, no floor, no pedestal."
        ),
        "parts": fallback_parts(prompt_text[:32] or "Item", "prop", defaults["color"]),
        "chatReply": f"I'll build “{prompt_text}” as a blocky 3D prop for the class closet.",
        "llm": None,
    }
    if not _anthropic_api_key() and not _openai_api_key():
        return fallback

    system = _parts_system_prompt()
    user = (
        f'Student request: "{prompt_text}"\n'
        "Return JSON keys: label, kind, attach, price, color, parts, meshyPrompt, chatReply. "
        "Make parts clearly recognizable as the requested object."
    )

    data = None
    llm = None
    # Prefer Claude for closet recipes when configured.
    if _anthropic_api_key():
        data = _claude_parts_json(system, user)
        if data is not None:
            llm = "claude"
    if data is None and _openai_api_key():
        data = _openai_parts_json(system, user)
        if data is not None:
            llm = "openai"
    if data is None:
        return fallback

    kind = str(data.get("kind") or "prop").strip().lower()
    if kind not in ACCESSORY_KINDS:
        kind = "prop"
    defaults = KIND_DEFAULTS[kind]
    attach = str(data.get("attach") or defaults["attach"]).strip()
    if attach not in _VALID_ATTACH:
        attach = defaults["attach"]
    try:
        price = int(data.get("price") or 2000)
    except (TypeError, ValueError):
        price = 2000
    price = max(500, min(8000, price))
    label = str(data.get("label") or fallback["label"]).strip()[:40] or fallback["label"]
    color = str(data.get("color") or defaults["color"]).strip()
    if not re.fullmatch(r"#?[0-9a-fA-F]{6}", color):
        color = defaults["color"]
    if not color.startswith("#"):
        color = f"#{color}"
    meshy = str(data.get("meshyPrompt") or fallback["meshyPrompt"]).strip()[:800]
    chat = str(data.get("chatReply") or fallback["chatReply"]).strip()[:280]
    parts = normalize_parts(data.get("parts"), fallback_color=color)
    if parts_look_weak(parts, label, prompt_text):
        parts = fallback_parts(f"{label} {prompt_text}", kind, color)
    return {
        "label": label,
        "kind": kind,
        "attach": attach,
        "price": price,
        "color": color,
        "meshyPrompt": meshy,
        "parts": parts,
        "chatReply": chat,
        "llm": llm,
    }


# Back-compat alias used by older call sites / notebooks.
def _openai_metadata(user_prompt: str) -> dict:
    return _llm_metadata(user_prompt)


def _meshy_headers() -> dict:
    return {
        "Authorization": f"Bearer {_meshy_api_key()}",
        "Content-Type": "application/json",
    }


def _meshy_create_preview(prompt: str) -> str:
    res = requests.post(
        f"{MESHY_BASE}/text-to-3d",
        headers=_meshy_headers(),
        json={
            "mode": "preview",
            "prompt": prompt[:800],
            "art_style": "lowpoly",
            "should_remesh": True,
            "target_polycount": 6000,
            "target_formats": ["glb"],
        },
        timeout=60,
    )
    if res.status_code >= 400:
        raise RuntimeError(f"Meshy preview failed: {res.text[:300]}")
    data = res.json()
    task_id = data.get("result") or data.get("id")
    if not task_id:
        raise RuntimeError("Meshy preview did not return a task id")
    return str(task_id)


def _meshy_create_refine(preview_task_id: str) -> str:
    res = requests.post(
        f"{MESHY_BASE}/text-to-3d",
        headers=_meshy_headers(),
        json={
            "mode": "refine",
            "preview_task_id": preview_task_id,
            "target_formats": ["glb"],
            "enable_pbr": True,
        },
        timeout=60,
    )
    if res.status_code >= 400:
        raise RuntimeError(f"Meshy refine failed: {res.text[:300]}")
    data = res.json()
    task_id = data.get("result") or data.get("id")
    if not task_id:
        raise RuntimeError("Meshy refine did not return a task id")
    return str(task_id)


def _meshy_get_task(task_id: str) -> dict:
    res = requests.get(
        f"{MESHY_BASE}/text-to-3d/{task_id}",
        headers=_meshy_headers(),
        timeout=45,
    )
    if res.status_code >= 400:
        raise RuntimeError(f"Meshy status failed: {res.text[:300]}")
    return res.json()


def _task_status(task: dict) -> str:
    return str(task.get("status") or "").upper()


def _glb_url_from_task(task: dict) -> str | None:
    urls = task.get("model_urls") or {}
    glb = urls.get("glb")
    if glb:
        return str(glb)
    single = task.get("model_url")
    return str(single) if single else None


def _openai_image_png(prompt: str) -> bytes:
    """Generate a PNG for the accessory via OpenAI Images API."""
    key = _openai_api_key()
    if not key:
        raise RuntimeError("OPENAI_API_KEY is not configured in backend/.env")
    art_prompt = (
        "Stylized classroom game accessory icon of: "
        f"{prompt.strip()[:350]}. "
        "Single centered object, bold simple shapes, clean edges, "
        "plain light background, no text, no watermark, no full character body."
    )
    last_err = "OpenAI image failed"
    for image_model in _openai_image_model_candidates():
        body: dict[str, Any] = {
            "model": image_model,
            "prompt": art_prompt,
            "n": 1,
            "size": "1024x1024",
        }
        res = requests.post(
            "https://api.openai.com/v1/images/generations",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json=body,
            timeout=120,
        )
        if res.status_code >= 400:
            last_err = f"OpenAI image failed ({image_model}): {res.text[:220]}"
            # Try next candidate on unknown/invalid model.
            low = (res.text or "").lower()
            if "does not exist" in low or "invalid_value" in low or "model" in low:
                continue
            raise RuntimeError(last_err)

        data = res.json()
        rows = data.get("data") or []
        if not rows:
            last_err = f"OpenAI image returned no data ({image_model})"
            continue
        row = rows[0]
        if row.get("b64_json"):
            return base64.b64decode(row["b64_json"])
        url = row.get("url")
        if not url:
            last_err = f"OpenAI image missing url/b64 ({image_model})"
            continue
        img = requests.get(url, timeout=60)
        if img.status_code >= 400 or not img.content:
            last_err = f"Could not download generated image ({image_model})"
            continue
        return img.content

    raise RuntimeError(
        last_err
        + " — set OPENAI_IMAGE_MODEL=gpt-image-1 in backend/.env "
        "(and verify the org for GPT Image access if prompted)."
    )


def _upload_bytes_to_storage(class_id: str, path_suffix: str, data: bytes, content_type: str) -> str:
    from firebase_admin import storage

    # Ensure Admin SDK is initialized before storage.bucket()
    if not fs_ledger.is_configured():
        raise RuntimeError(fs_ledger.config_error() or "Firestore/Storage not configured")
    name = fs_ledger.storage_bucket_name()
    if not name:
        raise RuntimeError(
            "FIREBASE_STORAGE_BUCKET is not set. "
            "Add it to backend/.env (e.g. yourproject-closet)."
        )
    try:
        bucket = storage.bucket(name)
    except Exception as exc:
        raise RuntimeError(f"Could not open Storage bucket {name}: {exc}") from exc
    path = f"classes/{class_id}/closet/{path_suffix}"
    blob = bucket.blob(path)
    try:
        blob.upload_from_string(data, content_type=content_type)
    except Exception as exc:
        msg = str(exc)
        if "404" in msg or "does not exist" in msg.lower():
            raise RuntimeError(
                f"Storage bucket “{name}” does not exist. "
                "In Firebase Console → Build → Storage → Get started "
                "(Blaze plan may be required), then set FIREBASE_STORAGE_BUCKET "
                "in backend/.env to the bucket name shown there."
            ) from exc
        raise
    try:
        blob.make_public()
        return blob.public_url
    except Exception:
        from datetime import timedelta

        try:
            return blob.generate_signed_url(expiration=timedelta(days=3650), method="GET")
        except Exception as exc:
            raise RuntimeError(
                "Uploaded closet file but could not make it public. "
                "Deploy storage.rules allowing read on classes/*/closet/**."
            ) from exc


def start_draft(class_id: str, student_id: str, prompt: str) -> dict:
    student, err = require_creator(class_id, student_id)
    if err:
        raise PermissionError(err)
    text = (prompt or "").strip()
    if len(text) < 2:
        raise ValueError("Describe what to make (at least a couple of words).")
    if len(text) > 400:
        raise ValueError("Keep your idea under 400 characters.")
    engine = _generation_engine()
    if _publishes_today(class_id, student_id) >= MAX_PUBLISHES_PER_DAY:
        raise RuntimeError(
            f"Daily create limit reached ({MAX_PUBLISHES_PER_DAY}). Try again tomorrow."
        )

    meta = _llm_metadata(text)
    job_id = f"job_{uuid.uuid4().hex[:16]}"
    from firebase_admin import firestore as fs

    payload = {
        "id": job_id,
        "engine": engine,
        "llm": meta.get("llm"),
        "status": "queued",
        "phase": "queued",
        "sourcePrompt": text,
        "createdBy": student_id,
        "creatorName": student.get("name") or "Student",
        "label": meta["label"],
        "kind": meta["kind"],
        "attach": meta["attach"],
        "price": meta["price"],
        "color": meta["color"],
        "meshyPrompt": meta["meshyPrompt"],
        "parts": meta.get("parts") or [],
        "chatReply": meta["chatReply"],
        "previewTaskId": None,
        "refineTaskId": None,
        "glbUrl": None,
        "thumbnailUrl": None,
        "error": None,
        "createdAt": fs.SERVER_TIMESTAMP,
        "updatedAt": fs.SERVER_TIMESTAMP,
    }

    if engine == "meshy":
        preview_id = _meshy_create_preview(meta["meshyPrompt"])
        payload.update(
            {
                "status": "previewing",
                "phase": "preview",
                "previewTaskId": preview_id,
            }
        )
    else:
        # Claude/OpenAI blocky 3D — mesh build happens on first poll.
        payload.update(
            {
                "status": "generating",
                "phase": "blocky",
                "progress": 5,
                "chatReply": meta["chatReply"]
                or f"I'll build “{meta['label']}” as a blocky 3D closet prop.",
            }
        )

    _job_ref(class_id, job_id).set(payload)
    return serialize_job(payload, job_id)


def _advance_blocky(class_id: str, job: dict, ref) -> dict:
    """Build a real blocky GLB from the AI parts recipe (same style as catalog accessories)."""
    from firebase_admin import firestore as fs

    job_id = job.get("id")
    ref.update(
        {
            "status": "generating",
            "phase": "blocky",
            "progress": 40,
            "updatedAt": fs.SERVER_TIMESTAMP,
        }
    )
    parts = normalize_parts(
        job.get("parts"),
        fallback_color=str(job.get("color") or "#888888"),
    )
    label = str(job.get("label") or "Item")
    prompt = str(job.get("sourcePrompt") or label)
    if parts_look_weak(parts, label, prompt):
        parts = fallback_parts(f"{label} {prompt}", str(job.get("kind") or "prop"), str(job.get("color") or "#888888"))
    glb = build_blocky_glb(parts)
    draft_id = f"draft-{job_id}"
    glb_url = _upload_bytes_to_storage(
        class_id, f"{draft_id}.glb", glb, "model/gltf-binary"
    )
    ref.update(
        {
            "status": "ready",
            "phase": "ready",
            "progress": 100,
            "glbUrl": glb_url,
            "parts": parts,
            "aiSprite": False,
            "updatedAt": fs.SERVER_TIMESTAMP,
        }
    )
    job.update(
        {
            "status": "ready",
            "phase": "ready",
            "progress": 100,
            "glbUrl": glb_url,
            "parts": parts,
            "aiSprite": False,
        }
    )
    return job


def _advance_openai_sprite(class_id: str, job: dict, ref) -> dict:
    """Legacy flat-image path (kept for in-flight jobs only)."""
    from firebase_admin import firestore as fs

    job_id = job.get("id")
    prompt = job.get("meshyPrompt") or job.get("sourcePrompt") or job.get("label") or "toy"
    ref.update(
        {
            "status": "generating",
            "phase": "openai_sprite",
            "progress": 35,
            "updatedAt": fs.SERVER_TIMESTAMP,
        }
    )
    png = _openai_image_png(str(prompt))
    ref.update({"progress": 70, "updatedAt": fs.SERVER_TIMESTAMP})
    glb = build_billboard_glb(png, size=1.0)
    draft_id = f"draft-{job_id}"
    glb_url = _upload_bytes_to_storage(
        class_id, f"{draft_id}.glb", glb, "model/gltf-binary"
    )
    try:
        thumb_url = _upload_bytes_to_storage(
            class_id, f"{draft_id}.png", png, "image/png"
        )
    except Exception:
        thumb_url = None
    ref.update(
        {
            "status": "ready",
            "phase": "ready",
            "progress": 100,
            "glbUrl": glb_url,
            "thumbnailUrl": thumb_url,
            "aiSprite": True,
            "updatedAt": fs.SERVER_TIMESTAMP,
        }
    )
    job.update(
        {
            "status": "ready",
            "phase": "ready",
            "progress": 100,
            "glbUrl": glb_url,
            "thumbnailUrl": thumb_url,
            "aiSprite": True,
        }
    )
    return job


def advance_job(class_id: str, student_id: str, job_id: str) -> dict:
    student, err = require_creator(class_id, student_id)
    if err:
        raise PermissionError(err)
    ref = _job_ref(class_id, job_id)
    snap = ref.get()
    if not snap.exists:
        raise ValueError("Job not found")
    job = snap.to_dict() or {}
    job["id"] = job_id
    if job.get("createdBy") != student_id:
        raise PermissionError("Not your create job")

    status = str(job.get("status") or "")
    if status in ("ready", "published", "failed", "pending_quiz", "awaiting_crew", "pending_review", "rejected"):
        return serialize_job(job, job_id)

    from firebase_admin import firestore as fs

    engine = str(job.get("engine") or _generation_engine())
    phase = str(job.get("phase") or "queued")

    try:
        if (
            engine in ("claude_blocky", "openai_blocky", "blocky")
            or phase in ("blocky", "openai_blocky", "claude_blocky")
        ):
            job = _advance_blocky(class_id, job, ref)
            return serialize_job(job, job_id)

        if engine == "openai_sprite" or phase == "openai_sprite":
            job = _advance_openai_sprite(class_id, job, ref)
            return serialize_job(job, job_id)

        if phase == "preview":
            task = _meshy_get_task(job["previewTaskId"])
            st = _task_status(task)
            if st in ("PENDING", "IN_PROGRESS"):
                progress = task.get("progress")
                ref.update(
                    {
                        "status": "previewing",
                        "progress": progress,
                        "updatedAt": fs.SERVER_TIMESTAMP,
                    }
                )
                job.update({"status": "previewing", "progress": progress})
                return serialize_job(job, job_id)
            if st == "FAILED":
                msg = task.get("task_error", {}).get("message") or "Meshy preview failed"
                ref.update(
                    {
                        "status": "failed",
                        "error": msg,
                        "updatedAt": fs.SERVER_TIMESTAMP,
                    }
                )
                job.update({"status": "failed", "error": msg})
                return serialize_job(job, job_id)
            if st != "SUCCEEDED":
                return serialize_job(job, job_id)
            refine_id = _meshy_create_refine(job["previewTaskId"])
            ref.update(
                {
                    "phase": "refine",
                    "status": "refining",
                    "refineTaskId": refine_id,
                    "updatedAt": fs.SERVER_TIMESTAMP,
                }
            )
            job.update(
                {
                    "phase": "refine",
                    "status": "refining",
                    "refineTaskId": refine_id,
                }
            )
            return serialize_job(job, job_id)

        if phase == "refine":
            refine_id = job.get("refineTaskId")
            if not refine_id:
                raise RuntimeError("Missing refine task")
            task = _meshy_get_task(refine_id)
            st = _task_status(task)
            if st in ("PENDING", "IN_PROGRESS"):
                progress = task.get("progress")
                ref.update(
                    {
                        "status": "refining",
                        "progress": progress,
                        "updatedAt": fs.SERVER_TIMESTAMP,
                    }
                )
                job.update({"status": "refining", "progress": progress})
                return serialize_job(job, job_id)
            if st == "FAILED":
                msg = task.get("task_error", {}).get("message") or "Meshy refine failed"
                ref.update(
                    {
                        "status": "failed",
                        "error": msg,
                        "updatedAt": fs.SERVER_TIMESTAMP,
                    }
                )
                job.update({"status": "failed", "error": msg})
                return serialize_job(job, job_id)
            if st != "SUCCEEDED":
                return serialize_job(job, job_id)
            glb_url = _glb_url_from_task(task)
            if not glb_url:
                raise RuntimeError("Meshy finished but no GLB URL was returned")
            thumb = task.get("thumbnail_url")
            ref.update(
                {
                    "status": "ready",
                    "phase": "ready",
                    "glbUrl": glb_url,
                    "thumbnailUrl": thumb,
                    "progress": 100,
                    "updatedAt": fs.SERVER_TIMESTAMP,
                }
            )
            job.update(
                {
                    "status": "ready",
                    "phase": "ready",
                    "glbUrl": glb_url,
                    "thumbnailUrl": thumb,
                    "progress": 100,
                }
            )
            return serialize_job(job, job_id)
    except Exception as exc:
        msg = str(exc)[:300]
        ref.update(
            {"status": "failed", "error": msg, "updatedAt": fs.SERVER_TIMESTAMP}
        )
        job.update({"status": "failed", "error": msg})
        return serialize_job(job, job_id)

    return serialize_job(job, job_id)


def serialize_job(job: dict, job_id: str | None = None) -> dict:
    return {
        "id": job_id or job.get("id"),
        "engine": job.get("engine"),
        "status": job.get("status"),
        "phase": job.get("phase"),
        "progress": job.get("progress"),
        "sourcePrompt": job.get("sourcePrompt"),
        "label": job.get("label"),
        "kind": job.get("kind"),
        "attach": job.get("attach"),
        "price": job.get("price"),
        "color": job.get("color"),
        "chatReply": job.get("chatReply"),
        "glbUrl": job.get("glbUrl"),
        "thumbnailUrl": job.get("thumbnailUrl"),
        "aiSprite": bool(job.get("aiSprite")),
        "parts": job.get("parts") or [],
        "error": job.get("error"),
        "category": KIND_TO_CATEGORY.get(job.get("kind") or "prop", "accessories"),
    }


def _upload_glb_to_storage(class_id: str, item_id: str, glb_bytes: bytes) -> str:
    return _upload_bytes_to_storage(
        class_id, f"{item_id}.glb", glb_bytes, "model/gltf-binary"
    )


def publish_job(class_id: str, student_id: str, job_id: str, price=None, crew_slots=0) -> dict:
    student, err = require_creator(class_id, student_id)
    if err:
        raise PermissionError(err)
    if _publishes_today(class_id, student_id) >= MAX_PUBLISHES_PER_DAY:
        raise RuntimeError(
            f"Daily create limit reached ({MAX_PUBLISHES_PER_DAY}). Try again tomorrow."
        )

    ref = _job_ref(class_id, job_id)
    snap = ref.get()
    if not snap.exists:
        raise ValueError("Job not found")
    job = snap.to_dict() or {}
    if job.get("createdBy") != student_id:
        raise PermissionError("Not your create job")
    if job.get("status") == "published" and job.get("itemId"):
        return {"item": _item_from_job(job), "alreadyPublished": True}
    if job.get("status") in ("pending_quiz", "pending_review", "awaiting_crew") and job.get("itemId"):
        tier = crew_tier(job.get("crewSlots") or 0)
        return {
            "item": _item_from_job(job),
            "pendingQuiz": job.get("status") == "pending_quiz",
            "pendingReview": job.get("status") == "pending_review",
            "awaitingCrew": job.get("status") == "awaiting_crew",
            "publishFee": tier["payroll"],
            "crew": _crew_public(job),
        }
    if job.get("status") != "ready" or not job.get("glbUrl"):
        raise RuntimeError("Model is not ready to publish yet")

    tier = crew_tier(crew_slots)
    cash = float(student.get("cash") or 0)
    if cash < tier["payroll"]:
        raise RuntimeError(
            f"You need at least {tier['payroll']:,.0f} cash for crew payroll "
            f"(paid only if your teacher approves). You have {cash:,.0f}."
        )

    # Creator-set classroom price (optional); fall back to AI suggestion.
    try:
        if price is None or price == "":
            raise TypeError("use job default")
        sell_price = int(round(float(price)))
    except (TypeError, ValueError):
        try:
            sell_price = int(job.get("price") or 2000)
        except (TypeError, ValueError):
            sell_price = 2000
    sell_price = max(100, min(tier["maxSellPrice"], sell_price))

    glb_res = requests.get(job["glbUrl"], timeout=120)
    if glb_res.status_code >= 400 or not glb_res.content:
        raise RuntimeError("Could not download the generated GLB")

    item_id = f"acc-ai-{uuid.uuid4().hex[:12]}"
    try:
        public_url = _upload_glb_to_storage(class_id, item_id, glb_res.content)
    except Exception as exc:
        # Fallback: keep draft CDN URL if Storage isn't configured yet.
        public_url = job["glbUrl"]
        storage_error = str(exc)[:200]
    else:
        storage_error = None

    thumb_url = job.get("thumbnailUrl") or None
    if thumb_url:
        try:
            thumb_res = requests.get(str(thumb_url), timeout=60)
            if thumb_res.status_code < 400 and thumb_res.content:
                thumb_url = _upload_bytes_to_storage(
                    class_id, f"{item_id}.png", thumb_res.content, "image/png"
                )
        except Exception:
            # Keep draft thumbnail URL if re-upload fails.
            pass

    kind = job.get("kind") if job.get("kind") in ACCESSORY_KINDS else "prop"
    defaults = KIND_DEFAULTS[kind]
    is_sprite = bool(job.get("aiSprite"))
    scale = float(defaults["scale"])
    if is_sprite:
        scale = max(scale, 1.15)
    elif str(job.get("engine") or "") in (
        "claude_blocky",
        "openai_blocky",
        "blocky",
        "",
    ) or job.get("parts"):
        # Blocky recipes are ~character-local units already.
        scale = max(scale, 1.0)
    item = {
        "id": item_id,
        "kind": kind,
        "label": str(job.get("label") or "Class item")[:40],
        "url": public_url,
        "thumbnailUrl": thumb_url,
        "attach": job.get("attach")
        if job.get("attach") in _VALID_ATTACH
        else defaults["attach"],
        "scale": scale,
        "color": job.get("color") or defaults["color"],
        "price": sell_price,
        "category": KIND_TO_CATEGORY.get(kind, "accessories"),
        "createdBy": student_id,
        "createdByName": student.get("name") or "Student",
        "sourcePrompt": job.get("sourcePrompt") or "",
        "createdAtMs": int(time.time() * 1000),
        "aiSprite": is_sprite,
        "parts": job.get("parts") or [],
        # Hidden until teacher approves after quiz.
        "live": False,
        "quizPending": True,
        "reviewPending": False,
        "jobId": job_id,
        "crewSlots": tier["slots"],
        "crewPayroll": tier["payroll"],
        "crewPayMode": tier["payMode"],
        "crewProfitSharePct": tier["profitSharePct"],
    }

    from firebase_admin import firestore as fs

    class_ref = fs_ledger.class_ref(class_id)
    class_ref.set(
        {
            "closetItems": fs.ArrayUnion([item]),
            "updatedAt": fs.SERVER_TIMESTAMP,
        },
        merge=True,
    )

    product_label = str(item.get("label") or job.get("label") or "Class item")[:40]
    job_title = job_title_from_product(
        product_label, job.get("sourcePrompt") or ""
    )

    # Partnership: reuse the invite created when they picked a classmate.
    # Teams: always create a fresh open Job board posting.
    existing_partnership = None
    if tier["payMode"] == "profit_share":
        existing_partnership = _find_active_partnership(class_id, student_id)
        if not existing_partnership:
            raise ValueError(
                "Invite a partner before publishing. Go back and send a partnership request."
            )
        has_invitee = bool(existing_partnership.get("invitedStudentId"))
        has_member = bool(list(existing_partnership.get("members") or []))
        if not has_invitee and not has_member:
            raise ValueError(
                "Invite a partner before publishing. Go back and send a partnership request."
            )

    members = []
    if existing_partnership:
        crew_ref = _crew_job_ref(class_id, existing_partnership["id"])
        members = list(existing_partnership.get("members") or [])
        invite_status = str(existing_partnership.get("status") or "pending_invite")
        board_status = (
            "filled"
            if members and len(members) >= tier["slots"]
            else invite_status
            if invite_status in ("pending_invite", "filled")
            else "pending_invite"
        )
        crew_ref.update(
            {
                "closetJobId": job_id,
                "itemId": item_id,
                "itemLabel": product_label,
                "jobTitle": job_title,
                "kind": kind,
                "sellPrice": sell_price,
                "wageEach": tier["wageEach"],
                "payroll": tier["payroll"],
                "maxSellPrice": tier["maxSellPrice"],
                "payMode": tier["payMode"],
                "profitSharePct": tier["profitSharePct"],
                "slots": tier["slots"],
                "thumbnailUrl": thumb_url or "",
                "parts": job.get("parts") or [],
                "sourcePrompt": str(job.get("sourcePrompt") or "")[:200],
                "status": board_status,
                "updatedAt": fs.SERVER_TIMESTAMP,
            }
        )
        crew_job_id = existing_partnership["id"]
        crew_status = board_status
        invited_id = existing_partnership.get("invitedStudentId")
        invited_name = existing_partnership.get("invitedStudentName")
    else:
        crew_ref = _crew_jobs_col(class_id).document()
        crew_payload = {
            "closetJobId": job_id,
            "itemId": item_id,
            "itemLabel": product_label,
            "jobTitle": job_title,
            "kind": kind,
            "creatorId": student_id,
            "creatorName": student.get("name") or "Student",
            "slots": tier["slots"],
            "wageEach": tier["wageEach"],
            "payroll": tier["payroll"],
            "maxSellPrice": tier["maxSellPrice"],
            "payMode": tier["payMode"],
            "profitSharePct": tier["profitSharePct"],
            "sellPrice": sell_price,
            "members": [],
            "status": "open",
            "invitedStudentId": None,
            "invitedStudentName": None,
            "thumbnailUrl": thumb_url or "",
            "parts": job.get("parts") or [],
            "sourcePrompt": str(job.get("sourcePrompt") or "")[:200],
            "createdAtMs": int(time.time() * 1000),
            "createdAt": fs.SERVER_TIMESTAMP,
            "updatedAt": fs.SERVER_TIMESTAMP,
        }
        crew_ref.set(crew_payload)
        crew_job_id = crew_ref.id
        crew_status = "open"
        invited_id = None
        invited_name = None

    _bump_publish_log(class_id, student_id)
    ref.update(
        {
            "status": "pending_quiz",
            "itemId": item_id,
            "publishedUrl": public_url,
            "sellPrice": sell_price,
            "publishFee": tier["payroll"],
            "crewSlots": tier["slots"],
            "crewWageEach": tier["wageEach"],
            "crewPayroll": tier["payroll"],
            "crewMaxSellPrice": tier["maxSellPrice"],
            "crewPayMode": tier["payMode"],
            "crewProfitSharePct": tier["profitSharePct"],
            "crewJobId": crew_job_id,
            "crewJobTitle": job_title,
            "crewMembers": members,
            "crewInvitedStudentId": invited_id,
            "crewInvitedStudentName": invited_name,
            "storageError": storage_error,
            "itemSnapshot": item,
            "updatedAt": fs.SERVER_TIMESTAMP,
        }
    )
    filled = len(members) >= tier["slots"]
    return {
        "item": item,
        "storageError": storage_error,
        "pendingQuiz": True,
        "publishFee": tier["payroll"],
        "feeCharged": False,
        "cash": cash,
        "crew": {
            "crewJobId": crew_job_id,
            "jobTitle": job_title,
            "slots": tier["slots"],
            "wageEach": tier["wageEach"],
            "payroll": tier["payroll"],
            "maxSellPrice": tier["maxSellPrice"],
            "payMode": tier["payMode"],
            "profitSharePct": tier["profitSharePct"],
            "members": members,
            "filled": filled,
            "status": crew_status,
            "needsPartnerInvite": False,
            "invitedStudentId": invited_id,
            "invitedStudentName": invited_name,
        },
        "tiers": [crew_tier(n) for n in (1, 3, 5)],
    }


def _crew_is_filled(job: dict) -> bool:
    slots = int(job.get("crewSlots") or 0)
    members = list(job.get("crewMembers") or [])
    if slots <= 0:
        return True
    return len(members) >= slots


def _promote_closet_job_to_review_if_ready(class_id: str, closet_job_id: str) -> bool:
    """If quiz is done and crew is full, surface the item on the teacher dashboard."""
    if not closet_job_id:
        return False
    ref = _job_ref(class_id, closet_job_id)
    snap = ref.get()
    if not snap.exists:
        return False
    job = snap.to_dict() or {}
    status = str(job.get("status") or "")
    if status == "pending_review":
        return True
    if status != "awaiting_crew":
        return False
    if not job.get("quizAnswers"):
        return False
    job = _sync_crew_from_board(class_id, closet_job_id, job)
    if not _crew_is_filled(job):
        return False

    from firebase_admin import firestore as fs

    item_id = job.get("itemId")
    if item_id:
        class_ref = fs_ledger.class_ref(class_id)
        class_snap = class_ref.get()
        rows = list((class_snap.to_dict() or {}).get("closetItems") or [])
        next_rows = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            if row.get("id") == item_id:
                next_rows.append(
                    {
                        **row,
                        "live": False,
                        "quizPending": False,
                        "reviewPending": True,
                        "awaitingCrew": False,
                    }
                )
            else:
                next_rows.append(row)
        class_ref.set(
            {"closetItems": next_rows, "updatedAt": fs.SERVER_TIMESTAMP},
            merge=True,
        )
    ref.update(
        {
            "status": "pending_review",
            "crewMembers": list(job.get("crewMembers") or []),
            "reviewReadyAt": fs.SERVER_TIMESTAMP,
            "updatedAt": fs.SERVER_TIMESTAMP,
        }
    )
    return True


def _demote_closet_job_if_crew_incomplete(class_id: str, closet_job_id: str) -> None:
    """If someone leaves after the teacher queue opened, pull it back until crew is full again."""
    if not closet_job_id:
        return
    ref = _job_ref(class_id, closet_job_id)
    snap = ref.get()
    if not snap.exists:
        return
    job = snap.to_dict() or {}
    if str(job.get("status") or "") != "pending_review":
        return
    if not job.get("quizAnswers"):
        return
    job = _sync_crew_from_board(class_id, closet_job_id, job)
    if _crew_is_filled(job):
        return

    from firebase_admin import firestore as fs

    item_id = job.get("itemId")
    if item_id:
        class_ref = fs_ledger.class_ref(class_id)
        class_snap = class_ref.get()
        rows = list((class_snap.to_dict() or {}).get("closetItems") or [])
        next_rows = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            if row.get("id") == item_id:
                next_rows.append(
                    {
                        **row,
                        "live": False,
                        "quizPending": False,
                        "reviewPending": False,
                        "awaitingCrew": True,
                    }
                )
            else:
                next_rows.append(row)
        class_ref.set(
            {"closetItems": next_rows, "updatedAt": fs.SERVER_TIMESTAMP},
            merge=True,
        )
    ref.update(
        {
            "status": "awaiting_crew",
            "crewMembers": list(job.get("crewMembers") or []),
            "updatedAt": fs.SERVER_TIMESTAMP,
        }
    )


def submit_quiz_for_review(
    class_id: str, student_id: str, job_id: str, answers=None
) -> dict:
    """Save strategy response now. Teacher queue only opens once the crew is full."""
    student, err = require_creator(class_id, student_id)
    if err:
        raise PermissionError(err)

    ref = _job_ref(class_id, job_id)
    snap = ref.get()
    if not snap.exists:
        raise ValueError("Job not found")
    job = snap.to_dict() or {}
    if job.get("createdBy") != student_id:
        raise PermissionError("Not your create job")
    item_id = job.get("itemId")
    if not item_id:
        raise RuntimeError("Nothing to submit — publish first")
    if job.get("status") == "published":
        return {"item": _item_from_job({**job, "live": True}), "alreadyLive": True}
    if job.get("status") == "pending_review":
        tier = crew_tier(job.get("crewSlots") or 0)
        return {
            "item": _item_from_job(job),
            "pendingReview": True,
            "awaitingCrew": False,
            "publishFee": tier["payroll"],
            "crew": _crew_public(job),
        }
    if job.get("status") == "awaiting_crew" and job.get("quizAnswers"):
        job = _sync_crew_from_board(class_id, job_id, job)
        if _crew_is_filled(job) and _promote_closet_job_to_review_if_ready(class_id, job_id):
            tier = crew_tier(job.get("crewSlots") or 0)
            return {
                "item": _item_from_job(job),
                "pendingReview": True,
                "awaitingCrew": False,
                "publishFee": tier["payroll"],
                "crew": _crew_public(job),
                "message": "Crew is full — your item is now in teacher review.",
            }
        tier = crew_tier(job.get("crewSlots") or 0)
        return {
            "item": _item_from_job(job),
            "pendingReview": False,
            "awaitingCrew": True,
            "publishFee": tier["payroll"],
            "crew": _crew_public(job),
            "message": (
                "Strategy response already saved. "
                "Your teacher will see it once the crew is full."
            ),
        }
    if job.get("status") != "pending_quiz":
        raise RuntimeError("Item is not waiting on the go-live quiz")

    # Sync crew from crewJobs doc if present.
    job = _sync_crew_from_board(class_id, job_id, job)
    members = list(job.get("crewMembers") or [])
    slots = int(job.get("crewSlots") or 0)
    crew_ready = _crew_is_filled(job)

    if not isinstance(answers, list) or len(answers) < 1:
        raise ValueError("Submit your strategy response before continuing")

    normalized = []
    for i, raw in enumerate(answers[:1]):
        if isinstance(raw, dict):
            prompt = str(raw.get("prompt") or "").strip()[:800]
            answer = str(raw.get("answer") or raw.get("text") or "").strip()[:1200]
            qid = str(raw.get("id") or f"q{i + 1}")
        else:
            prompt = ""
            answer = str(raw or "").strip()[:1200]
            qid = f"q{i + 1}"
        if len(answer) < 80:
            raise ValueError(
                "Write a thoughtful strategy response (at least 80 characters)"
            )
        normalized.append({"id": qid, "prompt": prompt, "answer": answer})

    from firebase_admin import firestore as fs

    next_status = "pending_review" if crew_ready else "awaiting_crew"
    class_ref = fs_ledger.class_ref(class_id)
    class_snap = class_ref.get()
    rows = list((class_snap.to_dict() or {}).get("closetItems") or [])
    updated = None
    next_rows = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if row.get("id") == item_id:
            updated = {
                **row,
                "live": False,
                "quizPending": False,
                "reviewPending": crew_ready,
                "awaitingCrew": not crew_ready,
                "quizCompletedAtMs": int(time.time() * 1000),
            }
            next_rows.append(updated)
        else:
            next_rows.append(row)
    if not updated:
        raise RuntimeError("Published item not found in class closet")

    class_ref.set(
        {"closetItems": next_rows, "updatedAt": fs.SERVER_TIMESTAMP},
        merge=True,
    )
    patch = {
        "status": next_status,
        "quizAnswers": normalized,
        "crewMembers": members,
        "reviewSubmittedAt": fs.SERVER_TIMESTAMP,
        "updatedAt": fs.SERVER_TIMESTAMP,
    }
    if crew_ready:
        patch["reviewReadyAt"] = fs.SERVER_TIMESTAMP
    ref.update(patch)
    tier = crew_tier(slots)
    payroll = int(job.get("crewPayroll") or tier["payroll"])
    if crew_ready:
        message = (
            "Your item is under teacher review. "
            + (
                f"If approved, you pay {payroll:,.0f} total crew wages and it goes live. "
                if payroll > 0
                else "If approved, it goes live with no payroll. "
            )
            + "If denied, the item is removed and you pay nothing."
        )
    else:
        message = (
            "Strategy response saved. Your teacher will see this once your crew "
            f"is full ({len(members)}/{slots or 0} hired so far)."
        )
    return {
        "item": updated,
        "pendingReview": crew_ready,
        "awaitingCrew": not crew_ready,
        "publishFee": payroll,
        "crew": _crew_public({**job, "crewMembers": members}),
        "message": message,
    }


# Back-compat name used by older API route.
def activate_published_item(class_id: str, student_id: str, job_id: str, answers=None) -> dict:
    return submit_quiz_for_review(class_id, student_id, job_id, answers=answers)


def _crew_public(job: dict) -> dict:
    slots = int(job.get("crewSlots") or 1)
    members = list(job.get("crewMembers") or [])
    tier = crew_tier(slots)
    wage = int(job.get("crewWageEach") if job.get("crewWageEach") is not None else tier["wageEach"])
    pay_mode = str(job.get("crewPayMode") or tier["payMode"])
    payroll = int(
        job.get("crewPayroll")
        if job.get("crewPayroll") is not None
        else (0 if pay_mode == "profit_share" else wage * slots)
    )
    return {
        "crewJobId": job.get("crewJobId"),
        "jobTitle": job.get("crewJobTitle") or "",
        "slots": slots,
        "wageEach": wage,
        "payroll": payroll,
        "maxSellPrice": int(job.get("crewMaxSellPrice") or tier["maxSellPrice"]),
        "payMode": pay_mode,
        "profitSharePct": int(
            job.get("crewProfitSharePct")
            if job.get("crewProfitSharePct") is not None
            else tier["profitSharePct"]
        ),
        "members": members,
        "filled": len(members) >= slots,
        "status": "filled" if len(members) >= slots else "open",
    }


def _sync_crew_from_board(class_id: str, job_id: str, job: dict) -> dict:
    """Pull latest members from the crewJobs board doc onto the closet job."""
    crew_job_id = job.get("crewJobId")
    if not crew_job_id:
        return job
    snap = _crew_job_ref(class_id, crew_job_id).get()
    if not snap.exists:
        return job
    board = snap.to_dict() or {}
    members = list(board.get("members") or [])
    from firebase_admin import firestore as fs

    _job_ref(class_id, job_id).update(
        {"crewMembers": members, "updatedAt": fs.SERVER_TIMESTAMP}
    )
    return {**job, "crewMembers": members}


def list_crew_jobs(class_id: str, student_id: str | None = None) -> dict:
    if not class_id:
        raise ValueError("classId is required")
    viewer = (student_id or "").strip() or None
    open_rows = []
    invite_rows = []
    filled_rows = []
    for snap in _crew_jobs_col(class_id).stream():
        data = snap.to_dict() or {}
        status = str(data.get("status") or "open")
        # Hide rejected / closed / partnership drafts — keep paid (teacher-approved) visible.
        if status in ("rejected", "closed", "awaiting_invite"):
            continue
        members = list(data.get("members") or [])
        slots = int(data.get("slots") or 0)
        row = {
            "id": snap.id,
            "closetJobId": data.get("closetJobId"),
            "itemId": data.get("itemId"),
            "itemLabel": data.get("itemLabel") or "Class item",
            "jobTitle": data.get("jobTitle")
            or job_title_from_product(
                data.get("itemLabel") or "", data.get("sourcePrompt") or ""
            ),
            "kind": data.get("kind") or "prop",
            "creatorId": data.get("creatorId"),
            "creatorName": data.get("creatorName") or "Student",
            "slots": slots,
            "wageEach": int(data.get("wageEach") or 0),
            "payroll": int(data.get("payroll") or 0),
            "maxSellPrice": int(data.get("maxSellPrice") or 0),
            "payMode": data.get("payMode") or "wages",
            "profitSharePct": int(data.get("profitSharePct") or 0),
            "sellPrice": int(data.get("sellPrice") or 0),
            "members": members,
            "openSlots": max(0, slots - len(members)),
            "status": status,
            "invitedStudentId": data.get("invitedStudentId"),
            "invitedStudentName": data.get("invitedStudentName"),
            "thumbnailUrl": data.get("thumbnailUrl") or "",
            "parts": data.get("parts") or [],
            "createdAtMs": int(data.get("createdAtMs") or 0),
        }
        if status == "pending_invite":
            if viewer and data.get("invitedStudentId") == viewer:
                invite_rows.append(row)
            continue
        if status == "paid" or (slots > 0 and len(members) >= slots):
            row["status"] = "paid" if status == "paid" else "filled"
            row["openSlots"] = 0
            filled_rows.append(row)
        elif status == "open":
            open_rows.append(row)

    open_rows.sort(key=lambda r: -int(r.get("createdAtMs") or 0))
    invite_rows.sort(key=lambda r: -int(r.get("createdAtMs") or 0))
    # Live (paid) first, then filled-but-pending-review.
    filled_rows.sort(
        key=lambda r: (
            0 if r.get("status") == "paid" else 1,
            -int(r.get("createdAtMs") or 0),
        )
    )
    return {
        "jobs": open_rows + filled_rows,
        "invites": invite_rows,
        "joinedCount": _count_student_crew_joins(class_id, viewer) if viewer else 0,
        "maxJoins": MAX_CREW_JOINS_PER_STUDENT,
        "tiers": [crew_tier(n) for n in (1, 3, 5)],
    }


def _ensure_paid_crew_job(class_id: str, job_id: str, job: dict, members: list) -> str:
    """On teacher approve: mark existing board post paid, or create one if missing."""
    from firebase_admin import firestore as fs

    crew_job_id = (job.get("crewJobId") or "").strip()
    slots = int(job.get("crewSlots") or (len(members) if members else 0) or 0)
    tier = crew_tier(slots or 1)
    item = job.get("itemSnapshot") or {}
    label = str(job.get("label") or item.get("label") or "Class item")[:40]
    title = job.get("crewJobTitle") or job_title_from_product(
        label, job.get("sourcePrompt") or ""
    )
    payload = {
        "closetJobId": job_id,
        "itemId": job.get("itemId"),
        "itemLabel": label,
        "jobTitle": title,
        "kind": job.get("kind") or item.get("kind") or "prop",
        "creatorId": job.get("createdBy"),
        "creatorName": job.get("creatorName") or "Student",
        "slots": slots or tier["slots"],
        "wageEach": int(job.get("crewWageEach") if job.get("crewWageEach") is not None else tier["wageEach"]),
        "payroll": int(job.get("crewPayroll") if job.get("crewPayroll") is not None else tier["payroll"]),
        "maxSellPrice": int(
            job.get("crewMaxSellPrice")
            if job.get("crewMaxSellPrice") is not None
            else tier["maxSellPrice"]
        ),
        "payMode": job.get("crewPayMode") or tier["payMode"],
        "profitSharePct": int(
            job.get("crewProfitSharePct")
            if job.get("crewProfitSharePct") is not None
            else tier["profitSharePct"]
        ),
        "sellPrice": int(job.get("sellPrice") or item.get("price") or 0),
        "members": members,
        "status": "paid",
        "thumbnailUrl": item.get("thumbnailUrl") or job.get("thumbnailUrl") or "",
        "parts": job.get("parts") or item.get("parts") or [],
        "sourcePrompt": str(job.get("sourcePrompt") or "")[:200],
        "updatedAt": fs.SERVER_TIMESTAMP,
    }
    if crew_job_id:
        ref = _crew_job_ref(class_id, crew_job_id)
        if ref.get().exists:
            ref.update(payload)
            return crew_job_id
    ref = _crew_jobs_col(class_id).document()
    payload["createdAtMs"] = int(time.time() * 1000)
    payload["createdAt"] = fs.SERVER_TIMESTAMP
    if not payload.get("invitedStudentId"):
        payload["invitedStudentId"] = job.get("crewInvitedStudentId")
        payload["invitedStudentName"] = job.get("crewInvitedStudentName")
    ref.set(payload)
    _job_ref(class_id, job_id).update(
        {"crewJobId": ref.id, "updatedAt": fs.SERVER_TIMESTAMP}
    )
    return ref.id


def _find_active_partnership(class_id: str, student_id: str) -> dict | None:
    """Unbound or pending partnership invite owned by this creator."""
    best = None
    for snap in _crew_jobs_col(class_id).stream():
        data = snap.to_dict() or {}
        if data.get("creatorId") != student_id:
            continue
        if str(data.get("payMode") or "") != "profit_share" and int(data.get("slots") or 0) != 1:
            continue
        status = str(data.get("status") or "")
        if status in ("paid", "rejected", "closed"):
            continue
        # Prefer invites not yet tied to a published closet job.
        if data.get("closetJobId"):
            continue
        if status not in ("pending_invite", "filled", "awaiting_invite"):
            continue
        row = {"id": snap.id, **data}
        # Prefer one that already has an invitee / members.
        if best is None:
            best = row
        elif data.get("invitedStudentId") and not best.get("invitedStudentId"):
            best = row
        elif list(data.get("members") or []) and not list(best.get("members") or []):
            best = row
    return best


def create_partnership_invite(class_id: str, student_id: str, partner_id: str) -> dict:
    """Right after choosing Partnership: pick a classmate and send the request."""
    student, err = require_creator(class_id, student_id)
    if err:
        raise PermissionError(err)
    partner_id = (partner_id or "").strip()
    if not partner_id:
        raise ValueError("Pick a classmate to invite")
    if partner_id == student_id:
        raise ValueError("You can't partner with yourself")
    partner = fs_ledger.get_student(class_id, partner_id)
    if not partner:
        raise ValueError("That classmate wasn't found in this class")

    from firebase_admin import firestore as fs

    # Close prior unbound partnership drafts from this creator.
    for snap in _crew_jobs_col(class_id).stream():
        data = snap.to_dict() or {}
        if data.get("creatorId") != student_id:
            continue
        if data.get("closetJobId"):
            continue
        if str(data.get("payMode") or "") != "profit_share" and int(data.get("slots") or 0) != 1:
            continue
        if str(data.get("status") or "") in ("paid", "rejected", "closed"):
            continue
        snap.reference.update(
            {"status": "closed", "updatedAt": fs.SERVER_TIMESTAMP}
        )

    tier = crew_tier(1)
    partner_name = partner.get("name") or "Student"
    creator_name = student.get("name") or "Student"
    crew_ref = _crew_jobs_col(class_id).document()
    crew_ref.set(
        {
            "closetJobId": None,
            "itemId": None,
            "itemLabel": "Partnership (item coming soon)",
            "jobTitle": "Partnership invite",
            "kind": "prop",
            "creatorId": student_id,
            "creatorName": creator_name,
            "slots": tier["slots"],
            "wageEach": tier["wageEach"],
            "payroll": tier["payroll"],
            "maxSellPrice": tier["maxSellPrice"],
            "payMode": tier["payMode"],
            "profitSharePct": tier["profitSharePct"],
            "sellPrice": 0,
            "members": [],
            "status": "pending_invite",
            "invitedStudentId": partner_id,
            "invitedStudentName": partner_name,
            "thumbnailUrl": "",
            "parts": [],
            "sourcePrompt": "",
            "createdAtMs": int(time.time() * 1000),
            "createdAt": fs.SERVER_TIMESTAMP,
            "updatedAt": fs.SERVER_TIMESTAMP,
        }
    )
    return {
        "invited": True,
        "crewJobId": crew_ref.id,
        "partnerId": partner_id,
        "partnerName": partner_name,
        "status": "pending_invite",
        "message": (
            f"Partnership request sent to {partner_name}. "
            "They’ll see a notification next time they open LedgerLab."
        ),
    }


def invite_crew_partner(
    class_id: str, student_id: str, crew_job_id: str, partner_id: str
) -> dict:
    """Partnership: creator picks one classmate and sends a directed invite."""
    # Early invite (no crew job yet) — create the request immediately.
    if not (crew_job_id or "").strip():
        return create_partnership_invite(class_id, student_id, partner_id)

    student, err = require_creator(class_id, student_id)
    if err:
        raise PermissionError(err)
    partner_id = (partner_id or "").strip()
    if not partner_id:
        raise ValueError("Pick a classmate to invite")
    if partner_id == student_id:
        raise ValueError("You can't partner with yourself")
    partner = fs_ledger.get_student(class_id, partner_id)
    if not partner:
        raise ValueError("That classmate wasn't found in this class")

    ref = _crew_job_ref(class_id, crew_job_id)
    snap = ref.get()
    if not snap.exists:
        raise ValueError("Job posting not found")
    board = snap.to_dict() or {}
    if board.get("creatorId") != student_id:
        raise PermissionError("Not your crew posting")
    if int(board.get("slots") or 0) != 1 or str(board.get("payMode") or "") != "profit_share":
        raise ValueError("Only partnerships use direct invites — teams post to the Job board")
    status = str(board.get("status") or "")
    if status in ("filled", "paid", "rejected", "closed"):
        raise RuntimeError("This partnership is already locked")
    members = list(board.get("members") or [])
    if members:
        raise RuntimeError("A partner already joined")

    from firebase_admin import firestore as fs

    partner_name = partner.get("name") or "Student"
    ref.update(
        {
            "invitedStudentId": partner_id,
            "invitedStudentName": partner_name,
            "status": "pending_invite",
            "updatedAt": fs.SERVER_TIMESTAMP,
        }
    )
    closet_job_id = board.get("closetJobId")
    if closet_job_id:
        _job_ref(class_id, closet_job_id).update(
            {
                "crewInvitedStudentId": partner_id,
                "crewInvitedStudentName": partner_name,
                "updatedAt": fs.SERVER_TIMESTAMP,
            }
        )
    return {
        "invited": True,
        "crewJobId": crew_job_id,
        "partnerId": partner_id,
        "partnerName": partner_name,
        "status": "pending_invite",
        "message": (
            f"Partnership request sent to {partner_name}. "
            "They’ll see a notification next time they open LedgerLab."
        ),
    }


def decline_crew_invite(class_id: str, student_id: str, crew_job_id: str) -> dict:
    ref = _crew_job_ref(class_id, crew_job_id)
    snap = ref.get()
    if not snap.exists:
        raise ValueError("Invite not found")
    board = snap.to_dict() or {}
    if board.get("invitedStudentId") != student_id:
        raise PermissionError("This invite isn't for you")
    if str(board.get("status") or "") != "pending_invite":
        raise RuntimeError("This invite is no longer pending")
    from firebase_admin import firestore as fs

    # Return to awaiting_invite so creator can pick someone else.
    ref.update(
        {
            "status": "awaiting_invite",
            "invitedStudentId": None,
            "invitedStudentName": None,
            "updatedAt": fs.SERVER_TIMESTAMP,
        }
    )
    return {"declined": True}


MAX_CREW_JOINS_PER_STUDENT = 2


def _count_student_crew_joins(class_id: str, student_id: str) -> int:
    """How many active crew roles this student is on (not counting their own projects)."""
    if not student_id:
        return 0
    count = 0
    for snap in _crew_jobs_col(class_id).stream():
        data = snap.to_dict() or {}
        if str(data.get("status") or "") in ("rejected", "closed"):
            continue
        if data.get("creatorId") == student_id:
            continue
        for m in list(data.get("members") or []):
            if isinstance(m, dict) and m.get("studentId") == student_id:
                count += 1
                break
    return count


def join_crew_job(class_id: str, student_id: str, crew_job_id: str) -> dict:
    student = fs_ledger.get_student(class_id, student_id)
    if not student:
        raise PermissionError("Student not found in this class")
    ref = _crew_job_ref(class_id, crew_job_id)
    snap = ref.get()
    if not snap.exists:
        raise ValueError("Job posting not found")
    board = snap.to_dict() or {}
    if board.get("creatorId") == student_id:
        raise ValueError("You can't join your own business as an employee")
    status = str(board.get("status") or "open")
    if status == "pending_invite":
        if board.get("invitedStudentId") != student_id:
            raise PermissionError("This partnership invite is for someone else")
    elif status != "open":
        raise RuntimeError("This job is not hiring")
    slots = int(board.get("slots") or 0)
    if slots < 1:
        raise ValueError("This project has no open roles")
    members = list(board.get("members") or [])
    if any(m.get("studentId") == student_id for m in members if isinstance(m, dict)):
        return {
            "job": {**board, "id": crew_job_id, "members": members},
            "alreadyJoined": True,
            "joinedCount": _count_student_crew_joins(class_id, student_id),
            "maxJoins": MAX_CREW_JOINS_PER_STUDENT,
        }
    if len(members) >= slots:
        raise RuntimeError("This crew is already full")

    joined_count = _count_student_crew_joins(class_id, student_id)
    if joined_count >= MAX_CREW_JOINS_PER_STUDENT:
        raise RuntimeError(
            f"You can only join {MAX_CREW_JOINS_PER_STUDENT} jobs at a time "
            f"(you're already on {joined_count}). Leave one first."
        )

    member = {
        "studentId": student_id,
        "studentName": student.get("name") or "Student",
        "joinedAtMs": int(time.time() * 1000),
    }
    members = members + [member]
    filled = len(members) >= slots
    from firebase_admin import firestore as fs

    ref.update(
        {
            "members": members,
            "status": "filled" if filled else "open",
            "updatedAt": fs.SERVER_TIMESTAMP,
        }
    )
    closet_job_id = board.get("closetJobId")
    if closet_job_id:
        _job_ref(class_id, closet_job_id).update(
            {
                "crewMembers": members,
                "updatedAt": fs.SERVER_TIMESTAMP,
            }
        )
        if filled:
            _promote_closet_job_to_review_if_ready(class_id, closet_job_id)
    return {
        "job": {
            "id": crew_job_id,
            **board,
            "members": members,
            "status": "filled" if filled else "open",
            "openSlots": max(0, slots - len(members)),
        },
        "joined": True,
        "joinedCount": joined_count + 1,
        "maxJoins": MAX_CREW_JOINS_PER_STUDENT,
    }


def leave_crew_job(class_id: str, student_id: str, crew_job_id: str) -> dict:
    ref = _crew_job_ref(class_id, crew_job_id)
    snap = ref.get()
    if not snap.exists:
        raise ValueError("Job posting not found")
    board = snap.to_dict() or {}
    if str(board.get("status") or "") in ("paid", "rejected", "closed"):
        raise RuntimeError("This job is locked")
    members = [
        m
        for m in list(board.get("members") or [])
        if isinstance(m, dict) and m.get("studentId") != student_id
    ]
    slots = int(board.get("slots") or 0)
    pay_mode = str(board.get("payMode") or "")
    from firebase_admin import firestore as fs

    if slots > 0 and len(members) >= slots:
        new_status = "filled"
    elif pay_mode == "profit_share" or slots == 1:
        new_status = "awaiting_invite"
    else:
        new_status = "open"
    patch = {
        "members": members,
        "status": new_status,
        "updatedAt": fs.SERVER_TIMESTAMP,
    }
    if new_status == "awaiting_invite":
        patch["invitedStudentId"] = None
        patch["invitedStudentName"] = None
    ref.update(patch)
    closet_job_id = board.get("closetJobId")
    if closet_job_id:
        closet_patch = {"crewMembers": members, "updatedAt": fs.SERVER_TIMESTAMP}
        if new_status == "awaiting_invite":
            closet_patch["crewInvitedStudentId"] = None
            closet_patch["crewInvitedStudentName"] = None
        _job_ref(class_id, closet_job_id).update(closet_patch)
        if new_status != "filled":
            _demote_closet_job_if_crew_incomplete(class_id, closet_job_id)
    return {"left": True, "members": members}


def seed_test_review_submission(
    class_id: str, student_id: str, answers=None
) -> dict:
    """Dev helper: fake pending_review job so teachers can preview the review UI."""
    student, err = require_creator(class_id, student_id)
    if err:
        raise PermissionError(err)

    if not isinstance(answers, list) or len(answers) < 1:
        raise ValueError("Submit your strategy response before continuing")

    normalized = []
    for i, raw in enumerate(answers[:1]):
        if isinstance(raw, dict):
            prompt = str(raw.get("prompt") or "").strip()[:800]
            answer = str(raw.get("answer") or raw.get("text") or "").strip()[:1200]
            qid = str(raw.get("id") or f"q{i + 1}")
        else:
            prompt = ""
            answer = str(raw or "").strip()[:1200]
            qid = f"q{i + 1}"
        if len(answer) < 80:
            raise ValueError(
                "Write a thoughtful strategy response (at least 80 characters)"
            )
        normalized.append({"id": qid, "prompt": prompt, "answer": answer})

    from firebase_admin import firestore as fs

    now_ms = int(time.time() * 1000)
    job_ref = _jobs_col(class_id).document()
    job_id = job_ref.id
    item_id = f"test-{job_id[:10]}"
    label = "Test item (fake)"
    kind = "prop"
    # Simple blocky recipe so the teacher review card can show a 3D preview.
    parts = [
        {
            "shape": "box",
            "size": [0.7, 0.5, 0.45],
            "pos": [0, 0.15, 0],
            "rot": [0, 0, 0],
            "color": "#6b8f71",
        },
        {
            "shape": "box",
            "size": [0.35, 0.35, 0.35],
            "pos": [0, 0.55, 0],
            "rot": [0, 20, 0],
            "color": "#2f6b4f",
        },
        {
            "shape": "cylinder",
            "radius": 0.12,
            "height": 0.55,
            "pos": [0, -0.2, 0],
            "rot": [0, 0, 0],
            "color": "#c4a574",
        },
    ]
    item = {
        "id": item_id,
        "kind": kind,
        "label": label,
        "url": "",
        "thumbnailUrl": "",
        "attach": "hand_r",
        "scale": 1.0,
        "color": "#6b8f71",
        "price": 2500,
        "category": KIND_TO_CATEGORY.get(kind, "accessories"),
        "createdBy": student_id,
        "createdByName": student.get("name") or "Student",
        "sourcePrompt": "[test] fake closet submission for teacher UI",
        "createdAtMs": now_ms,
        "aiSprite": False,
        "parts": parts,
        "live": False,
        "quizPending": False,
        "reviewPending": True,
        "jobId": job_id,
        "isTest": True,
        "crewSlots": 3,
        "crewMembers": [
            {"studentId": "test-crew-1", "studentName": "Alex (test)"},
            {"studentId": "test-crew-2", "studentName": "Jordan (test)"},
            {"studentId": "test-crew-3", "studentName": "Sam (test)"},
        ],
    }

    tier = crew_tier(3)
    # Test review: show as Team of 3 on the board, but $0 payroll so approve always works.
    test_wage = 0
    test_payroll = 0
    crew_ref = _crew_jobs_col(class_id).document()
    crew_ref.set(
        {
            "closetJobId": job_id,
            "itemId": item_id,
            "itemLabel": label,
            "jobTitle": job_title_from_product(label, item["sourcePrompt"]),
            "kind": kind,
            "creatorId": student_id,
            "creatorName": student.get("name") or "Student",
            "slots": 3,
            "wageEach": test_wage,
            "payroll": test_payroll,
            "maxSellPrice": tier["maxSellPrice"],
            "payMode": tier["payMode"],
            "profitSharePct": tier["profitSharePct"],
            "sellPrice": item["price"],
            "members": item["crewMembers"],
            "status": "filled",
            "invitedStudentId": None,
            "invitedStudentName": None,
            "thumbnailUrl": "",
            "parts": parts,
            "sourcePrompt": item["sourcePrompt"][:200],
            "createdAtMs": now_ms,
            "createdAt": fs.SERVER_TIMESTAMP,
            "updatedAt": fs.SERVER_TIMESTAMP,
            "isTest": True,
        }
    )

    class_ref = fs_ledger.class_ref(class_id)
    class_ref.set(
        {
            "closetItems": fs.ArrayUnion([item]),
            "updatedAt": fs.SERVER_TIMESTAMP,
        },
        merge=True,
    )
    job_ref.set(
        {
            "status": "pending_review",
            "kind": kind,
            "label": label,
            "color": item["color"],
            "createdBy": student_id,
            "creatorName": student.get("name") or "Student",
            "sourcePrompt": item["sourcePrompt"],
            "itemId": item_id,
            "sellPrice": item["price"],
            "publishFee": test_payroll,
            "crewSlots": 3,
            "crewWageEach": test_wage,
            "crewPayroll": test_payroll,
            "crewMaxSellPrice": tier["maxSellPrice"],
            "crewPayMode": tier["payMode"],
            "crewProfitSharePct": tier["profitSharePct"],
            "crewJobId": crew_ref.id,
            "crewJobTitle": job_title_from_product(label, item["sourcePrompt"]),
            "crewMembers": item["crewMembers"],
            "quizAnswers": normalized,
            "itemSnapshot": item,
            "parts": parts,
            "isTest": True,
            "reviewSubmittedAt": fs.SERVER_TIMESTAMP,
            "createdAt": fs.SERVER_TIMESTAMP,
            "updatedAt": fs.SERVER_TIMESTAMP,
        }
    )
    return {
        "item": item,
        "jobId": job_id,
        "pendingReview": True,
        "publishFee": test_payroll,
        "crewJobId": crew_ref.id,
        "isTest": True,
        "message": (
            "Test Team-of-3 submission sent to teacher review (fake item, $0 payroll). "
            "After approve it appears on the Job board under Filled & live."
        ),
    }


def _require_teacher(teacher_uid: str) -> dict:
    uid = (teacher_uid or "").strip()
    if not uid:
        raise PermissionError("Teacher sign-in required")
    snap = fs_ledger.db().collection("users").document(uid).get()
    if not snap.exists:
        raise PermissionError("Teacher account not found")
    data = snap.to_dict() or {}
    if data.get("role") not in ("teacher", "admin"):
        raise PermissionError("Only teachers can review closet creations")
    return {"uid": uid, **data}


def list_pending_reviews(class_id: str, teacher_uid: str) -> dict:
    _require_teacher(teacher_uid)
    if not class_id:
        raise ValueError("classId is required")
    rows = []
    for snap in _jobs_col(class_id).stream():
        job = snap.to_dict() or {}
        if job.get("status") != "pending_review":
            continue
        item = job.get("itemSnapshot") or _item_from_job(job)
        rows.append(
            {
                "jobId": snap.id,
                "status": "pending_review",
                "label": job.get("label") or item.get("label"),
                "kind": job.get("kind") or item.get("kind"),
                "sellPrice": job.get("sellPrice") or item.get("price"),
                "createdBy": job.get("createdBy"),
                "creatorName": job.get("creatorName"),
                "sourcePrompt": job.get("sourcePrompt") or "",
                "quizAnswers": job.get("quizAnswers") or [],
                "item": item,
                "glbUrl": job.get("publishedUrl") or job.get("glbUrl"),
                "parts": job.get("parts") or item.get("parts") or [],
                "color": job.get("color") or item.get("color"),
                "thumbnailUrl": item.get("thumbnailUrl") or job.get("thumbnailUrl"),
                "crew": _crew_public(job),
                "publishFee": int(
                    job.get("crewPayroll")
                    or crew_tier(job.get("crewSlots") or 0)["payroll"]
                ),
            }
        )
    rows.sort(key=lambda r: str(r.get("label") or ""))
    return {"reviews": rows, "publishFee": 0, "tiers": [crew_tier(n) for n in (1, 3, 5)]}


def review_submission(
    class_id: str,
    teacher_uid: str,
    job_id: str,
    *,
    action: str,
    note: str | None = None,
) -> dict:
    teacher = _require_teacher(teacher_uid)
    action_norm = str(action or "").strip().lower()
    if action_norm not in ("approve", "reject"):
        raise ValueError("action must be approve or reject")

    ref = _job_ref(class_id, job_id)
    snap = ref.get()
    if not snap.exists:
        raise ValueError("Submission not found")
    job = snap.to_dict() or {}
    if job.get("status") == "published" and action_norm == "approve":
        return {"alreadyLive": True, "item": _item_from_job(job)}
    if job.get("status") == "rejected" and action_norm == "reject":
        return {"alreadyRejected": True}
    if job.get("status") != "pending_review":
        raise RuntimeError("This submission is not waiting for review")

    item_id = job.get("itemId")
    student_id = job.get("createdBy")
    if not item_id or not student_id:
        raise RuntimeError("Submission is missing item or student")

    from firebase_admin import firestore as fs

    class_ref = fs_ledger.class_ref(class_id)
    class_snap = class_ref.get()
    rows = list((class_snap.to_dict() or {}).get("closetItems") or [])
    job = _sync_crew_from_board(class_id, job_id, job)
    fee = int(job.get("crewPayroll") or crew_tier(job.get("crewSlots") or 0)["payroll"])
    wage_each = int(
        job.get("crewWageEach") or crew_tier(job.get("crewSlots") or 0)["wageEach"]
    )
    members = [
        m
        for m in list(job.get("crewMembers") or [])
        if isinstance(m, dict) and m.get("studentId")
    ]
    slots = int(job.get("crewSlots") or 0)
    if action_norm == "approve" and slots > 0 and len(members) < slots:
        raise RuntimeError(
            f"Crew is incomplete ({len(members)}/{slots}). Student must finish hiring first."
        )
    teacher_note = str(note or "").strip()[:400]

    if action_norm == "reject":
        next_rows = [r for r in rows if not (isinstance(r, dict) and r.get("id") == item_id)]
        class_ref.set(
            {"closetItems": next_rows, "updatedAt": fs.SERVER_TIMESTAMP},
            merge=True,
        )
        ref.update(
            {
                "status": "rejected",
                "reviewAction": "reject",
                "reviewNote": teacher_note or None,
                "reviewedBy": teacher["uid"],
                "reviewedAt": fs.SERVER_TIMESTAMP,
                "feeCharged": 0,
                "updatedAt": fs.SERVER_TIMESTAMP,
            }
        )
        crew_job_id = job.get("crewJobId")
        if crew_job_id:
            _crew_job_ref(class_id, crew_job_id).update(
                {"status": "rejected", "updatedAt": fs.SERVER_TIMESTAMP}
            )
        return {
            "action": "reject",
            "feeCharged": 0,
            "itemId": item_id,
            "message": "Item removed. Student was not charged.",
        }

    # Approve: pay crew wages (if any), then make live.
    student = fs_ledger.get_student(class_id, student_id)
    if not student:
        raise RuntimeError("Student not found")
    cash = float(student.get("cash") or 0)
    if cash < fee:
        raise RuntimeError(
            f"Student only has {cash:,.0f} cash — need {fee:,.0f} payroll to approve."
        )

    updated = None
    next_rows = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if row.get("id") == item_id:
            updated = {
                **row,
                "live": True,
                "quizPending": False,
                "reviewPending": False,
                "approvedAtMs": int(time.time() * 1000),
                "crewMembers": members,
                "crewPayMode": job.get("crewPayMode") or crew_tier(slots)["payMode"],
                "crewProfitSharePct": int(
                    job.get("crewProfitSharePct")
                    or crew_tier(slots)["profitSharePct"]
                ),
            }
            next_rows.append(updated)
        else:
            next_rows.append(row)
    if not updated:
        snapshot = dict(job.get("itemSnapshot") or _item_from_job(job) or {})
        snapshot.update(
            {
                "id": item_id,
                "live": True,
                "quizPending": False,
                "reviewPending": False,
                "approvedAtMs": int(time.time() * 1000),
            }
        )
        updated = snapshot
        next_rows.append(updated)

    new_cash = cash - fee
    holdings = fs_ledger.list_holdings(class_id, student_id)
    fs_ledger.set_cash(class_id, student_id, new_cash, holdings_count=len(holdings))

    for member in members:
        emp_id = member.get("studentId")
        if not emp_id or emp_id == student_id:
            continue
        emp = fs_ledger.get_student(class_id, emp_id)
        if not emp:
            continue
        emp_cash = float(emp.get("cash") or 0) + wage_each
        emp_holdings = fs_ledger.list_holdings(class_id, emp_id)
        fs_ledger.set_cash(
            class_id, emp_id, emp_cash, holdings_count=len(emp_holdings)
        )

    class_ref.set(
        {"closetItems": next_rows, "updatedAt": fs.SERVER_TIMESTAMP},
        merge=True,
    )
    ref.update(
        {
            "status": "published",
            "reviewAction": "approve",
            "reviewNote": teacher_note or None,
            "reviewedBy": teacher["uid"],
            "reviewedAt": fs.SERVER_TIMESTAMP,
            "liveAt": fs.SERVER_TIMESTAMP,
            "feeCharged": fee,
            "crewPaid": True,
            "updatedAt": fs.SERVER_TIMESTAMP,
        }
    )
    crew_job_id = _ensure_paid_crew_job(class_id, job_id, job, members)
    if crew_job_id and not job.get("crewJobId"):
        job["crewJobId"] = crew_job_id
    return {
        "action": "approve",
        "feeCharged": fee,
        "cash": new_cash,
        "item": updated,
        "crewPaid": len(members),
        "crewJobId": crew_job_id,
        "message": (
            f"Item is live. Creator paid {fee:,.0f} in crew wages."
            if fee > 0
            else "Item is live. Solo project — no payroll."
        ),
    }


def _item_from_job(job: dict) -> dict:
    kind = job.get("kind") if job.get("kind") in ACCESSORY_KINDS else "prop"
    defaults = KIND_DEFAULTS[kind]
    return {
        "id": job.get("itemId"),
        "kind": kind,
        "label": job.get("label"),
        "url": job.get("publishedUrl") or job.get("glbUrl"),
        "attach": job.get("attach") or defaults["attach"],
        "scale": defaults["scale"],
        "color": job.get("color") or defaults["color"],
        "price": job.get("sellPrice") or job.get("price"),
        "category": KIND_TO_CATEGORY.get(kind, "accessories"),
        "live": job.get("status") == "published",
        "quizPending": job.get("status") == "pending_quiz",
        "reviewPending": job.get("status") == "pending_review",
        "parts": job.get("parts") or [],
    }


def creator_status(class_id: str, student_id: str) -> dict:
    student, err = require_creator(class_id, student_id)
    if err:
        return {"allowed": False, "reason": err}
    used = _publishes_today(class_id, student_id)
    engine = None
    try:
        engine = _generation_engine()
    except Exception:
        engine = None
    cash = float(student.get("cash") or 0)
    return {
        "allowed": True,
        "email": CLOSET_CREATOR_EMAIL,
        "name": student.get("name"),
        "publishesToday": used,
        "maxPerDay": MAX_PUBLISHES_PER_DAY,
        "publishFee": 0,
        "tiers": [crew_tier(n) for n in (1, 3, 5)],
        "cash": cash,
        "canAffordPublish": True,
        "engine": engine,
        "meshyConfigured": bool(_meshy_api_key()),
        "claudeConfigured": bool(_anthropic_api_key()),
        "openaiConfigured": bool(_openai_api_key()),
        "storageBucket": fs_ledger.storage_bucket_name(),
    }
