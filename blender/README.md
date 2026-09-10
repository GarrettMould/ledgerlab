# Blender assets (Ledger Lab)

## Student character (Roblox-style)

Blocky R6-style figure used in the closet / student home.

```bash
blender --background --python blender/make_roblox_character.py
```

Outputs:
- `public/models/character.glb` (loaded by the app)
- `public/models/character.blend`
- `public/character.glb` (copy)

**Hair styles** are separate meshes; the app shows one at a time (bald = none):
`Hair_Block`, `Hair_Tall`, `Hair_Poof`, `Hair_Side`, `Hair_Buzz`.

To add a new cut: model another `Hair_*` mesh in the Blender script, re-export the GLB, and add an entry to `CLOSET_CATALOG.hairStyle` in `src/StudentCharacter.jsx`.

Other recolorable parts: `Torso`, `Leg_L` / `Leg_R`, `Shoe_L` / `Shoe_R`, `Head`, `Arm_L` / `Arm_R`, `Eye_L` / `Eye_R`.

## House (optional)

```bash
blender --background --python blender/build_ledger_house.py
```
