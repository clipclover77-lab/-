import {
  BoardState,
  Piece,
  Position,
  PlayerColor,
  PieceType,
  getValidMoves,
  canDropPiece,
  PROMOTION_MAP,
  DEMOTION_MAP,
  getHackedTiles
} from '../shogiEngine';

// Shogi piece static weights for AI heuristic evaluation
const PIECE_VALUES: Record<PieceType, number> = {
  '歩': 10,
  '香': 30,
  '桂': 40,
  '銀': 50,
  '金': 60,
  '角': 80,
  '飛': 100,
  '玉': 15000,
  'と': 60,
  '成香': 60,
  '成桂': 60,
  '成銀': 60,
  '馬': 100,
  '竜': 120,
};

interface EvaluatedMove {
  from: Position | null; // null if dropping
  to: Position;
  pieceType: PieceType;
  score: number;
  promote: boolean;
  dropType?: PieceType;
}

// Check if a cell is under attack by the enemy
function isCellUnderAttack(target: Position, attackerColor: PlayerColor, board: BoardState): boolean {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p && p.player === attackerColor) {
        // Simple reachable check (ignores recursion depth for performance)
        const moves = getValidMoves(r, c, board);
        if (moves.some((m) => m.r === target.r && m.c === target.c)) {
          return true;
        }
      }
    }
  }
  return false;
}

// Find Gote's King for hacking checks
function findGoteKing(board: BoardState): Position | null {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p && p.type === '玉' && p.player === '後手') {
        return { r, c };
      }
    }
  }
  return null;
}

/**
 * Main AI function: returns the chosen move or a string "HACK" if applying the Super Hack
 */
export function calculateBestCpuMove(
  board: BoardState,
  cpuHand: Piece[],
  cpuCharge: number
): EvaluatedMove | 'HACK' {
  // 1. Evaluate Super Hack (Once at 100% Charge)
  if (cpuCharge >= 100) {
    const kingPos = findGoteKing(board);
    if (kingPos) {
      const harvest = getHackedTiles(kingPos.r, kingPos.c, '後手', board);
      // If there are at least two enemy pieces near our King (or a high wealth piece like Bishop or Rook), do King Hack!
      let totalHackedValue = 0;
      let hasHighScorePiece = false;

      harvest.forEach((pos) => {
        const targetPiece = board[pos.r][pos.c];
        if (targetPiece) {
          totalHackedValue += PIECE_VALUES[targetPiece.type];
          if (['飛', '角', '角', '金', '金', '銀', '竜', '馬'].includes(targetPiece.type)) {
            hasHighScorePiece = true;
          }
        }
      });

      // Hack if total value gained is significant
      if (totalHackedValue >= 60 || hasHighScorePiece || harvest.length >= 3) {
        return 'HACK';
      }
    }
  }

  const movesList: EvaluatedMove[] = [];
  const player: PlayerColor = '後手';
  const enemyColor: PlayerColor = '先手';

  // 2. Gather All Valid Board Moves
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (p && p.player === player) {
        const validDests = getValidMoves(r, c, board);
        
        validDests.forEach((dest) => {
          let score = 0;
          const captured = board[dest.r][dest.c];
          
          // Heuristic A: Capturing enemy piece
          if (captured) {
            score += PIECE_VALUES[captured.type] * 1.5;
          }

          // Heuristic B: Positional bonuses based on rows for pawns / knights
          if (p.type === '歩') {
            score += dest.r * 1.5; // Encourages pushing pawns down
          } else if (p.type === '香') {
            score += dest.r * 0.8;
          }

          // Heuristic C: Vulnerability penalty
          if (isCellUnderAttack(dest, enemyColor, board)) {
            score -= PIECE_VALUES[p.type] * 0.8;
          }

          // Heuristic D: Moving out of initial danger
          if (isCellUnderAttack({ r, c }, enemyColor, board)) {
            score += PIECE_VALUES[p.type] * 0.4;
          }

          // Gather normal move
          movesList.push({
            from: { r, c },
            to: dest,
            pieceType: p.type,
            score,
            promote: false,
          });

          // If eligible for promotion, also score a promoting move option
          const entersPromotion = dest.r >= 6; // Rows 6, 7, 8 for Gote (Sente's zone)
          const leavesPromotion = r >= 6;
          const canPromote = (entersPromotion || leavesPromotion) && (p.type in PROMOTION_MAP);
          
          if (canPromote) {
            const promoType = PROMOTION_MAP[p.type];
            let promoBonus = (PIECE_VALUES[promoType] - PIECE_VALUES[p.type]) * 1.2 + 5;
            movesList.push({
              from: { r, c },
              to: dest,
              pieceType: p.type,
              score: score + promoBonus,
              promote: true,
            });
          }
        });
      }
    }
  }

  // 3. Gather Hand Drops
  // Unique types of pieces in CPU hand
  const handTypes = Array.from(new Set(cpuHand.map((p) => p.type)));
  handTypes.forEach((pieceType) => {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const checkDrop = canDropPiece(pieceType, r, c, player, board);
        if (checkDrop.valid) {
          let score = 10; // Base score for drops

          // Adjust drops based on board tactical needs
          const isUnderThreat = isCellUnderAttack({ r, c }, enemyColor, board);
          if (isUnderThreat) {
            score -= PIECE_VALUES[pieceType] * 0.6; // Avoid dropping in danger
          }

          // Defending king drop
          const kingPos = findGoteKing(board);
          if (kingPos) {
            const distToKing = Math.abs(r - kingPos.r) + Math.abs(c - kingPos.c);
            if (distToKing <= 2 && ['金', '銀', '歩'].includes(pieceType)) {
              score += 15; // Defend the vicinity of the king
            }
          }

          // Drop attack lines
          if (pieceType === '歩' && r >= 3 && r <= 5) {
            score += 5; // Pawn drop at key files
          }

          movesList.push({
            from: null,
            to: { r, c },
            pieceType,
            score,
            promote: false,
            dropType: pieceType,
          });
        }
      }
    }
  });

  // 4. Fallback if no moves are found (extremely rare unless checkmate)
  if (movesList.length === 0) {
    return {
      from: null,
      to: { r: 0, c: 0 },
      pieceType: '歩',
      score: -99999,
      promote: false,
    };
  }

  // Add random variance (+/- 3) to keep gameplay organic
  movesList.forEach((m) => {
    m.score += (Math.random() - 0.5) * 6;
  });

  // Sort and select best move
  movesList.sort((a, b) => b.score - a.score);
  return movesList[0];
}
