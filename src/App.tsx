import { useState, useEffect, useRef } from 'react';
import {
  BoardState,
  Piece,
  Position,
  PlayerColor,
  PieceType,
  PROMOTION_MAP,
  DEMOTION_MAP,
  getInitialBoard,
  getValidMoves,
  canDropPiece,
  isKingInCheck,
  getHackedTiles,
  findKing,
  hasAnyLegalMoves,
  toJapaneseNotation,
  isPromotionForced,
  isInPromotionZone,
  KifuMove
} from './shogiEngine';

import { calculateBestCpuMove } from './components/CpuController';
import { ShogiBoard } from './components/ShogiBoard';
import { HandDisplay } from './components/HandDisplay';
import { KifuManager } from './components/KifuManager';

import {
  db,
  isFirebaseConfigured,
  handleFirestoreError,
  OperationType,
  ensureSignedIn
} from './firebase';
import { doc, onSnapshot, updateDoc, setDoc } from 'firebase/firestore';

import {
  playPieceMoveSound,
  playCaptureSound,
  playPromotionSound,
  playChargeSound,
  playKingHackSound,
  playCheckAlarmSound
} from './utils/audio';

import {
  Zap,
  Sword,
  ShieldAlert,
  Save,
  RotateCcw,
  BookOpen,
  Trophy,
  Share2,
  RefreshCw,
  Home,
  MessageSquare,
  HelpCircle,
  Clock,
  ChevronRight,
  Sparkles,
  Layers,
  Users
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface SavedKifu {
  id: string;
  title: string;
  playerSente: string;
  playerGote: string;
  moves: KifuMove[];
  winner: PlayerColor | null;
  date: string;
}

export default function App() {
  // Navigation tabs
  const [activeTab, setActiveTab] = useState<'play' | 'saved' | 'rules'>('play');

  // Core Game State
  const [gameMode, setGameMode] = useState<'vs_player' | 'vs_ai' | 'online' | null>(null);
  const [board, setBoard] = useState<BoardState>(getInitialBoard());
  const [activePlayer, setActivePlayer] = useState<PlayerColor>('先手');
  const [senteHand, setSenteHand] = useState<Piece[]>([]);
  const [goteHand, setGoteHand] = useState<Piece[]>([]);
  const [senteCharge, setSenteCharge] = useState<number>(0);
  const [goteCharge, setGoteCharge] = useState<number>(0);
  
  // Selection States
  const [selectedPos, setSelectedPos] = useState<Position | null>(null);
  const [selectedHandPiece, setSelectedHandPiece] = useState<{
    player: PlayerColor;
    type: PieceType;
    index: number;
  } | null>(null);
  const [legalMoves, setLegalMoves] = useState<Position[]>([]);
  
  // Highlighting last move
  const [lastMove, setLastMove] = useState<{ from: Position | null; to: Position } | null>(null);
  
  // Game Status
  const [winner, setWinner] = useState<PlayerColor | null>(null);
  const [kingInCheck, setKingInCheck] = useState<PlayerColor | null>(null);
  const [aiIsThinking, setAiIsThinking] = useState<boolean>(false);
  const [movesLog, setMovesLog] = useState<KifuMove[]>([]);

  // Promotion choice pending
  const [pendingPromo, setPendingPromo] = useState<{
    from: Position;
    to: Position;
    piece: Piece;
  } | null>(null);

  // Holographic hacked flash animation overlay
  const [hackedFlashTiles, setHackedFlashTiles] = useState<Position[]>([]);
  const [glitchMessage, setGlitchMessage] = useState<string | null>(null);

  // Player Settings / Online Profile
  const [playerName, setPlayerName] = useState<string>('先手棋士');
  const [onlineRole, setOnlineRole] = useState<'先手' | '後手' | null>(null);
  const [onlineOpponentName, setOnlineOpponentName] = useState<string>('対戦相手');
  const [onlineMatchId, setOnlineMatchId] = useState<string | null>(null);

  // Saved kifus list
  const [savedKifus, setSavedKifus] = useState<SavedKifu[]>(() => {
    const raw = localStorage.getItem('shogi_kifus');
    return raw ? JSON.parse(raw) : [];
  });
  const [activeReviewKifu, setActiveReviewKifu] = useState<SavedKifu | null>(null);
  const [kifuSaveTitle, setKifuSaveTitle] = useState<string>('');
  const [showSaveKifuModal, setShowSaveKifuModal] = useState<boolean>(false);

  // Real-time Firestore Subscriptions
  const onSnapshotUnsubscribe = useRef<(() => void) | null>(null);

  // Load profile name
  useEffect(() => {
    const cached = localStorage.getItem('shogi_player_name');
    if (cached) setPlayerName(cached);
  }, []);

  const handleSetPlayerName = (name: string) => {
    setPlayerName(name);
    localStorage.setItem('shogi_player_name', name);
  };

  // Subscribe to real-time online game rooms
  useEffect(() => {
    if (gameMode === 'online' && onlineMatchId) {
      const matchDocRef = doc(db, 'matches', onlineMatchId);
      onSnapshotUnsubscribe.current = onSnapshot(matchDocRef, (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          
          // Deserialize board
          const serverBoard = JSON.parse(data.board) as BoardState;
          const serverSenteHand = JSON.parse(data.senteHand) as Piece[];
          const serverGoteHand = JSON.parse(data.goteHand) as Piece[];
          const serverMoves = JSON.parse(data.moves) as KifuMove[];
          const serverLastMoveStr = data.lastMove ? JSON.parse(data.lastMove) : null;

          setBoard(serverBoard);
          setSenteHand(serverSenteHand);
          setGoteHand(serverGoteHand);
          setSenteCharge(data.senteCharge);
          setGoteCharge(data.goteCharge);
          setActivePlayer(data.turn as PlayerColor);
          setMovesLog(serverMoves);
          setLastMove(serverLastMoveStr);

          // Update opponent names
          if (onlineRole === '先手') {
            setOnlineOpponentName(data.goteName || '対戦相手の入室待ち...');
          } else {
            setOnlineOpponentName(data.senteName || '先手');
          }

          if (data.status === 'finished' && data.winner) {
            setWinner(data.winner as PlayerColor);
          }

          // Evaluate check state for visual highlights
          if (isKingInCheck('先手', serverBoard)) {
            setKingInCheck('先手');
          } else if (isKingInCheck('後手', serverBoard)) {
            setKingInCheck('後手');
          } else {
            setKingInCheck(null);
          }
        }
      }, (err) => {
        handleFirestoreError(err, OperationType.GET, `matches/${onlineMatchId}`);
      });
    }

    return () => {
      if (onSnapshotUnsubscribe.current) {
        onSnapshotUnsubscribe.current();
        onSnapshotUnsubscribe.current = null;
      }
    };
  }, [gameMode, onlineMatchId, onlineRole]);

  // Synchronize game choices to Firestore
  const syncMatchToFirestore = async (
    nextBoard: BoardState,
    nextSenteHand: Piece[],
    nextGoteHand: Piece[],
    nextSenteCharge: number,
    nextGoteCharge: number,
    nextTurn: PlayerColor,
    nextMoves: KifuMove[],
    nextWinner: PlayerColor | null,
    nextLastMove: { from: Position | null; to: Position } | null
  ) => {
    if (!onlineMatchId) return;
    try {
      await updateDoc(doc(db, 'matches', onlineMatchId), {
        board: JSON.stringify(nextBoard),
        senteHand: JSON.stringify(nextSenteHand),
        goteHand: JSON.stringify(nextGoteHand),
        senteCharge: nextSenteCharge,
        goteCharge: nextGoteCharge,
        turn: nextTurn,
        moves: JSON.stringify(nextMoves),
        lastMove: nextLastMove ? JSON.stringify(nextLastMove) : '',
        status: nextWinner ? 'finished' : 'playing',
        winner: nextWinner || '',
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error('Failed to sync to Firestore: ', e);
    }
  };

  // Check AI Turn Trigger (VS AI Mode)
  useEffect(() => {
    if (gameMode === 'vs_ai' && activePlayer === '後手' && !winner && !aiIsThinking) {
      setAiIsThinking(true);
      
      const timer = setTimeout(() => {
        executeAiMove();
      }, 750); // Natural visual delay

      return () => clearTimeout(timer);
    }
  }, [gameMode, activePlayer, winner]);

  // Execute CPU AI's move selection
  const executeAiMove = () => {
    // 1. CPU Stargazer Sweep Action Evaluation
    let cpuStargazerPos: Position | null = null;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const p = board[r][c];
        if (p && p.type === 'スターゲイザー' && p.player === '後手') {
          cpuStargazerPos = { r, c };
          break;
        }
      }
      if (cpuStargazerPos) break;
    }

    if (cpuStargazerPos) {
      const { r, c } = cpuStargazerPos;
      const sweptTiles: Position[] = [];
      let containsSenteKing = false;
      let targetPiecesCount = 0;

      // For Gote ('後手'), front vertical column is row > r
      for (let row = r + 1; row < 9; row++) {
        const targetPiece = board[row][c];
        if (targetPiece) {
          sweptTiles.push({ r: row, c });
          if (targetPiece.player === '先手') {
            targetPiecesCount++;
            if (targetPiece.type === '玉') {
              containsSenteKing = true;
            }
          }
        }
      }

      // If Sente's King is in range, or with 50% probability if there are multiple targets, shoot the laser column sweep!
      if (containsSenteKing || (targetPiecesCount >= 2 && Math.random() < 0.50)) {
        executeStargazerSweep(cpuStargazerPos);
        setAiIsThinking(false);
        return;
      }
    }

    // 2. CPU Rook-to-Stargazer Transformation Option
    if (goteCharge >= 100) {
      let rookPos: Position | null = null;
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          const p = board[r][c];
          if (p && p.player === '後手' && (p.type === '飛' || p.type === '竜')) {
            rookPos = { r, c };
            break;
          }
        }
        if (rookPos) break;
      }

      // 50% chance to transform Rook to Stargazer instead of using System Jack (or normal moves)
      if (rookPos && Math.random() < 0.50) {
        transformRookToStargazer(rookPos);
        setAiIsThinking(false);
        return;
      }
    }

    const decision = calculateBestCpuMove(board, goteHand, goteCharge);

    if (decision === 'HACK') {
      // AI triggers a King Hack!
      triggerKingHack('後手');
      setAiIsThinking(false);
      return;
    }

    const { from, to, pieceType, promote, dropType } = decision;

    let nextBoard = board.map((row) => [...row]);
    let nextSenteHand = [...senteHand];
    let nextGoteHand = [...goteHand];
    let nextSenteCharge = senteCharge;
    let nextGoteCharge = goteCharge;
    let capturedPiece: Piece | null = null;

    if (from === null && dropType) {
      // AI Drop
      const pieceIdx = goteHand.findIndex((p) => p.type === dropType);
      const pieceToDrop = goteHand[pieceIdx];
      
      nextBoard[to.r][to.c] = {
        ...pieceToDrop,
        player: '後手',
      };
      nextGoteHand.splice(pieceIdx, 1);
      
      playPieceMoveSound();
    } else if (from) {
      // AI Slide move
      const originalPiece = board[from.r][from.c]!;
      capturedPiece = board[to.r][to.c];

      let finalType = originalPiece.type;
      if (promote) {
        finalType = PROMOTION_MAP[originalPiece.type];
        playPromotionSound();
      } else {
        playPieceMoveSound();
      }

      nextBoard[to.r][to.c] = {
        ...originalPiece,
        type: finalType,
      };
      nextBoard[from.r][from.c] = null;

      if (capturedPiece) {
        // Carry over capture
        const baseType = DEMOTION_MAP[capturedPiece.type];
        nextGoteHand.push({
          id: `g_${baseType}_${Math.random().toString(36).substring(2, 6)}`,
          type: baseType,
          player: '後手',
        });
        
        playCaptureSound();
        nextGoteCharge = Math.min(100, nextGoteCharge + 20);
        if (nextGoteCharge === 100) {
          playPromotionSound(); // Extra alert
        }
      }
    }

    const nextTurn: PlayerColor = '先手';
    
    // Log Kifu move
    const isDrop = from === null;
    const isPromotion = !!promote;
    const prevMove = movesLog.length > 0 ? movesLog[movesLog.length - 1] : null;
    const finalLoggedType = from === null ? dropType! : board[from.r][from.c]!.type;
    const notation = toJapaneseNotation(from, to, finalLoggedType, isDrop, isPromotion, prevMove);

    const loggedMove: KifuMove = {
      from,
      to,
      pieceType: finalLoggedType,
      wasPromoted: isPromotion,
      capturedPieceType: capturedPiece?.type,
      player: '後手',
      moveNumber: movesLog.length + 1,
      japaneseNotation: notation,
    };

    const nextMoves = [...movesLog, loggedMove];

    // Evaluate Check state & Checkmate
    let currentInCheck: PlayerColor | null = null;
    let nextWinner: PlayerColor | null = null;

    const senteKingPos = findKing('先手', nextBoard);
    const goteKingPos = findKing('後手', nextBoard);

    if (!senteKingPos && !goteKingPos) {
      nextWinner = '後手';
    } else if (!senteKingPos) {
      nextWinner = '後手';
    } else if (!goteKingPos) {
      nextWinner = '先手';
    } else {
      if (isKingInCheck('先手', nextBoard)) {
        currentInCheck = '先手';
        playCheckAlarmSound();
      }

      if (!hasAnyLegalMoves('先手', nextBoard, nextSenteHand)) {
        // Sente is checkmated
        nextWinner = '後手';
      }
    }

    setBoard(nextBoard);
    setSenteHand(nextSenteHand);
    setGoteHand(nextGoteHand);
    setGoteCharge(nextGoteCharge);
    setActivePlayer(nextTurn);
    setLastMove({ from, to });
    setMovesLog(nextMoves);
    setKingInCheck(currentInCheck);
    if (nextWinner) setWinner(nextWinner);

    setAiIsThinking(false);
  };

  // Perform Standard move on the board (Sente or Gote)
  const executeStandardMove = (
    from: Position,
    to: Position,
    promote: boolean
  ) => {
    const originalPiece = board[from.r][from.c]!;
    const capturedPiece = board[to.r][to.c];

    let nextBoard = board.map((row) => [...row]);
    let nextSenteHand = [...senteHand];
    let nextGoteHand = [...goteHand];
    let nextSenteCharge = senteCharge;
    let nextGoteCharge = goteCharge;

    const finalType = promote ? PROMOTION_MAP[originalPiece.type] : originalPiece.type;

    nextBoard[to.r][to.c] = {
      ...originalPiece,
      type: finalType,
    };
    nextBoard[from.r][from.c] = null;

    if (promote) {
      playPromotionSound();
    } else {
      playPieceMoveSound();
    }

    if (capturedPiece) {
      const baseType = DEMOTION_MAP[capturedPiece.type];
      const nextPieceObj: Piece = {
        id: `${activePlayer === '先手' ? 's' : 'g'}_${baseType}_${Math.random().toString(36).substring(2, 6)}`,
        type: baseType,
        player: activePlayer,
      };

      if (activePlayer === '先手') {
        nextSenteHand.push(nextPieceObj);
        nextSenteCharge = Math.min(100, nextSenteCharge + 20);
        if (nextSenteCharge === 100) playPromotionSound();
      } else {
        nextGoteHand.push(nextPieceObj);
        nextGoteCharge = Math.min(100, nextGoteCharge + 20);
        if (nextGoteCharge === 100) playPromotionSound();
      }

      playCaptureSound();
    }

    // Toggle Sente/Gote turns
    const nextTurn: PlayerColor = activePlayer === '先手' ? '後手' : '先手';

    // Log Kifu move
    const prevMove = movesLog.length > 0 ? movesLog[movesLog.length - 1] : null;
    const notation = toJapaneseNotation(from, to, originalPiece.type, false, promote, prevMove);

    const loggedMove: KifuMove = {
      from,
      to,
      pieceType: originalPiece.type,
      wasPromoted: promote,
      capturedPieceType: capturedPiece?.type,
      player: activePlayer,
      moveNumber: movesLog.length + 1,
      japaneseNotation: notation,
    };

    const nextMoves = [...movesLog, loggedMove];

    // Evaluate Check state & Checkmate on next opponent
    let currentInCheck: PlayerColor | null = null;
    let nextWinner: PlayerColor | null = null;

    const senteKingPos = findKing('先手', nextBoard);
    const goteKingPos = findKing('後手', nextBoard);

    if (!senteKingPos && !goteKingPos) {
      nextWinner = activePlayer;
    } else if (!senteKingPos) {
      nextWinner = '後手';
    } else if (!goteKingPos) {
      nextWinner = '先手';
    } else {
      if (isKingInCheck(nextTurn, nextBoard)) {
        currentInCheck = nextTurn;
        playCheckAlarmSound();
      }

      const opponentHand = nextTurn === '先手' ? nextSenteHand : nextGoteHand;
      if (!hasAnyLegalMoves(nextTurn, nextBoard, opponentHand)) {
        nextWinner = activePlayer;
      }
    }

    // Update locally
    setBoard(nextBoard);
    setSenteHand(nextSenteHand);
    setGoteHand(nextGoteHand);
    setSenteCharge(nextSenteCharge);
    setGoteCharge(nextGoteCharge);
    setActivePlayer(nextTurn);
    setLastMove({ from, to });
    setMovesLog(nextMoves);
    setKingInCheck(currentInCheck);
    if (nextWinner) setWinner(nextWinner);

    // Sync online
    if (gameMode === 'online') {
      syncMatchToFirestore(
        nextBoard,
        nextSenteHand,
        nextGoteHand,
        nextSenteCharge,
        nextGoteCharge,
        nextTurn,
        nextMoves,
        nextWinner,
        { from, to }
      );
    }

    // Reset selection states
    setSelectedPos(null);
    setSelectedHandPiece(null);
    setLegalMoves([]);
  };

  // Perform Piece drop from player's hand tray
  const executeDropPiece = (
    pieceType: PieceType,
    to: Position
  ) => {
    if (!selectedHandPiece) return;

    let nextBoard = board.map((row) => [...row]);
    let nextSenteHand = [...senteHand];
    let nextGoteHand = [...goteHand];

    const targetHand = activePlayer === '先手' ? nextSenteHand : nextGoteHand;
    
    // Pick the piece from tray
    const pIdx = targetHand.findIndex((p) => p.type === pieceType);
    const pieceObj = targetHand[pIdx];

    nextBoard[to.r][to.c] = {
      ...pieceObj,
      player: activePlayer,
    };
    targetHand.splice(pIdx, 1);

    playPieceMoveSound();

    // Alternate turn
    const nextTurn: PlayerColor = activePlayer === '先手' ? '後手' : '先手';

    // Log Kifu
    const prevMove = movesLog.length > 0 ? movesLog[movesLog.length - 1] : null;
    const notation = toJapaneseNotation(null, to, pieceType, true, false, prevMove);

    const loggedMove: KifuMove = {
      from: null,
      to,
      pieceType,
      wasPromoted: false,
      player: activePlayer,
      moveNumber: movesLog.length + 1,
      japaneseNotation: notation,
    };

    const nextMoves = [...movesLog, loggedMove];

    let currentInCheck: PlayerColor | null = null;
    let nextWinner: PlayerColor | null = null;

    const senteKingPos = findKing('先手', nextBoard);
    const goteKingPos = findKing('後手', nextBoard);

    if (!senteKingPos && !goteKingPos) {
      nextWinner = activePlayer;
    } else if (!senteKingPos) {
      nextWinner = '後手';
    } else if (!goteKingPos) {
      nextWinner = '先手';
    } else {
      if (isKingInCheck(nextTurn, nextBoard)) {
        currentInCheck = nextTurn;
        playCheckAlarmSound();
      }

      const opponentHand = nextTurn === '先手' ? nextSenteHand : nextGoteHand;
      if (!hasAnyLegalMoves(nextTurn, nextBoard, opponentHand)) {
        nextWinner = activePlayer;
      }
    }

    // Set states
    setBoard(nextBoard);
    setSenteHand(nextSenteHand);
    setGoteHand(nextGoteHand);
    setActivePlayer(nextTurn);
    setLastMove({ from: null, to });
    setMovesLog(nextMoves);
    setKingInCheck(currentInCheck);
    if (nextWinner) setWinner(nextWinner);

    // Sync online
    if (gameMode === 'online') {
      syncMatchToFirestore(
        nextBoard,
        nextSenteHand,
        nextGoteHand,
        senteCharge,
        goteCharge,
        nextTurn,
        nextMoves,
        nextWinner,
        { from: null, to }
      );
    }

    setSelectedPos(null);
    setSelectedHandPiece(null);
    setLegalMoves([]);
  };

  // Trigger "King Hack" Ultra Special Move (100% Charge cost)
  const triggerKingHack = (actor: PlayerColor) => {
    // Locate King
    const kingPos = findKing(actor, board);
    if (!kingPos) return;

    // Identify victims
    const victims = getHackedTiles(kingPos.r, kingPos.c, actor, board);
    if (victims.length === 0) {
      setGlitchMessage(`${actor === '先手' ? '先手' : '後手'}がハッキングを起動！ しかし、範囲内に敵駒がいませんでした...`);
      setTimeout(() => setGlitchMessage(null), 3500);
      return;
    }

    let nextBoard = board.map((row) => [...row]);
    
    // Convert victims
    victims.forEach((pos) => {
      const p = nextBoard[pos.r][pos.c]!;
      nextBoard[pos.r][pos.c] = {
        ...p,
        player: actor, // Switch alliance ownership!
      };
    });

    // Reset charge
    let nextSenteCharge = senteCharge;
    let nextGoteCharge = goteCharge;
    if (actor === '先手') {
      nextSenteCharge = 0;
    } else {
      nextGoteCharge = 0;
    }

    // Dramatic FX flashes and audio chimes
    setHackedFlashTiles(victims);
    playKingHackSound();
    
    setGlitchMessage(`SYSTEM WARNING: ${actor === '先手' ? '先手' : '後手'}の【全権掌握（コード・ハック）】発動！ 範囲内の敵 ${victims.length} 駒が洗脳ハックされました！`);
    
    // Clear flash FX after 1.5s
    setTimeout(() => {
      setHackedFlashTiles([]);
      setGlitchMessage(null);
    }, 4500);

    const nextTurn: PlayerColor = actor === '先手' ? '後手' : '先手';

    // Log Kifu
    const loggedMove: KifuMove = {
      from: null,
      to: kingPos,
      pieceType: '玉',
      wasPromoted: false,
      player: actor,
      moveNumber: movesLog.length + 1,
      japaneseNotation: `▲王将ハック (ハック ${victims.length}枚)`,
    };

    const nextMoves = [...movesLog, loggedMove];

    let currentInCheck: PlayerColor | null = null;
    let nextWinner: PlayerColor | null = null;

    if (isKingInCheck(nextTurn, nextBoard)) {
      currentInCheck = nextTurn;
      playCheckAlarmSound();
    }

    const opponentHand = nextTurn === '先手' ? senteHand : goteHand;
    if (!hasAnyLegalMoves(nextTurn, nextBoard, opponentHand)) {
      nextWinner = actor;
    }

    setBoard(nextBoard);
    setSenteCharge(nextSenteCharge);
    setGoteCharge(nextGoteCharge);
    setActivePlayer(nextTurn);
    setMovesLog(nextMoves);
    setKingInCheck(currentInCheck);
    if (nextWinner) setWinner(nextWinner);

    // Sync online
    if (gameMode === 'online') {
      syncMatchToFirestore(
        nextBoard,
        senteHand,
        goteHand,
        nextSenteCharge,
        nextGoteCharge,
        nextTurn,
        nextMoves,
        nextWinner,
        { from: null, to: kingPos }
      );
    }

    // Clear selections
    setSelectedPos(null);
    setSelectedHandPiece(null);
    setLegalMoves([]);
  };

  // Trigger "Rook to Stargazer" Transformation (100% Charge cost)
  const transformRookToStargazer = (pos: Position) => {
    const originalPiece = board[pos.r][pos.c];
    if (!originalPiece || (originalPiece.type !== '飛' && originalPiece.type !== '竜')) return;
    
    const actor = originalPiece.player;
    const charge = actor === '先手' ? senteCharge : goteCharge;
    if (charge < 100) return;

    let nextBoard = board.map((row) => [...row]);
    nextBoard[pos.r][pos.c] = {
      ...originalPiece,
      id: `${actor === '先手' ? 's' : 'g'}_スターゲイザー_${Math.random().toString(36).substring(2, 6)}`,
      type: 'スターゲイザー',
    };

    // Reset charge
    let nextSenteCharge = senteCharge;
    let nextGoteCharge = goteCharge;
    if (actor === '先手') {
      nextSenteCharge = 0;
    } else {
      nextGoteCharge = 0;
    }

    playPromotionSound();
    
    setGlitchMessage(`SYSTEM WARNING: ${actor === '先手' ? '先手' : '後手'}の飛車が次元兵器【スターゲイザー】に変身しました！`);
    
    setTimeout(() => {
      setGlitchMessage(null);
    }, 4500);

    const nextTurn: PlayerColor = actor === '先手' ? '後手' : '先手';

    // Log Kifu
    const loggedMove: KifuMove = {
      from: pos,
      to: pos,
      pieceType: 'スターゲイザー',
      wasPromoted: true,
      player: actor,
      moveNumber: movesLog.length + 1,
      japaneseNotation: `${actor === '先手' ? '▲' : '△'}飛車変身 [天星]`,
    };

    const nextMoves = [...movesLog, loggedMove];

    // Evaluate win condition (missing King check)
    let currentInCheck: PlayerColor | null = null;
    let nextWinner: PlayerColor | null = null;

    const senteKingPos = findKing('先手', nextBoard);
    const goteKingPos = findKing('後手', nextBoard);

    if (!senteKingPos && !goteKingPos) {
      nextWinner = actor;
    } else if (!senteKingPos) {
      nextWinner = '後手';
    } else if (!goteKingPos) {
      nextWinner = '先手';
    } else {
      if (isKingInCheck(nextTurn, nextBoard)) {
        currentInCheck = nextTurn;
        playCheckAlarmSound();
      }
      const opponentHand = nextTurn === '先手' ? senteHand : goteHand;
      if (!hasAnyLegalMoves(nextTurn, nextBoard, opponentHand)) {
        nextWinner = actor;
      }
    }

    setBoard(nextBoard);
    setSenteCharge(nextSenteCharge);
    setGoteCharge(nextGoteCharge);
    setActivePlayer(nextTurn);
    setMovesLog(nextMoves);
    setKingInCheck(currentInCheck);
    if (nextWinner) setWinner(nextWinner);

    // Sync online
    if (gameMode === 'online') {
      syncMatchToFirestore(
        nextBoard,
        senteHand,
        goteHand,
        nextSenteCharge,
        nextGoteCharge,
        nextTurn,
        nextMoves,
        nextWinner,
        { from: pos, to: pos }
      );
    }

    // Clear selections
    setSelectedPos(null);
    setSelectedHandPiece(null);
    setLegalMoves([]);
  };

  // Trigger "Stargazer Column Sweep" (Deletes everything in front vertical column)
  const executeStargazerSweep = (pos: Position) => {
    const originalPiece = board[pos.r][pos.c];
    if (!originalPiece || originalPiece.type !== 'スターゲイザー') return;

    const actor = originalPiece.player;
    let nextBoard = board.map((row) => [...row]);
    
    const sweptTiles: Position[] = [];
    
    // Sente: rows < pos.r (moving up, so indices from 0 up to pos.r-1)
    // Gote: rows > pos.r (moving down, so indices from pos.r+1 up to 8)
    if (actor === '先手') {
      for (let row = 0; row < pos.r; row++) {
        sweptTiles.push({ r: row, c: pos.c });
      }
    } else {
      for (let row = pos.r + 1; row < 9; row++) {
        sweptTiles.push({ r: row, c: pos.c });
      }
    }

    if (sweptTiles.length === 0) {
      setGlitchMessage(`SYSTEM: スターゲイザーの前方に一掃可能な空間が存在しません。`);
      setTimeout(() => setGlitchMessage(null), 3000);
      return;
    }

    // Erase pieces in target tiles
    sweptTiles.forEach((tile) => {
      nextBoard[tile.r][tile.c] = null;
    });

    // Sound FX & Flashes
    setHackedFlashTiles(sweptTiles);
    playKingHackSound(); // Play epic hack sound
    playCheckAlarmSound(); // Overlay with warning sound

    setGlitchMessage(`SYSTEM PURGE: ${actor === '先手' ? '先手' : '後手'}の【スターゲイザー】レーザー照射！ 前方縦一列のすべての駒が消滅しました！`);

    setTimeout(() => {
      setHackedFlashTiles([]);
      setGlitchMessage(null);
    }, 4500);

    const nextTurn: PlayerColor = actor === '先手' ? '後手' : '先手';

    // Log Kifu
    const loggedMove: KifuMove = {
      from: pos,
      to: pos,
      pieceType: 'スターゲイザー',
      wasPromoted: false,
      player: actor,
      moveNumber: movesLog.length + 1,
      japaneseNotation: `${actor === '先手' ? '▲' : '△'}天星一掃 (縦列ビーム)`,
    };

    const nextMoves = [...movesLog, loggedMove];

    // Evaluate win condition (missing King check)
    let currentInCheck: PlayerColor | null = null;
    let nextWinner: PlayerColor | null = null;

    const senteKingPos = findKing('先手', nextBoard);
    const goteKingPos = findKing('後手', nextBoard);

    if (!senteKingPos && !goteKingPos) {
      nextWinner = actor;
    } else if (!senteKingPos) {
      nextWinner = '後手';
    } else if (!goteKingPos) {
      nextWinner = '先手';
    } else {
      if (isKingInCheck(nextTurn, nextBoard)) {
        currentInCheck = nextTurn;
        playCheckAlarmSound();
      }
      const opponentHand = nextTurn === '先手' ? senteHand : goteHand;
      if (!hasAnyLegalMoves(nextTurn, nextBoard, opponentHand)) {
        nextWinner = actor;
      }
    }

    setBoard(nextBoard);
    setActivePlayer(nextTurn);
    setMovesLog(nextMoves);
    setKingInCheck(currentInCheck);
    if (nextWinner) setWinner(nextWinner);

    // Sync online
    if (gameMode === 'online') {
      syncMatchToFirestore(
        nextBoard,
        senteHand,
        goteHand,
        senteCharge,
        goteCharge,
        nextTurn,
        nextMoves,
        nextWinner,
        { from: pos, to: pos }
      );
    }

    // Clear selections
    setSelectedPos(null);
    setSelectedHandPiece(null);
    setLegalMoves([]);
  };

  // Tile Selection / Interaction Router
  const handleTileClick = (r: number, c: number) => {
    // If online mode, make sure it is actually our turn
    if (gameMode === 'online') {
      if (activePlayer !== onlineRole) return;
    }
    // If AI's turn in VS AI, ignore clicking
    if (gameMode === 'vs_ai' && activePlayer === '後手') return;

    if (winner) return;

    const clickedPiece = board[r][c];

    // CASE 1: Clicked validation of an allied piece on board
    if (clickedPiece && clickedPiece.player === activePlayer) {
      setSelectedHandPiece(null);
      setSelectedPos({ r, c });

      // Generate moves, then filter out illegal moves that place King in danger (Anti-Suicidal move security)
      const rawMoves = getValidMoves(r, c, board);
      const safeMoves = rawMoves.filter((dest) => {
        // Simulate step
        const tempBoard = board.map((row) => [...row]);
        tempBoard[dest.r][dest.c] = tempBoard[r][c];
        tempBoard[r][c] = null;
        return !isKingInCheck(activePlayer, tempBoard);
      });

      setLegalMoves(safeMoves);
      return;
    }

    // CASE 2: Clicked on a destination cell with an active on-board selection
    if (selectedPos) {
      const isLegal = legalMoves.some((m) => m.r === r && m.c === c);
      if (isLegal) {
        const piece = board[selectedPos.r][selectedPos.c]!;
        
        // Promotion potential evaluation
        const SenteZone = r <= 2 || selectedPos.r <= 2;
        const GoteZone = r >= 6 || selectedPos.r >= 6;
        const eligibleForPromo =
          (activePlayer === '先手' ? SenteZone : GoteZone) &&
          originalCanPromote(piece.type);

        if (eligibleForPromo) {
          const mustPromote = isPromotionForced(piece.type, r, activePlayer);
          if (mustPromote) {
            executeStandardMove(selectedPos, { r, c }, true);
          } else {
            // Prompt the player with promotion options
            setPendingPromo({
              from: selectedPos,
              to: { r, c },
              piece,
            });
          }
        } else {
          executeStandardMove(selectedPos, { r, c }, false);
        }
      } else {
        // Clear selection if clicking elsewhere
        setSelectedPos(null);
        setLegalMoves([]);
      }
      return;
    }

    // CASE 3: Drop a chosen piece from hand tray
    if (selectedHandPiece) {
      if (selectedHandPiece.player !== activePlayer) return;

      const isLegalDrop = canDropPiece(selectedHandPiece.type, r, c, activePlayer, board).valid;
      if (isLegalDrop) {
        // Double check checks
        const tempBoard = board.map((row) => [...row]);
        tempBoard[r][c] = { id: 'temp', type: selectedHandPiece.type, player: activePlayer };
        const leavesKingInCheck = isKingInCheck(activePlayer, tempBoard);
        
        if (!leavesKingInCheck) {
          executeDropPiece(selectedHandPiece.type, { r, c });
        }
      } else {
        // Clear tray selection if clicked outside
        setSelectedHandPiece(null);
      }
      return;
    }
  };

  const originalCanPromote = (type: PieceType) => {
    return type in PROMOTION_MAP;
  };

  // Hand Piece Selection Router
  const handleSelectHandPiece = (
    player: PlayerColor,
    type: PieceType,
    index: number
  ) => {
    if (winner) return;
    if (player !== activePlayer) return;
    if (gameMode === 'online' && activePlayer !== onlineRole) return;

    // Highlight drop targets
    setSelectedPos(null);
    setSelectedHandPiece({ player, type, index });

    // Mark legal empty drop spaces across the board
    const drops: Position[] = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (canDropPiece(type, r, c, player, board).valid) {
          // Validate drop doesn't cause self check
          const tempBoard = board.map((row) => [...row]);
          tempBoard[r][c] = { id: 'test_drop', type, player };
          if (!isKingInCheck(player, tempBoard)) {
            drops.push({ r, c });
          }
        }
      }
    }
    setLegalMoves(drops);
  };

  // Join online room
  const handleJoinOnlineMatch = (
    matchId: string,
    role: '先手' | '後手',
    opponent: string
  ) => {
    setGameMode('online');
    setOnlineMatchId(matchId);
    setOnlineRole(role);
    setOnlineOpponentName(opponent);
    setActiveTab('play');
    resetGameEngineState();
  };

  // Reset core board state for clean matches
  const resetGameEngineState = () => {
    setBoard(getInitialBoard());
    setActivePlayer('先手');
    setSenteHand([]);
    setGoteHand([]);
    setSenteCharge(0);
    setGoteCharge(0);
    setSelectedPos(null);
    setSelectedHandPiece(null);
    setLegalMoves([]);
    setLastMove(null);
    setWinner(null);
    setKingInCheck(null);
    setMovesLog([]);
    setPendingPromo(null);
    setHackedFlashTiles([]);
  };

  const handleStartLocalVsPlayer = () => {
    setGameMode('vs_player');
    resetGameEngineState();
    setActiveTab('play');
  };

  const handleStartVsAi = () => {
    setGameMode('vs_ai');
    resetGameEngineState();
    setActiveTab('play');
  };

  // Resignation event handler
  const handleResign = async () => {
    if (window.confirm('投了（ギブアップ）しますか？')) {
      const loser = activePlayer;
      const winnerColor: PlayerColor = loser === '先手' ? '後手' : '先手';
      setWinner(winnerColor);

      if (gameMode === 'online' && onlineMatchId) {
        try {
          await updateDoc(doc(db, 'matches', onlineMatchId), {
            status: 'finished',
            winner: winnerColor,
            updatedAt: new Date().toISOString(),
          });
        } catch (e) {
          console.error(e);
        }
      }
    }
  };

  // Kifu archiving saving
  const handleOpenSaveKifu = () => {
    // Generate default title based on mode
    const dateStr = new Date().toLocaleDateString();
    let modeLabel = '対局';
    if (gameMode === 'vs_ai') modeLabel = 'CPU戦';
    if (gameMode === 'online') modeLabel = 'オンライン';
    setKifuSaveTitle(`${modeLabel} - ${dateStr} 棋譜記録`);
    setShowSaveKifuModal(true);
  };

  const handleSaveKifuConfirm = () => {
    if (!kifuSaveTitle.trim()) return;

    const newKifu: SavedKifu = {
      id: `kifu_${Math.random().toString(36).substring(2, 9)}`,
      title: kifuSaveTitle.trim(),
      playerSente: gameMode === 'online' && onlineRole === '後手' ? onlineOpponentName : (gameMode === 'vs_ai' ? playerName : '先手プレイヤー'),
      playerGote: gameMode === 'vs_ai' ? 'CPU AI' : (gameMode === 'online' && onlineRole === '先手' ? onlineOpponentName : '後手プレイヤー'),
      moves: movesLog,
      winner: winner,
      date: new Date().toLocaleString(),
    };

    const nextSaved = [newKifu, ...savedKifus];
    setSavedKifus(nextSaved);
    localStorage.setItem('shogi_kifus', JSON.stringify(nextSaved));

    // Reset modals
    setShowSaveKifuModal(false);
    alert('棋譜を保存しました。アーカイブタブでいつでも再現・コピーできます！');
  };

  const handleDeleteKifu = (id: string) => {
    if (window.confirm('この棋譜データをアーカイブから削除しますか？')) {
      const nextSaved = savedKifus.filter((k) => k.id !== id);
      setSavedKifus(nextSaved);
      localStorage.setItem('shogi_kifus', JSON.stringify(nextSaved));
    }
  };

  return (
    <div id="shogi_app_root" className="min-h-screen bg-[#07040d] text-[#f3f0fa] flex flex-col font-sans relative overflow-x-hidden">
      
      {/* Decorative cybernetic grid backgrounds */}
      <div className="absolute inset-0 bg-grid-pattern opacity-12 pointer-events-none z-0 animate-[pulse_10s_infinite]" />

      {/* Futuristic status alert banner overlay for hacks */}
      <AnimatePresence>
        {glitchMessage && (
          <motion.div
            initial={{ y: -60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -60, opacity: 0 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 bg-fuchsia-600/95 text-white font-mono text-xs md:text-sm shadow-[0_0_20px_rgba(255,0,127,0.6)] border border-[#ff007f] p-3 px-6 rounded-2xl z-50 flex items-center gap-2 max-w-[90vw] text-center"
          >
            <Sparkles className="w-5 h-5 animate-spin text-cyan-300" />
            <span className="font-bold">{glitchMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Header */}
      <header className="sticky top-0 bg-[#0e091a]/90 backdrop-blur-md border-b-2 border-cyan-500/30 z-40 py-3.5 px-4 md:px-8 flex justify-between items-center shadow-[0_4px_30px_rgba(0,240,255,0.15)]">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-gradient-to-tr from-[#ff007f] to-[#7b00ff] rounded-xl flex items-center justify-center text-white shadow-[0_0_12px_rgba(255,0,127,0.5)]">
            <Sword className="w-5 h-5 rotate-45 animate-pulse" />
          </div>
          <div>
            <h1 className="text-base md:text-xl font-extrabold tracking-widest leading-none bg-gradient-to-r from-[#00f0ff] via-[#fffb00] to-[#ff007f] bg-clip-text text-transparent flex items-center gap-1.5 drop-shadow-[0_0_6px_rgba(0,240,255,0.5)]">
              電脳将棋 CODE:HACK
            </h1>
            <p className="text-[10px] text-cyan-400/50 font-mono mt-0.5 tracking-wider">
              CYBERNETIC SHOGI ULTIMATE HACK ENGINE
            </p>
          </div>
        </div>

        {/* Tab Selection */}
        <nav className="flex gap-1 md:gap-2">
          <button
            onClick={() => {
              setActiveTab('play');
              setActiveReviewKifu(null);
            }}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer select-none border ${
              activeTab === 'play'
                ? 'bg-cyan-500/15 text-[#00f0ff] font-extrabold border-[#00f0ff]/60 shadow-[0_0_10px_rgba(0,240,255,0.25)]'
                : 'text-violet-200/40 border-transparent hover:text-white/80 hover:bg-white/5'
            }`}
          >
            <Sword className="w-3.5 h-3.5" />
            <span>対局</span>
          </button>
          
          <button
            onClick={() => setActiveTab('saved')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer select-none border ${
              activeTab === 'saved'
                ? 'bg-fuchsia-500/15 text-[#ff007f] font-extrabold border-[#ff007f]/60 shadow-[0_0_10px_rgba(255,0,127,0.25)]'
                : 'text-violet-200/40 border-transparent hover:text-white/80 hover:bg-white/5'
            }`}
          >
            <Save className="w-3.5 h-3.5" />
            <span>棋譜復元</span>
          </button>

          <button
            onClick={() => setActiveTab('rules')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer select-none border ${
              activeTab === 'rules'
                ? 'bg-amber-500/15 text-[#fffb00] font-extrabold border-[#fffb00]/60 shadow-[0_0_10px_rgba(255,251,0,0.25)]'
                : 'text-violet-200/40 border-transparent hover:text-white/80 hover:bg-white/5'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>遊び方</span>
          </button>
        </nav>
      </header>

      {/* Main Body view */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6 md:py-10 z-10 grid grid-cols-1 items-center justify-center">

        {/* 1. PLAY TAB */}
        {activeTab === 'play' && (
          <div className="flex flex-col items-center gap-6">

            {/* If no match is selected: match selection lobby */}
            {!gameMode ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.98, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                id="lobby_scaffholding"
                className="flex flex-col items-center text-center gap-8 max-w-2xl mx-auto w-full px-4"
              >
                
                {/* CYBERPUNK CHRONO TITLE CARD */}
                <div className="w-full p-8 md:p-10 rounded-[2.5rem] border-2 border-cyan-500/30 flex flex-col items-center bg-[#0d061b]/95 shadow-[0_0_40px_rgba(0,240,255,0.25),0_0_15px_rgba(255,0,127,0.15)] relative overflow-hidden backdrop-blur-md">
                  
                  {/* Glowing header accents */}
                  <div className="absolute top-0 left-0 w-full h-[4px] bg-gradient-to-r from-[#00f0ff] via-[#ff007f] to-[#fffb00]" />
                  
                  {/* Security Clearance Tag */}
                  <div className="absolute top-4 right-6 flex items-center gap-1.5 text-[8.5px] font-mono font-black tracking-widest text-[#ff007f] select-none animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#ff007f] shadow-[0_0_4px_#ff007f]" />
                    SECURE NODE ACCESS ACTIVE
                  </div>

                  <div className="absolute top-4 left-6 flex items-center gap-1.5 text-[8.5px] font-mono font-bold tracking-widest text-cyan-400/50 select-none">
                    PORT: 3000 / HOST: ONLINE
                  </div>

                  {/* Version tag */}
                  <div className="mt-4 mb-2 py-0.5 px-3 rounded-full bg-[#ff007f]/5 border border-[#ff007f]/30 text-[9px] font-mono font-extrabold text-[#fffb00] tracking-[0.2em] uppercase shadow-inner">
                    NEON EDITION v2.5.0
                  </div>

                  {/* Ultimate Neo Cyber Logo Grid */}
                  <div className="relative my-4 flex flex-col items-center select-none">
                    <span className="text-cyan-400/40 text-[10px] font-mono font-black uppercase tracking-[0.45em] mb-1.5">
                      CYBERNETIC SHOGI MATRIX
                    </span>
                    
                    <h2 className="text-4xl md:text-5xl font-black text-white tracking-widest uppercase relative font-sans drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]">
                      電脳将棋
                    </h2>
                    
                    <div className="mt-3 relative">
                      {/* Ambient background glow for the key BRANDING */}
                      <div className="absolute -inset-2 bg-gradient-to-r from-[#ff007f] to-[#00f0ff] rounded-lg blur-md opacity-40 select-none pointer-events-none" />
                      <span className="relative block text-3xl md:text-4xl font-mono tracking-[0.2em] text-[#00f0ff] font-black filter drop-shadow-[0_0_10px_rgba(0,240,255,0.8)]">
                        CODE:HACK
                      </span>
                    </div>
                  </div>

                  {/* Visual Divider line */}
                  <div className="flex items-center gap-3 w-64 my-4 text-cyan-500/20">
                    <div className="flex-1 h-[1.5px] bg-gradient-to-r from-transparent to-cyan-400/30" />
                    <Zap className="w-4 h-4 text-[#fffb00] animate-bounce drop-shadow-[0_0_4px_#fffb00]" />
                    <div className="flex-1 h-[1.5px] bg-gradient-to-l from-transparent to-fuchsia-500/30" />
                  </div>

                  {/* Interactive rules summary layout */}
                  <div className="text-white/85 space-y-3 leading-relaxed max-w-md text-xs md:text-sm bg-cyan-950/15 border border-cyan-500/20 p-5 rounded-2xl shadow-inner mt-1">
                    <p className="font-extrabold flex items-center justify-center gap-2 text-[#00f0ff] text-sm tracking-wider">
                      <Sparkles className="w-4 h-4 text-[#fffb00] animate-spin" />
                      <span>【全権掌握（コード・ハック）】システム概要</span>
                    </p>
                    <p className="text-violet-100/70 text-xs text-left leading-relaxed">
                      対局相手の駒を捕獲すると、ハックチャージエネルギーが<span className="text-[#ff007f] font-black px-1 border-b border-[#ff007f]/40">20%蓄積</span>されます。100%チャージ完了時に、王将が持つ究極奥義【全権掌握（コード・ハック）】の使用が許可されます。
                    </p>
                    <p className="text-violet-100/70 text-xs text-left leading-relaxed">
                      発動時、王の周囲2マスの範囲(5x5マス)に存在する<span className="text-[#00f0ff] font-extrabold">すべての敵駒を一瞬でハック（洗脳）</span>し、自軍の持ち駒として再構成する、支配的かつ最高にポップな超次元将棋ルール。
                    </p>
                  </div>

                  {/* Terminal systems line */}
                  <div className="flex items-center gap-4 mt-6 text-[9px] font-mono text-cyan-400/40 uppercase tracking-wider select-none">
                    <span>GRID: CONNECTED</span>
                    <span>•</span>
                    <span>AI CALIBRATED: YES</span>
                    <span>•</span>
                    <span>CORE RECTOR: ONLINE</span>
                  </div>
                </div>

                {/* PROTOCOL SELECTOR */}
                <div className="w-full flex flex-col gap-4">
                  <h3 className="text-[10px] text-cyan-400/40 font-mono font-black uppercase tracking-[0.3em] text-center">
                    ー 対局プロトコルを選択してください ー
                  </h3>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                    {/* CPU MATCH CARD */}
                    <button
                      onClick={handleStartVsAi}
                      className="group p-6 bg-[#0c051a]/90 hover:bg-[#110726]/90 rounded-3xl border-2 border-cyan-500/25 hover:border-[#00f0ff] font-bold transition-all duration-300 shadow-[0_0_15px_rgba(0,240,255,0.1)] hover:shadow-[0_0_25px_rgba(0,240,255,0.4)] flex flex-col items-center gap-4 cursor-pointer hover:translate-y-[-3px] backdrop-blur-sm"
                    >
                      <div className="w-14 h-14 rounded-2xl bg-cyan-500/5 flex items-center justify-center border border-cyan-500/25 group-hover:scale-110 group-hover:bg-cyan-500/20 group-hover:border-[#00f0ff] transition duration-300 shadow-lg shadow-cyan-950/40">
                        <Layers className="w-7 h-7 text-[#00f0ff] drop-shadow-[0_0_4px_#00f0ff]" />
                      </div>
                      <div className="text-center">
                        <span className="text-base font-black text-white block mb-1.5 tracking-wider group-hover:text-[#00f0ff] transition duration-200">
                          VS CPU AI (電脳演算対局)
                        </span>
                        <span className="text-[10px] text-violet-100/60 font-normal leading-relaxed block max-w-[190px] mx-auto">
                          最先端の人工知能思考モジュールを搭載したコンピュータAIと対局します。
                        </span>
                      </div>
                    </button>

                    {/* LOCAL MATCH CARD */}
                    <button
                      onClick={handleStartLocalVsPlayer}
                      className="group p-6 bg-[#0c051a]/90 hover:bg-[#110726]/90 rounded-3xl border-2 border-fuchsia-500/25 hover:border-[#ff007f] font-bold transition-all duration-300 shadow-[0_0_15px_rgba(255,0,127,0.1)] hover:shadow-[0_0_25px_rgba(255,0,127,0.4)] flex flex-col items-center gap-4 cursor-pointer hover:translate-y-[-3px] backdrop-blur-sm"
                    >
                      <div className="w-14 h-14 rounded-2xl bg-fuchsia-500/5 flex items-center justify-center border border-fuchsia-500/25 group-hover:scale-110 group-hover:bg-fuchsia-500/20 group-hover:border-[#ff007f] transition duration-300 shadow-lg shadow-fuchsia-950/40">
                        <Users className="w-7 h-7 text-[#ff007f] drop-shadow-[0_0_4px_#ff007f]" />
                      </div>
                      <div className="text-center">
                        <span className="text-base font-black text-white block mb-1.5 tracking-wider group-hover:text-[#ff007f] transition duration-200">
                          VS LOCAL (局地共有対局)
                        </span>
                        <span className="text-[10px] text-violet-100/60 font-normal leading-relaxed block max-w-[190px] mx-auto">
                          一台のデバイスを交互に操作し、同じ盤面上でローカル対戦を行います。
                        </span>
                      </div>
                    </button>
                  </div>
                </div>

              </motion.div>
            ) : (
              /* ACTIVE GAME INTERFACE */
              <div id="active_match_dashboard" className="flex flex-col lg:flex-row gap-8 w-full justify-center items-stretch max-w-7xl">
                
                {/* Lateral Side: Gote player hand display */}
                <div className="flex flex-col gap-4 justify-between items-center lg:items-end lg:w-[280px] lg:min-w-[280px] flex-shrink-0">
                  <HandDisplay
                    player="後手"
                    hand={goteHand}
                    selectedHandIndex={selectedHandPiece?.player === '後手' ? selectedHandPiece.index : null}
                    onSelectHandPiece={handleSelectHandPiece}
                    charge={goteCharge}
                    onTriggerKingHack={triggerKingHack}
                    isActive={activePlayer === '後手' && !winner}
                    playerName={
                      gameMode === 'vs_ai'
                        ? 'CPU AI'
                        : gameMode === 'online'
                        ? onlineRole === '先手'
                          ? onlineOpponentName
                          : playerName
                        : '後手プレイヤー'
                    }
                    isCpu={gameMode === 'vs_ai'}
                  />

                  {/* Move notation list with clear board review info */}
                  <div className="w-full max-w-[280px] p-4 rounded-3xl flex flex-col justify-between flex-1 mt-4 glass-panel border-2 border-cyan-500/30 shadow-[0_0_15px_rgba(0,240,255,0.1)]">
                    <div>
                      <div className="flex justify-between items-center border-b border-cyan-500/20 pb-2 mb-2 font-mono text-[10px] font-black text-cyan-400/60 uppercase tracking-widest">
                        <span>棋譜ログ / Move Logs</span>
                        <span className="text-[#ff007f] drop-shadow-[0_0_3px_rgba(255,0,127,0.4)] font-black">{movesLog.length}手経過</span>
                      </div>

                      <div className="h-[120px] lg:h-[220px] overflow-y-auto font-mono text-xs text-violet-100/70 flex flex-col gap-1 pr-1 scrollbar">
                        {movesLog.length === 0 ? (
                          <div className="text-center py-6 text-violet-100/30 italic">対局を開始してください。</div>
                        ) : (
                          movesLog.slice().reverse().map((move, idx) => (
                            <div key={`kifu_m_${idx}`} className="flex justify-between p-1 bg-cyan-950/10 hover:bg-cyan-500/10 transition rounded-lg border border-transparent hover:border-cyan-500/20">
                              <span className="text-cyan-400/40 font-mono text-[10px]">
                                {movesLog.length - idx}.
                              </span>
                              <span className="font-bold flex-1 pl-4 text-violet-100/90">
                                {move.player}: {move.japaneseNotation}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-cyan-500/20 mt-2 flex gap-2">
                      <button
                        onClick={handleResign}
                        disabled={!!winner}
                        className="flex-1 py-2 px-3 bg-fuchsia-950/30 hover:bg-[#ff007f]/20 text-[#ff007f] rounded-xl border border-[#ff007f]/40 hover:border-[#ff007f] text-xs font-black font-mono uppercase transition cursor-pointer disabled:opacity-40 shadow-[0_0_8px_rgba(255,0,127,0.1)] hover:shadow-[0_0_12px_rgba(255,0,127,0.3)]"
                      >
                        投了 (Resign)
                      </button>

                      <button
                        onClick={() => {
                          if (window.confirm('対局を終了してロビーに戻りますか？')) {
                            setGameMode(null);
                            onSnapshotUnsubscribe.current?.();
                            onSnapshotUnsubscribe.current = null;
                          }
                        }}
                        className="py-2 px-3 bg-cyan-950/20 hover:bg-[#00f0ff]/20 border border-cyan-500/40 hover:border-[#00f0ff] text-[#00f0ff] text-xs font-black rounded-xl transition cursor-pointer shadow-[0_0_8px_rgba(0,240,255,0.1)]"
                        title="マイメニューに戻る"
                      >
                        ロビー
                      </button>
                    </div>

                  </div>
                </div>

                {/* Center Core: The main 9x9 Shogi Board */}
                <div className="flex flex-col items-center justify-center gap-4 flex-1">
                  
                  {kingInCheck && !winner && (
                    <div className="w-full max-w-[740px] p-2.5 bg-[#ff007f]/10 border-2 border-[#ff007f] text-[#ff007f] rounded-2xl font-black text-xs flex items-center justify-center gap-1.5 animate-bounce shadow-[0_0_15px_rgba(255,0,127,0.45)]">
                      <ShieldAlert className="w-4 h-4 animate-pulse text-[#ff007f]" />
                      <span>警告: {kingInCheck}の玉（王）に「王手」がかかっています！</span>
                    </div>
                  )}

                  <ShogiBoard
                    board={board}
                    selectedPos={selectedPos}
                    legalMoves={legalMoves}
                    lastMove={lastMove}
                    activePlayer={activePlayer}
                    onTileClick={handleTileClick}
                    gameMode={gameMode}
                    playerColorPreference="先手"
                    senteCharge={senteCharge}
                    goteCharge={goteCharge}
                    kingInCheck={kingInCheck}
                  />

                  {/* Selected Piece Actions Panel (Stargazer transformation and Sweep) */}
                  {selectedPos && (() => {
                    const selectedPiece = board[selectedPos.r][selectedPos.c];
                    if (!selectedPiece || selectedPiece.player !== activePlayer || winner) return null;

                    const isOnlineTurn = gameMode === 'online' ? activePlayer === onlineRole : true;
                    const isCpuTurn = gameMode === 'vs_ai' && activePlayer === '後手';
                    const canControl = isOnlineTurn && !isCpuTurn;

                    const activeCharge = activePlayer === '先手' ? senteCharge : goteCharge;
                    const isRookOrDragon = selectedPiece.type === '飛' || selectedPiece.type === '竜';
                    const isStargazer = selectedPiece.type === 'スターゲイザー';

                    if (!isRookOrDragon && !isStargazer) return null;

                    return (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="w-full max-w-[740px] p-4 rounded-3xl border-2 border-cyan-500 bg-[#0c051a]/95 shadow-[0_0_25px_rgba(0,240,255,0.3)] flex flex-col gap-3 text-center"
                      >
                        <div className="flex items-center justify-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-[#00f0ff] animate-pulse" />
                          <span className="font-mono text-xs font-black text-[#00f0ff] tracking-widest uppercase drop-shadow-[0_0_3px_#00f0ff]">
                            SYSTEM LINK: {selectedPiece.type} 制御ユニット
                          </span>
                        </div>

                        {isRookOrDragon && (
                          <div className="flex flex-col gap-2">
                            <span className="text-[11px] text-violet-100/80 leading-normal">
                              ハックエナジーが100%のとき、この駒を究極変身させ、
                              縦一列すべての駒を一掃（消滅）できる【スターゲイザー】に改造できます。
                            </span>
                            <button
                              disabled={activeCharge < 100 || !canControl}
                              onClick={() => transformRookToStargazer(selectedPos)}
                              className={`
                                py-2.5 px-4 rounded-xl font-mono text-xs font-black uppercase tracking-widest transition-all duration-300 border
                                ${activeCharge >= 100 && canControl
                                  ? 'bg-gradient-to-r from-[#00f0ff] via-[#7b00ff] to-[#ff007f] hover:from-[#00f0ff] hover:to-[#ff007f] text-white border-[#00f0ff] shadow-[0_0_15px_rgba(0,240,255,0.5)] cursor-pointer hover:scale-[1.02] active:scale-[0.98]'
                                  : 'bg-white/5 text-white/20 border-white/10 cursor-not-allowed'
                                }
                              `}
                            >
                              🔮 スターゲイザーに変身 (消費100%)
                            </button>
                          </div>
                        )}

                        {isStargazer && (
                          <div className="flex flex-col gap-2">
                            <span className="text-[11px] text-violet-100/80 leading-normal">
                              通常移動のほか、前方縦1列（盤面の端まで）にあるすべての駒を
                              敵味方問わず瞬時に一掃・消滅させます。（敵王将を巻き込めば勝利！）
                            </span>
                            <button
                              disabled={!canControl}
                              onClick={() => executeStargazerSweep(selectedPos)}
                              className={`
                                py-2.5 px-4 rounded-xl font-mono text-xs font-black uppercase tracking-widest transition-all duration-300 border
                                ${canControl
                                  ? 'bg-gradient-to-r from-[#ff007f] via-[#7b00ff] to-[#00f0ff] hover:from-[#ff007f] hover:to-[#00f0ff] text-white border-[#ff007f] shadow-[0_0_15px_rgba(255,0,127,0.5)] cursor-pointer hover:scale-[1.02] active:scale-[0.98]'
                                  : 'bg-white/5 text-white/20 border-white/10 cursor-not-allowed'
                                }
                              `}
                            >
                              🌠 前方縦一列を一掃 (COLUMN SWEEP)
                            </button>
                          </div>
                        )}
                      </motion.div>
                    );
                  })()}

                  {/* Active turn label */}
                  <div className="flex items-center gap-3 bg-[#0d061b]/80 p-3 px-6 rounded-2xl border border-cyan-500/20 font-mono shadow-inner shadow-cyan-950/20">
                    <span className="text-xs text-cyan-400/50 font-black uppercase tracking-widest">
                      手番 / Active Turn:
                    </span>
                    <span className="text-sm font-bold flex items-center gap-1.5">
                      <div className={`w-3 h-3 rounded-full ${activePlayer === '先手' ? 'bg-[#00f0ff] shadow-[0_0_8px_#00f0ff]' : 'bg-[#ff007f] animate-pulse shadow-[0_0_8px_#ff007f]'}`} />
                      <span className={activePlayer === '先手' ? 'text-[#00f0ff] drop-shadow-[0_0_3px_rgba(0,240,255,0.4)] font-black' : 'text-[#ff007f] drop-shadow-[0_0_3px_rgba(255,0,127,0.4)] font-black'}>
                        {activePlayer === '先手' ? '先手' : '後手'}
                      </span>
                      {gameMode === 'vs_ai' && activePlayer === '後手' && <span className="text-violet-100/40 text-xs font-normal"> (CPU思考中...)</span>}
                      {gameMode === 'online' && activePlayer === onlineRole && <span className="text-violet-100/40 text-xs font-normal"> (あなた)</span>}
                      {gameMode === 'online' && activePlayer !== onlineRole && <span className="text-violet-100/40 text-xs font-normal"> (相手の操作中)</span>}
                    </span>
                  </div>

                </div>

                {/* Lateral Side: Sente player hand display */}
                <div className="flex flex-col gap-4 items-center lg:items-start justify-start lg:w-[280px] lg:min-w-[280px] flex-shrink-0">
                  <HandDisplay
                    player="先手"
                    hand={senteHand}
                    selectedHandIndex={selectedHandPiece?.player === '先手' ? selectedHandPiece.index : null}
                    onSelectHandPiece={handleSelectHandPiece}
                    charge={senteCharge}
                    onTriggerKingHack={triggerKingHack}
                    isActive={activePlayer === '先手' && !winner}
                    playerName={
                      gameMode === 'online'
                        ? onlineRole === '後手'
                          ? onlineOpponentName
                          : playerName
                        : '先手プレイヤー (あなた)'
                    }
                    isCpu={false}
                  />
                  
                  {/* Real-time sync instructions for online */}
                  {gameMode === 'online' && (
                    <div className="w-full max-w-[280px] p-4 rounded-2xl flex flex-col gap-2 mt-4 glass-panel border border-white/5">
                      <div className="flex items-center gap-2 text-[#D4AF37] font-bold text-xs font-mono">
                        <Users className="w-4 h-4" />
                        <span>オンライン戦情報</span>
                      </div>
                      <div className="text-[10px] text-white/60 space-y-1.5">
                        <div className="flex justify-between items-center">
                          <strong>部屋合言葉:</strong> 
                          <span className="font-mono bg-white/5 border border-white/10 p-0.5 px-2.5 rounded font-bold tracking-wider text-[#D4AF37]">
                            {onlineMatchId}
                          </span>
                        </div>
                        <div className="flex justify-between"><strong>あなたの役割:</strong> <span className="text-white/80 font-semibold">{onlineRole}</span></div>
                        <div className="flex justify-between"><strong>対局相手:</strong> <span className="text-white/80 font-semibold">{onlineOpponentName}</span></div>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            )}

          </div>
        )}

        {/* 2. SAVED KIFU ARCHIVE TAB */}
        {activeTab === 'saved' && (
          <div className="flex flex-col items-center">
            <KifuManager
              savedKifus={savedKifus}
              onLoadKifu={(k) => {
                setActiveReviewKifu(k);
              }}
              onDeleteKifu={handleDeleteKifu}
              activeReviewKifu={activeReviewKifu}
              onCloseReview={() => setActiveReviewKifu(null)}
            />
          </div>
        )}

        {/* 3. RULES AND INSTRUCTIONS TAB */}
        {activeTab === 'rules' && (
          <div id="rules_tab_view" className="max-w-2xl mx-auto p-6 md:p-8 rounded-2xl shadow-2xl glass-panel border border-white/5">
            <h2 className="text-xl font-bold text-white border-b border-white/5 pb-3 mb-4 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-[#D4AF37]" />
              必殺ハック将棋 遊び方と移動規則
            </h2>

            <div className="space-y-6 text-xs text-white/75 leading-relaxed">
              <div className="bg-white/[0.02] p-4 rounded-xl border border-dashed border-white/10">
                <h3 className="font-bold text-white mb-1.5 flex items-center gap-1.5 font-sans">
                  <Zap className="w-4 h-4 text-[#FF4500]" />
                  超必殺技「全権掌握（コード・ハック）」のルール
                </h3>
                <p>
                  この将棋における最大の特徴は、対局中に発動可能な超必殺技です。
                </p>
                <ul className="list-disc pl-5 mt-2 space-y-1.5 text-[11px]">
                  <li>
                    <strong>パワーチャージ：</strong>相手の駒を取るごとに、自分のハックゲージが<strong>+20%</strong>チャージされます（計5枚獲得が必要）。
                  </li>
                  <li>
                    <strong>必殺ハック発動：</strong>ゲージが100%になり自分の手番の際、「全権掌握（コード・ハック）」ボタンをいつでも起動できます。
                  </li>
                  <li>
                    <strong>効果：</strong>自軍の玉将（王将）から２マス周囲（縦・横・斜め2マス先の5x5マスエリア）にいるすべての敵の駒を洗脳し、自分の駒（自軍の勢力）に強制書き換えできます。
                  </li>
                  <li>
                    <strong>特性：</strong>洗脳された敵 of 敵の駒は、そのままそのマスに留まった状態で向きが反転し、次の手番からあなたの仲間として動かすことができます（成りの状態もキープされます）。
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-white mb-1.5">【基本移動ルール】</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-[11px]">
                  <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 shadow-inner">
                    <span className="font-bold block text-[#D4AF37]">歩 (Fu / 歩兵)</span>
                    前に1マスだけ進めます。後ろや横には進めません。
                  </div>
                  <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 shadow-inner">
                    <span className="font-bold block text-[#D4AF37]">香 (Kyo / 香車)</span>
                    何マスでも前にまっすぐ突き進めます。後退はできません。
                  </div>
                  <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 shadow-inner">
                    <span className="font-bold block text-[#D4AF37]">桂 (Kei / 桂馬)</span>
                    前2マス、横1マス（L字）へ障害物を飛び越えて進めます。
                  </div>
                  <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 shadow-inner">
                    <span className="font-bold block text-[#D4AF37]">銀 (Gin / 銀将)</span>
                    前、及び斜め4方向（計5箇所）に1マスずつ進めます。
                  </div>
                  <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 shadow-inner">
                    <span className="font-bold block text-[#D4AF37]">金 (Kin / 金将)</span>
                    全8方向のうち、斜め後ろを除く6方向に1マスずつ動けます。
                  </div>
                  <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 shadow-inner">
                    <span className="font-bold block text-[#D4AF37]">角 / 馬 (Kaku / Bishop)</span>
                    斜め4方向に何マスでも進めます。成ると「馬」となり、前後左右に1マス進む能力が加わります。
                  </div>
                  <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 shadow-inner">
                    <span className="font-bold block text-[#D4AF37]">飛 / 竜 (Hi / Rook)</span>
                    前後左右に何マスでも進めます。成ると「竜」となり、斜め4方向に1マス進む能力が加わります。
                  </div>
                  <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 shadow-inner">
                    <span className="font-bold block text-[#D4AF37]">玉 / 王 (Gyoku / King)</span>
                    周囲8方向のすべての隣接するマスに1マス動けます。
                  </div>
                </div>
              </div>

              <div className="border-t border-white/5 pt-4">
                <h3 className="font-bold text-white mb-1.5">【特有の将棋禁止原則】</h3>
                <ul className="list-decimal pl-5 space-y-1 text-[11px] text-white/60">
                  <li><strong>二歩（にふ）：</strong>同じ縦列（筋）に自分の未成りの「歩」を２枚置くことはできません。</li>
                  <li><strong>行き所のない駒：</strong>「歩」「香」を最後の段（「桂」は最後から二段）にそのまま打つことはできません。</li>
                  <li><strong>成りの権利：</strong>敵陣の3段（先手なら一番上の3段、後手なら一番下の3段）に駒を動かすか、そこから出る際に駒を成らせることができます（成ると金将と同様の動きになります）。</li>
                </ul>
              </div>

            </div>
          </div>
        )}

      </main>

      {/* FOOTER */}
      <footer className="mt-auto py-5 bg-black/25 border-t border-white/5 text-center font-mono text-[10px] text-white/35 z-10 select-none">
        必殺ハック将棋 © 2026 • CRAFTED WITH WEBAUDIO & FIRESTORE REAL-TIME GRAPHICS
      </footer>

      {/* ===================== OVERLAYS / DIALOGUES ===================== */}

      {/* 1. PROMOTION DIALOG OVERLAY */}
      <AnimatePresence>
        {pendingPromo && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="p-6 rounded-2xl border border-white/10 max-w-sm w-full text-center shadow-2xl glass-panel text-white"
            >
              <h3 className="font-bold text-lg mb-2 text-[#D4AF37]">成りますか？</h3>
              <p className="text-xs text-white/60 mb-5 leading-relaxed">
                移動した駒を成らせて強化（金将と同じ動き、またはパワーアップ）させることができます。成らないことも可能です。
              </p>
              
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    executeStandardMove(pendingPromo.from, pendingPromo.to, true);
                    setPendingPromo(null);
                  }}
                  className="flex-1 py-3 bg-[#D4AF37] hover:bg-[#FFD700] text-black font-extrabold rounded-xl text-xs shadow-lg transition cursor-pointer hover:scale-[1.02]"
                >
                  成る (PROMOTE)
                </button>
                <button
                  onClick={() => {
                    executeStandardMove(pendingPromo.from, pendingPromo.to, false);
                    setPendingPromo(null);
                  }}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold rounded-xl text-xs transition cursor-pointer"
                >
                  成らず (KEEP)
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 2. GAME VICTORY / GAME OVER OVERLAY */}
      <AnimatePresence>
        {winner && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.85, opacity: 0 }}
              className="p-8 rounded-3xl border border-white/10 text-center max-w-md w-full shadow-2xl relative overflow-hidden glass-panel text-white"
            >
              {/* Confetti or Glowing accents */}
              <div className="absolute -top-12 -left-12 w-24 h-24 bg-gradient-to-br from-[#D4AF37] to-transparent rounded-full opacity-10" />
              <div className="absolute -bottom-12 -right-12 w-24 h-24 bg-gradient-to-tl from-[#FF4500] to-transparent rounded-full opacity-10" />

              <Trophy className="w-16 h-16 mx-auto mb-4 text-[#D4AF37] animate-bounce" />

              <h2 className="text-2xl font-bold text-[#D4AF37] tracking-wider font-mono">
                対局終了！
              </h2>
              
              <div className="text-lg font-bold mt-2 text-white flex items-center justify-center gap-1.5">
                <span className={`inline-block w-3 h-3 rounded-full ${winner === '先手' ? 'bg-[#D4AF37]' : 'bg-[#FF4500] animate-pulse'}`} />
                <span>勝者: {winner === '先手' ? '先手' : '後手'}</span>
              </div>

              <p className="text-xs text-white/50 mt-2 font-mono">
                総手順: {movesLog.length} 手
              </p>

              <div className="mt-6 flex flex-col gap-2.5">
                <button
                  onClick={handleOpenSaveKifu}
                  className="w-full py-3 bg-[#D4AF37] hover:bg-[#FFD700] text-black font-extrabold text-xs rounded-xl shadow-lg cursor-pointer transition hover:scale-[1.01]"
                >
                  盤面棋譜 (Kifu) データを保存
                </button>

                <button
                  onClick={() => {
                    setWinner(null);
                    setGameMode(null);
                    onSnapshotUnsubscribe.current?.();
                    onSnapshotUnsubscribe.current = null;
                  }}
                  className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold text-xs rounded-xl transition cursor-pointer"
                >
                  ロビーに戻る
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 3. SAVE KIFU MODAL OVERLAY */}
      <AnimatePresence>
        {showSaveKifuModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="p-6 rounded-2xl border border-white/10 max-w-sm w-full shadow-2xl glass-panel text-white"
            >
              <h3 className="font-bold text-sm mb-1.5 text-white">
                棋譜保存タイトル入力
              </h3>
              <p className="text-[11px] text-white/60 mb-4 leading-relaxed">
                アーカイブに登録する対局のタイトルを入力してください。後から見返すことができます。
              </p>

              <input
                id="kifu_save_title_input"
                type="text"
                maxLength={40}
                value={kifuSaveTitle}
                onChange={(e) => setKifuSaveTitle(e.target.value)}
                placeholder="初段リベンジマッチ"
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs font-bold focus:outline-none mb-6 text-white placeholder-white/20 focus:border-[#D4AF37]/50"
              />

              <div className="flex gap-3">
                <button
                  onClick={handleSaveKifuConfirm}
                  disabled={!kifuSaveTitle.trim()}
                  className="flex-1 py-3 bg-[#D4AF37] hover:bg-[#FFD700] text-black font-extrabold text-xs rounded-xl shadow disabled:opacity-45 cursor-pointer"
                >
                  保存する
                </button>
                <button
                  onClick={() => setShowSaveKifuModal(false)}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold text-xs rounded-xl cursor-pointer"
                >
                  閉じる
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
