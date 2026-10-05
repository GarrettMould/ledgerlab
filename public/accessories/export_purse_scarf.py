"""Rebuild and export Purse.glb + Scarf.glb from build_accessories.py.

Run from repo root:
  blender --background --python public/accessories/export_purse_scarf.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

src = (ROOT / "build_accessories.py").read_text()
src = src.replace("\nbuild_all()\n", "\n")
ns = {}
exec(compile(src, str(ROOT / "build_accessories.py"), "exec"), ns)


def export_one(name: str, build_fn, out_path: Path):
    ns["clear_scene"]()
    objs = build_fn()
    empty = bpy.data.objects.new(f"ACCESSORY_{name}", None)
    empty.empty_display_type = "PLAIN_AXES"
    bpy.context.scene.collection.objects.link(empty)
    for o in objs:
        o.parent = empty
    empty.location = (0.0, 0.0, 0.0)

    bpy.ops.object.select_all(action="DESELECT")
    empty.select_set(True)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = empty

    bpy.ops.export_scene.gltf(
        filepath=str(out_path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
    )
    print(f"Wrote {out_path}")


def main():
    export_one("Purse", ns["build_purse"], ROOT / "Purse.glb")
    export_one("Scarf", ns["build_scarf"], ROOT / "Scarf.glb")


main()
