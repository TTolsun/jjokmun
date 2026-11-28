const DIRECTIONS = ['left', 'center', 'right'];
const TURNS = DIRECTIONS.length;

export function createBallGame(random = Math.random) {
  const first = Math.floor(random() * TURNS);
  const step = random() < 0.5 ? 1 : TURNS - 1;
  const targets = DIRECTIONS.map((_, index) => DIRECTIONS[(first + step * index) % TURNS]);
  return {
    phase: 'ready', turn: 0, turns: TURNS, direction: 'left', target: null,
    hits: 0, lastHit: null, targets
  };
}

function startTurn(game) {
  const turn = game.turn + 1;
  return {
    ...game, phase: 'aim', turn, direction: 'left', target: game.targets[turn - 1], lastHit: null
  };
}

export function pressBallGame(game, button) {
  if (!game || button === 'c') return null;
  if (game.phase === 'aim' && button === 'a') {
    const index = DIRECTIONS.indexOf(game.direction);
    return { ...game, direction: DIRECTIONS[(index + 1) % TURNS] };
  }
  if (button !== 'b') return game;
  switch (game.phase) {
    case 'ready':
      return startTurn(game);
    case 'aim': {
      const lastHit = game.direction === game.target;
      return { ...game, phase: 'result', hits: game.hits + Number(lastHit), lastHit };
    }
    case 'result':
      return game.turn === TURNS ? { ...game, phase: 'complete' } : startTurn(game);
    default:
      return game;
  }
}
