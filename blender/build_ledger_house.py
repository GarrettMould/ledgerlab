"""
Ledger Lab classroom house — Blender Python builder.

Matches the app's low-poly Florida house look (warm walls, cone roof,
door + windows), with light bevels so it reads a bit richer than R3F boxes.

Run in Blender (GUI):
  Scripting → Open → this file → Run Script

Or headless:
  blender --background --python blender/build_ledger_house.py

Exports:
  public/models/house.glb
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Euler

# Resolve repo root whether run from Blender GUI or CLI
_SCRIPT = Path(__file__).resolve()
ROOT = _SCRIPT.parents[1]
OUT = ROOT / "public" / "models" / "house.glb"

# FL-MIA palette (same as HouseCharacter.jsx)
COLORS = {
    "walls": (0.969, 0.945, 0.910, 1.0),   # #f7f1e8
    "trim": (0.937, 0.902, 0.847, 1.0),    # #efe6d8
    "roof": (0.769, 0.361, 0.227, 1.0),    # #c45c3a
    "door": (0.055, 0.455, 0.565, 1.0),    # #0e7490
    "window": (0.843, 0.941, 0.961, 1.0),  # #d7f0f5
    "frame": (0.420, 0.357, 0.294, 1.0),   # #6b5b4b
    "knob": (0.769, 0.627, 0.208, 1.0),    # #c4a035
}


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.meshes:
        bpy.data.meshes.remove(block)
    for block in bpy.data.materials:
        bpy.data.materials.remove(block)


def mat(name: str, rgba: tuple[float, float, float, float], roughness: float = 0.62) -> bpy.types.Material:
    m = bpy.data.materials.new(name=name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = roughness
        if "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = 0.04
    return m


def y_up_pos(x: float, y: float, z: float) -> tuple[float, float, float]:
    """App Y-up (x,y,z) → Blender Z-up (x, -z, y)."""
    return (x, -z, y)


def y_up_size(sx: float, sy: float, sz: float) -> tuple[float, float, float]:
    """App box size (x,y,z) → Blender scale (x, z, y)."""
    return (sx, sz, sy)


def box(
    name: str,
    size_app: tuple[float, float, float],
    loc_app: tuple[float, float, float],
    material: bpy.types.Material,
    bevel: float = 0.012,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1, location=y_up_pos(*loc_app))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = y_up_size(*size_app)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        mod = obj.modifiers.new(name="Bevel", type="BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.data.materials.append(material)
    return obj


def sphere(
    name: str,
    radius: float,
    loc_app: tuple[float, float, float],
    material: bpy.types.Material,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=radius, location=y_up_pos(*loc_app), segments=16, ring_count=8
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(material)
    return obj


def roof_pyramid(material: bpy.types.Material, loc_app: tuple[float, float, float]) -> bpy.types.Object:
    # 4-sided cone ≈ square pyramid (same idea as coneGeometry in the app)
    bpy.ops.mesh.primitive_cone_add(
        vertices=4,
        radius1=0.98,
        depth=0.62,
        location=y_up_pos(*loc_app),
    )
    obj = bpy.context.active_object
    obj.name = "Roof"
    obj.rotation_euler = Euler((0, 0, math.pi / 4), "XYZ")
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    mod = obj.modifiers.new(name="Bevel", type="BEVEL")
    mod.width = 0.008
    mod.segments = 1
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.data.materials.append(material)
    return obj


def build_house() -> bpy.types.Object:
    mats = {
        k: mat(k.title(), v, 0.35 if k == "window" else (0.78 if k == "roof" else 0.62))
        for k, v in COLORS.items()
        if k != "knob"
    }
    mats["knob"] = mat("Knob", COLORS["knob"], 0.35)
    if mats["knob"].use_nodes:
        bsdf = mats["knob"].node_tree.nodes.get("Principled BSDF")
        if bsdf and "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = 0.4

    root = bpy.data.objects.new("LedgerHouse", None)
    bpy.context.collection.objects.link(root)
    root.location = y_up_pos(0, -0.55, 0)

    parts = [
        box("Foundation", (1.35, 0.12, 1.15), (0, 0.06, 0), mats["trim"], 0.02),
        box("Walls", (1.25, 1.05, 1.05), (0, 0.64, 0), mats["walls"], 0.018),
        box("Chimney", (0.18, 0.38, 0.18), (0.38, 1.55, -0.18), mats["frame"], 0.01),
        box("Door", (0.32, 0.58, 0.08), (0, 0.41, 0.54), mats["door"], 0.01),
        box("WindowL", (0.28, 0.28, 0.06), (-0.34, 0.78, 0.54), mats["window"], 0.006),
        box("WindowR", (0.28, 0.28, 0.06), (0.34, 0.78, 0.54), mats["window"], 0.006),
        box("MullionLH", (0.3, 0.04, 0.07), (-0.34, 0.78, 0.55), mats["frame"], 0.0),
        box("MullionLV", (0.04, 0.3, 0.07), (-0.34, 0.78, 0.55), mats["frame"], 0.0),
        box("MullionRH", (0.3, 0.04, 0.07), (0.34, 0.78, 0.55), mats["frame"], 0.0),
        box("MullionRV", (0.04, 0.3, 0.07), (0.34, 0.78, 0.55), mats["frame"], 0.0),
        box("SideWindow", (0.06, 0.26, 0.26), (0.63, 0.72, 0.1), mats["window"], 0.006),
        roof_pyramid(mats["roof"], (0, 1.42, 0)),
        sphere("Knob", 0.03, (0.1, 0.4, 0.59), mats["knob"]),
    ]

    for obj in parts:
        obj.parent = root
    return root


def export_glb(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    root = bpy.data.objects.get("LedgerHouse")
    if root is None:
        raise RuntimeError("LedgerHouse root missing")
    root.select_set(True)
    for child in root.children_recursive:
        child.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
    )


def main() -> None:
    clear_scene()
    build_house()
    export_glb(OUT)
    print(f"Exported {OUT}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
