"""
Roblox-style blocky character for Ledger Lab (Blender).

Run:
  blender --background --python blender/make_roblox_character.py

Exports:
  public/models/character.glb

Mesh names (recolored / toggled by the app closet):
  Head, Torso, Arm_L, Arm_R, Leg_L, Leg_R, Shoe_L, Shoe_R, Eye_L, Eye_R
  Hair_Block, Hair_Tall, Hair_Poof, Hair_Side, Hair_Buzz
"""

from __future__ import annotations

import sys
from pathlib import Path

import bpy

_SCRIPT = Path(__file__).resolve()
ROOT = _SCRIPT.parents[1]
OUT = ROOT / "public" / "models" / "character.glb"
BLEND_OUT = ROOT / "public" / "models" / "character.blend"

SKIN_COLOR = (0.878, 0.690, 0.565, 1.0)
HAIR_COLOR = (0.231, 0.165, 0.118, 1.0)
SHIRT_COLOR = (0.247, 0.561, 0.408, 1.0)
PANTS_COLOR = (0.122, 0.239, 0.188, 1.0)
SHOE_COLOR = (0.165, 0.141, 0.122, 1.0)
EYE_COLOR = (0.102, 0.180, 0.141, 1.0)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for coll in (
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for block in list(coll):
            coll.remove(block)


def make_material(name: str, color: tuple[float, float, float, float]):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = 0.65
        if "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = 0.25
        if "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = 0.0
    return mat


def add_box(name: str, size, location, material=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0], size[1], size[2])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.location = location
    if material:
        obj.data.materials.clear()
        obj.data.materials.append(material)
    return obj


def build_hair_styles(head_z_center: float, head_size, mat_hair):
    top = head_z_center + head_size[2] / 2
    styles = []

    h = 0.35
    styles.append(
        add_box("Hair_Block", (1.05, 1.05, h), (0, 0, top + h / 2 - 0.05), mat_hair)
    )

    h = 0.72
    styles.append(
        add_box("Hair_Tall", (0.95, 0.95, h), (0, 0.02, top + h / 2 - 0.04), mat_hair)
    )

    h = 0.42
    styles.append(
        add_box("Hair_Poof", (1.25, 1.2, h), (0, 0, top + h / 2 - 0.06), mat_hair)
    )

    h = 0.5
    styles.append(
        add_box(
            "Hair_Side", (0.7, 1.05, h), (0.28, 0.02, top + h / 2 - 0.05), mat_hair
        )
    )

    h = 0.12
    styles.append(
        add_box("Hair_Buzz", (1.02, 1.02, h), (0, 0, top + h / 2 - 0.02), mat_hair)
    )

    return styles


def build_character():
    clear_scene()

    mat_skin = make_material("Skin", SKIN_COLOR)
    mat_hair = make_material("Hair", HAIR_COLOR)
    mat_shirt = make_material("Shirt", SHIRT_COLOR)
    mat_pants = make_material("Pants", PANTS_COLOR)
    mat_shoe = make_material("Shoe", SHOE_COLOR)
    mat_eye = make_material("Eye", EYE_COLOR)

    head_size = (1.0, 1.0, 1.0)
    torso_size = (2.0, 1.0, 2.0)
    arm_size = (0.6, 0.6, 1.5)
    leg_size = (0.6, 0.6, 1.5)
    shoe_size = (0.65, 0.75, 0.3)

    leg_z_center = leg_size[2] / 2
    torso_z_center = leg_size[2] + torso_size[2] / 2
    head_z_center = leg_size[2] + torso_size[2] + head_size[2] / 2
    arm_z_center = leg_size[2] + torso_size[2] / 2

    torso_half_w = torso_size[0] / 2
    arm_half_w = arm_size[0] / 2
    leg_half_w = leg_size[0] / 2

    parts = [
        add_box("Leg_L", leg_size, (-leg_half_w, 0, leg_z_center), mat_pants),
        add_box("Leg_R", leg_size, (leg_half_w, 0, leg_z_center), mat_pants),
        add_box("Shoe_L", shoe_size, (-leg_half_w, 0.05, shoe_size[2] / 2), mat_shoe),
        add_box("Shoe_R", shoe_size, (leg_half_w, 0.05, shoe_size[2] / 2), mat_shoe),
        add_box("Torso", torso_size, (0, 0, torso_z_center), mat_shirt),
    ]

    arm_x = torso_half_w + arm_half_w
    parts.append(add_box("Arm_L", arm_size, (-arm_x, 0, arm_z_center), mat_skin))
    parts.append(add_box("Arm_R", arm_size, (arm_x, 0, arm_z_center), mat_skin))
    parts.append(add_box("Head", head_size, (0, 0, head_z_center), mat_skin))

    eye_z = head_z_center + 0.08
    eye_y = -head_size[1] / 2 - 0.01
    parts.append(add_box("Eye_L", (0.12, 0.05, 0.12), (-0.18, eye_y, eye_z), mat_eye))
    parts.append(add_box("Eye_R", (0.12, 0.05, 0.12), (0.18, eye_y, eye_z), mat_eye))
    parts.extend(build_hair_styles(head_z_center, head_size, mat_hair))

    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
    root = bpy.context.active_object
    root.name = "Character_Root"
    for obj in parts:
        obj.parent = root
    return root


def export_glb(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    root = bpy.data.objects.get("Character_Root")
    if root is None:
        raise RuntimeError("Character_Root missing")
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
    build_character()
    export_glb(OUT)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUT))
    (ROOT / "public" / "character.glb").write_bytes(OUT.read_bytes())
    print(f"Exported {OUT}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
