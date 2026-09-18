"""Build a tiny textured-quad GLB from a PNG (no Meshy / no Blender)."""

from __future__ import annotations

import json
import struct


def build_billboard_glb(png_bytes: bytes, *, size: float = 1.0) -> bytes:
    """
    Single double-sided quad with the PNG as baseColorTexture.
    Origin at center; +Z faces the camera-ish front for hand/hat props.
    """
    if not png_bytes.startswith(b"\x89PNG"):
        raise ValueError("Expected a PNG image for the closet GLB")

    half = float(size) * 0.5
    # 4 corners: BL, BR, TR, TL (Y-up)
    positions = [
        -half,
        -half,
        0.0,
        half,
        -half,
        0.0,
        half,
        half,
        0.0,
        -half,
        half,
        0.0,
    ]
    uvs = [
        0.0,
        1.0,
        1.0,
        1.0,
        1.0,
        0.0,
        0.0,
        0.0,
    ]
    indices = [0, 1, 2, 0, 2, 3]

    pos_bytes = b"".join(struct.pack("<f", v) for v in positions)
    uv_bytes = b"".join(struct.pack("<f", v) for v in uvs)
    idx_bytes = b"".join(struct.pack("<H", i) for i in indices)
    # Pad to 4-byte alignment before image
    pad1 = (4 - (len(idx_bytes) % 4)) % 4
    idx_bytes_padded = idx_bytes + (b"\x00" * pad1)

    bin_blob = pos_bytes + uv_bytes + idx_bytes_padded + png_bytes
    pad2 = (4 - (len(bin_blob) % 4)) % 4
    bin_blob = bin_blob + (b"\x00" * pad2)

    pos_view = 0
    uv_view = len(pos_bytes)
    idx_view = uv_view + len(uv_bytes)
    img_view = idx_view + len(idx_bytes_padded)

    gltf = {
        "asset": {"version": "2.0", "generator": "ledgerlab-closet-sprite"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "ClosetSprite"}],
        "meshes": [
            {
                "name": "Billboard",
                "primitives": [
                    {
                        "attributes": {"POSITION": 0, "TEXCOORD_0": 1},
                        "indices": 2,
                        "material": 0,
                    }
                ],
            }
        ],
        "materials": [
            {
                "name": "SpriteMat",
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": 0},
                    "metallicFactor": 0.0,
                    "roughnessFactor": 1.0,
                },
                "alphaMode": "BLEND",
                "doubleSided": True,
            }
        ],
        "textures": [{"source": 0}],
        "images": [{"mimeType": "image/png", "bufferView": 3}],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": 4,
                "type": "VEC3",
                "max": [half, half, 0.0],
                "min": [-half, -half, 0.0],
            },
            {
                "bufferView": 1,
                "componentType": 5126,
                "count": 4,
                "type": "VEC2",
            },
            {
                "bufferView": 2,
                "componentType": 5123,
                "count": 6,
                "type": "SCALAR",
            },
        ],
        "bufferViews": [
            {
                "buffer": 0,
                "byteOffset": pos_view,
                "byteLength": len(pos_bytes),
                "target": 34962,
            },
            {
                "buffer": 0,
                "byteOffset": uv_view,
                "byteLength": len(uv_bytes),
                "target": 34962,
            },
            {
                "buffer": 0,
                "byteOffset": idx_view,
                "byteLength": len(idx_bytes),
                "target": 34963,
            },
            {
                "buffer": 0,
                "byteOffset": img_view,
                "byteLength": len(png_bytes),
            },
        ],
        "buffers": [{"byteLength": len(bin_blob)}],
    }

    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_pad = (4 - (len(json_bytes) % 4)) % 4
    json_bytes = json_bytes + (b" " * json_pad)

    total = 12 + 8 + len(json_bytes) + 8 + len(bin_blob)
    header = struct.pack("<4sII", b"glTF", 2, total)
    json_chunk = struct.pack("<I4s", len(json_bytes), b"JSON") + json_bytes
    bin_chunk = struct.pack("<I4s", len(bin_blob), b"BIN\x00") + bin_blob
    return header + json_chunk + bin_chunk
