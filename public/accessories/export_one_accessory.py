"""Export a single accessory GLB (FootballHelmet by default).

Run from repo root:
  blender --background --python public/accessories/export_one_accessory.py
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

spec = importlib.util.spec_from_file_location("build_accessories", ROOT / "build_accessories.py")
mod = importlib.util.module_from_spec(spec)
# Avoid running build_all() on import — load source without executing trailing call.
src = (ROOT / "build_accessories.py").read_text()
src = src.replace("\nbuild_all()\n", "\n")
exec(compile(src, str(ROOT / "build_accessories.py"), "exec"), mod.__dict__)

NAME = "FootballHelmet"
OUT = ROOT / f"{NAME}.glb"


def main():
    mod.clear_scene()
    objs = mod.build_football_helmet()
    empty = bpy.data.objects.new(f"ACCESSORY_{NAME}", None)
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
        filepath=str(OUT),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
    )
    print(f"Wrote {OUT}")


main()
