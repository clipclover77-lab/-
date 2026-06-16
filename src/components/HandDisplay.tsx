import { Piece, PieceType, DEMOTION_MAP } from '../shogiEngine';
import { Zap, ShieldAlert, Laptop, Radio } from 'lucide-react';
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
        p-4 rounded-2xl border transition-all duration-300 w-full max-w-[340px] shadow-2xl flex flex-col justify-between glass-panel
        ${isActive
          ? 'border-[#D4AF37]/50 ring-1 ring-[#D4AF37]/20 shadow-[#D4AF37]/5 bg-[#1E1E23]/95'
          : 'border-white/5 bg-[#141416]/70 opacity-80'
        }
      `}
    >
      {/* Player Header */}
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${isSente ? 'bg-[#D4AF37]' : 'bg-[#FF4500]'}`} />
          <span className="font-bold text-sm md:text-base text-[#E2E2E2] flex items-center gap-1.5 animate-none">
            {playerName}
            <span className="text-xs text-white/40 font-mono">
              ({player})
            </span>
          </span>
        </div>
        {isCpu && (
          <span className="text-[10px] bg-white/5 text-white/60 font-mono px-1.5 py-0.5 rounded border border-white/10 uppercase tracking-widest">
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
          <div className="text-center py-3 text-xs italic text-white/20 border border-dashed border-white/5 rounded-lg bg-black/25">
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
                    relative flex items-center justify-center w-11 h-12 rounded-lg border font-bold text-sm transition-all shadow-md
                    ${isSelectedType
                      ? 'bg-[#3D3A30] border-[#D4AF37] scale-105 shadow-md'
                      : 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-white/90 hover:border-white/20'
                    }
                    ${isActive ? 'cursor-pointer' : 'cursor-default'}
                  `}
                >
                  <span className="text-[#E2E2E2] font-serif select-none">
                    {type}
                  </span>

                  {/* Quantity Indicator badge */}
                  {data.indices.length > 1 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-[#FF4500] text-white font-mono text-[9px] w-4 h-4 rounded-full flex items-center justify-center border border-[#1A1A1D] shadow font-bold">
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
      <div className="border-t border-white/5 pt-3 flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-bold text-[#FF4500] font-mono uppercase tracking-widest flex items-center gap-1">
            <Zap className={`w-3.5 h-3.5 ${isCharged ? 'text-[#FF4500] animate-pulse' : 'text-white/30'}`} />
            HACK ENERGY
          </span>
          <span className={`font-mono text-xs font-bold ${isCharged ? 'text-[#FF4500] animate-pulse' : 'text-white/60'}`}>
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
            w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl font-bold font-mono text-xs uppercase shadow transition-all border tracking-widest
            ${isCharged && isActive && !isCpu
              ? 'hack-button-active text-white border-none cursor-pointer hover:scale-[1.01] active:scale-[0.99]'
              : 'bg-white/5 border-white/10 text-white/20 cursor-not-allowed'
            }
            ${isCharged && isCpu ? 'bg-[#FF4500]/10 border-dashed border-[#FF4500]/40 animate-pulse text-[#FF4500]' : ''}
          `}
        >
          <Radio className={`w-3.5 h-3.5 ${isCharged ? 'animate-pulse' : ''}`} />
          {isCharged && isCpu ? (
            <span>HACK READY (AI WILL USE)</span>
          ) : (
            <span>全権掌握（システム・ジャック）</span>
          )}
        </button>

        {/* Informative hack conditions */}
        <div className="text-[9px] text-[#8C8C92] italic leading-relaxed">
          ※ 相手の駒を取るごとに +20% チャージ。100%になると王(玉)の周囲2マス(5x5マス)にいる敵の駒を全てハックし洗脳できます。
        </div>
      </div>
    </div>
  );
}
