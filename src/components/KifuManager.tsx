import { useState } from 'react';
import { KifuMove, PlayerColor, getInitialBoard, DEMOTION_MAP, Piece, BoardState } from '../shogiEngine';
import { Play, SkipForward, SkipBack, Trash2, ClipboardCheck, ClipboardCopy, Save, ListRestart } from 'lucide-react';

interface SavedKifu {
  id: string;
  title: string;
  playerSente: string;
  playerGote: string;
  moves: KifuMove[];
  winner: PlayerColor | null;
  date: string;
}

interface KifuManagerProps {
  savedKifus: SavedKifu[];
  onLoadKifu: (kifu: SavedKifu) => void;
  onDeleteKifu: (id: string) => void;
  activeReviewKifu: SavedKifu | null;
  onCloseReview: () => void;
}

export function KifuManager({
  savedKifus,
  onLoadKifu,
  onDeleteKifu,
  activeReviewKifu,
  onCloseReview,
}: KifuManagerProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // States for the interactive kifu replayer
  const [currentStep, setCurrentStep] = useState<number>(0);

  // Reconstruct board at current step
  const reconstructBoardAtStep = (moves: KifuMove[], step: number): BoardState => {
    const board = getInitialBoard();
    
    // Play through moves up to step
    for (let i = 0; i < step; i++) {
      const move = moves[i];
      if (move.from === null) {
        // Drop from hand
        // In simple reconstruction, just place it on board
        const nextId = `${move.player === '先手' ? 's' : 'g'}_${move.pieceType}_review_${i}`;
        board[move.to.r][move.to.c] = {
          id: nextId,
          type: move.pieceType,
          player: move.player,
        };
      } else {
        // Standard move
        const piece = board[move.from.r][move.from.c];
        if (piece) {
          board[move.to.r][move.to.c] = {
            ...piece,
            type: move.wasPromoted ? (DEMOTION_MAP[piece.type] === '歩' ? 'と' : 'と') : piece.type, // Basic promo logic visual, if wasPromoted was true, make sure to promote type
          };
          // Correct type if promoted
          if (move.wasPromoted) {
            const currentBase = DEMOTION_MAP[piece.type];
            if (currentBase === '歩') board[move.to.r][move.to.c]!.type = 'と';
            else if (currentBase === '香') board[move.to.r][move.to.c]!.type = '成香';
            else if (currentBase === '桂') board[move.to.r][move.to.c]!.type = '成桂';
            else if (currentBase === '銀') board[move.to.r][move.to.c]!.type = '成銀';
            else if (currentBase === '角') board[move.to.r][move.to.c]!.type = '馬';
            else if (currentBase === '飛') board[move.to.r][move.to.c]!.type = '竜';
          }
          board[move.from.r][move.from.c] = null;
        }
      }
    }
    return board;
  };

  // Build full notation text export
  const buildKifuTextExport = (kifu: SavedKifu): string => {
    let text = `【超必殺ハック将棋 棋譜データ】\n`;
    text += `対局日: ${kifu.date}\n`;
    text += `先手: ${kifu.playerSente}\n`;
    text += `後手: ${kifu.playerGote}\n`;
    text += `勝者: ${kifu.winner ? kifu.winner : '引き分け'}\n`;
    text += `手動手順:\n`;
    kifu.moves.forEach((m, idx) => {
      text += `${idx + 1}: ${m.japaneseNotation}\n`;
    });
    return text;
  };

  const handleCopyKifuText = (kifu: SavedKifu) => {
    const kifuText = buildKifuTextExport(kifu);
    navigator.clipboard.writeText(kifuText);
    setCopiedId(kifu.id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  if (activeReviewKifu) {
    const currentBoard = reconstructBoardAtStep(activeReviewKifu.moves, currentStep);
    
    return (
      <div id="kifu_replayer" className="p-6 rounded-2xl shadow-2xl w-full max-w-[620px] flex flex-col md:flex-row gap-6 glass-panel border border-white/5">
        
        {/* Left Side: Board State Static Map */}
        <div className="flex flex-col items-center">
          <div className="text-sm font-bold text-white flex items-center gap-2 mb-2">
            <span>リプレイ再現盤面 ({currentStep}手目)</span>
          </div>

          <div className="grid grid-cols-9 grid-rows-9 gap-[1px] bg-white/5 p-[1px] rounded border border-white/10"
               style={{ width: '270px', height: '270px' }}>
            {currentBoard.map((row, rIdx) =>
              row.map((piece, cIdx) => (
                <div
                  key={`review_cell_${rIdx}_${cIdx}`}
                  className="bg-[#18181B] flex items-center justify-center relative select-none rounded-[1.5px]"
                >
                  {piece && (
                    <div className={`text-xs font-bold leading-none ${piece.player === '後手' ? 'rotate-180 text-[#FF4500]' : 'text-[#D4AF37]'} select-none`}>
                      {piece.type}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="text-[10px] text-white/40 mt-2 font-mono">
            先手: {activeReviewKifu.playerSente} • 後手: {activeReviewKifu.playerGote}
          </div>
        </div>

        {/* Right Side: Move Logs and Control keys */}
        <div className="flex-1 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start mb-2 border-b border-white/5 pb-2">
              <div>
                <h3 className="font-bold text-white text-sm">{activeReviewKifu.title}</h3>
                <span className="text-[10px] text-white/40 font-mono">{activeReviewKifu.date}</span>
              </div>
              <button
                onClick={onCloseReview}
                className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold px-2.5 py-1 rounded-lg cursor-pointer transition"
              >
                終了
              </button>
            </div>

            {/* Move Lists with Scroll */}
            <div className="max-h-[160px] overflow-y-auto mb-4 border border-white/5 bg-black/25 p-2 rounded-lg scrollbar">
              {activeReviewKifu.moves.length === 0 ? (
                <div className="text-center italic text-xs text-white/30 py-2">何も手順がありません</div>
              ) : (
                <div className="grid grid-cols-1 gap-1 text-xs">
                  {activeReviewKifu.moves.map((move, idx) => {
                    const isSelected = currentStep === idx + 1;
                    return (
                      <button
                        key={`log_move_${idx}`}
                        onClick={() => setCurrentStep(idx + 1)}
                        className={`text-left px-2 py-1 rounded transition flex justify-between items-center ${
                          isSelected 
                            ? 'bg-gradient-to-r from-[#D4AF37]/20 to-transparent border-l-2 border-[#D4AF37] px-2.5 text-[#D4AF37] font-bold' 
                            : 'hover:bg-white/5 text-white/60'
                        }`}
                      >
                        <span>{idx + 1}. {move.player}: {move.japaneseNotation}</span>
                        {isSelected && <span className="text-[9px] font-mono tracking-widest bg-[#D4AF37]/10 px-1 rounded">ACTIVE</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Stepper Buttons */}
          <div className="flex flex-col gap-2">
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
                disabled={currentStep === 0}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 bg-white/5 text-white border border-white/10 hover:bg-white/10 rounded-lg disabled:opacity-30 select-none cursor-pointer text-xs transition"
              >
                <SkipBack className="w-3.5 h-3.5" />
                戻る
              </button>
              
              <button
                onClick={() => setCurrentStep(Math.min(activeReviewKifu.moves.length, currentStep + 1))}
                disabled={currentStep === activeReviewKifu.moves.length}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 bg-gradient-to-r from-[#FF4500] to-[#B22222] text-white hover:opacity-95 rounded-lg disabled:opacity-30 select-none cursor-pointer text-xs font-bold transition"
              >
                進む
                <SkipForward className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              onClick={() => handleCopyKifuText(activeReviewKifu)}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-bold text-white/80 cursor-pointer transition"
            >
              {copiedId === activeReviewKifu.id ? (
                <>
                  <ClipboardCheck className="w-3.5 h-3.5 text-[#D4AF37]" />
                  棋譜をコピーしました
                </>
              ) : (
                <>
                  <ClipboardCopy className="w-3.5 h-3.5 text-white/40" />
                  棋譜をクリップボードにコピー
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="kifu_archiver_panel" className="p-6 rounded-2xl shadow-2xl w-full max-w-[500px] glass-panel">
      <div className="flex items-center gap-2 mb-4 border-b border-white/5 pb-2">
        <h2 className="text-base font-bold text-white">
          棋譜アーカイブ (Saved Games)
        </h2>
        <span className="text-[10px] bg-white/5 text-[#D4AF37] px-2 py-0.5 rounded font-mono font-bold border border-white/5">
          {savedKifus.length} 件
        </span>
      </div>

      {savedKifus.length === 0 ? (
        <div className="text-center py-7 text-xs text-white/30 italic border border-dashed border-white/5 rounded-xl bg-black/10">
          保存された棋譜レコードはまだありません。<br />対局完了後に盤面データを保存できます。
        </div>
      ) : (
        <div className="flex flex-col gap-3 max-h-[300px] overflow-y-auto pr-1 scrollbar">
          {savedKifus.map((kifu) => (
            <div
              key={kifu.id}
              className="border border-white/5 rounded-xl p-3 bg-white/[0.02] flex justify-between items-center group hover:border-[#D4AF37]/30 transition duration-200"
            >
              <div className="flex-1 min-w-0 mr-3">
                <div className="flex items-center gap-1.5 mb-1 bg-transparent">
                  <span className="font-bold text-xs text-white truncate block">
                    {kifu.title}
                  </span>
                  <span className="text-[9px] text-white/45 font-mono flex-shrink-0">
                    ({kifu.moves.length}手)
                  </span>
                </div>
                <div className="text-[10px] text-white/60 flex flex-wrap gap-2 truncate">
                  <span>先手: {kifu.playerSente}</span>
                  <span>vs</span>
                  <span>後手: {kifu.playerGote}</span>
                </div>
                <span className="text-[8px] text-white/40 block mt-1 font-mono">
                  {kifu.date}
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => onLoadKifu(kifu)}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/90 hover:text-white transition cursor-pointer"
                  title="盤面リプレイ"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                </button>

                <button
                  onClick={() => handleCopyKifuText(kifu)}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/90 hover:text-white transition cursor-pointer"
                  title="テキストコピー"
                >
                  {copiedId === kifu.id ? (
                    <ClipboardCheck className="w-3.5 h-3.5 text-[#D4AF37]" />
                  ) : (
                    <ClipboardCopy className="w-3.5 h-3.5" />
                  )}
                </button>

                <button
                  onClick={() => onDeleteKifu(kifu.id)}
                  className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition cursor-pointer"
                  title="削除"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
