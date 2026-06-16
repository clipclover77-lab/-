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

    if (isKingInCheck('先手', nextBoard)) {
      currentInCheck = '先手';
      playCheckAlarmSound();
    }

    if (!hasAnyLegalMoves('先手', nextBoard, nextSenteHand)) {
      // Sente is checkmated
      nextWinner = '後手';
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

    if (isKingInCheck(nextTurn, nextBoard)) {
      currentInCheck = nextTurn;
      playCheckAlarmSound();
    }

    const opponentHand = nextTurn === '先手' ? nextSenteHand : nextGoteHand;
    if (!hasAnyLegalMoves(nextTurn, nextBoard, opponentHand)) {
      nextWinner = activePlayer;
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

    if (isKingInCheck(nextTurn, nextBoard)) {
      currentInCheck = nextTurn;
      playCheckAlarmSound();
    }

    const opponentHand = nextTurn === '先手' ? nextSenteHand : nextGoteHand;
    if (!hasAnyLegalMoves(nextTurn, nextBoard, opponentHand)) {
      nextWinner = activePlayer;
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
    
    setGlitchMessage(`SYSTEM WARNING: ${actor === '先手' ? '先手' : '後手'}の【全権掌握（システム・ジャック）】発動！ 範囲内の敵 ${victims.length} 駒が洗脳ハックされました！`);
    
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
    <div id="shogi_app_root" className="min-h-screen bg-[#0F0F11] text-[#E2E2E2] flex flex-col font-sans relative overflow-x-hidden">
      
      {/* Decorative cybernetic grid backgrounds */}
      <div className="absolute inset-0 bg-grid-pattern opacity-5 pointer-events-none z-0" />

      {/* Futuristic status alert banner overlay for hacks */}
      <AnimatePresence>
        {glitchMessage && (
          <motion.div
            initial={{ y: -60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -60, opacity: 0 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 bg-emerald-600/95 text-white font-mono text-xs md:text-sm shadow-2xl border border-emerald-405 p-3 px-6 rounded-2xl z-50 flex items-center gap-2 max-w-[90vw] text-center"
          >
            <Sparkles className="w-5 h-5 animate-spin text-emerald-300" />
            <span className="font-bold">{glitchMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Header */}
      <header className="sticky top-0 bg-[#161619]/80 backdrop-blur border-b border-white/5 z-40 py-3.5 px-4 md:px-8 flex justify-between items-center shadow-lg">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-gradient-to-tr from-[#FF4500] to-[#B22222] rounded-xl flex items-center justify-center text-white shadow-lg shadow-red-950/20">
            <Sword className="w-5 h-5 rotate-45 animate-pulse" />
          </div>
          <div>
            <h1 className="text-base md:text-xl font-extrabold tracking-widest leading-none bg-gradient-to-r from-[#D4AF37] via-[#FFD700] to-[#FF4500] bg-clip-text text-transparent flex items-center gap-1.5">
              電脳将棋 CODE:HACK
            </h1>
            <p className="text-[10px] text-white/40 font-mono mt-0.5">
              SUPER SHOGI ULTIMATE HACK ENGINE
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
                ? 'bg-white/5 text-white font-extrabold border-white/10 shadow-inner'
                : 'text-white/40 border-transparent hover:text-white/80'
            }`}
          >
            <Sword className="w-3.5 h-3.5" />
            <span>対局</span>
          </button>
          
          <button
            onClick={() => setActiveTab('saved')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer select-none border ${
              activeTab === 'saved'
                ? 'bg-white/5 text-white font-extrabold border-white/10 shadow-inner'
                : 'text-white/40 border-transparent hover:text-white/80'
            }`}
          >
            <Save className="w-3.5 h-3.5" />
            <span>棋譜復元</span>
          </button>

          <button
            onClick={() => setActiveTab('rules')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer select-none border ${
              activeTab === 'rules'
                ? 'bg-white/5 text-white font-extrabold border-white/10 shadow-inner'
                : 'text-white/40 border-transparent hover:text-white/80'
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
                <div className="w-full p-8 md:p-10 rounded-[2.5rem] border border-white/10 flex flex-col items-center bg-[#111115]/80 shadow-[0_0_60px_rgba(255,69,0,0.15)] relative overflow-hidden backdrop-blur-md">
                  
                  {/* Glowing header accents */}
                  <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-[#FF4500] via-[#D4AF37] to-[#FF4500]" />
                  
                  {/* Security Clearance Tag */}
                  <div className="absolute top-4 right-6 flex items-center gap-1.5 text-[8.5px] font-mono font-black tracking-widest text-[#FF4500]/70 select-none animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#FF4500]" />
                    SECURE NODE COMPROMISED
                  </div>

                  <div className="absolute top-4 left-6 flex items-center gap-1.5 text-[8.5px] font-mono font-semibold tracking-widest text-white/35 select-none">
                    PORT: 3000 / HOST: ACTIVE
                  </div>

                  {/* Version tag */}
                  <div className="mt-4 mb-2 py-0.5 px-3 rounded-full bg-white/[0.04] border border-white/10 text-[9px] font-mono font-extrabold text-[#D4AF37] tracking-[0.2em] uppercase shadow-inner">
                    SYSTEM SUITE v2.2.4
                  </div>

                  {/* Ultimate Neo Cyber Logo Grid */}
                  <div className="relative my-4 flex flex-col items-center select-none">
                    <span className="text-white/40 text-[10px] font-mono font-black uppercase tracking-[0.45em] mb-1.5">
                      CYBERNETIC SHOGI MATRIX
                    </span>
                    
                    <h2 className="text-4xl md:text-5xl font-black text-white tracking-widest uppercase relative font-sans">
                      電脳将棋
                    </h2>
                    
                    <div className="mt-3 relative">
                      {/* Ambient background glow for the key BRANDING */}
                      <div className="absolute -inset-2 bg-gradient-to-r from-red-600 to-amber-500 rounded-lg blur opacity-30 select-none pointer-events-none" />
                      <span className="relative block text-3xl md:text-4xl font-mono tracking-[0.2em] text-[#FF4500] font-black filter drop-shadow-[0_0_8px_rgba(255,69,0,0.5)]">
                        CODE:HACK
                      </span>
                    </div>
                  </div>

                  {/* Visual Divider line */}
                  <div className="flex items-center gap-3 w-64 my-4 text-white/10">
                    <div className="flex-1 h-[1px] bg-gradient-to-r from-transparent to-white/15" />
                    <Zap className="w-4 h-4 text-[#D4AF37]/80 animate-bounce" />
                    <div className="flex-1 h-[1px] bg-gradient-to-l from-transparent to-white/15" />
                  </div>

                  {/* Interactive rules summary layout */}
                  <div className="text-white/85 space-y-3 leading-relaxed max-w-md text-xs md:text-sm bg-white/[0.02] border border-white/5 p-5 rounded-2xl shadow-inner mt-1">
                    <p className="font-extrabold flex items-center justify-center gap-2 text-white/90 text-sm tracking-wider">
                      <Sparkles className="w-4 h-4 text-[#D4AF37]" />
                      <span>【全権掌握（システム・ジャック）】システム概要</span>
                    </p>
                    <p className="text-white/60 text-xs text-left leading-relaxed">
                      対局相手の駒を捕獲すると、チャージエネルギーが<span className="text-[#FF4500]/90 font-black px-1 border-b border-[#FF4500]/30">20%蓄積</span>されます。100%チャージ完了時に、玉将(王将)が持つ究極奥義【全権掌握（システム・ジャック）】の使用が許可されます。
                    </p>
                    <p className="text-white/60 text-xs text-left leading-relaxed">
                      発動時、王の周囲2マスの範囲に存在する<span className="text-[#D4AF37] font-semibold">すべての敵駒を一瞬で洗脳</span>し、自軍の持ち駒として再構成する支配的超次元将棋ルール。
                    </p>
                  </div>

                  {/* Terminal systems line */}
                  <div className="flex items-center gap-4 mt-6 text-[9px] font-mono text-white/25 uppercase tracking-wider select-none">
                    <span>GRID: CONNECTED</span>
                    <span>•</span>
                    <span>AI CALIBRATED: SUCCESS</span>
                    <span>•</span>
                    <span>CORE RECTOR: ONLINE</span>
                  </div>
                </div>

                {/* PROTOCOL SELECTOR */}
                <div className="w-full flex flex-col gap-4">
                  <h3 className="text-[10px] text-white/30 font-mono font-black uppercase tracking-[0.3em] text-center">
                    ー 対局プロトコルを選択してください ー
                  </h3>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                    {/* CPU MATCH CARD */}
                    <button
                      onClick={handleStartVsAi}
                      className="group p-6 bg-gradient-to-b from-[#111115]/80 to-transparent hover:from-[#1b1b22]/90 rounded-3xl border border-white/5 hover:border-[#D4AF37]/50 font-bold transition-all duration-300 shadow-2xl flex flex-col items-center gap-4 cursor-pointer hover:translate-y-[-2px] backdrop-blur-sm"
                    >
                      <div className="w-14 h-14 rounded-2xl bg-[#D4AF37]/5 flex items-center justify-center border border-[#D4AF37]/25 group-hover:scale-110 group-hover:bg-[#D4AF37]/15 group-hover:border-[#D4AF37]/50 transition duration-300 shadow-lg">
                        <Layers className="w-7 h-7 text-[#D4AF37]" />
                      </div>
                      <div className="text-center">
                        <span className="text-sm font-extrabold text-white block mb-1.5 tracking-wider group-hover:text-[#D4AF37] transition duration-200">
                          VS CPU AI (演算対局)
                        </span>
                        <span className="text-[10px] text-white/45 font-normal leading-relaxed block max-w-[190px] mx-auto">
                          高水準の思考モジュールを搭載したコンピュータAIと対戦します。
                        </span>
                      </div>
                    </button>

                    {/* LOCAL MATCH CARD */}
                    <button
                      onClick={handleStartLocalVsPlayer}
                      className="group p-6 bg-gradient-to-b from-[#111115]/80 to-transparent hover:from-[#1b1b22]/90 rounded-3xl border border-white/5 hover:border-[#FF4500]/50 font-bold transition-all duration-300 shadow-2xl flex flex-col items-center gap-4 cursor-pointer hover:translate-y-[-2px] backdrop-blur-sm"
                    >
                      <div className="w-14 h-14 rounded-2xl bg-[#FF4500]/5 flex items-center justify-center border border-[#FF4500]/25 group-hover:scale-110 group-hover:bg-[#FF4500]/15 group-hover:border-[#FF4500]/50 transition duration-300 shadow-lg">
                        <Users className="w-7 h-7 text-[#FF4500]" />
                      </div>
                      <div className="text-center">
                        <span className="text-sm font-extrabold text-white block mb-1.5 tracking-wider group-hover:text-[#FF4500] transition duration-200">
                          VS LOCAL (盤面共有対局)
                        </span>
                        <span className="text-[10px] text-white/45 font-normal leading-relaxed block max-w-[190px] mx-auto">
                          同じ画面を交互に操作し、1台のデバイスでローカル対戦を行います。
                        </span>
                      </div>
                    </button>
                  </div>
                </div>

              </motion.div>
            ) : (
              /* ACTIVE GAME INTERFACE */
              <div id="active_match_dashboard" className="flex flex-col lg:flex-row gap-8 w-full justify-center items-stretch max-w-5xl">
                
                {/* Lateral Side: Gote player hand display */}
                <div className="flex flex-col gap-4 justify-between items-center lg:items-end">
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
                  <div className="w-full max-w-[340px] p-4 rounded-2xl flex flex-col justify-between flex-1 mt-4 glass-panel border border-white/5">
                    <div>
                      <div className="flex justify-between items-center border-b border-white/5 pb-2 mb-2 font-mono text-[10px] font-bold text-white/40 uppercase">
                        <span>棋譜ログ / Move Logs</span>
                        <span className="text-[#D4AF37]">{movesLog.length}手経過</span>
                      </div>

                      <div className="h-[120px] lg:h-[220px] overflow-y-auto font-mono text-xs text-white/70 flex flex-col gap-1 pr-1 scrollbar">
                        {movesLog.length === 0 ? (
                          <div className="text-center py-6 text-white/30 italic">対局を開始してください。</div>
                        ) : (
                          movesLog.slice().reverse().map((move, idx) => (
                            <div key={`kifu_m_${idx}`} className="flex justify-between p-1 bg-white/[0.01] hover:bg-white/[0.03] transition rounded border border-transparent hover:border-white/5">
                              <span className="text-white/30 font-mono text-[10px]">
                                {movesLog.length - idx}.
                              </span>
                              <span className="font-bold flex-1 pl-4 text-white/90">
                                {move.player}: {move.japaneseNotation}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-white/5 mt-2 flex gap-2">
                      <button
                        onClick={handleResign}
                        disabled={!!winner}
                        className="flex-1 py-2 px-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-xl border border-rose-500/20 text-xs font-bold font-mono uppercase transition cursor-pointer disabled:opacity-40"
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
                        className="py-2 px-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-bold rounded-xl transition cursor-pointer"
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
                    <div className="w-full max-w-[450px] p-2 bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 animate-bounce">
                      <ShieldAlert className="w-4 h-4 animate-pulse" />
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

                  {/* Active turn label */}
                  <div className="flex items-center gap-3 bg-white/[0.01] p-3 px-6 rounded-2xl border border-white/5 font-mono shadow-inner">
                    <span className="text-xs text-white/40 font-bold uppercase">
                      手番 / Active Turn:
                    </span>
                    <span className="text-sm font-bold flex items-center gap-1.5">
                      <div className={`w-3 h-3 rounded-full ${activePlayer === '先手' ? 'bg-[#D4AF37] shadow-[0_0_10px_rgba(212,175,55,0.5)]' : 'bg-[#FF4500] animate-pulse shadow-[0_0_10px_rgba(255,69,0,0.5)]'}`} />
                      <span className={activePlayer === '先手' ? 'text-[#D4AF37]' : 'text-[#FF4500]'}>
                        {activePlayer === '先手' ? '先手' : '後手'}
                      </span>
                      {gameMode === 'vs_ai' && activePlayer === '後手' && <span className="text-white/45 text-xs font-normal"> (CPU思考中...)</span>}
                      {gameMode === 'online' && activePlayer === onlineRole && <span className="text-white/45 text-xs font-normal"> (あなた)</span>}
                      {gameMode === 'online' && activePlayer !== onlineRole && <span className="text-white/45 text-xs font-normal"> (相手の操作中)</span>}
                    </span>
                  </div>

                </div>

                {/* Lateral Side: Sente player hand display */}
                <div className="flex flex-col gap-4 items-center lg:items-start justify-start">
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
                    <div className="w-full max-w-[340px] p-4 rounded-2xl flex flex-col gap-2 mt-4 glass-panel border border-white/5">
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
                  超必殺技「全権掌握（システム・ジャック）」のルール
                </h3>
                <p>
                  この将棋における最大の特徴は、対局中に発動可能な超必殺技です。
                </p>
                <ul className="list-disc pl-5 mt-2 space-y-1.5 text-[11px]">
                  <li>
                    <strong>パワーチャージ：</strong>相手の駒を取るごとに、自分のハックゲージが<strong>+20%</strong>チャージされます（計5枚獲得が必要）。
                  </li>
                  <li>
                    <strong>必殺ハック発動：</strong>ゲージが100%になり自分の手番の際、「全権掌握（システム・ジャック）」ボタンをいつでも起動できます。
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
