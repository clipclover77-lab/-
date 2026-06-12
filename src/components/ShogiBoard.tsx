import { Piece, Position, BoardState, PlayerColor, getHackedTiles, findKing } from '../shogiEngine';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldAlert, Zap } from 'lucide-react';

interface ShogiBoardProps {
  board: BoardState;
  selectedPos: Position | null;
  legalMoves: Position[];
  lastMove: { from: Position | null; to: Position } | null;
  activePlayer: PlayerColor;
  onTileClick: (r: number, c: number) => void;
  gameMode: 'vs_player' | 'vs_ai' | 'online';
  playerColorPreference: PlayerColor; // Sente bottom/Gote top
  senteCharge: number;
  goteCharge: number;
  kingInCheck: PlayerColor | null;
}

export function ShogiBoard({
  board,
  selectedPos,
  legalMoves,
  lastMove,
  activePlayer,
  onTileClick,
  gameMode,
  playerColorPreference,
  senteCharge,
  goteCharge,
  kingInCheck,
}: ShogiBoardProps) {
  // Traditional file/rank numbers
  const files = ['9', '8', '7', '6', '5', '4', '3', '2', '1'];
  const ranks = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

  // Check if a cell is Sente or Gote zone
  const isSelected = (r: number, c: number) => selectedPos?.r === r && selectedPos?.c === c;
  const isLegalMove = (r: number, c: number) => legalMoves.some((m) => m.r === r && m.c === c);
  const isLastMoveTo = (r: number, c: number) => lastMove?.to.r === r && lastMove?.to.c === c;
  const isLastMoveFrom = (r: number, c: number) => lastMove?.from?.r === r && lastMove?.from?.c === c;

  // Find if currently clicked piece is a King, and show its Cyber Hack aura zone (if active, and charge is 100%)
  const isAuraSource = (r: number, c: number) => {
    const piece = board[r][c];
    if (piece && piece.type === '玉') {
      const charge = piece.player === '先手' ? senteCharge : goteCharge;
      return charge >= 100;
    }
    return false;
  };

  // Check if a tile falls inside the 5x5 Hack range of the active king, provided active player's charge is 100%
  const activeKingPos = findKing(activePlayer, board);
  const isTileInHackRange = (r: number, c: number) => {
    if (!activeKingPos) return false;
    const activeCharge = activePlayer === '先手' ? senteCharge : goteCharge;
    if (activeCharge < 100) return false;

    // Chebychev distance <= 2
    const dr = Math.abs(r - activeKingPos.r);
    const dc = Math.abs(c - activeKingPos.c);
    return dr <= 2 && dc <= 2 && (dr > 0 || dc > 0);
  };

  // Determine if there is an opponent piece inside the Hack zone that is ripe for takeover!
  const isRipeForHack = (r: number, c: number) => {
    if (!isTileInHackRange(r, c)) return false;
    const p = board[r][c];
    return p !== null && p.player !== activePlayer;
  };

  return (
    <div id="shogi_board_container" className="relative p-3 md:p-6 bg-[#151518]/90 border border-white/5 rounded-2xl shadow-2xl flex flex-col items-center glass-panel">
      
      {/* File Coordinates (Top) */}
      <div className="grid grid-cols-9 w-full max-w-[450px] mb-2.5 text-center">
        {files.map((file, idx) => (
          <div key={`file_${idx}`} className="text-[10px] md:text-xs font-mono font-bold text-white/40">
            {file}
          </div>
        ))}
      </div>

      <div className="flex flex-row relative">
        
        {/* Main 9x9 Grid layout */}
        <div id="shogi_grid" className="grid grid-cols-9 grid-rows-9 gap-[2px] bg-[#1A1A1D] p-[4px] border-6 border-[#2C2C30] rounded-xl shadow-2xl relative overflow-hidden" 
             style={{ width: '100%', maxWidth: '450px', aspectRatio: '1/1' }}>
          
          {board.map((row, rIdx) =>
            row.map((piece, cIdx) => {
              const selected = isSelected(rIdx, cIdx);
              const legal = isLegalMove(rIdx, cIdx);
              const lastTo = isLastMoveTo(rIdx, cIdx);
              const lastFrom = isLastMoveFrom(rIdx, cIdx);
              const aura = isAuraSource(rIdx, cIdx);
              const inHackRange = isTileInHackRange(rIdx, cIdx);
              const canBeHacked = isRipeForHack(rIdx, cIdx);
              const isKing = piece?.type === '玉';
              const isInCheck = isKing && kingInCheck === piece?.player;

              const tileId = `tile_${rIdx}_${cIdx}`;

              return (
                <div
                  key={tileId}
                  id={tileId}
                  onClick={() => onTileClick(rIdx, cIdx)}
                  className={`
                    relative flex items-center justify-center cursor-pointer transition-all duration-200 select-none
                    ${selected ? 'bg-[#3D3A30] border border-[#D4AF37]/60 shadow-inner' : ''}
                    ${legal ? 'hover:bg-[#2E3C34] bg-[#222E26]' : 'hover:bg-[#2D2D33] bg-[#242428]'}
                    ${lastTo ? 'bg-amber-950/40 border border-[#D4AF37]/40' : ''}
                    ${lastFrom ? 'bg-amber-950/10' : ''}
                    ${isInCheck ? 'bg-rose-950/40 border border-rose-500 animate-pulse' : ''}
                    ${aura ? 'bg-emerald-500/10 border-2 border-emerald-500/40' : ''}
                    ${canBeHacked ? 'bg-emerald-500/15 border border-dashed border-emerald-400/60' : ''}
                    border border-white/[0.02]
                  `}
                >
                  {/* Subtle Grid Dot decorations (Traditional boards have 4 dots) */}
                  {((rIdx === 3 || rIdx === 6) && (cIdx === 3 || cIdx === 6)) && (
                    <div className="absolute w-1 h-1 bg-[#1A1A1D] rounded-full" />
                  )}

                  {/* King Hack Range Grid Cyber Matrix Scanlines */}
                  {inHackRange && (
                    <div className="absolute inset-0 bg-emerald-500/[0.04] pointer-events-none overflow-hidden">
                      <div className="absolute top-0 left-0 w-full h-[1px] bg-emerald-400/30 animate-[scan_2s_infinite]" />
                    </div>
                  )}

                  {/* Legal Move indicator dot/ring */}
                  {legal && (
                    <div className="absolute w-2.5 h-2.5 rounded-full bg-emerald-500/60 border border-[#242428] shadow-sm z-30 pointer-events-none" />
                  )}

                  {/* Piece element with transitions */}
                  <AnimatePresence mode="popLayout">
                    {piece && (
                      <motion.div
                        id={`piece_wrap_${piece.id}`}
                        initial={{ scale: 0.85, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.85, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                        className={`
                          relative flex flex-col items-center justify-center w-[92%] h-[92%] font-sans font-bold z-10
                          ${piece.player === '後手' ? 'rotate-180' : ''}
                        `}
                      >
                        {/* Shogi traditional pentagon piece symbol vector shape wrapper */}
                        <div className="absolute inset-0 w-full h-full flex items-center justify-center">
                          <svg
                            viewBox="0 0 100 120"
                            className={`w-full h-full drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]`}
                          >
                            <defs>
                              <linearGradient id="gradient-sente" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor="#E8E2D1" />
                                <stop offset="100%" stopColor="#C7B797" />
                              </linearGradient>
                              <linearGradient id="gradient-gote" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor="#A19B8C" />
                                <stop offset="100%" stopColor="#827A68" />
                              </linearGradient>
                            </defs>
                            <polygon
                              points="50,5 92,30 84,115 16,115 8,30"
                              className={`
                                transition-colors duration-200
                                stroke-[3.5]
                                ${selected ? 'stroke-[#D4AF37]' : 'stroke-[#1A1A1D]'}
                              `}
                              fill={piece.player === '先手' ? 'url(#gradient-sente)' : 'url(#gradient-gote)'}
                            />
                          </svg>
                        </div>

                        {/* Piece Kanji Characters */}
                        <div className={`
                          absolute flex flex-col items-center justify-center font-serif leading-none mt-1 z-20 select-none
                          ${['と', '成香', '成桂', '成銀', '馬', '竜'].includes(piece.type) 
                            ? 'text-rose-700 font-extrabold' 
                            : 'text-[#1A1A1D]'
                          }
                        `}>
                          <span className={`font-semibold ${piece.type.length > 1 ? 'text-[11px] md:text-xs tracking-tighter' : 'text-xs md:text-sm'}`}>
                            {piece.type === '玉' && piece.player === '後手' ? '王' : piece.type}
                          </span>
                        </div>

                        {/* Player control indicator tip */}
                        <span className={`absolute top-0.5 w-1 h-1 rounded-full z-20 ${piece.player === '先手' ? 'bg-[#D4AF37]' : 'bg-[#FF4500]'}`} />

                        {/* Glow effect if charge is 100% on the King */}
                        {isKing && aura && (
                          <div className="absolute inset-0 border border-emerald-400 rounded-md animate-ping opacity-60 z-0" />
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          )}
        </div>

        {/* Rank Coordinates (Right Side) */}
        <div className="flex flex-col justify-between ml-1 pb-1 pt-1 h-full pr-[2px]">
          {ranks.map((rank, idx) => (
            <div
              key={`rank_${idx}`}
              className="text-[9px] md:text-xs font-mono font-bold text-white/40 flex items-center justify-center"
              style={{ height: 'calc(100% / 9)', minHeight: '32px' }}
            >
              {rank}
            </div>
          ))}
        </div>
      </div>

      {/* Cyber Info Bar */}
      <div className="mt-3 flex gap-2 text-[10px] font-mono text-white/30 uppercase">
        <span>先手 = Sente (Up)</span>
        <span>•</span>
        <span>後手 = Gote (Down)</span>
      </div>
    </div>
  );
}
