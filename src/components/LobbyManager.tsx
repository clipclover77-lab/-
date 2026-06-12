import { useState, useEffect } from 'react';
import { db, isFirebaseConfigured, auth, ensureSignedIn, handleFirestoreError, OperationType } from '../firebase';
import { collection, doc, setDoc, getDoc, updateDoc, onSnapshot, query, where, getDocs, limit } from 'firebase/firestore';
import { getInitialBoard, BoardState, Piece, PlayerColor } from '../shogiEngine';
import { Server, Users, RefreshCw, Key, ShieldAlert, Zap, Layers, Play } from 'lucide-react';

interface LobbyManagerProps {
  onJoinMatch: (matchId: string, role: '先手' | '後手', opponentName: string) => void;
  onSetPlayerName: (name: string) => void;
  savedName: string;
}

export function LobbyManager({ onJoinMatch, onSetPlayerName, savedName }: LobbyManagerProps) {
  const [userName, setUserName] = useState<string>(savedName || '');
  const [roomCodeInput, setRoomCodeInput] = useState<string>('');
  const [activeRooms, setActiveRooms] = useState<{ id: string; senteName: string }[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSyncingRoom, setIsSyncingRoom] = useState<string | null>(null);

  useEffect(() => {
    onSetPlayerName(userName);
  }, [userName]);

  // Load public lobby rooms
  const handleFetchRooms = async () => {
    if (!isFirebaseConfigured) return;
    setLoading(true);
    setErrorMsg(null);
    const colName = 'matches';
    try {
      await ensureSignedIn();
      const q = query(collection(db, colName), where('status', '==', 'waiting'), limit(10));
      const querySnap = await getDocs(q);
      const rooms: { id: string; senteName: string }[] = [];
      querySnap.forEach((docSnap) => {
        const data = docSnap.data();
        rooms.push({
          id: docSnap.id,
          senteName: data.senteName || '不明なプレイヤー',
        });
      });
      setActiveRooms(rooms);
    } catch (err) {
      setErrorMsg('対局室の読み込みに失敗しました。時間をおいてもう一度お試しください。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isFirebaseConfigured) {
      handleFetchRooms();
    }
  }, []);

  // Make a new match doc
  const handleCreateRoom = async () => {
    if (!userName.trim()) {
      setErrorMsg('オンライン対局をするには、お名前を入力してください。');
      return;
    }
    setLoading(true);
    setErrorMsg(null);

    // Random 5-digit room code
    const rCode = Math.floor(10000 + Math.random() * 90000).toString();
    const colName = 'matches';

    try {
      const user = await ensureSignedIn();
      if (!user) throw new Error("No signed in user");

      const emptyBoard = getInitialBoard();

      const newMatchDoc = {
        id: rCode,
        status: 'waiting',
        turn: '先手',
        senteUid: user.uid,
        senteName: userName.trim(),
        goteUid: '',
        goteName: '',
        board: JSON.stringify(emptyBoard),
        senteHand: JSON.stringify([]),
        goteHand: JSON.stringify([]),
        senteCharge: 0,
        goteCharge: 0,
        moves: JSON.stringify([]),
        lastMove: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Create in Firestore
      await setDoc(doc(db, colName, rCode), newMatchDoc);
      
      // Let parent hook into match
      onJoinMatch(rCode, '先手', '対戦相手の入室待ち');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `${colName}/${rCode}`);
    } finally {
      setLoading(false);
    }
  };

  // Join a match doc
  const handleJoinByCode = async (codeToJoin?: string) => {
    const targetCode = (codeToJoin || roomCodeInput).trim();
    if (!userName.trim()) {
      setErrorMsg('オンライン対局をするには、お名前を入力してください。');
      return;
    }
    if (!targetCode) {
      setErrorMsg('合言葉を入力してください。');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    const colName = 'matches';

    try {
      const user = await ensureSignedIn();
      if (!user) throw new Error("Cannot authorize session");

      const matchRef = doc(db, colName, targetCode);
      const matchSnap = await getDoc(matchRef);

      if (!matchSnap.exists()) {
        setErrorMsg('指定された部屋コードが見つかりません。入力内容をお確かめください。');
        setLoading(false);
        return;
      }

      const matchDetails = matchSnap.data();

      if (!matchDetails) {
        setErrorMsg('部屋情報の読み込みに失敗しました。');
        setLoading(false);
        return;
      }

      if (matchDetails.status !== 'waiting') {
        setErrorMsg('この部屋は既に満員か、対局が終了しています。');
        setLoading(false);
        return;
      }

      if (matchDetails.senteUid === user.uid) {
        setErrorMsg('あなたが作成した対局室です。相手が参加するのを待ってください。');
        setLoading(false);
        return;
      }

      // Enter match as Gote (後手)
      await updateDoc(matchRef, {
        goteUid: user.uid,
        goteName: userName.trim(),
        status: 'playing',
        updatedAt: new Date().toISOString(),
      });

      onJoinMatch(targetCode, '後手', matchDetails.senteName);
    } catch (err) {
      setErrorMsg('部屋の参加に失敗しました。');
      handleFirestoreError(err, OperationType.WRITE, `${colName}/${targetCode}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="online_lobby_container" className="p-6 rounded-2xl shadow-2xl w-full max-w-[500px] glass-panel">
      
      {/* Player Setup Section */}
      <div className="mb-5">
        <label className="block text-[10px] font-bold text-white/40 font-mono uppercase tracking-widest mb-2">
          あなたのお名前 / Player Nickname
        </label>
        <input
          id="player_nickname_field"
          type="text"
          maxLength={15}
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
          placeholder="対馬 太郎"
          className="w-full px-3 py-2 bg-white/[0.03] border border-white/10 hover:border-white/20 rounded-xl text-sm font-semibold text-white placeholder-white/20 focus:outline-none focus:border-[#D4AF37] shadow-inner transition"
        />
      </div>

      {/* FIREBASE CONFIG CHECK */}
      {!isFirebaseConfigured ? (
        <div id="offline_helper" className="p-4 bg-teal-500/[0.04] border border-dashed border-teal-500/30 rounded-xl flex flex-col gap-3">
          <div className="flex gap-2 items-start text-emerald-400">
            <Server className="w-5 h-5 flex-shrink-0 mt-0.5 animate-pulse" />
            <div>
              <h4 className="font-bold text-xs text-white">オンライン対戦：セットアップ中です</h4>
              <p className="text-[10px] mt-1 text-white/55 leading-relaxed">
                自動的なFirestore/Authのセットアップが行われています。お馴染みのAIアシスタント経由で権限を承認すると、リアルタイム対戦ができるようになります。
              </p>
            </div>
          </div>
          
          <div className="text-[10px] bg-[#D4AF37]/10 border border-[#D4AF37]/20 text-[#D4AF37] rounded-lg p-2 leading-normal">
            <strong>💡 今すぐ遊べる！：</strong>現在、オフライン「VS AI (コンピュータ対戦)」または「VS Local Player (ローカル２人操作)」がお使い頂けます。今すぐハック将棋をプレイできます！
          </div>
        </div>
      ) : (
        <div id="online_lobby_actions" className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            {/* Create Room Button */}
            <button
              onClick={handleCreateRoom}
              disabled={loading}
              className="flex flex-col items-center justify-center p-4 bg-gradient-to-br from-[#FF4500] to-[#B22222] border border-[#FF4500]/50 rounded-2xl text-white font-bold transition hover:scale-[1.02] shadow-lg shadow-[#FF4500]/10 cursor-pointer disabled:opacity-50"
            >
              <Zap className="w-6 h-6 mb-1 animate-pulse" />
              <span className="text-xs">新部屋を立てる</span>
              <span className="text-[9px] font-mono opacity-80 mt-0.5">(先手として部屋を生成)</span>
            </button>

            {/* Direct code join panel */}
            <div className="bg-white/[0.03] p-3.5 border border-white/5 rounded-2xl flex flex-col justify-between">
              <input
                id="join_room_code_field"
                type="text"
                pattern="[0-9]*"
                maxLength={5}
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value.replace(/\D/g, ''))}
                placeholder="部屋合言葉"
                className="w-full text-center py-1.5 border-b border-white/10 bg-transparent text-sm font-mono tracking-widest text-white placeholder-white/20 focus:outline-none focus:border-[#D4AF37]"
              />
              <button
                onClick={() => handleJoinByCode()}
                disabled={loading}
                className="mt-2 w-full py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/25 text-white/90 text-xs font-bold rounded-xl shadow transition cursor-pointer"
              >
                合言葉で参戦
              </button>
            </div>
          </div>

          {/* Active Lobby Selection List */}
          <div className="border-t border-white/5 pt-4">
            <div className="flex justify-between items-center mb-2.5">
              <span className="text-[10px] font-bold text-white/40 font-mono uppercase tracking-widest flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-[#D4AF37]" />
                入室待ちの部屋 / Active Rooms
              </span>
              <button
                onClick={handleFetchRooms}
                disabled={loading}
                className="p-1 text-white/40 hover:text-white/80 transition rounded hover:bg-white/5 cursor-pointer"
                title="対局室を更新"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {errorMsg && (
              <div className="my-2 p-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-lg flex items-center gap-1.5 leading-snug">
                <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {activeRooms.length === 0 ? (
              <div className="text-center py-5 text-[11px] text-white/30 italic border border-white/5 rounded-xl bg-black/10">
                現在、対戦者を募集している部屋はありません。<br />新部屋を立てて対局を待ってみましょう！
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-[150px] overflow-y-auto scrollbar">
                {activeRooms.map((room) => (
                  <div
                    key={`lobby_r_${room.id}`}
                    className="flex justify-between items-center p-2.5 bg-white/[0.02] border border-white/5 hover:border-[#D4AF37]/50 rounded-xl transition duration-150"
                  >
                    <div>
                      <span className="text-xs font-bold text-white">
                        室主: {room.senteName}
                      </span>
                      <span className="text-[10px] text-white/40 block font-mono">
                        部屋コード: {room.id}
                      </span>
                    </div>
                    <button
                      onClick={() => handleJoinByCode(room.id)}
                      disabled={loading}
                      className="flex items-center gap-1 p-1.5 px-3 bg-[#D4AF37] hover:bg-[#D4AF37]/90 text-black text-xs font-bold rounded-lg transition cursor-pointer"
                    >
                      <Play className="w-2.5 h-2.5 fill-current" />
                      挑戦する
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
