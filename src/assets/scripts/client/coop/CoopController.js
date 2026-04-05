import $ from 'jquery';
import EventBus from '../lib/EventBus';
import GameController from '../game/GameController';
import { COOP_EVENT } from '../constants/eventNames';

export const COOP_ROLE = {
    NONE: 'none',
    HOST: 'host',
    GUEST: 'guest'
};

const STATE_SYNC_INTERVAL_MS = 100;

export default class CoopController {
    constructor(aircraftController, inputController) {
        this._eventBus = EventBus;
        this._socket = null;
        this._role = COOP_ROLE.NONE;
        this._roomCode = null;
        this._aircraftController = aircraftController;
        this._inputController = inputController;
        this._syncIntervalId = null;
    }

    get isHost() {
        return this._role === COOP_ROLE.HOST;
    }

    get isGuest() {
        return this._role === COOP_ROLE.GUEST;
    }

    get isCoop() {
        return this._role !== COOP_ROLE.NONE;
    }

    get role() {
        return this._role;
    }

    get roomCode() {
        return this._roomCode;
    }

    createRoom(airportIcao) {
        console.log(`[Coop] createRoom called for airport: ${airportIcao}`);
        this._connectSocket();

        if (!this._socket) {
            console.error('[Coop] Failed to create socket, cannot create room');

            return;
        }

        this._socket.emit('create-room', { airportIcao });

        this._socket.on('room-created', (data) => {
            this._role = COOP_ROLE.HOST;
            this._roomCode = data.code;
            this._eventBus.trigger(COOP_EVENT.ROOM_CREATED, data);
        });

        this._socket.on('guest-joined', (data) => {
            this._sendExistingAircraft();
            this._startStateSync();
            this._eventBus.trigger(COOP_EVENT.GUEST_JOINED, data);
        });

        this._socket.on('remote-command', (data) => {
            this._onRemoteCommand(data);
        });

        this._socket.on('partner-disconnected', (data) => {
            this._stopStateSync();
            this._eventBus.trigger(COOP_EVENT.PARTNER_DISCONNECTED, data);
        });
    }

    joinRoom(code) {
        console.log(`[Coop] joinRoom called with code: ${code}`);
        this._connectSocket();

        if (!this._socket) {
            console.error('[Coop] Failed to create socket, cannot join room');

            return;
        }

        // Register ALL listeners BEFORE emitting join-room
        this._socket.on('room-joined', (data) => {
            console.log('[Coop] room-joined received:', data);
            this._role = COOP_ROLE.GUEST;
            this._roomCode = data.code;
            this._eventBus.trigger(COOP_EVENT.ROOM_JOINED, data);
        });

        this._socket.on('join-error', (data) => {
            console.error(`[Coop] Join error: ${data.message}`);
            this._eventBus.trigger('coop-join-error', data);
        });

        this._socket.on('state-sync', (data) => {
            this._onStateSync(data);
        });

        this._socket.on('aircraft-spawn', (data) => {
            console.log('[Coop] aircraft-spawn received:', data.callsign);
            this._eventBus.trigger(COOP_EVENT.AIRCRAFT_SPAWN, data);
        });

        this._socket.on('aircraft-remove', (data) => {
            console.log('[Coop] aircraft-remove received:', data.callsign);
            this._eventBus.trigger(COOP_EVENT.AIRCRAFT_REMOVE, data);
        });

        this._socket.on('command-result', (data) => {
            this._eventBus.trigger(COOP_EVENT.COMMAND_RESULT, data);
        });

        this._socket.on('game-event', (data) => {
            this._eventBus.trigger(COOP_EVENT.GAME_EVENT, data);
        });

        this._socket.on('partner-disconnected', (data) => {
            this._eventBus.trigger(COOP_EVENT.PARTNER_DISCONNECTED, data);
        });

        // Emit join-room AFTER all listeners are registered
        console.log(`[Coop] Emitting join-room for code: ${code}`);
        this._socket.emit('join-room', { code });
    }

    leaveRoom() {
        this._stopStateSync();

        if (this._socket) {
            this._socket.disconnect();
            this._socket = null;
        }

        this._role = COOP_ROLE.NONE;
        this._roomCode = null;
    }

    sendCommand(rawCommand) {
        if (!this._socket || !this.isGuest) {
            return;
        }

        this._socket.emit('command', { raw: rawCommand });
    }

    broadcastCommandResult(callsign, responseText, isWarning) {
        if (!this._socket || !this.isHost) {
            return;
        }

        this._socket.emit('command-result', { callsign, responseText, isWarning });
    }

    broadcastAircraftSpawn(spawnData) {
        if (!this._socket || !this.isHost) {
            return;
        }

        this._socket.emit('aircraft-spawn', spawnData);
    }

    broadcastAircraftRemove(callsign) {
        if (!this._socket || !this.isHost) {
            return;
        }

        this._socket.emit('aircraft-remove', { callsign });
    }

    broadcastGameEvent(type, data) {
        if (!this._socket || !this.isHost) {
            return;
        }

        this._socket.emit('game-event', { type, ...data });
    }

    _sendExistingAircraft() {
        if (!this._socket || !this.isHost || !this._aircraftController) {
            return;
        }

        const aircraftList = this._aircraftController.aircraft.list;

        for (let i = 0; i < aircraftList.length; i++) {
            const ac = aircraftList[i];

            const spawnData = {
                callsign: ac.flightNumber,
                airline: ac.airlineId,
                airlineCallsign: ac.airlineCallsign,
                fleet: ac.fleet,
                altitude: ac.altitude,
                speed: ac.speed,
                heading: ac.heading,
                transponderCode: ac.transponderCode,
                origin: ac.origin,
                destination: ac.destination,
                category: ac.category,
                icao: ac.model.icao,
                routeString: ac.fms ? ac.fms.getRouteString() : '',
                positionGps: ac.positionModel.gps
            };

            this._socket.emit('aircraft-spawn', spawnData);
        }
    }

    _connectSocket() {
        if (this._socket) {
            return;
        }

        if (typeof window.io !== 'function') {
            console.error('[Coop] socket.io client not loaded! window.io is', typeof window.io);

            return;
        }

        // socket.io client is loaded globally via script tag
        this._socket = window.io();

        this._socket.on('connect', () => {
            console.log('[Coop] Socket connected, id:', this._socket.id);
        });

        this._socket.on('connect_error', (err) => {
            console.error('[Coop] Socket connection error:', err.message);
        });

        this._socket.on('disconnect', (reason) => {
            console.warn('[Coop] Socket disconnected:', reason);
        });

        console.log('[Coop] Socket created, connecting...');
    }

    _startStateSync() {
        this._stopStateSync();

        this._syncCount = 0;

        console.log('[Coop] Starting state sync interval');

        this._syncIntervalId = setInterval(() => {
            this._syncCount++;

            if (this._syncCount % 50 === 0) {
                console.log(`[Coop] State sync tick ${this._syncCount}, role=${this._role}, socket=${!!this._socket}`);
            }

            try {
                this._broadcastStateSync();
            } catch (error) {
                console.error('[Coop] State sync error:', error.message, error.stack);
            }
        }, STATE_SYNC_INTERVAL_MS);
    }

    _stopStateSync() {
        if (this._syncIntervalId) {
            clearInterval(this._syncIntervalId);
            this._syncIntervalId = null;
        }
    }

    _broadcastStateSync() {
        if (!this._socket || !this.isHost) {
            return;
        }

        if (!this._aircraftController || !this._aircraftController.aircraft) {
            console.warn('[Coop] No aircraft controller or aircraft list');

            return;
        }

        const aircraftList = this._aircraftController.aircraft.list;
        const aircraftStates = [];

        for (let i = 0; i < aircraftList.length; i++) {
            try {
                const aircraft = aircraftList[i];

                aircraftStates.push({
                    callsign: aircraft.callsign,
                    posX: aircraft.positionModel.relativePosition[0],
                    posY: aircraft.positionModel.relativePosition[1],
                    heading: aircraft.heading,
                    altitude: aircraft.altitude,
                    speed: aircraft.speed,
                    groundSpeed: aircraft.groundSpeed,
                    groundTrack: aircraft.groundTrack,
                    isControllable: aircraft.isControllable,
                    mcpAltitude: aircraft.mcp ? aircraft.mcp.altitude : 0,
                    mcpHeading: aircraft.mcp ? aircraft.mcp.heading : 0,
                    mcpSpeed: aircraft.mcp ? aircraft.mcp.speed : 0,
                    transponderCode: aircraft.transponderCode,
                    trend: aircraft.trend,
                    flightPhase: aircraft.flightPhase
                });
            } catch (error) {
                console.warn(`[Coop] Failed to serialize aircraft: ${error.message}`);
            }
        }

        this._socket.emit('state-sync', {
            aircraftStates,
            score: GameController.game.score
        });
    }

    _onRemoteCommand(data) {
        if (!this.isHost || !this._inputController) {
            return;
        }

        this._inputController.processRemoteCommand(data.raw);
    }

    _onStateSync(data) {
        if (!this.isGuest || !this._aircraftController) {
            console.warn('[Coop] state-sync ignored: isGuest=', this.isGuest, 'hasAC=', !!this._aircraftController);

            return;
        }

        this._guestSyncCount = (this._guestSyncCount || 0) + 1;

        if (this._guestSyncCount <= 3 || this._guestSyncCount % 100 === 0) {
            console.log(`[Coop] state-sync #${this._guestSyncCount}, aircraft in payload: ${data.aircraftStates ? data.aircraftStates.length : 0}`);
        }

        this._aircraftController.applyRemoteState(data.aircraftStates);

        if (typeof data.score === 'number') {
            GameController.game.score = data.score;
        }
    }

    /**
     * Global diagnostic — call window.coopDebug() from browser console
     */
    debug() {
        const info = {
            role: this._role,
            roomCode: this._roomCode,
            socketConnected: this._socket ? this._socket.connected : false,
            socketId: this._socket ? this._socket.id : null,
            syncIntervalId: this._syncIntervalId,
            syncCount: this._syncCount || 0,
            guestSyncCount: this._guestSyncCount || 0,
            hasAircraftController: !!this._aircraftController,
            hasInputController: !!this._inputController,
            aircraftCount: this._aircraftController && this._aircraftController.aircraft
                ? this._aircraftController.aircraft.list.length : 0,
            bundleVersion: 'coop2'
        };

        console.log('[Coop Debug]', JSON.stringify(info, null, 2));

        return info;
    }
}

// Expose global debug function
if (typeof window !== 'undefined') {
    window.coopDebug = function() {
        if (window.aircraftController && window.aircraftController._coopController) {
            return window.aircraftController._coopController.debug();
        }

        console.error('[Coop Debug] No coop controller found. Check if aircraftController is on window.');

        return null;
    };
}
