import { Piece, PieceType, DEMOTION_MAP } from '../shogiEngine';
import { Zap, Radio } from 'lucide-react';
import { motion } from 'motion/react';

interface HandDisplayProps {
  player: '先手' | '後手';
  hand: Piece[];
  selectedHandIndex: number | null; // index inside the hand
  onSelectHandPiece: (player: '先手' | '後手', pieceType: PieceType, index: number) => void;
  charge: number;
  onTriggerKingHack: (player: '先手' | '後手') => void;
  isActive: boolean;
  playerName: string;
  isCpu: boolean;
}

export function HandDisplay({
  player,
  hand,
  selectedHandIndex,
  onSelectHandPiece,
  charge,
  onTriggerKingHack,
  isActive,
  playerName,
  isCpu,
}: HandDisplayProps) {
  // Aggregate hand pieces by type
  const aggregated: Record<string, { piece: Piece; indices: number[] }> = {};
  hand.forEach((p, originalIdx) => {
    // Demote to base unpromoted type if somehow promoted
    const baseType = DEMOTION_MAP[p.type];
    if (!aggregated[baseType]) {
      aggregated[baseType] = { piece: { ...p, type: baseType }, indices: [] };
    }
    aggregated[baseType].indices.push(originalIdx);
  });

  const isSente = player === '先手';
  const isCharged = charge >= 100;
  return (
    <div
      id={`hand_${player}`}
      className={`
        p-4 rounded-3xl border-2 transition-all duration-300 w-full max-w-[340px] shadow-2xl flex flex-col justify-between glass-panel
        ${isActive
          ? isSente
            ? 'border-[#00f0ff]/60 ring-2 ring-[#00f0ff]/10 shadow-[0_0_18px_rgba(0,240,255,0.25)] bg-[#100724]/95'
            : 'border-[#ff007f]/60 ring-2 ring-[#ff007f]/10 shadow-[0_0_18px_rgba(255,0,127,0.25)] bg-[#1f0314]/95'
          : 'border-violet-950/30 bg-[#07030e]/75 opacity-70'
        }
      `}
    >
      {/* Player Header */}
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full animate-pulse shadow-[0_0_6px_currentColor] ${isSente ? 'bg-[#00f0ff] text-[#00f0ff]' : 'bg-[#ff007f] text-[#ff007f]'}`} />
          <span className={`font-black text-sm md:text-base flex items-center gap-1.5 ${isSente ? 'text-[#00f0ff] drop-shadow-[0_0_3px_rgba(0,240,255,0.4)]' : 'text-[#ff007f] drop-shadow-[0_0_3px_rgba(255,0,127,0.4)]'}`}>
            {playerName}
            <span className="text-[10px] text-white/40 font-mono">
              ({player})
            </span>
          </span>
        </div>
        {isCpu && (
          <span className="text-[10px] bg-white/5 text-[#fffb00] font-mono px-2 py-0.5 rounded border border-[#fffb00]/30 uppercase tracking-widest animate-pulse">
            CPU AI
          </span>
        )}
      </div>

      {/* Captured Hand pieces list */}
      <div className="mb-4">
        <div className="text-[10px] font-bold text-white/40 mb-2 font-mono uppercase tracking-widest">
          持ち駒 / Captured Pieces
        </div>

        {hand.length === 0 ? (
          <div className="text-center py-4 text-xs italic text-white/20 border border-dashed border-violet-950/60 rounded-xl bg-black/40">
            持ち駒がありません
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {Object.entries(aggregated).map(([type, data]) => {
              // Check if currently selected hand piece is of this type
              const isSelectedType =
                selectedHandIndex !== null &&
                hand[selectedHandIndex] &&
                DEMOTION_MAP[hand[selectedHandIndex].type] === type;

              // Simply pick the first index to select when clicked
              const firstOriginalIndex = data.indices[0];

              return (
                <button
                  key={`hand_btn_${player}_${type}`}
                  onClick={() => {
                    if (isActive && !isCpu) {
                      onSelectHandPiece(player, type as PieceType, firstOriginalIndex);
                    }
                  }}
                  disabled={!isActive || isCpu}
                  className={`
                    relative flex items-center justify-center w-11 h-12 rounded-xl border font-bold text-sm transition-all shadow-md
                    ${isSelectedType
                      ? 'bg-[#00f0ff]/10 border-2 border-[#00f0ff] scale-105 shadow-[0_0_10px_rgba(0,240,255,0.5)] text-[#00f0ff]'
                      : 'bg-[#120a23] border-violet-950/60 hover:bg-[#1e1039] text-violet-100 hover:border-[#00f0ff]/50'
                    }
                    ${isActive ? 'cursor-pointer' : 'cursor-default'}
                  `}
                >
                  <span className={`font-serif select-none ${isSelectedType ? 'text-[#00f0ff] font-extrabold' : 'text-violet-100/90'}`}>
                    {type}
                  </span>

                  {/* Quantity Indicator badge */}
                  {data.indices.length > 1 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-[#ff007f] text-white font-mono text-[9px] w-4 h-4 rounded-full flex items-center justify-center border border-[#140828] shadow font-black">
                      {data.indices.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Super Hack Charge Meter Widget */}
      <div className="border-t border-violet-950/40 pt-3 flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-black text-[#ff007f] font-mono uppercase tracking-widest flex items-center gap-1">
            <Zap className={`w-3.5 h-3.5 ${isCharged ? 'text-[#fffb00] animate-pulse drop-shadow-[0_0_4px_#fffb00]' : 'text-white/30'}`} />
            HACK ENERGY
          </span>
          <span className={`font-mono text-xs font-black ${isCharged ? 'text-[#fffb00] animate-pulse' : 'text-white/60'}`}>
            {charge}%
          </span>
        </div>

        {/* Charge Progress bar */}
        <div className="gauge-container">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${charge}%` }}
            transition={{ type: 'spring', stiffness: 100, damping: 15 }}
            className="gauge-fill"
          />
        </div>

        {/* Special Ultimate button */}
        <button
          onClick={() => {
            if (isCharged && isActive && !isCpu) {
              onTriggerKingHack(player);
            }
          }}
          disabled={!isCharged || !isActive || isCpu}
          className={`
            w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl font-black font-mono text-xs uppercase shadow transition-all border tracking-widest
            ${isCharged && isActive && !isCpu
              ? 'hack-button-active text-white border-none cursor-pointer hover:scale-[1.01] active:scale-[0.99] shadow-[0_0_15px_rgba(255,0,127,0.5)]'
              : 'bg-white/5 border-white/10 text-white/20 cursor-not-allowed'
            }
            ${isCharged && isCpu ? 'bg-[#ff007f]/10 border-dashed border-[#ff007f]/40 animate-pulse text-[#ff007f]' : ''}
          `}
        >
          <Radio className={`w-3.5 h-3.5 ${isCharged ? 'animate-pulse text-[#fffb00]' : ''}`} />
          {isCharged && isCpu ? (
            <span>HACK READY (AI WILL USE)</span>
          ) : (
            <span>全権掌握（コード・ハック）</span>
          )}
        </button>

        {/* Informative hack conditions */}
        <div className="text-[9px] text-[#8C8C92] italic leading-relaxed">
          ※ 相手 detour 駒を取るごとに +20% チャージ。100%になると王(玉)の周囲2マス(5x5マス)にいる敵の駒を全てハックし洗脳できます。
        </div>
      </div>
    </div>
  );
}
