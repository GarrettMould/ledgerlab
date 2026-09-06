# Blender assets (Ledger Lab)

## Student character (preferred)

Same blocky student as `StudentCharacter.jsx`, with bevels. Mesh names (`Shirt`, `PantsL`, `Hair`, `ArmR`, …) let the app recolor from the closet.

```bash
blender --background --python blender/build_ledger_character.py
```

Output: `public/models/character.glb`  
The app uses it automatically when present; otherwise it falls back to the procedural avatar.

## House (optional)

```bash
blender --background --python blender/build_ledger_house.py
```

Output: `public/models/house.glb` (not wired into the UI by default anymore).
