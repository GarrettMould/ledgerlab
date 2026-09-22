"""Build Roblox-style blocky accessory GLBs from a parts recipe (no Blender/Meshy).

Matches the aesthetic of public/accessories/build_accessories.py:
stacked boxes / cylinders / spheres, flat colors, origin at the attach point.
Coordinate system is app/Y-up: +Y up, +Z toward the camera/front of the character.
"""

from __future__ import annotations

import json
import math
import struct
from typing import Any


def _hex_rgb(color: str) -> tuple[float, float, float]:
    c = (color or "#888888").strip()
    if not c.startswith("#"):
        c = f"#{c}"
    if len(c) != 7:
        return (0.53, 0.53, 0.53)
    try:
        return (
            int(c[1:3], 16) / 255.0,
            int(c[3:5], 16) / 255.0,
            int(c[5:7], 16) / 255.0,
        )
    except ValueError:
        return (0.53, 0.53, 0.53)


def _v3(x: float, y: float, z: float) -> tuple[float, float, float]:
    return (float(x), float(y), float(z))


def _rot_point(
    p: tuple[float, float, float],
    rot: tuple[float, float, float],
) -> tuple[float, float, float]:
    """Apply XYZ Euler rotations (radians) then leave for translation."""
    x, y, z = p
    rx, ry, rz = rot
    if rx:
        cy, sy = math.cos(rx), math.sin(rx)
        y, z = y * cy - z * sy, y * sy + z * cy
    if ry:
        cy, sy = math.cos(ry), math.sin(ry)
        x, z = x * cy + z * sy, -x * sy + z * cy
    if rz:
        cy, sy = math.cos(rz), math.sin(rz)
        x, y = x * cy - y * sy, x * sy + y * cy
    return (x, y, z)


def _box_mesh(
    size: tuple[float, float, float],
    pos: tuple[float, float, float],
    rot: tuple[float, float, float],
) -> tuple[list[float], list[float], list[int]]:
    sx, sy, sz = size[0] * 0.5, size[1] * 0.5, size[2] * 0.5
    corners = [
        (-sx, -sy, -sz),
        (sx, -sy, -sz),
        (sx, sy, -sz),
        (-sx, sy, -sz),
        (-sx, -sy, sz),
        (sx, -sy, sz),
        (sx, sy, sz),
        (-sx, sy, sz),
    ]
    faces = [
        (0, 1, 2, 3),  # -Z
        (4, 5, 6, 7),  # +Z
        (0, 4, 7, 3),  # -X
        (1, 2, 6, 5),  # +X
        (0, 1, 5, 4),  # -Y
        (3, 2, 6, 7),  # +Y
    ]
    normals = [
        (0, 0, -1),
        (0, 0, 1),
        (-1, 0, 0),
        (1, 0, 0),
        (0, -1, 0),
        (0, 1, 0),
    ]
    positions: list[float] = []
    norms: list[float] = []
    indices: list[int] = []
    for fi, (a, b, c, d) in enumerate(faces):
        base = len(positions) // 3
        n = normals[fi]
        nr = _rot_point(n, rot)
        for idx in (a, b, c, d):
            pr = _rot_point(corners[idx], rot)
            positions.extend([pr[0] + pos[0], pr[1] + pos[1], pr[2] + pos[2]])
            norms.extend(nr)
        indices.extend([base, base + 1, base + 2, base, base + 2, base + 3])
    return positions, norms, indices


def _cylinder_mesh(
    radius: float,
    height: float,
    pos: tuple[float, float, float],
    rot: tuple[float, float, float],
    radius2: float | None = None,
    segments: int = 12,
) -> tuple[list[float], list[float], list[int]]:
    r1 = max(0.01, float(radius))
    r2 = max(0.01, float(radius2 if radius2 is not None else radius))
    h = max(0.01, float(height))
    y0, y1 = -h * 0.5, h * 0.5
    positions: list[float] = []
    norms: list[float] = []
    indices: list[int] = []

    def add_vert(local: tuple[float, float, float], normal: tuple[float, float, float]) -> int:
        pr = _rot_point(local, rot)
        nr = _rot_point(normal, rot)
        # normalize nr
        length = math.sqrt(nr[0] ** 2 + nr[1] ** 2 + nr[2] ** 2) or 1.0
        nr = (nr[0] / length, nr[1] / length, nr[2] / length)
        idx = len(positions) // 3
        positions.extend([pr[0] + pos[0], pr[1] + pos[1], pr[2] + pos[2]])
        norms.extend(nr)
        return idx

    # Side
    ring0: list[int] = []
    ring1: list[int] = []
    for i in range(segments):
        ang = (i / segments) * math.tau
        c, s = math.cos(ang), math.sin(ang)
        ring0.append(add_vert((r1 * c, y0, r1 * s), (c, 0.0, s)))
        ring1.append(add_vert((r2 * c, y1, r2 * s), (c, 0.0, s)))
    for i in range(segments):
        a = ring0[i]
        b = ring0[(i + 1) % segments]
        c = ring1[(i + 1) % segments]
        d = ring1[i]
        indices.extend([a, b, c, a, c, d])

    # Caps
    bot = add_vert((0.0, y0, 0.0), (0.0, -1.0, 0.0))
    top = add_vert((0.0, y1, 0.0), (0.0, 1.0, 0.0))
    bot_ring = [add_vert((r1 * math.cos(i / segments * math.tau), y0, r1 * math.sin(i / segments * math.tau)), (0.0, -1.0, 0.0)) for i in range(segments)]
    top_ring = [add_vert((r2 * math.cos(i / segments * math.tau), y1, r2 * math.sin(i / segments * math.tau)), (0.0, 1.0, 0.0)) for i in range(segments)]
    for i in range(segments):
        indices.extend([bot, bot_ring[(i + 1) % segments], bot_ring[i]])
        indices.extend([top, top_ring[i], top_ring[(i + 1) % segments]])
    return positions, norms, indices


def _sphere_mesh(
    radius: float,
    pos: tuple[float, float, float],
    rot: tuple[float, float, float],
    scale: tuple[float, float, float] = (1.0, 1.0, 1.0),
    segments: int = 10,
    rings: int = 8,
) -> tuple[list[float], list[float], list[int]]:
    r = max(0.01, float(radius))
    sx, sy, sz = scale
    positions: list[float] = []
    norms: list[float] = []
    indices: list[int] = []
    grid: list[list[int]] = []

    for j in range(rings + 1):
        v = j / rings
        phi = v * math.pi
        row: list[int] = []
        for i in range(segments):
            u = i / segments
            theta = u * math.tau
            x = math.sin(phi) * math.cos(theta)
            y = math.cos(phi)
            z = math.sin(phi) * math.sin(theta)
            local = (x * r * sx, y * r * sy, z * r * sz)
            nlocal = (x / sx if sx else x, y / sy if sy else y, z / sz if sz else z)
            pr = _rot_point(local, rot)
            nr = _rot_point(nlocal, rot)
            length = math.sqrt(nr[0] ** 2 + nr[1] ** 2 + nr[2] ** 2) or 1.0
            nr = (nr[0] / length, nr[1] / length, nr[2] / length)
            idx = len(positions) // 3
            positions.extend([pr[0] + pos[0], pr[1] + pos[1], pr[2] + pos[2]])
            norms.extend(nr)
            row.append(idx)
        grid.append(row)

    for j in range(rings):
        for i in range(segments):
            a = grid[j][i]
            b = grid[j][(i + 1) % segments]
            c = grid[j + 1][(i + 1) % segments]
            d = grid[j + 1][i]
            if j != 0:
                indices.extend([a, b, c])
            if j != rings - 1:
                indices.extend([a, c, d])
    return positions, norms, indices


def _pack_f32(values: list[float]) -> bytes:
    return b"".join(struct.pack("<f", float(v)) for v in values)


def _pack_u16(values: list[int]) -> bytes:
    return b"".join(struct.pack("<H", int(v)) for v in values)


def _pad4(data: bytes) -> bytes:
    pad = (4 - (len(data) % 4)) % 4
    return data + (b"\x00" * pad)


def normalize_parts(raw_parts: Any, *, fallback_color: str = "#888888") -> list[dict]:
    """Clamp / sanitize an AI parts recipe into a safe list."""
    if not isinstance(raw_parts, list):
        return []
    out: list[dict] = []
    for row in raw_parts[:24]:
        if not isinstance(row, dict):
            continue
        shape = str(row.get("shape") or "box").strip().lower()
        if shape not in {"box", "cylinder", "sphere"}:
            shape = "box"
        color = str(row.get("color") or fallback_color).strip()
        if not color.startswith("#"):
            color = f"#{color}"
        if len(color) != 7:
            color = fallback_color

        def num_list(key: str, n: int, default: list[float]) -> list[float]:
            vals = row.get(key)
            if not isinstance(vals, (list, tuple)) or len(vals) < n:
                return list(default)
            try:
                return [float(vals[i]) for i in range(n)]
            except (TypeError, ValueError):
                return list(default)

        pos = num_list("pos", 3, [0, 0, 0])
        # Keep geometry near the attach origin so it stays on-character.
        pos = [max(-3.0, min(3.0, p)) for p in pos]
        # Keep degrees in the recipe (frontend + Blender-style). Convert only when meshing.
        rot_deg = num_list("rot", 3, [0, 0, 0])
        rot_deg = [max(-180.0, min(180.0, d)) for d in rot_deg]

        part: dict[str, Any] = {
            "shape": shape,
            "pos": pos,
            "rot": rot_deg,
            "color": color,
        }
        if shape == "box":
            size = num_list("size", 3, [0.4, 0.4, 0.4])
            part["size"] = [max(0.05, min(2.5, s)) for s in size]
        elif shape == "cylinder":
            try:
                radius = float(row.get("radius") if row.get("radius") is not None else 0.2)
            except (TypeError, ValueError):
                radius = 0.2
            try:
                height = float(row.get("height") if row.get("height") is not None else 0.4)
            except (TypeError, ValueError):
                height = 0.4
            part["radius"] = max(0.03, min(1.5, radius))
            part["height"] = max(0.05, min(3.0, height))
            if row.get("radius2") is not None:
                try:
                    part["radius2"] = max(0.03, min(1.5, float(row.get("radius2"))))
                except (TypeError, ValueError):
                    pass
        else:
            try:
                radius = float(row.get("radius") if row.get("radius") is not None else 0.25)
            except (TypeError, ValueError):
                radius = 0.25
            part["radius"] = max(0.05, min(1.5, radius))
            scale = num_list("scale", 3, [1, 1, 1])
            part["scale"] = [max(0.2, min(2.5, s)) for s in scale]
        out.append(part)
    return out


def fallback_parts(label: str, kind: str, color: str) -> list[dict]:
    """Curated Roblox-style recipes when the model returns nothing usable."""
    c = color or "#888888"
    accent = "#222222"
    kind = (kind or "prop").lower()
    low = f"{label or ''}".lower()

    if kind == "hat":
        return [
            {"shape": "cylinder", "radius": 0.55, "height": 0.08, "pos": [0, 0.04, 0], "rot": [0, 0, 0], "color": c},
            {"shape": "cylinder", "radius": 0.35, "height": 0.7, "pos": [0, 0.42, 0], "rot": [0, 0, 0], "color": c},
        ]
    if kind == "hair":
        return [
            {"shape": "box", "size": [1.02, 0.12, 1.02], "pos": [0, 0.06, 0], "rot": [0, 0, 0], "color": c},
            {"shape": "box", "size": [0.88, 0.36, 0.88], "pos": [0, 0.32, 0], "rot": [0, 0, 0], "color": c},
            {"shape": "box", "size": [0.12, 0.7, 0.08], "pos": [0, 0.95, 0.3], "rot": [20, 0, 0], "color": c},
            {"shape": "box", "size": [0.12, 0.55, 0.08], "pos": [-0.3, 0.85, 0.2], "rot": [12, 0, -25], "color": c},
            {"shape": "box", "size": [0.12, 0.55, 0.08], "pos": [0.3, 0.85, 0.2], "rot": [12, 0, 25], "color": c},
        ]
    if kind == "glasses":
        return [
            {"shape": "box", "size": [0.85, 0.22, 0.08], "pos": [0, 0, 0], "rot": [0, 0, 0], "color": accent},
            {"shape": "box", "size": [0.28, 0.18, 0.06], "pos": [-0.22, 0, 0.02], "rot": [0, 0, 0], "color": c},
            {"shape": "box", "size": [0.28, 0.18, 0.06], "pos": [0.22, 0, 0.02], "rot": [0, 0, 0], "color": c},
        ]
    if kind in {"backpack", "bag"}:
        return [
            {"shape": "box", "size": [0.9, 1.1, 0.45], "pos": [0, -0.2, -0.15], "rot": [0, 0, 0], "color": c},
            {"shape": "box", "size": [0.12, 0.9, 0.12], "pos": [-0.28, 0.15, 0.15], "rot": [0, 0, 0], "color": accent},
            {"shape": "box", "size": [0.12, 0.9, 0.12], "pos": [0.28, 0.15, 0.15], "rot": [0, 0, 0], "color": accent},
        ]
    if kind == "jersey":
        return [
            {"shape": "box", "size": [2.05, 2.05, 1.05], "pos": [0, 0, 0], "rot": [0, 0, 0], "color": c},
        ]
    if kind == "neck":
        return [
            {"shape": "cylinder", "radius": 0.55, "height": 0.08, "pos": [0, 0, 0.1], "rot": [90, 0, 0], "color": c},
            {"shape": "box", "size": [0.35, 0.7, 0.12], "pos": [0, -0.45, 0.25], "rot": [0, 0, 0], "color": c},
        ]

    fur = c if c.lower() not in {"#000000", "#111111", "#222222"} else "#d4a574"
    nose = "#ff8fab"
    eye = "#1a1a1a"

    if any(w in low for w in ("cat", "kitten", "kitty", "meow")):
        # Blocky sitting cat plush — boxes only (no spheres = no “beak ball”).
        return [
            {"shape": "box", "size": [0.7, 0.55, 0.55], "pos": [0, 0.28, 0.05], "rot": [0, 0, 0], "color": fur},
            {"shape": "box", "size": [0.48, 0.42, 0.45], "pos": [0, 0.72, 0.12], "rot": [0, 0, 0], "color": fur},
            {"shape": "box", "size": [0.16, 0.22, 0.1], "pos": [-0.16, 0.98, 0.05], "rot": [0, 0, -18], "color": fur},
            {"shape": "box", "size": [0.16, 0.22, 0.1], "pos": [0.16, 0.98, 0.05], "rot": [0, 0, 18], "color": fur},
            {"shape": "box", "size": [0.1, 0.1, 0.06], "pos": [-0.12, 0.74, 0.34], "rot": [0, 0, 0], "color": eye},
            {"shape": "box", "size": [0.1, 0.1, 0.06], "pos": [0.12, 0.74, 0.34], "rot": [0, 0, 0], "color": eye},
            {"shape": "box", "size": [0.1, 0.08, 0.08], "pos": [0, 0.64, 0.36], "rot": [0, 0, 0], "color": nose},
            {"shape": "box", "size": [0.18, 0.14, 0.55], "pos": [0.28, 0.22, -0.35], "rot": [0, 25, 0], "color": fur},
        ]
    if any(w in low for w in ("dog", "puppy", "pup")):
        return [
            {"shape": "box", "size": [0.75, 0.5, 0.55], "pos": [0, 0.28, 0.05], "rot": [0, 0, 0], "color": fur},
            {"shape": "box", "size": [0.42, 0.38, 0.45], "pos": [0, 0.62, 0.28], "rot": [0, 0, 0], "color": fur},
            {"shape": "box", "size": [0.14, 0.28, 0.08], "pos": [-0.22, 0.78, 0.2], "rot": [0, 0, -12], "color": fur},
            {"shape": "box", "size": [0.14, 0.28, 0.08], "pos": [0.22, 0.78, 0.2], "rot": [0, 0, 12], "color": fur},
            {"shape": "box", "size": [0.22, 0.16, 0.28], "pos": [0, 0.52, 0.48], "rot": [0, 0, 0], "color": fur},
            {"shape": "box", "size": [0.09, 0.09, 0.06], "pos": [-0.1, 0.66, 0.5], "rot": [0, 0, 0], "color": eye},
            {"shape": "box", "size": [0.09, 0.09, 0.06], "pos": [0.1, 0.66, 0.5], "rot": [0, 0, 0], "color": eye},
            {"shape": "box", "size": [0.16, 0.14, 0.5], "pos": [0.3, 0.25, -0.3], "rot": [0, 20, 0], "color": fur},
        ]
    if "boom" in low or "radio" in low or "speaker" in low:
        return [
            {"shape": "box", "size": [1.1, 0.65, 0.45], "pos": [0, 0.15, 0.15], "rot": [0, 0, 0], "color": c},
            {"shape": "cylinder", "radius": 0.22, "height": 0.08, "pos": [-0.28, 0.15, 0.38], "rot": [90, 0, 0], "color": accent},
            {"shape": "cylinder", "radius": 0.22, "height": 0.08, "pos": [0.28, 0.15, 0.38], "rot": [90, 0, 0], "color": accent},
            {"shape": "box", "size": [0.12, 0.45, 0.12], "pos": [0, 0.55, 0.05], "rot": [0, 0, 0], "color": accent},
        ]
    return [
        {"shape": "box", "size": [0.55, 0.55, 0.55], "pos": [0, 0.2, 0.15], "rot": [0, 0, 0], "color": c},
        {"shape": "box", "size": [0.25, 0.25, 0.25], "pos": [0, 0.55, 0.15], "rot": [0, 0, 0], "color": accent},
    ]


def parts_look_weak(parts: list[dict], label: str, user_prompt: str) -> bool:
    """Reject nonsense recipes (e.g. a sphere 'cat' with a beak-like cone)."""
    if not parts or len(parts) < 3:
        return True
    shapes = [str(p.get("shape") or "") for p in parts]
    boxes = shapes.count("box")
    spheres = shapes.count("sphere")
    cylinders = shapes.count("cylinder")
    blob = f"{label} {user_prompt}".lower()

    # Animals must read as stacked boxes, not a ball with a nose cone.
    if any(w in blob for w in ("cat", "kitten", "kitty", "dog", "puppy", "pup", "bear", "bunny", "rabbit")):
        if boxes < 4:
            return True
        if spheres >= boxes:
            return True
        # A lone forward cylinder on a spherey head = classic "beak" fail.
        if spheres >= 1 and cylinders >= 1 and boxes < 5:
            return True

    # Tiny / collapsed geometry
    span = 0.0
    for p in parts:
        pos = p.get("pos") or [0, 0, 0]
        span = max(span, abs(float(pos[0])), abs(float(pos[1])), abs(float(pos[2])))
        if p.get("shape") == "box":
            size = p.get("size") or [0, 0, 0]
            span = max(span, max(float(x) for x in size) * 0.5)
    if span < 0.25:
        return True
    return False


def build_blocky_glb(parts: list[dict]) -> bytes:
    """Compile sanitized parts into a binary GLB (Y-up)."""
    if not parts:
        parts = fallback_parts("Item", "prop", "#888888")

    all_pos: list[float] = []
    all_norm: list[float] = []
    all_idx: list[int] = []
    primitives: list[dict] = []
    materials: list[dict] = []
    color_to_mat: dict[str, int] = {}

    for part in parts:
        shape = part["shape"]
        pos = _v3(*part["pos"])
        color = part["color"]
        if color not in color_to_mat:
            color_to_mat[color] = len(materials)
            rgb = _hex_rgb(color)
            materials.append(
                {
                    "name": f"Mat_{len(materials)}",
                    "pbrMetallicRoughness": {
                        "baseColorFactor": [rgb[0], rgb[1], rgb[2], 1.0],
                        "metallicFactor": 0.05,
                        "roughnessFactor": 0.55,
                    },
                }
            )
        mat_i = color_to_mat[color]

        if shape == "cylinder":
            p, n, idx = _cylinder_mesh(
                part["radius"],
                part["height"],
                pos,
                _v3(*[math.radians(a) for a in part["rot"]]),
                radius2=part.get("radius2"),
            )
        elif shape == "sphere":
            p, n, idx = _sphere_mesh(
                part["radius"],
                pos,
                _v3(*[math.radians(a) for a in part["rot"]]),
                scale=tuple(part.get("scale") or [1, 1, 1]),  # type: ignore[arg-type]
            )
        else:
            p, n, idx = _box_mesh(
                tuple(part["size"]),  # type: ignore[arg-type]
                pos,
                _v3(*[math.radians(a) for a in part["rot"]]),
            )

        base = len(all_pos) // 3
        all_pos.extend(p)
        all_norm.extend(n)
        shifted = [i + base for i in idx]
        # Track per-primitive index range by slicing after build — easier: one mesh, multi material groups
        prim_start = len(all_idx)
        all_idx.extend(shifted)
        primitives.append(
            {
                "material": mat_i,
                "start": prim_start,
                "count": len(shifted),
            }
        )

    if not all_pos or not all_idx:
        raise ValueError("Blocky accessory produced empty geometry")

    # Build separate index buffers per material group for glTF multi-primitive mesh
    bin_chunks: list[bytes] = []
    buffer_views: list[dict] = []
    accessors: list[dict] = []

    def add_view(data: bytes, target: int | None = None) -> int:
        data = _pad4(data)
        offset = sum(len(c) for c in bin_chunks)
        bin_chunks.append(data)
        view: dict[str, Any] = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
        if target is not None:
            view["target"] = target
        buffer_views.append(view)
        return len(buffer_views) - 1

    pos_bytes = _pack_f32(all_pos)
    norm_bytes = _pack_f32(all_norm)
    pos_view = add_view(pos_bytes, 34962)
    norm_view = add_view(norm_bytes, 34962)

    xs = all_pos[0::3]
    ys = all_pos[1::3]
    zs = all_pos[2::3]
    pos_acc = len(accessors)
    accessors.append(
        {
            "bufferView": pos_view,
            "componentType": 5126,
            "count": len(all_pos) // 3,
            "type": "VEC3",
            "max": [max(xs), max(ys), max(zs)],
            "min": [min(xs), min(ys), min(zs)],
        }
    )
    norm_acc = len(accessors)
    accessors.append(
        {
            "bufferView": norm_view,
            "componentType": 5126,
            "count": len(all_norm) // 3,
            "type": "VEC3",
        }
    )

    mesh_primitives: list[dict] = []
    for prim in primitives:
        slice_idx = all_idx[prim["start"] : prim["start"] + prim["count"]]
        # Remap isn't needed — indices already global into shared position accessor
        idx_view = add_view(_pack_u16(slice_idx), 34963)
        idx_acc = len(accessors)
        accessors.append(
            {
                "bufferView": idx_view,
                "componentType": 5123,
                "count": len(slice_idx),
                "type": "SCALAR",
            }
        )
        mesh_primitives.append(
            {
                "attributes": {"POSITION": pos_acc, "NORMAL": norm_acc},
                "indices": idx_acc,
                "material": prim["material"],
            }
        )

    bin_blob = b"".join(bin_chunks)
    gltf = {
        "asset": {"version": "2.0", "generator": "ledgerlab-closet-blocky"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "ACCESSORY_Blocky"}],
        "meshes": [{"name": "BlockyAccessory", "primitives": mesh_primitives}],
        "materials": materials,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(bin_blob)}],
    }

    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_pad = (4 - (len(json_bytes) % 4)) % 4
    json_bytes = json_bytes + (b" " * json_pad)
    bin_blob = _pad4(bin_blob)

    total = 12 + 8 + len(json_bytes) + 8 + len(bin_blob)
    header = struct.pack("<4sII", b"glTF", 2, total)
    json_chunk = struct.pack("<I4s", len(json_bytes), b"JSON") + json_bytes
    bin_chunk = struct.pack("<I4s", len(bin_blob), b"BIN\x00") + bin_blob
    return header + json_chunk + bin_chunk
