import { DEFAULT_GAME_SETS } from './defaultSets.js';
import { soundEngine } from './audio.js';
import { SyncEngine } from './sync.js';

const SETS_STORAGE_KEY = 'fuenf_gegen_fuenf_sets_v1';

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function createInitialFinalEntries() {
  return [0, 1, 2, 3, 4].map((idx) => ({
    questionIndex: idx,
    p1Text: '',
    p1Points: 0,
    p1TextRevealed: false,
    p1PointsRevealed: false,
    p2Text: '',
    p2Points: 0,
    p2TextRevealed: false,
    p2PointsRevealed: false
  }));
}

export class GameStore {
  constructor() {
    this.listeners = new Set();
    this.gameSets = this.loadGameSets();
    this.timerInterval = null;

    this.sync = new SyncEngine((remoteState, effect) => {
      this.state = remoteState;
      if (effect && effect.sound) {
        soundEngine.play(effect.sound);
      }
      this.notify(effect);
    });

    const persisted = this.sync.loadPersistedState();
    this.state = persisted || this.createDefaultState(this.gameSets[0].id);
  }

  loadGameSets() {
    try {
      const raw = localStorage.getItem(SETS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      // fallback to default sets
    }
    return clone(DEFAULT_GAME_SETS);
  }

  saveGameSets(sets) {
    this.gameSets = clone(sets);
    try {
      localStorage.setItem(SETS_STORAGE_KEY, JSON.stringify(this.gameSets));
    } catch (e) {
      // ignore storage errors
    }
    this.notify();
  }

  createDefaultState(setId = 'set_001') {
    const activeSet = this.gameSets.find(s => s.id === setId) || this.gameSets[0];
    return {
      activeSetId: activeSet.id,
      mode: 'rounds', // 'rounds' | 'finale' | 'winner'
      currentRoundIndex: 0, // 0..3 for rounds 1..4
      roundPhase: 'faceoff', // 'faceoff' | 'playing' | 'steal' | 'settled'
      questionVisible: true,

      // Phase 1: Team Setup
      teamA: {
        name: 'TEAM NORD',
        score: 0
      },
      teamB: {
        name: 'TEAM SÜD',
        score: 0
      },
      targetScore: 300,

      // Phase 2: Face-off (Duell am Pult)
      buzzerLocked: false,
      buzzerWinner: null, // 'A' | 'B' | null
      buzzerTimestamp: null,
      controllingTeam: null, // 'A' | 'B' | null
      stealTeam: null, // 'A' | 'B' | null
      roundWinner: null, // 'A' | 'B' | null

      // Phase 3: Regular Round Board State
      roundBank: 0,
      revealedIds: [], // Answer IDs revealed during play (counted in bank)
      postRevealedIds: [], // Answer IDs revealed after round settlement (not added to bank)
      strikes: 0, // 0..3
      strikeOverlay: null, // { count: 1|2|3|'X', id: timestamp, label: string }

      // Phase 4: Final Round ("Fast Money" / Finale)
      finale: {
        activePlayer: 1, // 1 | 2
        hidePlayer1: false,
        targetPoints: 200,
        timerSeconds: 20,
        timerRunning: false,
        duplicateAlert: null, // { id: timestamp, text: string }
        entries: createInitialFinalEntries()
      }
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(effect = null) {
    for (const listener of this.listeners) {
      listener(this.state, effect);
    }
  }

  commit(mutator, effect = null) {
    mutator(this.state);
    if (effect && effect.sound) {
      soundEngine.play(effect.sound);
    }
    this.sync.broadcast(this.state, effect);
    this.notify(effect);
  }

  getActiveSet() {
    return this.gameSets.find(s => s.id === this.state.activeSetId) || this.gameSets[0];
  }

  getCurrentRoundData() {
    const set = this.getActiveSet();
    if (!set || !set.rounds || set.rounds.length === 0) return null;
    const idx = Math.min(Math.max(0, this.state.currentRoundIndex), set.rounds.length - 1);
    const round = set.rounds[idx];
    // Standard 5 gegen 5 multipliers: R1=1, R2=1, R3=2, R4=3 unless overridden
    const defaultMultiplier = idx === 2 ? 2 : idx >= 3 ? 3 : 1;
    return {
      ...round,
      roundNumber: round.roundNumber || (idx + 1),
      multiplier: round.multiplier || defaultMultiplier
    };
  }

  // --- Team Setup & Game Control ---
  updateTeams({ nameA, nameB, scoreA, scoreB, targetScore }) {
    this.commit((s) => {
      if (typeof nameA === 'string' && nameA.trim()) s.teamA.name = nameA.trim().toUpperCase();
      if (typeof nameB === 'string' && nameB.trim()) s.teamB.name = nameB.trim().toUpperCase();
      if (typeof scoreA === 'number' && !Number.isNaN(scoreA)) s.teamA.score = Math.max(0, scoreA);
      if (typeof scoreB === 'number' && !Number.isNaN(scoreB)) s.teamB.score = Math.max(0, scoreB);
      if (typeof targetScore === 'number' && targetScore > 0) s.targetScore = targetScore;
    });
  }

  selectGameSet(setId) {
    this.stopFinalTimer();
    const found = this.gameSets.find(s => s.id === setId) || this.gameSets[0];
    this.commit((s) => {
      const fresh = this.createDefaultState(found.id);
      fresh.teamA.name = s.teamA.name;
      fresh.teamB.name = s.teamB.name;
      Object.assign(s, fresh);
    });
  }

  resetMatch() {
    this.stopFinalTimer();
    this.commit((s) => {
      const fresh = this.createDefaultState(s.activeSetId);
      fresh.teamA.name = s.teamA.name;
      fresh.teamB.name = s.teamB.name;
      Object.assign(s, fresh);
    });
  }

  // --- Phase 2: Face-Off (Duell am Pult) ---
  buzzIn(team) {
    if (this.state.buzzerLocked && this.state.buzzerWinner) return false;
    this.commit((s) => {
      s.buzzerLocked = true;
      s.buzzerWinner = team;
      s.buzzerTimestamp = Date.now();
    }, { type: 'buzzer', sound: 'buzzer', team });
    return true;
  }

  resetBuzzer() {
    this.commit((s) => {
      s.buzzerLocked = false;
      s.buzzerWinner = null;
      s.buzzerTimestamp = null;
    });
  }

  decideFaceOff(team, decision) {
    // decision: 'play' (Spielen) or 'pass' (Weitergeben)
    const activeTeam = decision === 'pass' ? (team === 'A' ? 'B' : 'A') : team;
    this.commit((s) => {
      s.buzzerWinner = team;
      s.controllingTeam = activeTeam;
      s.stealTeam = null;
      s.roundPhase = 'playing';
    });
  }

  setControllingTeam(team) {
    this.commit((s) => {
      s.controllingTeam = team;
      if (s.roundPhase === 'faceoff') {
        s.roundPhase = 'playing';
      }
    });
  }

  toggleQuestionVisibility() {
    this.commit((s) => {
      s.questionVisible = !s.questionVisible;
    });
  }

  // --- Phase 3: Regular Rounds ---
  switchToRound(roundIndex) {
    this.stopFinalTimer();
    const set = this.getActiveSet();
    const maxIdx = (set.rounds ? set.rounds.length : 1) - 1;
    const clamped = Math.min(Math.max(0, roundIndex), maxIdx);
    this.commit((s) => {
      s.mode = 'rounds';
      s.currentRoundIndex = clamped;
      s.roundPhase = 'faceoff';
      s.roundBank = 0;
      s.revealedIds = [];
      s.postRevealedIds = [];
      s.strikes = 0;
      s.strikeOverlay = null;
      s.buzzerLocked = false;
      s.buzzerWinner = null;
      s.controllingTeam = null;
      s.stealTeam = null;
      s.roundWinner = null;
    });
  }

  toggleAnswer(answerId) {
    const round = this.getCurrentRoundData();
    if (!round) return;
    const answer = round.answers.find(a => a.id === answerId);
    if (!answer) return;

    const isRevealed = this.state.revealedIds.includes(answerId) || this.state.postRevealedIds.includes(answerId);
    const isSettled = this.state.roundPhase === 'settled';

    if (!isRevealed) {
      this.commit((s) => {
        if (isSettled) {
          // Post-round reveal: flip card without modifying already settled bank
          s.postRevealedIds.push(answerId);
        } else {
          s.revealedIds.push(answerId);
          s.roundBank = this.calculateBank(round, s.revealedIds);
        }
      }, { type: 'reveal', sound: 'ding', answerId });
    } else {
      // Hide answer again (host override)
      this.commit((s) => {
        s.revealedIds = s.revealedIds.filter(id => id !== answerId);
        s.postRevealedIds = s.postRevealedIds.filter(id => id !== answerId);
        if (!isSettled) {
          s.roundBank = this.calculateBank(round, s.revealedIds);
        }
      });
    }
  }

  calculateBank(round, revealedIds) {
    const multiplier = round.multiplier || 1;
    return round.answers
      .filter(a => revealedIds.includes(a.id))
      .reduce((acc, a) => acc + (Number(a.points) || 0) * multiplier, 0);
  }

  revealAllRemaining() {
    const round = this.getCurrentRoundData();
    if (!round) return;
    const unrevealed = round.answers
      .map(a => a.id)
      .filter(id => !this.state.revealedIds.includes(id) && !this.state.postRevealedIds.includes(id));
    if (unrevealed.length === 0) return;

    this.commit((s) => {
      unrevealed.forEach(id => s.postRevealedIds.push(id));
    }, { type: 'reveal_all', sound: 'ding' });
  }

  // Strike System (1X, 2X, 3X + Steal Transfer)
  triggerStrike(customCount = null) {
    this.commit((s) => {
      let displayCount;
      if (customCount !== null) {
        displayCount = customCount;
        if (typeof customCount === 'number') {
          s.strikes = Math.min(3, Math.max(0, customCount));
        }
      } else if (s.roundPhase === 'steal') {
        // Single X during steal attempt
        displayCount = 1;
      } else {
        s.strikes = Math.min(3, s.strikes + 1);
        displayCount = s.strikes;
      }

      const xString = 'X'.repeat(Math.max(1, Number(displayCount) || 1));
      s.strikeOverlay = {
        id: Date.now(),
        count: Number(displayCount) || 1,
        label: xString
      };

      // Upon 3 strikes in regular play, transfer to Steal-Phase!
      if (s.strikes >= 3 && s.roundPhase !== 'steal' && s.roundPhase !== 'settled') {
        s.roundPhase = 'steal';
        const currentCtrl = s.controllingTeam || 'A';
        s.stealTeam = currentCtrl === 'A' ? 'B' : 'A';
      }
    }, { type: 'strike', sound: 'strike' });
  }

  clearStrikeOverlay() {
    this.commit((s) => {
      s.strikeOverlay = null;
    });
  }

  resetStrikes() {
    this.commit((s) => {
      s.strikes = 0;
      s.strikeOverlay = null;
      if (s.roundPhase === 'steal') {
        s.roundPhase = 'playing';
        s.stealTeam = null;
      }
    });
  }

  // Steal Mechanism (Steal-Phase resolution)
  resolveSteal(stealSucceeded, matchingAnswerId = null) {
    const round = this.getCurrentRoundData();
    this.commit((s) => {
      const origTeam = s.controllingTeam || 'A';
      const oppTeam = s.stealTeam || (origTeam === 'A' ? 'B' : 'A');

      if (stealSucceeded) {
        if (matchingAnswerId && round && !s.revealedIds.includes(matchingAnswerId)) {
          s.revealedIds.push(matchingAnswerId);
          s.roundBank = this.calculateBank(round, s.revealedIds);
        }
        const winnerKey = oppTeam === 'A' ? 'teamA' : 'teamB';
        s[winnerKey].score += s.roundBank;
        s.roundWinner = oppTeam;
        s.roundPhase = 'settled';
        s.strikeOverlay = null;
      } else {
        // Steal failed: original controlling team retains the bank!
        const winnerKey = origTeam === 'A' ? 'teamA' : 'teamB';
        s[winnerKey].score += s.roundBank;
        s.roundWinner = origTeam;
        s.roundPhase = 'settled';
        s.strikeOverlay = {
          id: Date.now(),
          count: 1,
          label: 'X'
        };
      }
    }, {
      type: stealSucceeded ? 'steal_success' : 'steal_fail',
      sound: stealSucceeded ? 'round_win' : 'strike'
    });
  }

  // End of Round Settlement
  awardRoundBank(team) {
    if (team !== 'A' && team !== 'B') return;
    this.commit((s) => {
      const key = team === 'A' ? 'teamA' : 'teamB';
      s[key].score += s.roundBank;
      s.roundWinner = team;
      s.roundPhase = 'settled';
      s.strikeOverlay = null;
    }, { type: 'round_win', sound: 'round_win', team });
  }

  // --- Phase 4: Final Round ("Fast Money" / Finale) ---
  enterFinale() {
    this.stopFinalTimer();
    this.commit((s) => {
      s.mode = 'finale';
      s.strikeOverlay = null;
      if (!s.finale || !Array.isArray(s.finale.entries) || s.finale.entries.length !== 5) {
        s.finale = {
          activePlayer: 1,
          hidePlayer1: false,
          targetPoints: 200,
          timerSeconds: 20,
          timerRunning: false,
          duplicateAlert: null,
          entries: createInitialFinalEntries()
        };
      }
    });
  }

  setFinalePlayer(playerNum) {
    this.stopFinalTimer();
    const p = playerNum === 2 ? 2 : 1;
    this.commit((s) => {
      s.finale.activePlayer = p;
      s.finale.timerSeconds = p === 1 ? 20 : 25;
      s.finale.timerRunning = false;
      // Automatically hide Player 1 answers on the public board when switching to Player 2
      if (p === 2) {
        s.finale.hidePlayer1 = true;
      }
    });
  }

  toggleHidePlayer1() {
    this.commit((s) => {
      s.finale.hidePlayer1 = !s.finale.hidePlayer1;
    });
  }

  startFinalTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.commit((s) => {
      if (s.finale.timerSeconds <= 0) {
        s.finale.timerSeconds = s.finale.activePlayer === 1 ? 20 : 25;
      }
      s.finale.timerRunning = true;
    }, { type: 'timer_start', sound: 'timer_tick' });

    this.timerInterval = setInterval(() => {
      if (!this.state.finale.timerRunning) {
        this.stopFinalTimer();
        return;
      }
      const remaining = this.state.finale.timerSeconds - 1;
      if (remaining <= 0) {
        this.stopFinalTimer();
        this.commit((s) => {
          s.finale.timerSeconds = 0;
          s.finale.timerRunning = false;
        }, { type: 'timer_end', sound: 'timer_end' });
      } else {
        this.commit((s) => {
          s.finale.timerSeconds = remaining;
        }, { type: 'timer_tick', sound: 'timer_tick' });
      }
    }, 1000);
  }

  stopFinalTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.state && this.state.finale && this.state.finale.timerRunning) {
      this.commit((s) => {
        s.finale.timerRunning = false;
      });
    }
  }

  resetFinalTimer(playerNum = null) {
    this.stopFinalTimer();
    this.commit((s) => {
      const p = playerNum || s.finale.activePlayer;
      s.finale.timerSeconds = p === 1 ? 20 : 25;
      s.finale.timerRunning = false;
    });
  }

  updateFinaleEntry(qIndex, playerNum, { text, points, textRevealed, pointsRevealed }) {
    const existingEntry = this.state.finale?.entries?.[qIndex];
    let isDuplicate = false;
    if (playerNum === 2 && typeof text === 'string' && existingEntry) {
      const cleanP1 = (existingEntry.p1Text || '').trim().toLowerCase();
      const cleanP2 = text.trim().toLowerCase();
      if (cleanP1 && cleanP2 && cleanP1 === cleanP2) {
        isDuplicate = true;
      }
    }

    const effect = isDuplicate
      ? { type: 'duplicate', sound: 'duplicate' }
      : (pointsRevealed === true ? { type: 'finale_points', sound: 'ding' } : null);

    this.commit((s) => {
      const entry = s.finale.entries[qIndex];
      if (!entry) return;
      if (playerNum === 1) {
        if (typeof text === 'string') entry.p1Text = text;
        if (typeof points === 'number' && !Number.isNaN(points)) entry.p1Points = Math.max(0, points);
        if (typeof textRevealed === 'boolean') entry.p1TextRevealed = textRevealed;
        if (typeof pointsRevealed === 'boolean') entry.p1PointsRevealed = pointsRevealed;
      } else {
        if (typeof text === 'string') {
          entry.p2Text = text;
          if (isDuplicate) {
            s.finale.duplicateAlert = {
              id: Date.now(),
              questionIndex: qIndex,
              text: text.toUpperCase()
            };
          }
        }
        if (typeof points === 'number' && !Number.isNaN(points)) entry.p2Points = Math.max(0, points);
        if (typeof textRevealed === 'boolean') entry.p2TextRevealed = textRevealed;
        if (typeof pointsRevealed === 'boolean') entry.p2PointsRevealed = pointsRevealed;
      }
    }, effect);
  }

  triggerDuplicateWarning(customText = 'DOPPELTE ANTWORT!') {
    this.commit((s) => {
      s.finale.duplicateAlert = {
        id: Date.now(),
        text: customText
      };
    }, { type: 'duplicate', sound: 'duplicate' });
  }

  clearDuplicateWarning() {
    this.commit((s) => {
      s.finale.duplicateAlert = null;
    });
  }

  resetFinale() {
    this.stopFinalTimer();
    this.commit((s) => {
      s.finale = {
        activePlayer: 1,
        hidePlayer1: false,
        targetPoints: 200,
        timerSeconds: 20,
        timerRunning: false,
        duplicateAlert: null,
        entries: createInitialFinalEntries()
      };
    });
  }

  getFinaleTotal(onlyRevealed = true) {
    if (!this.state.finale || !this.state.finale.entries) return 0;
    const hideP1 = onlyRevealed && this.state.finale.hidePlayer1;
    return this.state.finale.entries.reduce((sum, e) => {
      const p1 = (!onlyRevealed || (e.p1PointsRevealed && !hideP1)) ? (Number(e.p1Points) || 0) : 0;
      const p2 = (!onlyRevealed || e.p2PointsRevealed) ? (Number(e.p2Points) || 0) : 0;
      return sum + p1 + p2;
    }, 0);
  }
}

export const gameStore = new GameStore();
