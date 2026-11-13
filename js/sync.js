// Multi-Screen & Multi-Device Synchronization Engine
// Mode A: BroadcastChannel API + LocalStorage Events (Same-Device Multi-Monitor)
// Mode B: Networked Server-Sent Events (/api/events) + REST Push (/api/state) (Local LAN Server)
// Mode C: WebRTC Peer-to-Peer DataChannels via PeerJS (Cloudflare Pages / Cross-Device Room Code)

const CHANNEL_PREFIX = 'fuenf_gegen_fuenf_sync_';
const STORAGE_KEY_PREFIX = 'fuenf_gegen_fuenf_state_';
const ROOM_STORAGE_KEY = 'fuenf_gegen_fuenf_room_code_v1';
const PEER_ID_PREFIX = 'fg5-room-v1-';

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function normalizeRoomCode(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

export class SyncEngine {
  constructor(onRemoteUpdate, getLatestState) {
    this.instanceId = `client_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
    this.onRemoteUpdate = onRemoteUpdate;
    this.getLatestState = getLatestState;

    this.roomCode = this.resolveInitialRoomCode();
    this.channel = null;
    this.sse = null;
    this.networkConnected = false;

    // WebRTC P2P state
    this.peer = null;
    this.isP2PHub = false;
    this.p2pStatus = 'INITIALISIERUNG...';
    this.p2pConnections = new Map(); // peerId -> DataConnection (when hub)
    this.hostConnection = null;      // DataConnection to hub (when client spoke)
    this.reconnectTimer = null;

    this.lastSeq = 0;
    this.localSeq = 0;
    this.seenPerSender = new Map();
    this.hubRetryCount = 0;
    this.latestEnvelope = null;

    if (typeof window !== 'undefined') {
      const cleanup = () => this.teardownWebRTC();
      window.addEventListener('pagehide', cleanup);
      window.addEventListener('beforeunload', cleanup);
    }

    this.initLocalSync();
    this.initNetworkSync();
    this.initWebRTCSync();
  }

  resolveInitialRoomCode() {
    if (typeof URLSearchParams !== 'undefined' && window.location) {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = normalizeRoomCode(params.get('room'));
      if (fromUrl.length >= 3) {
        try { localStorage.setItem(ROOM_STORAGE_KEY, fromUrl); } catch (e) {}
        return fromUrl;
      }
    }
    try {
      const saved = normalizeRoomCode(localStorage.getItem(ROOM_STORAGE_KEY));
      if (saved.length >= 3) {
        this.syncRoomToUrl(saved);
        return saved;
      }
    } catch (e) {}

    const generated = generateRoomCode();
    try { localStorage.setItem(ROOM_STORAGE_KEY, generated); } catch (e) {}
    this.syncRoomToUrl(generated);
    return generated;
  }

  syncRoomToUrl(code) {
    if (typeof URL !== 'undefined' && window.history && window.history.replaceState) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('room', code);
        window.history.replaceState({}, '', url);
      } catch (e) {}
    }
  }

  getStorageKey() {
    return `${STORAGE_KEY_PREFIX}${this.roomCode}`;
  }

  getChannelName() {
    return `${CHANNEL_PREFIX}${this.roomCode}`;
  }

  getHubPeerId() {
    return `${PEER_ID_PREFIX}${this.roomCode.toLowerCase()}`;
  }

  isPreferredHostView() {
    if (typeof URLSearchParams !== 'undefined' && window.location) {
      const params = new URLSearchParams(window.location.search);
      const v = (params.get('view') || 'host').toLowerCase();
      return v === 'host' || v === 'editor';
    }
    return true;
  }

  emitStatus() {
    const peerCount = this.isP2PHub
      ? this.p2pConnections.size
      : (this.hostConnection && this.hostConnection.open ? 1 : 0);

    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sync-status', {
        detail: {
          roomCode: this.roomCode,
          isP2PHub: this.isP2PHub,
          peerCount,
          p2pStatus: this.p2pStatus,
          networkConnected: this.networkConnected
        }
      }));
    }
  }

  joinRoom(newCode) {
    const cleaned = normalizeRoomCode(newCode);
    if (cleaned.length < 3) return false;
    if (cleaned === this.roomCode && this.peer && !this.peer.destroyed) {
      return true;
    }

    this.roomCode = cleaned;
    try { localStorage.setItem(ROOM_STORAGE_KEY, cleaned); } catch (e) {}
    this.syncRoomToUrl(cleaned);

    // Re-initialize channels for new room
    if (this.channel) {
      try { this.channel.close(); } catch (e) {}
      this.channel = null;
    }
    this.initLocalSync();
    this.teardownWebRTC();
    this.initWebRTCSync();
    this.emitStatus();
    return true;
  }

  regenerateRoomCode() {
    const nextCode = generateRoomCode();
    this.joinRoom(nextCode);
    return nextCode;
  }

  // ==========================================================================
  // MODE A: BroadcastChannel + LocalStorage
  // ==========================================================================
  initLocalSync() {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(this.getChannelName());
        this.channel.onmessage = (event) => {
          this.handleIncoming(event.data, 'BroadcastChannel');
        };
      } catch (e) {}
    }

    if (!this._storageBound && typeof window !== 'undefined') {
      this._storageBound = true;
      window.addEventListener('storage', (event) => {
        if (event.key === this.getStorageKey() && event.newValue) {
          try {
            const parsed = JSON.parse(event.newValue);
            this.handleIncoming(parsed, 'localStorage');
          } catch (e) {}
        }
      });
    }
  }

  // ==========================================================================
  // MODE B: Local Node Server SSE (/api/events)
  // ==========================================================================
  initNetworkSync() {
    if (typeof EventSource === 'undefined' || !window.location || window.location.protocol === 'file:') {
      return;
    }
    try {
      this.sse = new EventSource('/api/events');
      this.sse.onopen = () => {
        this.networkConnected = true;
        this.emitStatus();
      };
      this.sse.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          this.handleIncoming(parsed, 'NetworkSSE');
        } catch (e) {}
      };
      this.sse.onerror = () => {
        this.networkConnected = false;
        if (this.sse) {
          this.sse.close();
          this.sse = null;
        }
        this.emitStatus();
      };
    } catch (e) {
      this.networkConnected = false;
    }
  }

  // ==========================================================================
  // MODE C: WebRTC Peer-to-Peer via PeerJS (Hub & Spoke per Room Code)
  // ==========================================================================
  async loadPeerJSLibrary() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    if (typeof window.Peer !== 'undefined') return true;

    const urls = [
      'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
      'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'
    ];

    for (const src of urls) {
      const loaded = await new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve(typeof window.Peer !== 'undefined');
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
      });
      if (loaded) return true;
    }
    return false;
  }

  teardownWebRTC() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const conn of this.p2pConnections.values()) {
      try { conn.close(); } catch (e) {}
    }
    this.p2pConnections.clear();
    if (this.hostConnection) {
      try { this.hostConnection.close(); } catch (e) {}
      this.hostConnection = null;
    }
    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
      this.peer = null;
    }
    this.isP2PHub = false;
  }

  async initWebRTCSync() {
    const hasPeerJS = await this.loadPeerJSLibrary();
    if (!hasPeerJS || typeof window.Peer === 'undefined') {
      this.p2pStatus = 'OFFLINE (NUR LOKAL)';
      this.emitStatus();
      return;
    }

    if (this.isPreferredHostView()) {
      this.startAsP2PHub();
    } else {
      this.startAsP2PClient();
    }
  }

  getPeerConfig() {
    return {
      debug: 0,
      pingInterval: 5000,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun.cloudflare.com:3478' }
        ]
      }
    };
  }

  startAsP2PHub() {
    this.teardownWebRTC();
    const hubId = this.getHubPeerId();
    this.p2pStatus = 'VERBINDE RAUM-HOST...';
    this.emitStatus();

    try {
      const peer = new window.Peer(hubId, this.getPeerConfig());
      this.peer = peer;

      peer.on('open', () => {
        this.isP2PHub = true;
        this.hubRetryCount = 0;
        this.p2pStatus = `HOST BEREIT (${this.roomCode})`;
        this.emitStatus();
      });

      peer.on('connection', (conn) => {
        this.setupHubIncomingConnection(conn);
      });

      peer.on('disconnected', () => {
        if (this.peer && !this.peer.destroyed) {
          this.p2pStatus = `VERBINDE NEU (${this.roomCode})...`;
          this.emitStatus();
          try { this.peer.reconnect(); } catch (e) {}
        }
      });

      peer.on('error', (err) => {
        if (err && err.type === 'unavailable-id') {
          if (this.hubRetryCount < 3) {
            this.hubRetryCount++;
            this.p2pStatus = `RAUM-ID BELEGT, RETRY (${this.hubRetryCount}/3)...`;
            this.emitStatus();
            setTimeout(() => {
              if (this.isPreferredHostView()) {
                this.startAsP2PHub();
              }
            }, 1500);
          } else {
            // Another active Host tab already owns the Hub ID — connect as Client Spoke
            this.startAsP2PClient();
          }
        } else {
          this.p2pStatus = `P2P FEHLER: ${err?.type || 'UNBEKANNT'}`;
          this.emitStatus();
        }
      });
    } catch (e) {
      this.p2pStatus = 'LOKAL AKTIV';
      this.emitStatus();
    }
  }

  setupHubIncomingConnection(conn) {
    conn.on('open', () => {
      this.p2pConnections.set(conn.peer, conn);
      this.p2pStatus = `${this.p2pConnections.size} GERÄT(E) VERBUNDEN`;
      this.emitStatus();

      // Send current game state to the newly connected Buzzer/Display client immediately
      const currentState = typeof this.getLatestState === 'function' ? this.getLatestState() : null;
      if (currentState) {
        const welcomeEnvelope = this.latestEnvelope || {
          senderId: this.instanceId,
          seq: Date.now() * 1000,
          timestamp: Date.now(),
          roomCode: this.roomCode,
          state: currentState,
          effect: null
        };
        try { conn.send(welcomeEnvelope); } catch (e) {}
      }
    });

    conn.on('data', (data) => {
      if (!data) return;
      if (data.type === 'REQUEST_STATE') {
        const currentState = typeof this.getLatestState === 'function' ? this.getLatestState() : null;
        if (currentState) {
          try {
            conn.send({
              senderId: this.instanceId,
              seq: Date.now() * 1000,
              timestamp: Date.now(),
              roomCode: this.roomCode,
              state: currentState,
              effect: null
            });
          } catch (e) {}
        }
        return;
      }

      // Process state update from Buzzer/Client and relay to all other connected P2P clients!
      this.handleIncoming(data, 'WebRTC');
      for (const [peerId, otherConn] of this.p2pConnections.entries()) {
        if (peerId !== conn.peer && otherConn.open) {
          try { otherConn.send(data); } catch (e) {}
        }
      }
      if (this.channel) {
        try { this.channel.postMessage(data); } catch (e) {}
      }
    });

    const cleanup = () => {
      this.p2pConnections.delete(conn.peer);
      this.p2pStatus = this.p2pConnections.size > 0
        ? `${this.p2pConnections.size} GERÄT(E) VERBUNDEN`
        : `HOST BEREIT (${this.roomCode})`;
      this.emitStatus();
    };

    conn.on('close', cleanup);
    conn.on('error', cleanup);
  }

  startAsP2PClient() {
    this.teardownWebRTC();
    this.isP2PHub = false;
    this.p2pStatus = `SUCHE RAUM ${this.roomCode}...`;
    this.emitStatus();

    try {
      const peer = new window.Peer(undefined, this.getPeerConfig());
      this.peer = peer;

      peer.on('open', () => {
        this.connectClientToHub();
      });

      peer.on('disconnected', () => {
        if (this.peer && !this.peer.destroyed) {
          try { this.peer.reconnect(); } catch (e) {}
        }
      });

      peer.on('error', (err) => {
        this.p2pStatus = err?.type === 'peer-unavailable'
          ? `WARTE AUF HOST (${this.roomCode})`
          : `P2P FEHLER: ${err?.type || 'VERBINDUNG'}`;
        this.emitStatus();
        this.scheduleClientReconnect();
      });
    } catch (e) {
      this.p2pStatus = 'LOKAL AKTIV';
      this.emitStatus();
    }
  }

  connectClientToHub() {
    if (!this.peer || this.peer.destroyed) return;
    if (this.hostConnection) {
      if (this.hostConnection.open) return;
      try { this.hostConnection.close(); } catch (e) {}
      this.hostConnection = null;
    }

    const hubId = this.getHubPeerId();

    try {
      const conn = this.peer.connect(hubId, { serialization: 'json' });
      this.hostConnection = conn;

      conn.on('open', () => {
        this.p2pStatus = `VERBUNDEN MIT RAUM ${this.roomCode}`;
        this.emitStatus();
        try {
          conn.send({ type: 'REQUEST_STATE', senderId: this.instanceId });
        } catch (e) {}
      });

      conn.on('data', (data) => {
        this.handleIncoming(data, 'WebRTC');
      });

      const onDisconnect = () => {
        if (this.hostConnection === conn) {
          this.hostConnection = null;
        }
        this.p2pStatus = `VERBINDUNG GETRENNT (${this.roomCode})`;
        this.emitStatus();
        this.scheduleClientReconnect();
      };

      conn.on('close', onDisconnect);
      conn.on('error', onDisconnect);
    } catch (e) {
      this.scheduleClientReconnect();
    }
  }

  scheduleClientReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.isP2PHub && (!this.hostConnection || !this.hostConnection.open)) {
        if (!this.peer || this.peer.destroyed) {
          this.startAsP2PClient();
        } else {
          this.connectClientToHub();
        }
      }
    }, 3500);
  }

  // ==========================================================================
  // UNIFIED MESSAGE HANDLING & BROADCAST
  // ==========================================================================
  handleIncoming(envelope, source) {
    if (!envelope || !envelope.state) return;
    if (envelope.senderId === this.instanceId) return;

    // Deduplicate per sender using sender-local monotonic sequence (immune to device clock skew)
    if (envelope.senderId && typeof envelope.senderSeq === 'number') {
      const prev = this.seenPerSender.get(envelope.senderId) || 0;
      if (envelope.senderSeq <= prev) return;
      this.seenPerSender.set(envelope.senderId, envelope.senderSeq);
    } else if (envelope.seq && envelope.senderId === undefined) {
      if (envelope.seq <= this.lastSeq) return;
    }

    this.lastSeq = Math.max(this.lastSeq, envelope.seq || Date.now());
    this.latestEnvelope = envelope;

    // Persist locally as well
    try {
      localStorage.setItem(this.getStorageKey(), JSON.stringify(envelope));
    } catch (e) {}

    if (typeof this.onRemoteUpdate === 'function') {
      this.onRemoteUpdate(envelope.state, envelope.effect, source);
    }
  }

  broadcast(state, effect = null) {
    const seq = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    const senderSeq = ++this.localSeq;
    this.lastSeq = seq;
    const envelope = {
      senderId: this.instanceId,
      senderSeq,
      seq,
      timestamp: Date.now(),
      roomCode: this.roomCode,
      state,
      effect
    };
    this.latestEnvelope = envelope;

    // 1. Persist to localStorage (triggers 'storage' in other windows on same device)
    try {
      localStorage.setItem(this.getStorageKey(), JSON.stringify(envelope));
    } catch (e) {}

    // 2. Broadcast via BroadcastChannel (same device)
    if (this.channel) {
      try {
        this.channel.postMessage(envelope);
      } catch (e) {}
    }

    // 3. Broadcast via WebRTC P2P DataChannels (cross-device phones / tablets / TVs)
    if (this.isP2PHub) {
      for (const conn of this.p2pConnections.values()) {
        if (conn.open) {
          try { conn.send(envelope); } catch (e) {}
        }
      }
    } else if (this.hostConnection && this.hostConnection.open) {
      try { this.hostConnection.send(envelope); } catch (e) {}
    }

    // 4. Push to Local LAN Server (Mode B) if connected
    if (this.networkConnected && window.location && window.location.protocol.startsWith('http')) {
      fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope)
      }).catch(() => {});
    }
  }

  loadPersistedState() {
    try {
      const raw = localStorage.getItem(this.getStorageKey());
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.state) {
        this.lastSeq = parsed.seq || 0;
        this.latestEnvelope = parsed;
        return parsed.state;
      }
    } catch (e) {
      return null;
    }
    return null;
  }
}
