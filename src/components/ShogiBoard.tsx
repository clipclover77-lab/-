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
    <div id="shogi_board_container" className="relative p-3 md:p-6 bg-[#0c081b]/95 border-2 border-cyan-500/30 rounded-3xl shadow-[0_0_35px_rgba(0,240,255,0.15)] flex flex-col items-center glass-panel">
      
      {/* File Coordinates (Top) */}
      <div className="grid grid-cols-9 w-full max-w-[740px] mb-2.5 text-center">
        {files.map((file, idx) => (
          <div key={`file_${idx}`} className="text-xs md:text-sm font-mono font-black text-[#00f0ff] drop-shadow-[0_0_4px_rgba(0,240,255,0.5)]">
            {file}
          </div>
        ))}
      </div>

      <div className="flex flex-row relative">
        
        {/* Main 9x9 Grid layout */}
        <div id="shogi_grid" className="grid grid-cols-9 grid-rows-9 gap-[2.5px] bg-[#140828] p-[6px] border-4 border-[#00f0ff] rounded-2xl shadow-[0_0_30px_rgba(0,240,255,0.4),inset_0_0_20px_rgba(0,240,255,0.2)] relative overflow-hidden" 
             style={{ width: '100%', maxWidth: '740px', aspectRatio: '1/1' }}>
          
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
                    ${selected ? 'bg-cyan-500/20 border-2 border-[#00f0ff] shadow-[0_0_12px_rgba(0,240,255,0.4)] z-30' : ''}
                    ${legal ? 'hover:bg-emerald-500/30 bg-emerald-950/40 border border-emerald-400/40 animate-pulse' : 'hover:bg-[#1f0f35]/90 bg-[#0b0416]/95'}
                    ${lastTo ? 'bg-fuchsia-500/20 border border-[#ff007f]/50 shadow-[0_0_8px_rgba(255,0,127,0.3)]' : ''}
                    ${lastFrom ? 'bg-[#1b0a21]/50' : ''}
                    ${isInCheck ? 'bg-rose-950/60 border-2 border-rose-500 animate-pulse shadow-[0_0_15px_rgba(244,63,94,0.6)]' : ''}
                    ${aura ? 'bg-emerald-500/20 border-2 border-emerald-400/80 shadow-[0_0_12px_rgba(52,211,153,0.4)]' : ''}
                    ${canBeHacked ? 'bg-emerald-500/25 border-2 border-dashed border-emerald-400 animate-[pulse_1s_infinite] shadow-[0_0_15px_rgba(52,211,153,0.4)]' : ''}
                    border border-violet-950/30
                  `}
                >
                  {/* Subtle Grid Dot decorations (Traditional boards have 4 dots) */}
                  {((rIdx === 3 || rIdx === 6) && (cIdx === 3 || cIdx === 6)) && (
                    <div className="absolute w-1.5 h-1.5 bg-[#00f0ff]/30 rounded-full shadow-[0_0_3px_rgba(0,240,255,0.4)]" />
                  )}

                  {/* King Hack Range Grid Cyber Matrix Scanlines */}
                  {inHackRange && (
                    <div className="absolute inset-0 bg-emerald-500/[0.06] pointer-events-none overflow-hidden">
                      <div className="absolute top-0 left-0 w-full h-[1.5px] bg-emerald-400/50 animate-[scan_2s_infinite]" />
                    </div>
                  )}

                  {/* Legal Move indicator dot/ring */}
                  {legal && (
                    <div className="absolute w-3 h-3 rounded-full bg-[#00f0ff] border-2 border-[#140828] shadow-[0_0_6px_#00f0ff] z-30 pointer-events-none" />
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
                            className={`w-full h-full drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]`}
                          >
                            <defs>
                              <linearGradient id={`gradient-sente-${piece.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor="#150a2e" />
                                <stop offset="100%" stopColor="#080312" />
                              </linearGradient>
                              <linearGradient id={`gradient-gote-${piece.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor="#2c051d" />
                                <stop offset="100%" stopColor="#0f010a" />
                              </linearGradient>
                              <linearGradient id={`gradient-stargazer-${piece.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor="#092d35" />
                                <stop offset="100%" stopColor="#020e11" />
                              </linearGradient>
                            </defs>
                            <polygon
                              points="50,5 92,30 84,115 16,115 8,30"
                              className={`
                                transition-colors duration-200
                                stroke-[3.5]
                                ${selected 
                                  ? 'stroke-[#fffb00] drop-shadow-[0_0_8px_rgba(255,251,0,0.8)]' 
                                  : piece.player === '先手' 
                                    ? 'stroke-[#00f0ff]/80 hover:stroke-[#00f0ff]' 
                                    : 'stroke-[#ff007f]/80 hover:stroke-[#ff007f]'
                                }
                              `}
                              fill={
                                piece.type === 'スターゲイザー'
                                  ? `url(#gradient-stargazer-${piece.id})`
                                  : piece.player === '先手'
                                    ? `url(#gradient-sente-${piece.id})`
                                    : `url(#gradient-gote-${piece.id})`
                              }
                            />
                          </svg>
                        </div>

                        {/* Piece Kanji Characters */}
                        <div className={`
                          absolute flex flex-col items-center justify-center font-serif leading-none mt-1 z-20 select-none
                          ${piece.type === 'スターゲイザー'
                            ? 'text-[#fffb00] font-black drop-shadow-[0_0_8px_rgba(255,251,0,0.9)] scale-110'
                            : ['と', '成香', '成桂', '成銀', '馬', '竜'].includes(piece.type) 
                              ? 'text-[#ff3366] font-extrabold drop-shadow-[0_0_4px_rgba(255,51,102,0.8)]' 
                              : piece.player === '先手'
                                ? 'text-[#00f0ff] font-bold drop-shadow-[0_0_4px_rgba(0,240,255,0.7)]'
                                : 'text-[#ff007f] font-bold drop-shadow-[0_0_4px_rgba(255,0,127,0.7)]'
                          }
                        `}>
                          <span className={`font-semibold ${piece.type.length > 1 ? 'text-[11px] md:text-xs tracking-tighter' : 'text-xs md:text-sm'}`}>
                            {piece.type === '玉' && piece.player === '後手' ? '王' : (piece.type === 'スターゲイザー' ? '天星' : piece.type)}
                          </span>
                        </div>

                        {/* Player control indicator tip */}
                        <span className={`absolute top-0.5 w-1.5 h-1.5 rounded-full z-20 shadow-[0_0_4px_currentColor] ${piece.player === '先手' ? 'bg-[#00f0ff] text-[#00f0ff]' : 'bg-[#ff007f] text-[#ff007f]'}`} />

                        {/* Glow effect if charge is 100% on the King */}
                        {isKing && aura && (
                          <div className="absolute inset-0 border border-emerald-400 rounded-md animate-ping opacity-60 z-0" />
                        )}

                        {/* Cosmic pulse for Stargazer */}
                        {piece.type === 'スターゲイザー' && (
                          <div className="absolute inset-0 border-2 border-[#fffb00]/60 rounded-md animate-pulse opacity-40 z-0" />
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
              className="text-xs md:text-sm font-mono font-black text-[#ff007f] drop-shadow-[0_0_4px_rgba(255,0,127,0.5)] flex items-center justify-center"
              style={{ height: 'calc(100% / 9)', minHeight: '32px' }}
            >
              {rank}
            </div>
          ))}
        </div>
      </div>

      {/* Cyber Info Bar */}
      <div className="mt-3 flex gap-2 text-[10px] font-mono text-cyan-400/40 uppercase tracking-widest">
        <span>先手 = Sente (Up)</span>
        <span>•</span>
        <span>後手 = Gote (Down)</span>
      </div>
    </div>
  );
}
