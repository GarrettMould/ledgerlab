"""
Ledger Lab student character — Blender Python builder.

Same low-poly blocky look as StudentCharacter.jsx, with light bevels.
Meshes are named so the app can recolor from the closet (Shirt, Pants*, Skin*, Hair, …).

Run:
  blender --background --python blender/build_ledger_character.py

Exports:
  public/models/character.glb
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Euler

_SCRIPT = Path(__file__).resolve()
ROOT = _SCRIPT.parents[1]
OUT = ROOT / "public" / "models" / "character.glb"

# Default outfit (Forest tee) — app overrides colors at runtime
COLORS = {
    "skin": (0.878, 0.690, 0.565, 1.0),   # #e0b090
    "hair": (0.231, 0.165, 0.118, 1.0),   # #3b2a1e
    "shirt": (0.247, 0.561, 0.408, 1.0),  # #3f8f68
    "pants": (0.122, 0.239, 0.188, 1.0),  # #1f3d30
    "shoes": (0.165, 0.141, 0.122, 1.0),  # #2a241f
    "eyes": (0.102, 0.180, 0.141, 1.0),   # #1a2e24
    "smile": (0.722, 0.420, 0.353, 1.0),  # #b86b5a
}


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)


def mat(name: str, rgba: tuple[float, float, float, float], roughness: float = 0.55) -> bpy.types.Material:
    m = bpy.data.materials.new(name=name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = roughness
        if "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = 0.05
    return m


def y_up_pos(x: float, y: float, z: float) -> tuple[float, float, float]:
    return (x, -z, y)


def y_up_size(sx: float, sy: float, sz: float) -> tuple[float, float, float]:
    return (sx, sz, sy)


def box(
    name: str,
    size_app: tuple[float, float, float],
    loc_app: tuple[float, float, float],
    material: bpy.types.Material,
    *,
    rot_z: float = 0.0,
    bevel: float = 0.014,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1, location=y_up_pos(*loc_app))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = y_up_size(*size_app)
    if rot_z:
        obj.rotation_euler = Euler((0, 0, rot_z), "XYZ")
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel > 0:
        mod = obj.modifiers.new(name="Bevel", type="BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.data.materials.append(material)
    if parent is not None:
        obj.parent = parent
    return obj


def shade_smooth(obj: bpy.types.Object) -> None:
    mesh = getattr(obj, "data", None)
    if mesh is None or not hasattr(mesh, "polygons"):
        return
    for poly in mesh.polygons:
        poly.use_smooth = True


def sphere(
    name: str,
    radius: float,
    loc_app: tuple[float, float, float],
    material: bpy.types.Material,
    *,
    segments: int = 48,
    ring_count: int = 32,
    parent: bpy.types.Object | None = None,
    smooth: bool = True,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=radius,
        location=y_up_pos(*loc_app),
        segments=segments,
        ring_count=ring_count,
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(material)
    if smooth:
        shade_smooth(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def hair_cap(material: bpy.types.Material, parent: bpy.types.Object) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=0.3,
        location=y_up_pos(0, 1.78, -0.02),
        segments=40,
        ring_count=24,
    )
    obj = bpy.context.active_object
    obj.name = "Hair"
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    mesh = obj.data
    for v in mesh.vertices:
        world_z = (obj.matrix_world @ v.co).z
        center_z = obj.location.z
        v.select = world_z < center_z - 0.02
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="VERT")
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.data.materials.append(material)
    shade_smooth(obj)
    obj.parent = parent
    return obj


def smile_arc(material: bpy.types.Material, parent: bpy.types.Object) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.08,
        minor_radius=0.015,
        major_segments=16,
        minor_segments=8,
        location=y_up_pos(0, 1.48, 0.3),
    )
    obj = bpy.context.active_object
    obj.name = "Smile"
    # App: rotation.x = 0.2; torus arc = half via geometry — cut bottom
    obj.rotation_euler = Euler((0.2, 0, 0), "XYZ")
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for v in obj.data.vertices:
        # Keep lower front smile arc (approx half torus)
        local = v.co
        v.select = local.z > 0.01
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="VERT")
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.data.materials.append(material)
    obj.parent = parent
    return obj


def empty(name: str, loc_app: tuple[float, float, float], parent: bpy.types.Object | None = None) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.08
    obj.location = y_up_pos(*loc_app)
    if parent is not None:
        obj.parent = parent
    return obj


def build_character() -> bpy.types.Object:
    mats = {
        "skin": mat("Skin", COLORS["skin"], 0.78),
        "hair": mat("Hair", COLORS["hair"], 0.92),
        "shirt": mat("Shirt", COLORS["shirt"], 0.55),
        "pants": mat("Pants", COLORS["pants"], 0.55),
        "shoes": mat("Shoes", COLORS["shoes"], 0.55),
        "eyes": mat("Eyes", COLORS["eyes"], 0.45),
        "smile": mat("Smile", COLORS["smile"], 0.55),
    }

    root = empty("LedgerCharacter", (0, 0, 0))
    # Match AVATAR_BASE_Y applied in the app separately — export at local origin.

    box("PantsL", (0.28, 0.55, 0.28), (-0.18, 0.35, 0), mats["pants"], parent=root)
    box("PantsR", (0.28, 0.55, 0.28), (0.18, 0.35, 0), mats["pants"], parent=root)
    box("ShoesL", (0.32, 0.14, 0.4), (-0.18, 0.05, 0.04), mats["shoes"], bevel=0.01, parent=root)
    box("ShoesR", (0.32, 0.14, 0.4), (0.18, 0.05, 0.04), mats["shoes"], bevel=0.01, parent=root)
    box("Shirt", (0.7, 0.75, 0.42), (0, 0.95, 0), mats["shirt"], bevel=0.02, parent=root)

    # Arms tucked into the shirt shoulders (was ~0.48 — looked floating).
    # Shirt half-width is 0.35; arm half-width 0.11 → center ~0.38 overlaps body.
    box(
        "ArmL",
        (0.22, 0.62, 0.22),
        (-0.38, 0.95, 0),
        mats["skin"],
        rot_z=0.12,
        bevel=0.008,
        parent=root,
    )

    arm_r_pivot = empty("ArmR", (0.38, 1.22, 0), parent=root)
    box(
        "ArmRLimb",
        (0.22, 0.62, 0.22),
        (0.38, 0.95, 0),
        mats["skin"],
        rot_z=-0.12,
        bevel=0.008,
        parent=arm_r_pivot,
    )

    sphere(
        "Head",
        0.34,
        (0, 1.58, 0),
        mats["skin"],
        segments=48,
        ring_count=32,
        parent=root,
    )
    hair_cap(mats["hair"], root)
    sphere(
        "EyeL",
        0.045,
        (-0.1, 1.6, 0.3),
        mats["eyes"],
        segments=20,
        ring_count=12,
        parent=root,
    )
    sphere(
        "EyeR",
        0.045,
        (0.1, 1.6, 0.3),
        mats["eyes"],
        segments=20,
        ring_count=12,
        parent=root,
    )
    smile_arc(mats["smile"], root)

    return root


def export_glb(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    root = bpy.data.objects.get("LedgerCharacter")
    if root is None:
        raise RuntimeError("LedgerCharacter missing")
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
    build_character()
    export_glb(OUT)
    print(f"Exported {OUT}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
