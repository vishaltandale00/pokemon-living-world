# Tile tooling

Scripts used to build and iterate on `public/tiles/atlas.png` (real FireRed
metatiles decoded from pret/pokefirered). Run with a python3 that has Pillow
(`pip install pillow`); `build_atlas.py` is pure-stdlib.

- `build_atlas.py` — decodes pret tileset data (tiles.png + NN.pal +
  metatiles.bin) into a metatile atlas PNG. Expects inputs in `/tmp/frtiles`
  (primary = General tileset) and `/tmp/frtiles/sec` (secondary = ViridianCity).
  Atlas layout: 16 metatiles per row, 16x16 px each, so PNG frame index ==
  metatile id. Primary ids 0–639, secondary 640–735.
- `label_sheets.py` — renders the atlas as upscaled contact sheets with the
  numeric id printed above every tile (for picking tile ids by eye).
- `preview.py` — offline renderer for the game's maps: mirrors the logic in
  `src/game/frlgTiles.ts` + `src/game/maps.ts` (layout chars, autotiling,
  building templates) and renders PNGs. Iterate here before touching the TS.
- `build_interiors.py` — renders real FRLG **interior** maps (Building primary
  tileset + a per-type secondary: pokemon_center / mart / generic_building_1 /
  lab / pewter_gym / viridian_gym) to `public/interiors/*.png`, and extracts
  per-tile collision from the map block bits (`collision = (v>>10)&3`). Writes
  `public/interiors/manifest.json` ({w,h,collision}). The split is
  NUM_METATILES_IN_PRIMARY = 640 (NOT 512). Interiors are wired in
  `src/game/interiors.ts` (geometry + collision strings + NPC placement) and
  `src/game/maps.ts` (`buildInterior`); each building's door warps to
  `int:<buildingId>`.

Ground truth: real map blockdata from pret (e.g.
`data/layouts/ViridianCity/map.bin`, 48x40 u16 LE, metatile id = low 10 bits)
renders correctly against this atlas — useful for verifying tile id choices.

Key metatile ids (verified against real ViridianCity/Route1 map data):
- ground grass variants 1, 8, 9, 16, 17 · tall encounter grass 13 · flowers 4
- yellow path 3x3: 211-213 / 219-221 / 227-229, inner corners 258-261 (NW/NE/SW/SE)
- city plaza 3x3: 357-359 / 365-367 / 373-375, inner corners 405/406/413/414
- pond 3x3: 416-418 / 424-426 / 432-434
- trees: tops 14|15, upper 30|31, mid 20|21, bottoms 36|37 (ends 38/39), single 35
- ledge: 135 mid, 176/177 end caps · hedge 317/318/319 · topiary 646
- Pokémon Center 72-99 · Mart 40-65+98 · Gym 685-687/329-331/336-350 ·
  green-roof house 640-679 (secondary)
