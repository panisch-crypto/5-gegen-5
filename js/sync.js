// Multi-Screen Synchronization Engine
// Mode A: BroadcastChannel API + LocalStorage Events (Zero Server Dependency)
// Mode B: Networked Server-Sent Events (/api/events) + REST Push (/api/state)

const CHANNEL_NAME = 'fuenf_gegen_fuenf_sync_v1';
const STORAGE_KEY = 'fuenf_gegen_fuenf_state_v1';

export class SyncEngine {
  constructor(onRemoteUpdate) {
    this.instanceId = `client_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
    this.onRemoteUpdate = onRemoteUpdate;
    this.channel = null;
    this.sse = null;
    this.networkConnected = false;
    this.lastSeq = 0;

    this.initLocalSync();
    this.initNetworkSync();
  }

  initLocalSync() {
    // 1. BroadcastChannel API for instant (<5ms) cross-tab/cross-window sync on same machine
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.channel.onmessage = (event) => {
          this.handleIncoming(event.data, 'BroadcastChannel');
        };
      } catch (e) {
        console.warn('BroadcastChannel init failed:', e);
      }
    }

    // 2. LocalStorage 'storage' event fallback & cross-window sync
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue);
          this.handleIncoming(parsed, 'localStorage');
        } catch (e) {
          // ignore malformed storage entry
        }
      }
    });
  }

  initNetworkSync() {
    if (typeof EventSource === 'undefined' || window.location.protocol === 'file:') {
      return;
    }
    try {
      this.sse = new EventSource('/api/events');
      this.sse.onopen = () => {
        this.networkConnected = true;
        window.dispatchEvent(new CustomEvent('sync-status', {
          detail: { mode: 'Mode A + B (BroadcastChannel + Netzwerk-Sync)', connected: true }
        }));
      };
      this.sse.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          this.handleIncoming(parsed, 'NetworkSSE');
        } catch (e) {
          // ignore
        }
      };
      this.sse.onerror = () => {
        this.networkConnected = false;
        if (this.sse) {
          this.sse.close();
          this.sse = null;
        }
        window.dispatchEvent(new CustomEvent('sync-status', {
          detail: { mode: 'Mode A (Lokal via BroadcastChannel)', connected: false }
        }));
      };
    } catch (e) {
      this.networkConnected = false;
    }
  }

  handleIncoming(envelope, source) {
    if (!envelope || !envelope.state) return;
    if (envelope.senderId === this.instanceId) return;
    if (envelope.seq && envelope.seq <= this.lastSeq) return;

    this.lastSeq = envelope.seq || Date.now();
    if (typeof this.onRemoteUpdate === 'function') {
      this.onRemoteUpdate(envelope.state, envelope.effect, source);
    }
  }

  broadcast(state, effect = null) {
    const seq = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    this.lastSeq = seq;
    const envelope = {
      senderId: this.instanceId,
      seq,
      timestamp: Date.now(),
      state,
      effect
    };

    // Persist to localStorage (triggers 'storage' in other windows & persists across reloads)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    } catch (e) {
      // ignore quota errors
    }

    // Broadcast via BroadcastChannel
    if (this.channel) {
      try {
        this.channel.postMessage(envelope);
      } catch (e) {
        // ignore
      }
    }

    // Push to Network Server (Mode B) if connected to local sync server
    if (this.networkConnected && window.location.protocol.startsWith('http')) {
      fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope)
      }).catch(() => {});
    }
  }

  loadPersistedState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.state) {
        this.lastSeq = parsed.seq || 0;
        return parsed.state;
      }
    } catch (e) {
      return null;
    }
    return null;
  }
}
