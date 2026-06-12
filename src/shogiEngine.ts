/**
 * Minimalist Shogi Engine with King Hack Mechanics
 */

export type PlayerColor = '先手' | '後手'; // 先手 is Sente (creates upward thrust), 後手 is Gote (faces down)

export type PieceType =
  | '歩' // Pawn
  | '香' // Lance
  | '桂' // Knight
  | '銀' // Silver General
  | '金' // Gold General
  | '角' // Bishop
  | '飛' // Rook
  | '玉' // King (Used for both, or can use 王 for Gote)
  | 'と' // Promoted Pawn
  | '成香' // Promoted Lance
  | '成桂' // Promoted Knight
  | '成銀' // Promoted Silver
  | '馬' // Promoted Bishop (Horse)
  | '竜'; // Promoted Rook (Dragon)

export interface Piece {
  id: string; // Unique ID for Framer Motion key rendering
  type: PieceType;
  player: PlayerColor;
}

export type BoardState = (Piece | null)[][]; // 9x9 Grid: index 0 to 8. row 0 is top, row 8 is bottom. col 0 is left, col 8 is right.

export interface Position {
  r: number;
  c: number;
}

export interface KifuMove {
  from: Position | null; // null if dropped from hand
  to: Position;
  pieceType: PieceType;
  wasPromoted: boolean;
  capturedPieceType?: PieceType;
  player: PlayerColor;
  moveNumber: number;
  japaneseNotation: string;
}

// Map standard unpromoted piece types to their promoted versions
export const PROMOTION_MAP: Record<string, PieceType> = {
  '歩': 'と',
  '香': '成香',
  '桂': '成桂',
  '銀': '成銀',
  '角': '馬',
  '飛': '竜',
};

// Map promoted piece types to their base (unpromoted) versions
export const DEMOTION_MAP: Record<PieceType, PieceType> = {
  '歩': '歩',
  '香': '香',
  '桂': '桂',
  '銀': '銀',
  '金': '金',
  '角': '角',
  '飛': '飛',
  '玉': '玉',
  'と': '歩',
  '成香': '香',
  '成桂': '桂',
  '成銀': '銀',
  '馬': '角',
  '竜': '飛',
};

// Check if a piece can be promoted
export function isPromotable(type: PieceType): boolean {
  return type in PROMOTION_MAP;
}

// Generate a random ID
export function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

// Format coordinates to Japanese Kifu notation format (e.g. "７六歩")
export function toJapaneseNotation(
  from: Position | null,
  to: Position,
  pieceType: PieceType,
  isDrop: boolean,
  isPromotion: boolean,
  prevMove: KifuMove | null
): string {
  // Traditional numbers: 1 to 9 (from Sente perspective: column index 8 is 1, index 0 is 9)
  const colsJapanese = ['９', '８', '７', '６', '５', '４', '３', '２', '１'];
  const rowsJapanese = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

  const colStr = colsJapanese[to.c];
  const rowStr = rowsJapanese[to.r];

  let targetStr = `${colStr}${rowStr}`;
  if (prevMove && prevMove.to.r === to.r && prevMove.to.c === to.c) {
    targetStr = '同 ';
  }

  if (isDrop) {
    return `${targetStr}${pieceType}打`;
  }

  const promoSuffix = isPromotion ? '成' : '';
  return `${targetStr}${pieceType}${promoSuffix}`;
}

// Get the initial board layout
export function getInitialBoard(): BoardState {
  const board: BoardState = Array(9)
    .fill(null)
    .map(() => Array(9).fill(null));

  // Helper to place pieces
  const createPiece = (type: PieceType, player: PlayerColor): Piece => ({
    id: `${player === '先手' ? 's' : 'g'}_${type}_${generateId()}`,
    type,
    player,
  });

  // Ranks 1 & 9 (indexes 0 & 8)
  const majorPieces: PieceType[] = ['香', '桂', '銀', '金', '玉', '金', '銀', '桂', '香'];
  for (let c = 0; c < 9; c++) {
    board[0][c] = createPiece(majorPieces[c], '後手');
    board[8][c] = createPiece(majorPieces[c], '先手');
  }

  // Ranks 2 & 8 (indexes 1 & 7) - Bishop & Rook
  board[1][1] = createPiece('飛', '後手'); // Gote Rook (originally 8二 from Sente view i.e. col 1, row 1)
  board[1][7] = createPiece('角', '後手'); // Gote Bishop (originally 2二 from Sente view i.e. col 7, row 1)

  board[7][1] = createPiece('角', '先手'); // Sente Bishop at 8八 (col 1, row 7)
  board[7][7] = createPiece('飛', '先手'); // Sente Rook at 2八 (col 7, row 7)

  // Ranks 3 & 7 (indexes 2 & 6) - Pawns
  for (let c = 0; c < 9; c++) {
    board[2][c] = createPiece('歩', '後手');
    board[6][c] = createPiece('歩', '先手');
  }

  return board;
}

// Returns the list of valid destinations for a piece at index (r, c)
export function getValidMoves(r: number, c: number, board: BoardState): Position[] {
  const piece = board[r][c];
  if (!piece) return [];

  const moves: Position[] = [];
  const player = piece.player;
  const isSente = player === '先手';

  // Helper for step-by-step or ray sliding
  const addStep = (dr: number, dc: number) => {
    const nr = r + dr;
    const nc = c + dc;
    if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9) {
      const dest = board[nr][nc];
      if (!dest || dest.player !== player) {
        moves.push({ r: nr, c: nc });
      }
    }
  };

  const addRay = (dr: number, dc: number) => {
    let nr = r + dr;
    let nc = c + dc;
    while (nr >= 0 && nr < 9 && nc >= 0 && nc < 9) {
      const dest = board[nr][nc];
      if (!dest) {
        moves.push({ r: nr, c: nc });
      } else {
        if (dest.player !== player) {
          moves.push({ r: nr, c: nc });
        }
        break; // Column blocked
      }
      nr += dr;
      nc += dc;
    }
  };

  const type = piece.type;

  switch (type) {
    case '歩':
      // 1 step forward
      addStep(isSente ? -1 : 1, 0);
      break;

    case '香':
      // Slide forward infinitely
      addRay(isSente ? -1 : 1, 0);
      break;

    case '桂':
      // L-shape leap: 2 steps forward, 1 step sidestep
      if (isSente) {
        addStep(-2, -1);
        addStep(-2, 1);
      } else {
        addStep(2, -1);
        addStep(2, 1);
      }
      break;

    case '銀':
      // Diagonals + 1 step forward
      addStep(1, 1);
      addStep(1, -1);
      addStep(-1, 1);
      addStep(-1, -1);
      addStep(isSente ? -1 : 1, 0);
      break;

    case '金':
    case 'と':
    case '成香':
    case '成桂':
    case '成銀':
      // Orthogonal + Front diagonals (Basically King minus backward diagonals)
      addStep(0, 1);
      addStep(0, -1);
      addStep(1, 0);
      addStep(-1, 0);
      if (isSente) {
        addStep(-1, -1);
        addStep(-1, 1);
      } else {
        addStep(1, -1);
        addStep(1, 1);
      }
      break;

    case '角':
      // Diagonals infinitely
      addRay(-1, -1);
      addRay(-1, 1);
      addRay(1, -1);
      addRay(1, 1);
      break;

    case '馬':
      // Bishop rays + King 1-step orthogonals
      addRay(-1, -1);
      addRay(-1, 1);
      addRay(1, -1);
      addRay(1, 1);
      addStep(0, -1);
      addStep(0, 1);
      addStep(-1, 0);
      addStep(1, 0);
      break;

    case '飛':
      // Orthogonal rays infinitely
      addRay(0, -1);
      addRay(0, 1);
      addRay(-1, 0);
      addRay(1, 0);
      break;

    case '竜':
      // Rook rays + King 1-step diagonals
      addRay(0, -1);
      addRay(0, 1);
      addRay(-1, 0);
      addRay(1, 0);
      addStep(-1, -1);
      addStep(-1, 1);
      addStep(1, -1);
      addStep(1, 1);
      break;

    case '玉':
      // All 8 directions
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr !== 0 || dc !== 0) {
            addStep(dr, dc);
          }
        }
      }
      break;
  }

  return moves;
}

// Find King position
export function findKing(player: PlayerColor, board: BoardState): Position | null {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = board[r][c];
      if (piece && piece.type === '玉' && piece.player === player) {
        return { r, c };
      }
    }
  }
  return null;
}

// Is the current player in Check? (Can the enemy capture the King next turn?)
export function isKingInCheck(player: PlayerColor, board: BoardState): boolean {
  const kingPos = findKing(player, board);
  if (!kingPos) return false;

  const enemyColor: PlayerColor = player === '先手' ? '後手' : '先手';

  // Check if any enemy piece can move to kingPos
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p && p.player === enemyColor) {
        const moves = getValidMoves(r, c, board);
        if (moves.some((m) => m.r === kingPos.r && m.c === kingPos.c)) {
          return true;
        }
      }
    }
  }
  return false;
}

// Helper to determine if Sente or Gote is in the promotion zone
export function isInPromotionZone(r: number, player: PlayerColor): boolean {
  if (player === '先手') {
    return r <= 2; // Rows 0, 1, 2
  } else {
    return r >= 6; // Rows 6, 7, 8
  }
}

// Check if promotion is FORCED (e.g. Pawn reaches the edge and has no moves)
export function isPromotionForced(type: PieceType, toR: number, player: PlayerColor): boolean {
  if (player === '先手') {
    if (type === '歩' || type === '香') {
      return toR === 0;
    }
    if (type === '桂') {
      return toR <= 1;
    }
  } else {
    if (type === '歩' || type === '香') {
      return toR === 8;
    }
    if (type === '桂') {
      return toR >= 7;
    }
  }
  return false;
}

// Check if a piece can be dropped on a specific tile
export function canDropPiece(
  type: PieceType,
  r: number,
  c: number,
  player: PlayerColor,
  board: BoardState
): { valid: boolean; reason?: string } {
  // Tile must be empty
  if (board[r][c] !== null) {
    return { valid: false, reason: '盤面に駒が既に存在します' };
  }

  // 1. Invalid positions (must have at least one valid move)
  if (player === '先手') {
    if ((type === '歩' || type === '香') && r === 0) {
      return { valid: false, reason: 'そのマスに打つと移動できなくなります' };
    }
    if (type === '桂' && r <= 1) {
      return { valid: false, reason: 'そのマスに打つと移動できなくなります' };
    }
  } else {
    if ((type === '歩' || type === '香') && r === 8) {
      return { valid: false, reason: 'そのマスに打つと移動できなくなります' };
    }
    if (type === '桂' && r >= 7) {
      return { valid: false, reason: 'そのマスに打つと移動できなくなります' };
    }
  }

  // 2. 二歩 (Nifu) - Can't drop Pawn on a column that has an unpromoted Pawn of our alliance
  if (type === '歩') {
    for (let row = 0; row < 9; row++) {
      const p = board[row][c];
      if (p && p.player === player && p.type === '歩') {
        return { valid: false, reason: '二歩（同じ筋に歩を２枚置くことはできません）' };
      }
    }
  }

  // Note: Uchifuzume (checking mate with pawn drop) is complex but we can optionally bypass or evaluate.
  // Standard gameplay with Nifu and forced spacing works brilliantly.
  return { valid: true };
}

// Check if a player has any legal moves (to detect Checkmate or Draw)
export function hasAnyLegalMoves(player: PlayerColor, board: BoardState, hand: Piece[]): boolean {
  // Check board moves
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = board[r][c];
      if (piece && piece.player === player) {
        const moves = getValidMoves(r, c, board);
        // For each move, simulate and see if it is legal (doesn't put our king in check)
        for (const m of moves) {
          const tempBoard = board.map((row) => [...row]);
          tempBoard[m.r][m.c] = tempBoard[r][c];
          tempBoard[r][c] = null;
          if (!isKingInCheck(player, tempBoard)) {
            return true;
          }
        }
      }
    }
  }

  // Check drop moves (Only if we have pieces in hand)
  const uniqueHandTypes = Array.from(new Set(hand.map((p) => p.type)));
  for (const pieceType of uniqueHandTypes) {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (canDropPiece(pieceType, r, c, player, board).valid) {
          // Simulate drop and check if it leaves our king in check
          const tempBoard = board.map((row) => [...row]);
          tempBoard[r][c] = { id: 'temp', type: pieceType, player };
          if (!isKingInCheck(player, tempBoard)) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

// Get the coordinates of all pieces hacked by a King's "King Hack" super move
export function getHackedTiles(kingR: number, kingC: number, player: PlayerColor, board: BoardState): Position[] {
  const enemyColor: PlayerColor = player === '先手' ? '後手' : '先手';
  const hacked: Position[] = [];

  // Chebyshev distance <= 2 around King (i.e., 5x5 area centered on King, except King itself)
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = kingR + dr;
      const c = kingC + dc;
      if (r >= 0 && r < 9 && c >= 0 && c < 9) {
        const p = board[r][c];
        if (p && p.player === enemyColor) {
          hacked.push({ r, c });
        }
      }
    }
  }

  return hacked;
}
