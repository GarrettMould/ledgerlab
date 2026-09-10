"""
AP... no wait — Character Accessory Pack generator for Blender.

Builds 12 blocky, Roblox-style accessories that match the character's
low-poly aesthetic. Each accessory is built with its LOCAL ORIGIN at its
correct attachment point, so it can be parented directly to the matching
body part on the character with no extra offset needed:

    TopHat, FootballHelmet, Headphones               -> parent to Head (sits at head-top)
    Sunglasses                                       -> parent to Head (sits at eye height)
    GoldChain, Scarf                                 -> parent to Torso (hangs from neck)
    SportsJersey                                     -> parent to Torso (replaces/overlays it)
    Backpack                                         -> parent to Torso back
    Purse                                            -> parent to Torso/shoulder (strap hangs down)
    BaseballBat                                      -> parent to Arm/hand (grip at origin)

Run: blender --background --python build_accessories.py
Produces accessories_master.blend with every accessory in its own
named collection, laid out in a grid for easy viewing.
"""

import bpy
import math

# =========================================================
# Helpers (same pattern as the character generator)
# =========================================================

def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block_collection in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for block in list(block_collection):
            if block.users == 0:
                block_collection.remove(block)


_materials = {}

def mat(name, color, roughness=0.55, metallic=0.0):
    key = (name, color, roughness, metallic)
    if key in _materials:
        return _materials[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = metallic
    _materials[key] = m
    return m


def box(name, size, location, material=None, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0], size[1], size[2])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.location = location
    obj.rotation_euler = rotation
    if material:
        obj.data.materials.append(material)
    return obj


def cylinder(name, radius, depth, location, rotation=(0, 0, 0), material=None, radius2=None):
    bpy.ops.mesh.primitive_cone_add(
        radius1=radius, radius2=radius2 if radius2 is not None else radius,
        depth=depth, location=location, rotation=rotation
    )
    obj = bpy.context.active_object
    obj.name = name
    if material:
        obj.data.materials.append(material)
    return obj


def sphere(name, radius, location, material=None, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=location, segments=16, ring_count=10)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.location = location
    if material:
        obj.data.materials.append(material)
    return obj


def torus(name, major_r, minor_r, location, rotation=(0, 0, 0), material=None):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_r, minor_radius=minor_r,
        location=location, rotation=rotation,
        major_segments=24, minor_segments=10
    )
    obj = bpy.context.active_object
    obj.name = name
    if material:
        obj.data.materials.append(material)
    return obj


def new_collection(name):
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    return coll


def move_new_objects_to(coll, objs):
    for o in objs:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)


def make_accessory(name, grid_pos, build_fn):
    """Builds one accessory: objects are created at their real local
    attachment coordinates (as if the character is at world origin),
    then parented under an empty. The empty is moved to grid_pos only
    for this overview file, so everything is visible side by side.
    Resetting the empty's location back to (0,0,0) restores the correct
    attachment-ready local coordinates."""
    before = set(bpy.data.objects)
    objs = build_fn()
    after = set(bpy.data.objects) - before

    empty = bpy.data.objects.new(f"ACCESSORY_{name}", None)
    empty.empty_display_type = 'PLAIN_AXES'
    empty.empty_display_size = 0.2
    bpy.context.scene.collection.objects.link(empty)

    coll = new_collection(name)
    coll.objects.link(empty)
    for o in objs:
        o.parent = empty
        move_new_objects_to(coll, [o])

    empty.location = grid_pos
    return coll


# =========================================================
# Accessory builders — each returns a list of mesh objects
# built at their correct LOCAL attachment-relative coordinates
# =========================================================

def build_top_hat():
    """Top hat. Attach to Head; bottom brim sits at head-top (z=0 local)."""
    black = mat("Hat_Black", (0.03, 0.03, 0.03, 1.0))
    band = mat("Hat_Band", (0.55, 0.05, 0.08, 1.0))
    return [
        cylinder("TopHat_Brim", 0.62, 0.06, (0, 0, 0.03), material=black),
        cylinder("TopHat_Body", 0.42, 0.85, (0, 0, 0.48), material=black),
        cylinder("TopHat_Band", 0.425, 0.12, (0, 0, 0.15), material=band),
    ]


def build_football_helmet():
    """Football helmet that wraps the whole head with a cage over the face.

    Local origin = head-top attach. -Y is face-forward (matches other hats).
    Shell hangs down over the skull; cheek + chin pieces and facemask stick
    out in front of the face instead of sitting on the crown.
    """
    shell = mat("Helmet_Shell", (0.63, 0.09, 0.11, 1.0))
    stripe = mat("Helmet_Stripe", (0.93, 0.93, 0.90, 1.0))
    grey = mat("Facemask_Grey", (0.78, 0.79, 0.82, 1.0), roughness=0.28, metallic=0.7)
    objs = []

    # Main shell centered on the head (below attach), slightly longer front-to-back
    objs.append(
        sphere(
            "Helmet_Dome",
            0.70,
            (0, 0.06, -0.32),
            shell,
            scale=(1.08, 1.22, 1.12),
        )
    )
    # Center stripe
    objs.append(box("Helmet_Stripe", (0.16, 1.15, 0.55), (0, 0.02, 0.05), stripe))

    # Brow / forehead lip that pushes forward over the eyes
    objs.append(box("Helmet_Brow", (1.2, 0.42, 0.22), (0, -0.58, -0.08), shell))

    # Cheek guards that come forward beside the face
    objs.append(box("Helmet_Cheek_L", (0.28, 0.62, 0.62), (-0.52, -0.42, -0.48), shell))
    objs.append(box("Helmet_Cheek_R", (0.28, 0.62, 0.62), (0.52, -0.42, -0.48), shell))

    # Chin piece under the face
    objs.append(box("Helmet_Chin", (0.78, 0.42, 0.2), (0, -0.52, -0.92), shell))

    # Facemask cage — well in front of the face (-Y)
    face_y = -0.98
    for i, z in enumerate([-0.12, -0.32, -0.52, -0.72, -0.88]):
        objs.append(
            cylinder(
                f"Facemask_H_{i}",
                0.04,
                1.05,
                (0, face_y, z),
                rotation=(0, math.radians(90), 0),
                material=grey,
            )
        )
    for i, x in enumerate([-0.35, -0.12, 0.12, 0.35]):
        objs.append(
            cylinder(
                f"Facemask_V_{i}",
                0.038,
                0.85,
                (x, face_y, -0.48),
                rotation=(math.radians(90), 0, 0),
                material=grey,
            )
        )
    # Side rails connecting cage to shell
    objs.append(
        cylinder(
            "Facemask_Rail_L",
            0.035,
            0.55,
            (-0.48, -0.72, -0.35),
            rotation=(math.radians(90), 0, math.radians(28)),
            material=grey,
        )
    )
    objs.append(
        cylinder(
            "Facemask_Rail_R",
            0.035,
            0.55,
            (0.48, -0.72, -0.35),
            rotation=(math.radians(90), 0, math.radians(-28)),
            material=grey,
        )
    )
    return objs


def build_headphones():
    """Over-ear headphones. Attach to Head; band arches over top (z=0 = head-top)."""
    black = mat("Headphones_Black", (0.04, 0.04, 0.05, 1.0))
    accent = mat("Headphones_Accent", (0.85, 0.25, 0.1, 1.0))
    objs = [torus("Headphones_Band", 0.60, 0.045, (0, 0, 0.15),
                  rotation=(math.radians(90), 0, 0), material=black)]
    objs.append(cylinder("Cup_L", 0.24, 0.16, (-0.62, 0, 0.02), rotation=(0, math.radians(90), 0), material=black))
    objs.append(cylinder("Cup_R", 0.24, 0.16, (0.62, 0, 0.02), rotation=(0, math.radians(90), 0), material=black))
    objs.append(cylinder("Cup_L_Accent", 0.10, 0.03, (-0.70, 0, 0.02), rotation=(0, math.radians(90), 0), material=accent))
    objs.append(cylinder("Cup_R_Accent", 0.10, 0.03, (0.70, 0, 0.02), rotation=(0, math.radians(90), 0), material=accent))
    return objs


def build_sunglasses():
    """Sunglasses. Attach to Head at eye height (z=0 local = eye line)."""
    black = mat("Glasses_Black", (0.03, 0.03, 0.03, 1.0))
    lens = mat("Glasses_Lens", (0.05, 0.08, 0.10, 1.0), roughness=0.15)
    return [
        box("Lens_L", (0.28, 0.03, 0.20), (-0.20, 0, 0), lens),
        box("Lens_R", (0.28, 0.03, 0.20), (0.20, 0, 0), lens),
        box("Bridge", (0.10, 0.03, 0.05), (0, 0, 0.02), black),
        box("Arm_L", (0.32, 0.03, 0.03), (-0.50, 0.16, 0), black),
        box("Arm_R", (0.32, 0.03, 0.03), (0.50, 0.16, 0), black),
    ]


def build_gold_chain():
    """Necklace. Attach to Torso at neck (z=0 local = neck base); hangs down."""
    gold = mat("Gold", (0.83, 0.68, 0.21, 1.0), roughness=0.25, metallic=0.85)
    objs = [torus("Chain_Loop", 0.42, 0.045, (0, 0.05, -0.1), rotation=(math.radians(80), 0, 0), material=gold)]
    objs.append(box("Pendant", (0.14, 0.05, 0.18), (0, 0.15, -0.42), gold, rotation=(math.radians(20), 0, 0)))
    return objs


def build_scarf():
    """Scarf. Attach to Torso at neck (z=0 local = neck base); drapes down front."""
    red = mat("Scarf_Red", (0.62, 0.10, 0.12, 1.0))
    return [
        cylinder("Scarf_Neck", 0.55, 0.30, (0, 0, -0.05), material=red),
        box("Scarf_Drape", (0.32, 0.10, 0.9), (0, 0.30, -0.55), red),
    ]


def build_sports_jersey():
    """Sports jersey. Attach to Torso, replacing/overlaying it (z=0 local = torso center)."""
    orange = mat("Jersey_Orange", (0.85, 0.42, 0.08, 1.0))
    white = mat("Jersey_White", (0.93, 0.93, 0.90, 1.0))
    objs = [box("Jersey_Body", (2.05, 1.05, 2.05), (0, 0, 0), orange)]
    objs.append(box("Jersey_Stripe_L", (0.18, 1.06, 2.05), (-0.9, 0, 0), white))
    objs.append(box("Jersey_Stripe_R", (0.18, 1.06, 2.05), (0.9, 0, 0), white))
    # number "7" made from simple stacked bars (stays low-poly, no font dependency)
    bar = white
    objs.append(box("Num_Top", (0.4, 0.03, 0.08), (0, -0.54, 0.35), bar))
    objs.append(box("Num_Diag", (0.10, 0.03, 0.55), (0.12, -0.54, 0.02), bar, rotation=(0, math.radians(18), 0)))
    return objs


def build_backpack():
    """Backpack. Attach to Torso back (z=0 local = torso center, sits behind)."""
    green = mat("Backpack_Green", (0.14, 0.35, 0.20, 1.0))
    strap = mat("Backpack_Strap", (0.08, 0.08, 0.08, 1.0))
    objs = [box("Backpack_Body", (1.3, 0.5, 1.5), (0, 0, 0), green)]
    objs.append(box("Backpack_Pocket", (0.9, 0.15, 0.6), (0, -0.32, -0.3), green))
    objs.append(box("Strap_L", (0.16, 0.55, 1.3), (-0.45, 0.35, 0.1), strap, rotation=(math.radians(8), 0, 0)))
    objs.append(box("Strap_R", (0.16, 0.55, 1.3), (0.45, 0.35, 0.1), strap, rotation=(math.radians(8), 0, 0)))
    return objs


def build_purse():
    """Purse. Attach to Torso/shoulder; strap loop sits at z=0 (shoulder), bag hangs below."""
    tan = mat("Purse_Tan", (0.62, 0.42, 0.24, 1.0))
    gold = mat("Purse_Hardware", (0.83, 0.68, 0.21, 1.0), roughness=0.25, metallic=0.8)
    objs = [torus("Purse_Strap", 0.55, 0.03, (0, 0, -0.4), rotation=(0, math.radians(90), 0), material=tan)]
    objs.append(box("Purse_Body", (0.7, 0.35, 0.55), (0, 0, -1.15), tan))
    objs.append(box("Purse_Flap", (0.72, 0.08, 0.30), (0, -0.19, -0.95), tan))
    objs.append(box("Purse_Clasp", (0.12, 0.05, 0.08), (0, -0.23, -0.95), gold))
    return objs


def build_baseball_bat():
    """Baseball bat. Attach to Hand; grip end is at z=0 local, bat extends in +Z."""
    wood = mat("Bat_Wood", (0.72, 0.52, 0.28, 1.0))
    grip = mat("Bat_Grip", (0.10, 0.10, 0.10, 1.0))
    objs = [cylinder("Bat_Grip", 0.06, 0.35, (0, 0, 0.175), material=grip)]
    objs.append(cylinder("Bat_Handle", 0.06, 0.9, (0, 0, 0.80), radius2=0.09, material=wood))
    objs.append(cylinder("Bat_Barrel", 0.09, 0.85, (0, 0, 1.65), radius2=0.16, material=wood))
    objs.append(cylinder("Bat_Cap", 0.16, 0.04, (0, 0, 2.09), material=wood))
    return objs


# =========================================================
# Build all + lay out in a grid + save
# =========================================================

def build_all():
    clear_scene()

    accessories = [
        ("TopHat", build_top_hat),
        ("FootballHelmet", build_football_helmet),
        ("Headphones", build_headphones),
        ("Sunglasses", build_sunglasses),
        ("GoldChain", build_gold_chain),
        ("Scarf", build_scarf),
        ("SportsJersey", build_sports_jersey),
        ("Backpack", build_backpack),
        ("Purse", build_purse),
        ("BaseballBat", build_baseball_bat),
    ]

    cols = 4
    spacing = 3.0
    for i, (name, fn) in enumerate(accessories):
        row = i // cols
        col = i % cols
        grid_pos = (col * spacing, -row * spacing, 0.0)
        make_accessory(name, grid_pos, fn)

    # Camera + lights for an overview render
    grid_center = ((cols - 1) * spacing / 2, -((len(accessories) - 1) // cols) * spacing / 2, 0.3)
    bpy.ops.object.camera_add(location=(grid_center[0] + 13, grid_center[1] - 13, 6.5))
    cam = bpy.context.active_object
    cam.data.lens = 32
    bpy.context.scene.camera = cam
    target = bpy.data.objects.new("CamTarget", None)
    target.location = grid_center
    bpy.context.collection.objects.link(target)
    tr = cam.constraints.new(type='TRACK_TO')
    tr.target = target
    tr.track_axis = 'TRACK_NEGATIVE_Z'
    tr.up_axis = 'UP_Y'

    bpy.ops.object.light_add(type='SUN', location=(5, -5, 12))
    bpy.context.active_object.data.energy = 2.0
    bpy.ops.object.light_add(type='SUN', location=(-5, 5, 8))
    bpy.context.active_object.data.energy = 1.0

    bpy.context.scene.view_settings.view_transform = 'Standard'

    bpy.ops.wm.save_as_mainfile(filepath="/home/claude/accessories/accessories_master.blend")
    print("Saved accessories_master.blend with", len(accessories), "accessories")


build_all()
