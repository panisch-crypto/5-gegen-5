import { gameStore } from './store.js';
import { soundEngine } from './audio.js';

class GameShowApp {
  constructor() {
    this.root = document.getElementById('app-root');
    this.currentView = this.detectInitialView();
    this.editingSetIndex = 0;
    this.strikeClearTimeout = null;
    this.lastStrikeId = null;
    this.lastRenderedBoardKey = null;

    this.bindTopbar();
    this.bindKeyboardShortcuts();

    window.addEventListener('popstate', () => {
      this.currentView = this.detectInitialView();
      this.lastRenderedBoardKey = null;
      this.render();
    });

    window.addEventListener('sfx-played', (e) => {
      const badge = document.getElementById('last-sfx-readout');
      if (badge && e.detail) {
        badge.textContent = `LETZTER TON: ${e.detail.sound.toUpperCase()}`;
      }
    });

    gameStore.subscribe((state, effect) => {
      this.onStateUpdate(state, effect);
    });

    this.render();
  }

  detectInitialView() {
    const params = new URLSearchParams(window.location.search);
    const v = (params.get('view') || 'host').toLowerCase();
    if (['host', 'display', 'buzzer', 'editor'].includes(v)) {
      return v;
    }
    return 'host';
  }

  switchView(viewName) {
    this.currentView = viewName;
    this.lastRenderedBoardKey = null;
    const url = new URL(window.location.href);
    url.searchParams.set('view', viewName);
    window.history.pushState({}, '', url);
    this.render();
  }

  bindTopbar() {
    document.querySelectorAll('[data-view-target]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-view-target');
        this.switchView(target);
      });
    });

    const muteBtn = document.getElementById('btn-mute-toggle');
    if (muteBtn) {
      muteBtn.addEventListener('click', () => {
        const muted = soundEngine.toggleMute();
        muteBtn.textContent = muted ? 'TON: AUS' : 'TON: EIN';
        muteBtn.classList.toggle('btn-strike', muted);
      });
    }

    const openBeamerBtn = document.getElementById('btn-open-beamer');
    if (openBeamerBtn) {
      openBeamerBtn.addEventListener('click', () => {
        const url = new URL(window.location.href);
        url.searchParams.set('view', 'display');
        window.open(url.toString(), '5Gegen5BeamerView', 'width=1280,height=720');
      });
    }
  }

  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Avoid triggering shortcuts while typing in inputs or textareas
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        return;
      }
      if (this.currentView !== 'host') return;

      const state = gameStore.state;
      if (state.mode === 'rounds') {
        if (e.key >= '1' && e.key <= '8') {
          const idx = Number(e.key) - 1;
          const round = gameStore.getCurrentRoundData();
          if (round && round.answers[idx]) {
            e.preventDefault();
            gameStore.toggleAnswer(round.answers[idx].id);
          }
        } else if (e.key === 'x' || e.key === 'X') {
          e.preventDefault();
          gameStore.triggerStrike();
        }
      }
    });
  }

  onStateUpdate(state, effect) {
    // Auto-dismiss full-screen strike overlay after 2.1 seconds so board remains readable
    if (state.strikeOverlay && state.strikeOverlay.id !== this.lastStrikeId) {
      this.lastStrikeId = state.strikeOverlay.id;
      if (this.strikeClearTimeout) clearTimeout(this.strikeClearTimeout);
      this.strikeClearTimeout = setTimeout(() => {
        if (gameStore.state.strikeOverlay && gameStore.state.strikeOverlay.id === this.lastStrikeId) {
          gameStore.clearStrikeOverlay();
        }
      }, 2100);
    }

    if (this.currentView === 'display') {
      if (!effect) {
        this.lastRenderedBoardKey = null;
      }
      this.renderDisplayView(effect);
    } else if (this.currentView === 'host') {
      // Preserve focus if user is editing a text/number input in Finale or Team setup
      const activeEl = document.activeElement;
      if (activeEl && activeEl.dataset && activeEl.dataset.preserveFocus) {
        this.updateHostDynamicReadouts();
        return;
      }
      this.renderHostView();
    } else if (this.currentView === 'buzzer') {
      this.renderBuzzerView();
    }
  }

  updateTopbarStatus() {
    const activeSet = gameStore.getActiveSet();
    const banner = document.getElementById('active-set-banner');
    if (banner && activeSet) {
      banner.textContent = activeSet.title.toUpperCase();
    }
    const topbar = document.getElementById('topbar');
    if (topbar) {
      topbar.classList.toggle('is-compact-display', this.currentView === 'display');
    }
    document.querySelectorAll('[data-view-target]').forEach(btn => {
      btn.classList.toggle('is-active', btn.getAttribute('data-view-target') === this.currentView);
    });
  }

  render() {
    this.updateTopbarStatus();
    if (this.currentView === 'display') {
      this.renderDisplayView();
    } else if (this.currentView === 'host') {
      this.renderHostView();
    } else if (this.currentView === 'buzzer') {
      this.renderBuzzerView();
    } else if (this.currentView === 'editor') {
      this.renderEditorView();
    }
  }

  // ==========================================================================
  // 1. PUBLIC DISPLAY VIEW (BEAMER / TV 16:9 STAGE)
  // ==========================================================================
  renderDisplayView(effect = null) {
    const state = gameStore.state;
    const activeSet = gameStore.getActiveSet();
    const round = gameStore.getCurrentRoundData();

    const boardKey = `${state.mode}_${state.activeSetId}_${state.currentRoundIndex}_${round ? round.answers.length : 0}`;

    // If we are in 'rounds' mode and the board structure is already mounted for this round,
    // update classes & text in-place so the CSS 3D rotateX(180deg) transition animates smoothly!
    if (state.mode === 'rounds' && this.lastRenderedBoardKey === boardKey && document.getElementById('tv-stage')) {
      this.patchDisplayRoundsDOM(state, round, effect);
      return;
    }

    this.lastRenderedBoardKey = boardKey;

    if (state.mode === 'finale') {
      this.renderDisplayFinaleDOM(state, activeSet);
      return;
    }

    const answerCount = round ? round.answers.length : 5;
    const isShaking = Boolean(state.strikeOverlay);

    this.root.innerHTML = `
      <section class="display-viewport" aria-label="TV und Beamer Spieltafel">
        <div class="tv-stage-frame ${isShaking ? 'is-shaking' : ''}" id="tv-stage">
          <!-- Top Bar: Team A | Round Bank | Team B -->
          <div class="stage-top-bar">
            <div class="team-score-wing" id="disp-wing-a">
              <div class="team-meta">
                <span class="team-status-tag" id="disp-tag-a">TEAM A</span>
                <span class="team-name-display" id="disp-name-a"></span>
              </div>
              <div class="score-led-box mono-num" id="disp-score-a">0</div>
            </div>

            <div class="stage-center-bank">
              <div class="round-meta-col">
                <span class="round-pill-title" id="disp-round-title">RUNDE 1</span>
                <span class="multiplier-badge" id="disp-multiplier">EINFACHE PUNKTE (×1)</span>
              </div>
              <div class="bank-counter-well">
                <span class="bank-counter-label">PUNKTE IM POOL</span>
                <span class="bank-counter-value mono-num" id="disp-bank-points">0</span>
              </div>
            </div>

            <div class="team-score-wing" id="disp-wing-b">
              <div class="team-meta">
                <span class="team-status-tag" id="disp-tag-b">TEAM B</span>
                <span class="team-name-display" id="disp-name-b"></span>
              </div>
              <div class="score-led-box mono-num" id="disp-score-b">0</div>
            </div>
          </div>

          <!-- Question Banner -->
          <div class="question-marquee">
            <p class="question-marquee-text" id="disp-question-text"></p>
          </div>

          <!-- Split-Flap 3D Answer Matrix (4 to 8 Answers) -->
          <div class="board-matrix-well count-${answerCount}" id="disp-board-grid">
            ${(round ? round.answers : []).map((ans, idx) => {
              const isRev = state.revealedIds.includes(ans.id) || state.postRevealedIds.includes(ans.id);
              return `
              <div class="answer-slot-scene ${isRev ? 'is-revealed' : ''}" data-answer-id="${ans.id}" id="disp-slot-${ans.id}">
                <div class="answer-slot-flipper">
                  <!-- Unrevealed Front Face -->
                  <div class="answer-face answer-face-front">
                    <div class="slot-rank-badge mono-num">${idx + 1}</div>
                  </div>
                  <!-- Revealed Back Face (rotated 180deg on X-axis) -->
                  <div class="answer-face answer-face-back" id="disp-slot-back-${ans.id}">
                    <div class="revealed-rank-strip mono-num">${idx + 1}</div>
                    <div class="revealed-answer-text">${this.escapeHtml(ans.text.toUpperCase())}</div>
                    <div class="revealed-answer-points mono-num">${ans.points}</div>
                  </div>
                </div>
              </div>
            `;
            }).join('')}
            ${answerCount % 2 === 1 ? `<div class="answer-slot-blank" aria-hidden="true">5 GEGEN 5</div>` : ''}
          </div>

          <!-- Bottom Status Bar & Strike Lamps -->
          <div class="stage-bottom-bar">
            <div class="phase-indicator-banner" id="disp-phase-banner">DUELL AM PULT</div>
            <div class="strike-lamps" id="disp-strike-lamps">
              <div class="strike-lamp" data-strike-lamp="1">X</div>
              <div class="strike-lamp" data-strike-lamp="2">X</div>
              <div class="strike-lamp" data-strike-lamp="3">X</div>
            </div>
          </div>

          <!-- Full-Screen Strike Stamp Overlay Container -->
          <div id="disp-strike-overlay-host"></div>
        </div>
      </section>
    `;

    this.patchDisplayRoundsDOM(state, round, effect);
  }

  patchDisplayRoundsDOM(state, round, effect) {
    if (!round) return;

    const stage = document.getElementById('tv-stage');
    if (stage) {
      if (effect && effect.type === 'strike') {
        stage.classList.remove('is-shaking');
        void stage.offsetWidth; // Reflow to re-trigger screen-shake keyframe
        stage.classList.add('is-shaking');
      } else if (!state.strikeOverlay) {
        stage.classList.remove('is-shaking');
      }
    }

    // Team A & Team B Wings
    const wingA = document.getElementById('disp-wing-a');
    const wingB = document.getElementById('disp-wing-b');
    const tagA = document.getElementById('disp-tag-a');
    const tagB = document.getElementById('disp-tag-b');

    if (wingA && wingB) {
      wingA.classList.toggle('is-controlling', state.controllingTeam === 'A' && state.roundPhase !== 'steal');
      wingB.classList.toggle('is-controlling', state.controllingTeam === 'B' && state.roundPhase !== 'steal');
      wingA.classList.toggle('is-stealing', state.roundPhase === 'steal' && state.stealTeam === 'A');
      wingB.classList.toggle('is-stealing', state.roundPhase === 'steal' && state.stealTeam === 'B');
    }

    if (tagA) {
      tagA.textContent = state.roundPhase === 'steal' && state.stealTeam === 'A'
        ? '⚡ STEAL-CHANCE!'
        : state.controllingTeam === 'A'
          ? '▶ AM ZUG'
          : state.buzzerWinner === 'A' && state.roundPhase === 'faceoff'
            ? '⚡ BUZZER!'
            : 'TEAM A';
    }
    if (tagB) {
      tagB.textContent = state.roundPhase === 'steal' && state.stealTeam === 'B'
        ? '⚡ STEAL-CHANCE!'
        : state.controllingTeam === 'B'
          ? '▶ AM ZUG'
          : state.buzzerWinner === 'B' && state.roundPhase === 'faceoff'
            ? '⚡ BUZZER!'
            : 'TEAM B';
    }

    const nameA = document.getElementById('disp-name-a');
    const nameB = document.getElementById('disp-name-b');
    const scoreA = document.getElementById('disp-score-a');
    const scoreB = document.getElementById('disp-score-b');
    if (nameA) nameA.textContent = state.teamA.name;
    if (nameB) nameB.textContent = state.teamB.name;
    if (scoreA) scoreA.textContent = String(state.teamA.score);
    if (scoreB) scoreB.textContent = String(state.teamB.score);

    // Round & Bank
    const roundTitle = document.getElementById('disp-round-title');
    const multBadge = document.getElementById('disp-multiplier');
    const bankVal = document.getElementById('disp-bank-points');
    if (roundTitle) roundTitle.textContent = `RUNDE ${round.roundNumber}`;
    if (multBadge) {
      const mLabel = round.multiplier === 3 ? 'DREIFACHE PUNKTE (×3)' : round.multiplier === 2 ? 'DOPPELTE PUNKTE (×2)' : 'EINFACHE PUNKTE (×1)';
      multBadge.textContent = mLabel;
    }
    if (bankVal) bankVal.textContent = String(state.roundBank);

    // Question Marquee
    const qText = document.getElementById('disp-question-text');
    if (qText) {
      if (state.questionVisible) {
        qText.textContent = round.question.toUpperCase();
        qText.classList.remove('is-masked');
      } else {
        qText.textContent = `5 GEGEN 5 — RUNDE ${round.roundNumber} (${round.answers.length} ANTWORTEN AUF DER TAFEL)`;
        qText.classList.add('is-masked');
      }
    }

    // 3D Answer Slots
    round.answers.forEach(ans => {
      const slotEl = document.getElementById(`disp-slot-${ans.id}`);
      const backEl = document.getElementById(`disp-slot-back-${ans.id}`);
      const inPlayReveal = state.revealedIds.includes(ans.id);
      const inPostReveal = state.postRevealedIds.includes(ans.id);
      const revealed = inPlayReveal || inPostReveal;

      if (slotEl) {
        slotEl.classList.toggle('is-revealed', revealed);
      }
      if (backEl) {
        backEl.classList.toggle('is-post-reveal', inPostReveal && !inPlayReveal);
      }
    });

    // Bottom Phase Banner & Strike Lamps
    const phaseBanner = document.getElementById('disp-phase-banner');
    if (phaseBanner) {
      if (state.roundPhase === 'faceoff') {
        if (state.buzzerWinner) {
          const tName = state.buzzerWinner === 'A' ? state.teamA.name : state.teamB.name;
          phaseBanner.textContent = `⚡ ${tName} HAT ZUERST GEBUZZERT — SPIELEN ODER WEITERGEBEN?`;
        } else {
          phaseBanner.textContent = 'DUELL AM PULT — WER BUZZERT ZUERST?';
        }
      } else if (state.roundPhase === 'playing') {
        const ctrlName = state.controllingTeam === 'B' ? state.teamB.name : state.teamA.name;
        phaseBanner.textContent = `AKTIVES TEAM: ${ctrlName} (${state.strikes} / 3 FEHLVERSUCHE)`;
      } else if (state.roundPhase === 'steal') {
        const stealName = state.stealTeam === 'B' ? state.teamB.name : state.teamA.name;
        phaseBanner.textContent = `🚨 3 FEHLVERSUCHE! STEAL-PHASE FÜR ${stealName}!`;
      } else if (state.roundPhase === 'settled') {
        const winName = state.roundWinner === 'B' ? state.teamB.name : state.teamA.name;
        phaseBanner.textContent = `🏆 RUNDE ENTSCHIEDEN — PUNKTE AN ${winName}!`;
      }
    }

    document.querySelectorAll('[data-strike-lamp]').forEach(lamp => {
      const idx = Number(lamp.getAttribute('data-strike-lamp'));
      lamp.classList.toggle('is-lit', state.strikes >= idx);
    });

    // Full-screen Strike Stamp Overlay
    const overlayHost = document.getElementById('disp-strike-overlay-host');
    if (overlayHost) {
      if (state.strikeOverlay) {
        const count = Math.min(3, Math.max(1, Number(state.strikeOverlay.count) || 1));
        const boxes = Array.from({ length: count }).map(() => `<div class="strike-x-box">X</div>`).join('');
        overlayHost.innerHTML = `
          <div class="strike-fullscreen-overlay" data-overlay-id="${state.strikeOverlay.id}">
            <div class="strike-stamp-row">${boxes}</div>
            <div class="strike-caption">FEHLVERSUCH! (${count}X)</div>
          </div>
        `;
      } else {
        overlayHost.innerHTML = '';
      }
    }
  }

  renderDisplayFinaleDOM(state, activeSet) {
    const f = state.finale;
    const totalPoints = gameStore.getFinaleTotal(true);
    const isWon = totalPoints >= (f.targetPoints || 200);

    this.root.innerHTML = `
      <section class="display-viewport" aria-label="Finale Spieltafel">
        <div class="tv-stage-frame" id="tv-stage-finale">
          <!-- Finale Top Header -->
          <div class="stage-top-bar">
            <div class="team-score-wing ${f.activePlayer === 1 ? 'is-controlling' : ''}">
              <div class="team-meta">
                <span class="team-status-tag">20 SEKUNDEN</span>
                <span class="team-name-display">SPIELER 1 ${f.hidePlayer1 ? '(VERBORGEN)' : ''}</span>
              </div>
            </div>

            <div class="stage-center-bank">
              <div class="round-meta-col">
                <span class="round-pill-title">FINALE — 5FRAGEN</span>
                <span class="multiplier-badge">ZIEL: ${f.targetPoints} PUNKTE</span>
              </div>
              <div class="finale-timer-box mono-num ${f.timerSeconds <= 5 ? 'is-urgent' : ''}" id="disp-finale-timer">
                ${String(f.timerSeconds).padStart(2, '0')}s
              </div>
              <div class="bank-counter-well">
                <span class="bank-counter-label">GESAMTPUNKTE</span>
                <span class="bank-counter-value mono-num" id="disp-finale-total">${totalPoints}</span>
              </div>
            </div>

            <div class="team-score-wing ${f.activePlayer === 2 ? 'is-controlling' : ''}">
              <div class="team-meta">
                <span class="team-status-tag">25 SEKUNDEN</span>
                <span class="team-name-display">SPIELER 2</span>
              </div>
            </div>
          </div>

          <!-- Finale 5x2 Matrix -->
          <div class="finale-board-grid">
            <!-- Player 1 Column -->
            <div class="finale-player-column ${f.activePlayer === 1 ? 'is-active-player' : ''}">
              <div class="finale-col-header">
                <span>SPIELER 1 ANTWORTEN</span>
                <span class="mono-num">PUNKTE</span>
              </div>
              ${f.entries.map((e, idx) => {
                const showText = e.p1TextRevealed && !f.hidePlayer1;
                const showPts = e.p1PointsRevealed && !f.hidePlayer1;
                return `
                  <div class="finale-row ${showText || showPts ? 'is-revealed' : ''}">
                    <div class="finale-row-num mono-num">${idx + 1}</div>
                    <div class="finale-row-answer ${showText ? '' : 'is-hidden'}">
                      ${showText ? this.escapeHtml((e.p1Text || '---').toUpperCase()) : '▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪'}
                    </div>
                    <div class="finale-row-points mono-num">
                      ${showPts ? e.p1Points : '--'}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>

            <!-- Player 2 Column -->
            <div class="finale-player-column ${f.activePlayer === 2 ? 'is-active-player' : ''}">
              <div class="finale-col-header">
                <span>SPIELER 2 ANTWORTEN</span>
                <span class="mono-num">PUNKTE</span>
              </div>
              ${f.entries.map((e, idx) => {
                const showText = e.p2TextRevealed;
                const showPts = e.p2PointsRevealed;
                return `
                  <div class="finale-row ${showText || showPts ? 'is-revealed' : ''}">
                    <div class="finale-row-num mono-num">${idx + 1}</div>
                    <div class="finale-row-answer ${showText ? '' : 'is-hidden'}">
                      ${showText ? this.escapeHtml((e.p2Text || '---').toUpperCase()) : '▪ ▪ ▪ ▪ ▪ ▪ ▪ ▪'}
                    </div>
                    <div class="finale-row-points mono-num">
                      ${showPts ? e.p2Points : '--'}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Finale Bottom Status -->
          <div class="stage-bottom-bar">
            <div class="phase-indicator-banner">
              ${isWon
                ? `🏆 FINALE GEWONNEN! ${totalPoints} VON ${f.targetPoints} PUNKTEN ERREICHT!`
                : `FINALE LÄUFT — NOCH ${Math.max(0, f.targetPoints - totalPoints)} PUNKTE BIS ZUM SIEG`}
            </div>
            <div class="mono-num" style="color: var(--accent-gold); font-size: 1.1rem;">
              AKTIV: SPIELER ${f.activePlayer}
            </div>
          </div>

          ${f.duplicateAlert ? `
            <div class="strike-fullscreen-overlay">
              <div class="strike-x-box" style="width: auto; height: auto; padding: 1.5rem 3rem; font-size: clamp(3rem, 6vw, 5.5rem);">
                DUPLIKAT!
              </div>
              <div class="strike-caption">GLEICHE ANTWORT WIE SPIELER 1 — BITTE ANDERE ANTWORT NENNEN!</div>
            </div>
          ` : ''}
        </div>
      </section>
    `;
  }

  // ==========================================================================
  // 2. HOST ADMIN CONSOLE (SPIELLEITER-KONSOLE)
  // ==========================================================================
  updateHostDynamicReadouts() {
    const timerReadout = document.getElementById('host-finale-timer-readout');
    if (timerReadout && gameStore.state.finale) {
      timerReadout.textContent = `${gameStore.state.finale.timerSeconds}s`;
    }
  }

  renderHostView() {
    const state = gameStore.state;
    const activeSet = gameStore.getActiveSet();
    const round = gameStore.getCurrentRoundData();

    this.root.innerHTML = `
      <section class="host-workspace" aria-label="Spielleiter Regie-Konsole">
        <!-- LEFT COLUMN: Game Set, Teams, Face-off Duel & Soundboard -->
        <div style="display: flex; flex-direction: column; gap: 1rem;">
          <!-- Set Selection & Reset -->
          <div class="console-panel">
            <div class="panel-header">
              <h2 class="panel-title">1. SPIEL-SET & TEAMS</h2>
              <span class="panel-badge">PHASE 1</span>
            </div>

            <label style="font-size: 0.85rem; color: var(--text-Secondary); text-transform: uppercase;">
              Aktives Fragen-Set:
            </label>
            <div style="display: flex; gap: 0.5rem;">
              <select class="select-field" id="host-set-select" style="flex: 1;">
                ${gameStore.gameSets.map(s => `
                  <option value="${s.id}" ${s.id === state.activeSetId ? 'selected' : ''}>
                    ${this.escapeHtml(s.title)} (${s.rounds.length} Runden)
                  </option>
                `).join('')}
              </select>
              <button type="button" class="btn btn-sm" id="host-btn-reset-match" title="Gesamtes Spiel zurücksetzen">
                NEUSTART
              </button>
            </div>

            <!-- Team A & Team B Config -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.65rem; margin-top: 0.25rem;">
              <div style="background: var(--bg-panel-deep); padding: 0.65rem; border: 2px solid ${state.controllingTeam === 'A' ? 'var(--accent-gold)' : 'var(--border-steel)'}; border-radius: var(--radius-sharp);">
                <div style="font-size: 0.78rem; color: var(--accent-gold); margin-bottom: 0.3rem;">TEAM A NAME & PUNKTE</div>
                <input type="text" class="input-field" id="host-team-a-name" data-preserve-focus="true" value="${this.escapeHtml(state.teamA.name)}" style="width: 100%; margin-bottom: 0.4rem;" />
                <div style="display: flex; gap: 0.35rem; align-items: center;">
                  <input type="number" class="input-field mono-num" id="host-team-a-score" data-preserve-focus="true" value="${state.teamA.score}" style="width: 100%;" />
                  <button type="button" class="btn btn-sm btn-gold" id="host-btn-save-teams">OK</button>
                </div>
              </div>

              <div style="background: var(--bg-panel-deep); padding: 0.65rem; border: 2px solid ${state.controllingTeam === 'B' ? 'var(--accent-gold)' : 'var(--border-steel)'}; border-radius: var(--radius-sharp);">
                <div style="font-size: 0.78rem; color: var(--accent-gold); margin-bottom: 0.3rem;">TEAM B NAME & PUNKTE</div>
                <input type="text" class="input-field" id="host-team-b-name" data-preserve-focus="true" value="${this.escapeHtml(state.teamB.name)}" style="width: 100%; margin-bottom: 0.4rem;" />
                <div style="display: flex; gap: 0.35rem; align-items: center;">
                  <input type="number" class="input-field mono-num" id="host-team-b-score" data-preserve-focus="true" value="${state.teamB.score}" style="width: 100%;" />
                  <button type="button" class="btn btn-sm btn-gold" id="host-btn-save-teams-b">OK</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Phase 2: Face-Off (Duell am Pult) -->
          <div class="console-panel">
            <div class="panel-header">
              <h2 class="panel-title">2. DUELL AM PULT (FACE-OFF)</h2>
              <span class="panel-badge">PHASE 2</span>
            </div>

            <div style="background: var(--bg-panel-deep); border: 1px solid var(--border-bright); padding: 0.65rem; border-radius: var(--radius-sharp); text-align: center;">
              <div style="font-size: 0.8rem; color: var(--text-Secondary);">BUZZER-STATUS:</div>
              <div style="font-size: 1.15rem; color: var(--accent-gold); margin-top: 0.2rem;">
                ${state.buzzerWinner
                  ? `⚡ ${state.buzzerWinner === 'A' ? state.teamA.name : state.teamB.name} HAT ZUERST GEBUZZERT!`
                  : 'WARTET AUF BUZZER-EINGABE...'}
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr auto; gap: 0.4rem;">
              <button type="button" class="btn btn-sm ${state.buzzerWinner === 'A' ? 'btn-gold' : ''}" id="host-buzz-a">
                ⚡ BUZZ ${this.escapeHtml(state.teamA.name)}
              </button>
              <button type="button" class="btn btn-sm ${state.buzzerWinner === 'B' ? 'btn-gold' : ''}" id="host-buzz-b">
                ⚡ BUZZ ${this.escapeHtml(state.teamB.name)}
              </button>
              <button type="button" class="btn btn-sm" id="host-buzz-reset">
                RESET
              </button>
            </div>

            <div style="border-top: 1px solid var(--border-steel); padding-top: 0.6rem;">
              <div style="font-size: 0.82rem; color: var(--text-Secondary); margin-bottom: 0.4rem; text-transform: uppercase;">
                Entscheidung des Duell-Siegers (${state.buzzerWinner === 'B' ? state.teamB.name : state.teamA.name}):
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                <button type="button" class="btn btn-gold" id="host-decide-play">
                  ▶ SPIELEN
                </button>
                <button type="button" class="btn" id="host-decide-pass">
                  ⇄ WEITERGEBEN
                </button>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; border-top: 1px solid var(--border-steel); padding-top: 0.6rem;">
              <button type="button" class="btn btn-sm ${state.controllingTeam === 'A' ? 'btn-gold' : ''}" id="host-ctrl-a">
                KONTROLLE: ${this.escapeHtml(state.teamA.name)}
              </button>
              <button type="button" class="btn btn-sm ${state.controllingTeam === 'B' ? 'btn-gold' : ''}" id="host-ctrl-b">
                KONTROLLE: ${this.escapeHtml(state.teamB.name)}
              </button>
            </div>
          </div>

          <!-- Audio Soundboard (FR-3.1) -->
          <div class="console-panel">
            <div class="panel-header">
              <h2 class="panel-title">STUDIO SOUNDBOARD (SFX)</h2>
              <span class="panel-badge mono-num" id="last-sfx-readout">
                ${soundEngine.lastPlayed ? `LETZTER TON: ${soundEngine.lastPlayed.sound.toUpperCase()}` : 'BEREIT'}
              </span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.45rem;">
              <button type="button" class="btn btn-sm" data-sfx="ding">🔔 DING (ANTWORT)</button>
              <button type="button" class="btn btn-sm btn-strike" data-sfx="strike">✖ STRIKE (X)</button>
              <button type="button" class="btn btn-sm" data-sfx="duplicate">⚠ DUPLIKAT</button>
              <button type="button" class="btn btn-sm btn-gold" data-sfx="round_win">🎺 RUNDEN-SIEG</button>
              <button type="button" class="btn btn-sm" data-sfx="timer_tick">⏱ TIMER TICK</button>
              <button type="button" class="btn btn-sm" data-sfx="timer_end">🚨 TIMER ENDE</button>
            </div>
          </div>
        </div>

        <!-- CENTER COLUMN: Active Round / Finale Matrix Control -->
        <div class="console-panel">
          <div class="panel-header">
            <h2 class="panel-title">3. RUNDEN- & TAFEL-STEUERUNG</h2>
            <span class="panel-badge">TASTATUR: [1-8] ANTWORTEN | [X] STRIKE</span>
          </div>

          <!-- Round Selector Strip (R1..R4 + FINALE) -->
          <div class="round-selector-strip">
            ${(activeSet.rounds || []).map((r, idx) => {
              const mult = idx === 2 ? 2 : idx >= 3 ? 3 : (r.multiplier || 1);
              const isAct = state.mode === 'rounds' && state.currentRoundIndex === idx;
              return `
                <button type="button" class="round-tab-btn ${isAct ? 'is-active' : ''}" data-round-idx="${idx}">
                  RUNDE ${idx + 1} (×${mult})
                </button>
              `;
            }).join('')}
            <button type="button" class="round-tab-btn ${state.mode === 'finale' ? 'is-active' : ''}" id="host-tab-finale">
              ★ FINALE (200P)
            </button>
          </div>

          ${state.mode === 'rounds' ? this.renderHostRoundCenter(state, round) : this.renderHostFinaleCenter(state, activeSet)}
        </div>

        <!-- RIGHT COLUMN: Strikes, Steal Phase & Round Settlement -->
        <div style="display: flex; flex-direction: column; gap: 1rem;">
          <!-- Strike System (FR-2.7) -->
          <div class="console-panel">
            <div class="panel-header">
              <h2 class="panel-title">4. FEHLVERSUCHE (STRIKES)</h2>
              <span class="panel-badge mono-num">AKTUELL: ${state.strikes} / 3 X</span>
            </div>

            <button type="button" class="btn btn-strike" id="host-btn-strike-main" style="font-size: 1.25rem; padding: 0.85rem;">
              ✖ FEHLVERSUCH / X AUSLÖSEN
            </button>

            <div class="strike-control-grid">
              <button type="button" class="btn btn-sm ${state.strikes === 1 ? 'btn-strike' : ''}" data-set-strike="1">1X</button>
              <button type="button" class="btn btn-sm ${state.strikes === 2 ? 'btn-strike' : ''}" data-set-strike="2">2X</button>
              <button type="button" class="btn btn-sm ${state.strikes === 3 ? 'btn-strike' : ''}" data-set-strike="3">3X</button>
              <button type="button" class="btn btn-sm" id="host-btn-strike-reset">0 (RESET)</button>
            </div>
          </div>

          <!-- Steal Mechanism (FR-2.8) -->
          <div class="console-panel" style="border-color: ${state.roundPhase === 'steal' ? 'var(--strike-red)' : 'var(--border-steel)'};">
            <div class="panel-header">
              <h2 class="panel-title" style="color: ${state.roundPhase === 'steal' ? 'var(--strike-red)' : 'var(--accent-gold)'};">
                5. STEAL-PHASE (PUNKTE STEHLEN)
              </h2>
              <span class="panel-badge">${state.roundPhase === 'steal' ? '⚡ AKTIV' : 'BEREIT'}</span>
            </div>

            <p style="font-size: 0.9rem; color: var(--text-Secondary);">
              Nach 3 Fehlversuchen hat das gegnerische Team (<strong>${state.stealTeam === 'A' ? state.teamA.name : state.stealTeam === 'B' ? state.teamB.name : (state.controllingTeam === 'A' ? state.teamB.name : state.teamA.name)}</strong>) genau einen Versuch, die Punkte im Pool (<span class="mono-num" style="color: var(--accent-gold);">${state.roundBank} P.</span>) zu stehlen:
            </p>

            <div style="display: flex; flex-direction: column; gap: 0.5rem;">
              <button type="button" class="btn btn-gold" id="host-btn-steal-success">
                ✅ STEAL ERFOLGREICH (GEGNER STIEHLT POOL)
              </button>
              <button type="button" class="btn btn-strike" id="host-btn-steal-fail">
                ✖ STEAL FEHLGESCHLAGEN (TEAM BEHÄLT POOL)
              </button>
            </div>
          </div>

          <!-- End of Round Settlement (FR-2.9) -->
          <div class="console-panel">
            <div class="panel-header">
              <h2 class="panel-title">6. RUNDEN-ABRECHNUNG</h2>
              <span class="panel-badge mono-num">POOL: ${state.roundBank} P.</span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
              <button type="button" class="btn btn-gold" id="host-award-a">
                🏆 +${state.roundBank} P. AN ${this.escapeHtml(state.teamA.name)}
              </button>
              <button type="button" class="btn btn-gold" id="host-award-b">
                🏆 +${state.roundBank} P. AN ${this.escapeHtml(state.teamB.name)}
              </button>
            </div>

            <button type="button" class="btn" id="host-reveal-remaining">
              👁 ALLE RESTLICHEN ANTWORTEN AUFDECKEN
            </button>

            <button type="button" class="btn btn-gold" id="host-next-round">
              ➔ NÄCHSTE RUNDE / WEITER
            </button>
          </div>
        </div>
      </section>
    `;

    this.bindHostEvents();
  }

  renderHostRoundCenter(state, round) {
    if (!round) return `<p>Keine Rundendaten vorhanden.</p>`;
    const totalBasePoints = round.answers.reduce((sum, a) => sum + (Number(a.points) || 0), 0);

    return `
      <!-- Question Header & Bank Summary -->
      <div style="background: var(--bg-panel-deep); border: 2px solid var(--accent-gold); padding: 0.85rem 1rem; border-radius: var(--radius-sharp); display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
        <div>
          <div style="font-size: 0.8rem; color: var(--accent-gold); letter-spacing: 0.1em;">
            FRAGE RUNDE ${round.roundNumber} • MULTIPLIKATOR ×${round.multiplier} • SUMME BASISPUNKTE: <span class="mono-num">${totalBasePoints}</span>
          </div>
          <div style="font-size: 1.35rem; font-weight: 900; text-transform: uppercase; margin-top: 0.15rem;">
            „${this.escapeHtml(round.question)}“
          </div>
        </div>
        <div style="text-align: right; min-width: 135px;">
          <div style="font-size: 0.75rem; color: var(--text-Secondary);">RUNDEN-POOL</div>
          <div class="mono-num" style="font-size: 2.1rem; color: var(--accent-gold); line-height: 1;">
            ${state.roundBank}
          </div>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 0.9rem; color: var(--text-Secondary); text-transform: uppercase;">
          Klicken Sie auf eine Antwort, um die 3D-Klappe auf dem TV-Board umzudrehen:
        </span>
        <button type="button" class="btn btn-sm" id="host-toggle-q-vis">
          ${state.questionVisible ? 'FRAGE AUF BOARD AUSBLENDEN' : 'FRAGE AUF BOARD EINBLENDEN'}
        </button>
      </div>

      <!-- Answers List for Host -->
      <div class="host-answer-list">
        ${round.answers.map((ans, idx) => {
          const inPlay = state.revealedIds.includes(ans.id);
          const inPost = state.postRevealedIds.includes(ans.id);
          const isRev = inPlay || inPost;
          const multPoints = (Number(ans.points) || 0) * (round.multiplier || 1);
          return `
            <div class="host-answer-row ${isRev ? 'is-revealed' : ''}" data-toggle-answer="${ans.id}">
              <div class="host-answer-rank mono-num">${idx + 1}</div>
              <div class="host-answer-text">${this.escapeHtml(ans.text.toUpperCase())}</div>
              <div class="host-answer-pts mono-num" title="Basispunkte × Multiplikator">
                ${ans.points} P. ${round.multiplier > 1 ? `(×${round.multiplier} = ${multPoints})` : ''}
              </div>
              <button type="button" class="btn btn-sm ${isRev ? 'btn-gold' : ''}">
                ${isRev ? '✓ OFFEN' : 'AUFDECKEN'}
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  renderHostFinaleCenter(state, activeSet) {
    const f = state.finale;
    const finalQuestions = activeSet.finalQuestions || [];
    const revealedTotal = gameStore.getFinaleTotal(true);
    const rawTotal = gameStore.getFinaleTotal(false);

    return `
      <!-- Finale Control Bar -->
      <div style="background: var(--bg-panel-deep); border: 2px solid var(--accent-gold); padding: 0.85rem; border-radius: var(--radius-sharp); display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem;">
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <button type="button" class="btn ${f.activePlayer === 1 ? 'btn-gold' : ''}" id="host-finale-p1">
            SPIELER 1 (20s)
          </button>
          <button type="button" class="btn ${f.activePlayer === 2 ? 'btn-gold' : ''}" id="host-finale-p2">
            SPIELER 2 (25s)
          </button>
          <button type="button" class="btn btn-sm ${f.hidePlayer1 ? 'btn-gold' : ''}" id="host-finale-hide-p1">
            ${f.hidePlayer1 ? '🔒 SPIELER 1 VERBORGEN' : '👁 SPIELER 1 SICHTBAR'}
          </button>
        </div>

        <div style="display: flex; gap: 0.45rem; align-items: center;">
          <span class="mono-num" id="host-finale-timer-readout" style="font-size: 1.75rem; color: var(--accent-gold); padding: 0 0.5rem;">
            ${f.timerSeconds}s
          </span>
          <button type="button" class="btn btn-sm btn-gold" id="host-timer-start">▶ START</button>
          <button type="button" class="btn btn-sm" id="host-timer-stop">⏸ STOP</button>
          <button type="button" class="btn btn-sm" id="host-timer-reset">↺ RESET</button>
        </div>

        <div style="display: flex; gap: 0.45rem; align-items: center;">
          <button type="button" class="btn btn-sm btn-strike" id="host-finale-dup-btn">
            ⚠ DUPLIKAT-WARNUNG
          </button>
          <span class="mono-num" style="font-size: 1.2rem; color: var(--accent-gold);">
            SICHTBAR: ${revealedTotal} / 200 P. (GESAMT: ${rawTotal})
          </span>
        </div>
      </div>

      <!-- 5 Rapid-Fire Questions Editor & Reveal Rows -->
      <div style="display: flex; flex-direction: column; gap: 0.65rem;">
        ${[0, 1, 2, 3, 4].map((qIdx) => {
          const qObj = finalQuestions[qIdx] || { id: `f${qIdx + 1}`, question: `Finalfrage ${qIdx + 1}` };
          const entry = f.entries[qIdx];
          const suggestions = qObj.suggestions || [];

          return `
            <div style="background: var(--bg-panel-deep); border: 1px solid var(--border-steel); padding: 0.7rem; border-radius: var(--radius-sharp);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.45rem; flex-wrap: wrap; gap: 0.4rem;">
                <strong style="color: var(--accent-gold); font-size: 1.05rem; text-transform: uppercase;">
                  F${qIdx + 1}: ${this.escapeHtml(qObj.question)}
                </strong>
                <div style="display: flex; gap: 0.3rem; flex-wrap: wrap;">
                  ${suggestions.map(sug => `
                    <button type="button" class="btn btn-sm" style="font-size: 0.75rem; padding: 0.2rem 0.45rem;"
                      data-finale-suggest-q="${qIdx}"
                      data-finale-suggest-text="${this.escapeHtml(sug.text)}"
                      data-finale-suggest-pts="${sug.points}">
                      ${this.escapeHtml(sug.text)} (${sug.points})
                    </button>
                  `).join('')}
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.65rem;">
                <!-- Player 1 Input & Reveal -->
                <div style="display: grid; grid-template-columns: 1fr 72px auto auto; gap: 0.35rem; align-items: center;">
                  <input type="text" class="input-field" placeholder="Spieler 1 Antwort"
                    data-preserve-focus="true"
                    data-finale-input="p1-text-${qIdx}"
                    value="${this.escapeHtml(entry.p1Text)}" />
                  <input type="number" class="input-field mono-num" placeholder="Pkt"
                    data-preserve-focus="true"
                    data-finale-input="p1-pts-${qIdx}"
                    value="${entry.p1Points}" />
                  <button type="button" class="btn btn-sm ${entry.p1TextRevealed ? 'btn-gold' : ''}" data-finale-toggle="p1-text-${qIdx}">
                    TEXT
                  </button>
                  <button type="button" class="btn btn-sm ${entry.p1PointsRevealed ? 'btn-gold' : ''}" data-finale-toggle="p1-pts-${qIdx}">
                    PKT 🔔
                  </button>
                </div>

                <!-- Player 2 Input & Reveal -->
                <div style="display: grid; grid-template-columns: 1fr 72px auto auto; gap: 0.35rem; align-items: center;">
                  <input type="text" class="input-field" placeholder="Spieler 2 Antwort"
                    data-preserve-focus="true"
                    data-finale-input="p2-text-${qIdx}"
                    value="${this.escapeHtml(entry.p2Text)}" />
                  <input type="number" class="input-field mono-num" placeholder="Pkt"
                    data-preserve-focus="true"
                    data-finale-input="p2-pts-${qIdx}"
                    value="${entry.p2Points}" />
                  <button type="button" class="btn btn-sm ${entry.p2TextRevealed ? 'btn-gold' : ''}" data-finale-toggle="p2-text-${qIdx}">
                    TEXT
                  </button>
                  <button type="button" class="btn btn-sm ${entry.p2PointsRevealed ? 'btn-gold' : ''}" data-finale-toggle="p2-pts-${qIdx}">
                    PKT 🔔
                  </button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  bindHostEvents() {
    const state = gameStore.state;

    // Set selector & reset
    const setSelect = document.getElementById('host-set-select');
    if (setSelect) {
      setSelect.addEventListener('change', () => {
        gameStore.selectGameSet(setSelect.value);
      });
    }
    document.getElementById('host-btn-reset-match')?.addEventListener('click', () => {
      gameStore.resetMatch();
    });

    // Save team names & scores
    const saveTeams = () => {
      const nameA = document.getElementById('host-team-a-name')?.value;
      const nameB = document.getElementById('host-team-b-name')?.value;
      const scoreA = Number(document.getElementById('host-team-a-score')?.value);
      const scoreB = Number(document.getElementById('host-team-b-score')?.value);
      gameStore.updateTeams({ nameA, nameB, scoreA, scoreB });
    };
    document.getElementById('host-btn-save-teams')?.addEventListener('click', saveTeams);
    document.getElementById('host-btn-save-teams-b')?.addEventListener('click', saveTeams);

    // Face-Off Buzzer & Play/Pass
    document.getElementById('host-buzz-a')?.addEventListener('click', () => gameStore.buzzIn('A'));
    document.getElementById('host-buzz-b')?.addEventListener('click', () => gameStore.buzzIn('B'));
    document.getElementById('host-buzz-reset')?.addEventListener('click', () => gameStore.resetBuzzer());

    document.getElementById('host-decide-play')?.addEventListener('click', () => {
      const winner = state.buzzerWinner || 'A';
      gameStore.decideFaceOff(winner, 'play');
    });
    document.getElementById('host-decide-pass')?.addEventListener('click', () => {
      const winner = state.buzzerWinner || 'A';
      gameStore.decideFaceOff(winner, 'pass');
    });

    document.getElementById('host-ctrl-a')?.addEventListener('click', () => gameStore.setControllingTeam('A'));
    document.getElementById('host-ctrl-b')?.addEventListener('click', () => gameStore.setControllingTeam('B'));

    // Soundboard buttons
    document.querySelectorAll('[data-sfx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sfx = btn.getAttribute('data-sfx');
        soundEngine.play(sfx);
      });
    });

    // Round tabs
    document.querySelectorAll('[data-round-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-round-idx'));
        gameStore.switchToRound(idx);
      });
    });
    document.getElementById('host-tab-finale')?.addEventListener('click', () => {
      gameStore.enterFinale();
    });

    // Question visibility
    document.getElementById('host-toggle-q-vis')?.addEventListener('click', () => {
      gameStore.toggleQuestionVisibility();
    });

    // Answer reveal rows
    document.querySelectorAll('[data-toggle-answer]').forEach(row => {
      row.addEventListener('click', () => {
        const ansId = Number(row.getAttribute('data-toggle-answer'));
        gameStore.toggleAnswer(ansId);
      });
    });

    // Strikes
    document.getElementById('host-btn-strike-main')?.addEventListener('click', () => {
      gameStore.triggerStrike();
    });
    document.querySelectorAll('[data-set-strike]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cnt = Number(btn.getAttribute('data-set-strike'));
        gameStore.triggerStrike(cnt);
      });
    });
    document.getElementById('host-btn-strike-reset')?.addEventListener('click', () => {
      gameStore.resetStrikes();
    });

    // Steal Phase
    document.getElementById('host-btn-steal-success')?.addEventListener('click', () => {
      gameStore.resolveSteal(true);
    });
    document.getElementById('host-btn-steal-fail')?.addEventListener('click', () => {
      gameStore.resolveSteal(false);
    });

    // Round Settlement & Next Round
    document.getElementById('host-award-a')?.addEventListener('click', () => gameStore.awardRoundBank('A'));
    document.getElementById('host-award-b')?.addEventListener('click', () => gameStore.awardRoundBank('B'));
    document.getElementById('host-reveal-remaining')?.addEventListener('click', () => gameStore.revealAllRemaining());
    document.getElementById('host-next-round')?.addEventListener('click', () => {
      const set = gameStore.getActiveSet();
      if (state.mode === 'rounds' && state.currentRoundIndex + 1 < set.rounds.length) {
        gameStore.switchToRound(state.currentRoundIndex + 1);
      } else {
        gameStore.enterFinale();
      }
    });

    // Finale Controls
    document.getElementById('host-finale-p1')?.addEventListener('click', () => gameStore.setFinalePlayer(1));
    document.getElementById('host-finale-p2')?.addEventListener('click', () => gameStore.setFinalePlayer(2));
    document.getElementById('host-finale-hide-p1')?.addEventListener('click', () => gameStore.toggleHidePlayer1());
    document.getElementById('host-timer-start')?.addEventListener('click', () => gameStore.startFinalTimer());
    document.getElementById('host-timer-stop')?.addEventListener('click', () => gameStore.stopFinalTimer());
    document.getElementById('host-timer-reset')?.addEventListener('click', () => gameStore.resetFinalTimer());
    document.getElementById('host-finale-dup-btn')?.addEventListener('click', () => {
      if (state.finale.duplicateAlert) {
        gameStore.clearDuplicateWarning();
      } else {
        gameStore.triggerDuplicateWarning();
      }
    });

    // Finale quick-suggestion chips
    document.querySelectorAll('[data-finale-suggest-q]').forEach(chip => {
      chip.addEventListener('click', () => {
        const qIdx = Number(chip.getAttribute('data-finale-suggest-q'));
        const text = chip.getAttribute('data-finale-suggest-text');
        const points = Number(chip.getAttribute('data-finale-suggest-pts'));
        const activePlayer = gameStore.state.finale.activePlayer;
        gameStore.updateFinaleEntry(qIdx, activePlayer, { text, points });
      });
    });

    // Finale text/points inputs
    document.querySelectorAll('[data-finale-input]').forEach(inp => {
      inp.addEventListener('input', () => {
        const [playerKey, fieldKey, qIdxStr] = inp.getAttribute('data-finale-input').split('-');
        const playerNum = playerKey === 'p2' ? 2 : 1;
        const qIdx = Number(qIdxStr);
        if (fieldKey === 'text') {
          gameStore.updateFinaleEntry(qIdx, playerNum, { text: inp.value });
        } else {
          gameStore.updateFinaleEntry(qIdx, playerNum, { points: Number(inp.value) || 0 });
        }
      });
    });

    // Finale reveal buttons
    document.querySelectorAll('[data-finale-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [playerKey, fieldKey, qIdxStr] = btn.getAttribute('data-finale-toggle').split('-');
        const playerNum = playerKey === 'p2' ? 2 : 1;
        const qIdx = Number(qIdxStr);
        const entry = gameStore.state.finale.entries[qIdx];
        if (fieldKey === 'text') {
          const cur = playerNum === 1 ? entry.p1TextRevealed : entry.p2TextRevealed;
          gameStore.updateFinaleEntry(qIdx, playerNum, { textRevealed: !cur });
        } else {
          const cur = playerNum === 1 ? entry.p1PointsRevealed : entry.p2PointsRevealed;
          gameStore.updateFinaleEntry(qIdx, playerNum, { pointsRevealed: !cur });
        }
      });
    });
  }

  // ==========================================================================
  // 3. PLAYERS / BUZZER CLIENT VIEW (DUELL AM PULT)
  // ==========================================================================
  renderBuzzerView() {
    const state = gameStore.state;
    const round = gameStore.getCurrentRoundData();

    this.root.innerHTML = `
      <section class="buzzer-arena" aria-label="Duell-Buzzer Pult">
        <div class="console-panel" style="text-align: center;">
          <div style="font-size: 0.9rem; color: var(--accent-gold); letter-spacing: 0.14em;">
            5 GEGEN 5 • DUELL AM PULT • RUNDE ${round ? round.roundNumber : 1}
          </div>
          <h1 style="font-size: 2.2rem; font-weight: 900; text-transform: uppercase; margin: 0.25rem 0;">
            ${state.buzzerWinner
              ? `⚡ ${state.buzzerWinner === 'A' ? state.teamA.name : state.teamB.name} HAT ZUERST GEBUZZERT!`
              : 'BEREIT FÜR DAS DUELL — JETZT BUZZERN!'}
          </h1>
        </div>

        <div class="buzzer-podium-grid">
          <button type="button"
            class="podium-buzzer-btn ${state.buzzerWinner === 'A' ? 'is-winner' : state.buzzerLocked ? 'is-locked-out' : ''}"
            id="client-buzz-a">
            <span style="font-size: 1rem; letter-spacing: 0.15em;">TEAM-KAPITÄN A</span>
            <span style="font-size: 2.6rem; font-weight: 900; text-transform: uppercase;">${this.escapeHtml(state.teamA.name)}</span>
            <span class="mono-num" style="font-size: 1.2rem;">
              ${state.buzzerWinner === 'A' ? '★ ERSTER AM BUZZER ★' : 'DRÜCKEN ZUM BUZZERN'}
            </span>
          </button>

          <button type="button"
            class="podium-buzzer-btn ${state.buzzerWinner === 'B' ? 'is-winner' : state.buzzerLocked ? 'is-locked-out' : ''}"
            id="client-buzz-b">
            <span style="font-size: 1rem; letter-spacing: 0.15em;">TEAM-KAPITÄN B</span>
            <span style="font-size: 2.6rem; font-weight: 900; text-transform: uppercase;">${this.escapeHtml(state.teamB.name)}</span>
            <span class="mono-num" style="font-size: 1.2rem;">
              ${state.buzzerWinner === 'B' ? '★ ERSTER AM BUZZER ★' : 'DRÜCKEN ZUM BUZZERN'}
            </span>
          </button>
        </div>

        <div style="text-align: center;">
          <button type="button" class="btn" id="client-buzz-reset">
            BUZZER FREIGEBEN / ZURÜCKSETZEN
          </button>
        </div>
      </section>
    `;

    document.getElementById('client-buzz-a')?.addEventListener('click', () => gameStore.buzzIn('A'));
    document.getElementById('client-buzz-b')?.addEventListener('click', () => gameStore.buzzIn('B'));
    document.getElementById('client-buzz-reset')?.addEventListener('click', () => gameStore.resetBuzzer());
  }

  // ==========================================================================
  // 4. QUESTION & GAME SET EDITOR (CMS — FR-1.1, FR-1.2, FR-1.3)
  // ==========================================================================
  renderEditorView() {
    const sets = gameStore.gameSets;
    if (this.editingSetIndex >= sets.length) this.editingSetIndex = 0;
    const currentSet = sets[this.editingSetIndex];

    this.root.innerHTML = `
      <section class="cms-workspace" aria-label="Fragen- und Spielset-Editor">
        <!-- Left Sidebar: Game Sets List & JSON Import/Export -->
        <div class="console-panel">
          <div class="panel-header">
            <h2 class="panel-title">SPIEL-SETS (CMS)</h2>
            <span class="panel-badge mono-num">${sets.length} SETS</span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 0.45rem;">
            ${sets.map((s, idx) => `
              <button type="button" class="btn ${idx === this.editingSetIndex ? 'btn-gold' : ''}"
                style="justify-content: space-between;" data-cms-select-set="${idx}">
                <span>${this.escapeHtml(s.title)}</span>
                <span class="mono-num">${s.rounds.length}R</span>
              </button>
            `).join('')}
          </div>

          <button type="button" class="btn" id="cms-btn-new-set">
            + NEUES SPIEL-SET ANLEGEN
          </button>

          <div style="border-top: 2px solid var(--border-steel); padding-top: 0.85rem; display: flex; flex-direction: column; gap: 0.5rem;">
            <div style="font-size: 0.85rem; color: var(--accent-gold); text-transform: uppercase;">
              JSON IMPORT & EXPORT (FR-1.2)
            </div>
            <button type="button" class="btn btn-gold" id="cms-btn-export-json">
              ⬇ AKTUELLES SET EXPORTIEREN (.JSON)
            </button>
            <label class="btn" style="cursor: pointer;">
              ⬆ JSON-DATEI IMPORTIEREN
              <input type="file" id="cms-file-import" accept=".json,application/json" style="display: none;" />
            </label>
          </div>
        </div>

        <!-- Right Editor Area: Active Set Rounds & Point Sum Validation -->
        <div class="console-panel">
          <div class="panel-header">
            <h2 class="panel-title">SET BEARBEITEN: ${this.escapeHtml(currentSet.title)}</h2>
            <button type="button" class="btn btn-sm btn-gold" id="cms-btn-activate-set">
              IM SPIEL AKTIVIEREN
            </button>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 160px; gap: 0.75rem;">
            <div>
              <label style="font-size: 0.8rem; color: var(--text-Secondary);">SET-TITEL (DEUTSCH):</label>
              <input type="text" class="input-field" id="cms-set-title" value="${this.escapeHtml(currentSet.title)}" style="width: 100%;" />
            </div>
            <div>
              <label style="font-size: 0.8rem; color: var(--text-Secondary);">SET-ID:</label>
              <input type="text" class="input-field mono-num" value="${this.escapeHtml(currentSet.id)}" disabled style="width: 100%; opacity: 0.7;" />
            </div>
          </div>

          <!-- Regular Rounds Editor (4 to 8 Answers + 100-Point Sum Check) -->
          <div style="display: flex; flex-direction: column; gap: 1rem; margin-top: 0.5rem;">
            ${currentSet.rounds.map((r, rIdx) => {
              const pointSum = r.answers.reduce((acc, a) => acc + (Number(a.points) || 0), 0);
              const isValidSum = pointSum === 100;
              const ansCount = r.answers.length;
              return `
                <div class="cms-round-card">
                  <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
                    <strong style="font-size: 1.15rem; color: var(--accent-gold);">
                      RUNDE ${rIdx + 1} (${ansCount} ANTWORTEN — ERLAUBT: 4 BIS 8)
                    </strong>
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                      <span class="validation-badge ${isValidSum ? '' : 'is-warning'}">
                        ${isValidSum ? '✓ SUMME = 100 PUNKTE (GÜLTIG)' : `⚠ WARNUNG: PUNKTESUMME = ${pointSum} (SOLL: 100)`}
                      </span>
                      <select class="select-field" data-cms-round-mult="${rIdx}">
                        <option value="1" ${r.multiplier === 1 ? 'selected' : ''}>Multiplikator ×1</option>
                        <option value="2" ${r.multiplier === 2 ? 'selected' : ''}>Multiplikator ×2</option>
                        <option value="3" ${r.multiplier === 3 ? 'selected' : ''}>Multiplikator ×3</option>
                      </select>
                    </div>
                  </div>

                  <input type="text" class="input-field" data-cms-round-q="${rIdx}"
                    value="${this.escapeHtml(r.question)}" placeholder="Fragetext auf Deutsch eingeben..." />

                  <div style="display: flex; flex-direction: column; gap: 0.4rem;">
                    ${r.answers.map((ans, aIdx) => `
                      <div class="cms-answer-grid">
                        <span class="mono-num" style="text-align: center; color: var(--accent-gold);">#${aIdx + 1}</span>
                        <input type="text" class="input-field" data-cms-ans-text="${rIdx}-${aIdx}"
                          value="${this.escapeHtml(ans.text)}" placeholder="Antworttext" />
                        <input type="number" class="input-field mono-num" data-cms-ans-pts="${rIdx}-${aIdx}"
                          value="${ans.points}" min="0" max="100" />
                        <button type="button" class="btn btn-sm btn-strike"
                          data-cms-remove-ans="${rIdx}-${aIdx}"
                          ${r.answers.length <= 4 ? 'disabled title="Mindestens 4 Antworten erforderlich"' : ''}>
                          ✕
                        </button>
                      </div>
                    `).join('')}
                  </div>

                  <div>
                    <button type="button" class="btn btn-sm"
                      data-cms-add-ans="${rIdx}"
                      ${r.answers.length >= 8 ? 'disabled title="Maximal 8 Antworten pro Frage"' : ''}>
                      + ANTWORT HINZUFÜGEN (${r.answers.length}/8)
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>

          <!-- Final Questions Editor -->
          <div class="cms-round-card" style="margin-top: 0.5rem;">
            <strong style="font-size: 1.15rem; color: var(--accent-gold);">
              FINALE („FAST MONEY“) — 5 SCHNELLFRAGEN
            </strong>
            ${(currentSet.finalQuestions || []).map((fq, fqIdx) => `
              <div style="display: grid; grid-template-columns: 44px 1fr; gap: 0.5rem; align-items: center;">
                <span class="mono-num" style="color: var(--accent-gold);">F${fqIdx + 1}</span>
                <input type="text" class="input-field" data-cms-final-q="${fqIdx}"
                  value="${this.escapeHtml(fq.question)}" />
              </div>
            `).join('')}
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 0.75rem;">
            <button type="button" class="btn btn-gold" id="cms-btn-save-all">
              💾 ÄNDERUNGEN SPEICHERN
            </button>
          </div>
        </div>
      </section>
    `;

    this.bindEditorEvents();
  }

  bindEditorEvents() {
    const sets = gameStore.gameSets;
    const currentSet = sets[this.editingSetIndex];

    document.querySelectorAll('[data-cms-select-set]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.editingSetIndex = Number(btn.getAttribute('data-cms-select-set'));
        this.renderEditorView();
      });
    });

    const syncFromDOM = () => {
      const titleInput = document.getElementById('cms-set-title');
      if (titleInput && titleInput.value.trim()) {
        currentSet.title = titleInput.value.trim();
      }
      document.querySelectorAll('[data-cms-round-q]').forEach(inp => {
        const rIdx = Number(inp.getAttribute('data-cms-round-q'));
        if (currentSet.rounds[rIdx]) currentSet.rounds[rIdx].question = inp.value;
      });
      document.querySelectorAll('[data-cms-round-mult]').forEach(sel => {
        const rIdx = Number(sel.getAttribute('data-cms-round-mult'));
        if (currentSet.rounds[rIdx]) currentSet.rounds[rIdx].multiplier = Number(sel.value) || 1;
      });
      document.querySelectorAll('[data-cms-ans-text]').forEach(inp => {
        const [rIdx, aIdx] = inp.getAttribute('data-cms-ans-text').split('-').map(Number);
        if (currentSet.rounds[rIdx]?.answers[aIdx]) {
          currentSet.rounds[rIdx].answers[aIdx].text = inp.value;
        }
      });
      document.querySelectorAll('[data-cms-ans-pts]').forEach(inp => {
        const [rIdx, aIdx] = inp.getAttribute('data-cms-ans-pts').split('-').map(Number);
        if (currentSet.rounds[rIdx]?.answers[aIdx]) {
          currentSet.rounds[rIdx].answers[aIdx].points = Number(inp.value) || 0;
        }
      });
      document.querySelectorAll('[data-cms-final-q]').forEach(inp => {
        const fqIdx = Number(inp.getAttribute('data-cms-final-q'));
        if (currentSet.finalQuestions[fqIdx]) {
          currentSet.finalQuestions[fqIdx].question = inp.value;
        }
      });
      gameStore.saveGameSets(sets);
    };

    document.getElementById('cms-btn-save-all')?.addEventListener('click', () => {
      syncFromDOM();
      this.renderEditorView();
    });

    document.querySelectorAll('[data-cms-ans-pts]').forEach(inp => {
      inp.addEventListener('change', () => {
        syncFromDOM();
        this.renderEditorView();
      });
    });

    document.querySelectorAll('[data-cms-add-ans]').forEach(btn => {
      btn.addEventListener('click', () => {
        syncFromDOM();
        const rIdx = Number(btn.getAttribute('data-cms-add-ans'));
        const round = currentSet.rounds[rIdx];
        if (round && round.answers.length < 8) {
          round.answers.push({
            id: round.answers.length + 1,
            text: `Neue Antwort ${round.answers.length + 1}`,
            points: 0
          });
          gameStore.saveGameSets(sets);
          this.renderEditorView();
        }
      });
    });

    document.querySelectorAll('[data-cms-remove-ans]').forEach(btn => {
      btn.addEventListener('click', () => {
        syncFromDOM();
        const [rIdx, aIdx] = btn.getAttribute('data-cms-remove-ans').split('-').map(Number);
        const round = currentSet.rounds[rIdx];
        if (round && round.answers.length > 4) {
          round.answers.splice(aIdx, 1);
          round.answers.forEach((a, idx) => { a.id = idx + 1; });
          gameStore.saveGameSets(sets);
          this.renderEditorView();
        }
      });
    });

    document.getElementById('cms-btn-new-set')?.addEventListener('click', () => {
      syncFromDOM();
      const newId = `set_custom_${Date.now().toString().slice(-4)}`;
      sets.push({
        id: newId,
        title: `Eigenes Spiel-Set ${sets.length + 1}`,
        language: 'de',
        rounds: [1, 2, 3, 4].map(num => ({
          roundNumber: num,
          multiplier: num === 3 ? 2 : num === 4 ? 3 : 1,
          question: `Beispiel-Frage für Runde ${num}?`,
          answers: [
            { id: 1, text: 'Top Antwort 1', points: 40 },
            { id: 2, text: 'Antwort 2', points: 30 },
            { id: 3, text: 'Antwort 3', points: 20 },
            { id: 4, text: 'Antwort 4', points: 10 }
          ]
        })),
        finalQuestions: [
          { id: 'f1', question: 'Finalfrage 1: Nennen Sie...' },
          { id: 'f2', question: 'Finalfrage 2: Nennen Sie...' },
          { id: 'f3', question: 'Finalfrage 3: Nennen Sie...' },
          { id: 'f4', question: 'Finalfrage 4: Nennen Sie...' },
          { id: 'f5', question: 'Finalfrage 5: Nennen Sie...' }
        ]
      });
      this.editingSetIndex = sets.length - 1;
      gameStore.saveGameSets(sets);
      this.renderEditorView();
    });

    document.getElementById('cms-btn-activate-set')?.addEventListener('click', () => {
      syncFromDOM();
      gameStore.selectGameSet(currentSet.id);
      this.switchView('host');
    });

    // Export JSON (FR-1.2)
    document.getElementById('cms-btn-export-json')?.addEventListener('click', () => {
      syncFromDOM();
      const blob = new Blob([JSON.stringify(currentSet, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentSet.id || 'game_set'}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    // Import JSON (FR-1.2)
    const fileInp = document.getElementById('cms-file-import');
    if (fileInp) {
      fileInp.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const parsed = JSON.parse(String(reader.result));
            if (parsed && parsed.title && Array.isArray(parsed.rounds)) {
              parsed.id = parsed.id || `set_import_${Date.now().toString().slice(-4)}`;
              const existingIdx = sets.findIndex(s => s.id === parsed.id);
              if (existingIdx >= 0) {
                sets[existingIdx] = parsed;
                this.editingSetIndex = existingIdx;
              } else {
                sets.push(parsed);
                this.editingSetIndex = sets.length - 1;
              }
              gameStore.saveGameSets(sets);
              this.renderEditorView();
            }
          } catch (err) {
            alert('Ungültiges JSON-Format für Spiel-Set.');
          }
        };
        reader.readAsText(file);
      });
    }
  }

  escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.gameShowApp = new GameShowApp();
});
