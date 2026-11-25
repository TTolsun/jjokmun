import { regularOf } from '../shop.js';
import { loadCharacterSheet } from './shop-interior.js';
import { paintPortrait } from './shop-scene.js';

// Portraits of memo regulars and guests. The optional local sprite sheet loads
// once; canvases painted before it arrives are repainted while still shown.
export function bindPortraits() {
  let characters;
  const pending = new Map();
  loadCharacterSheet().then(sheet => {
    characters = sheet;
    if (sheet) for (const [canvas, person] of pending) if (canvas.isConnected) paintPortrait(canvas, person, sheet);
    pending.clear();
  });
  return {
    portrait(canvas, memoId) {
      const { person } = regularOf(memoId);
      if (!characters) pending.set(canvas, person);
      paintPortrait(canvas, person, characters);
    }
  };
}
