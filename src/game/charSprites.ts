import Phaser from 'phaser';

// Loads FireRed overworld character sheets (pret/pokefirered, 144x32 = nine
// 16x32 frames) with color-key transparency (these PNGs have an opaque bg).
// Frame layout: 0 stand-down, 1 stand-up, 2 stand-left,
//               3/4 walk-down, 5/6 walk-up, 7/8 walk-left. East = flipX(west).

export const CHAR_SHEETS = [
  'player', 'giovanni', 'oak', 'blue', 'sailor',
  'rocket', 'camper', 'brock', 'oldwoman', 'woman', 'youngster',
] as const;

// numeric NPC.sprite index → sheet key (keeps save format unchanged)
export const SHEET_BY_INDEX: string[] = [
  'player',    // 0 (player)
  'giovanni',  // 1
  'oak',       // 2
  'blue',      // 3
  'sailor',    // 4 Sal
  'rocket',    // 5 James
  'camper',    // 6 Ranger Iva
  'brock',     // 7
  'rocket',    // 8 Archer
  'oldwoman',  // 9 Elder Rosa
  'woman',     // 10 Nurse
  'youngster', // 11 Mart clerk
];

function colorKey(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const [kr, kg, kb] = [px[0], px[1], px[2]]; // top-left pixel = bg color
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] === kr && px[i + 1] === kg && px[i + 2] === kb) px[i + 3] = 0;
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

export async function loadCharSheets(scene: Phaser.Scene): Promise<void> {
  await Promise.all(CHAR_SHEETS.map(async key => {
    if (scene.textures.exists(`ow_${key}`)) return;
    try {
      const raw = await loadImage(`/chars/${key}.png`);
      const keyed = colorKey(raw);
      const img = await loadImage(keyed.toDataURL());
      scene.textures.addSpriteSheet(`ow_${key}`, img, { frameWidth: 16, frameHeight: 32 });
      // some sheets only have the 3 stand frames — skip walk anims for those
      const frameCount = scene.textures.get(`ow_${key}`).frameTotal - 1;
      if (frameCount < 9) return;
      // walking animations (left doubles as right via flipX)
      const mk = (dir: string, stand: number, a: number, b: number) => {
        const animKey = `ow_${key}_walk_${dir}`;
        if (!scene.anims.exists(animKey)) {
          scene.anims.create({
            key: animKey,
            frames: [
              { key: `ow_${key}`, frame: a },
              { key: `ow_${key}`, frame: stand },
              { key: `ow_${key}`, frame: b },
              { key: `ow_${key}`, frame: stand },
            ],
            frameRate: 8,
          });
        }
      };
      mk('down', 0, 3, 4);
      mk('up', 1, 5, 6);
      mk('left', 2, 7, 8);
    } catch { /* missing sheet → sprite falls back to procedural texture */ }
  }));
}

export const STAND_FRAME: Record<string, number> = { down: 0, up: 1, left: 2, right: 2 };
