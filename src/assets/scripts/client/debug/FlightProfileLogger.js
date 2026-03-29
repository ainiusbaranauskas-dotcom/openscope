/**
 * Flight Profile Logger — debug utility for tracking aircraft descent/speed profiles
 *
 * Attaches to the game loop and periodically samples arrival aircraft state,
 * logging significant changes (altitude bands, speed changes, phase transitions).
 *
 * Usage from browser console:
 *   window.flightLogger.start()          — begin logging all arrivals
 *   window.flightLogger.start('DLH15K')  — log only this callsign
 *   window.flightLogger.stop()           — stop logging
 *   window.flightLogger.dump()           — print full history as table
 *   window.flightLogger.dump('DLH15K')   — print history for one aircraft
 *   window.flightLogger.export()         — export as JSON (copy-pasteable)
 *
 * @class FlightProfileLogger
 */
import { nm } from '../utilities/unitConverters';

const SAMPLE_INTERVAL_MS = 3000; // sample every 3 seconds of real time
const ALT_CHANGE_THRESHOLD = 500; // log when altitude changes by this much
const SPEED_CHANGE_THRESHOLD = 10; // log when speed changes by this much

export default class FlightProfileLogger {
    constructor() {
        this._history = {}; // { callsign: [samples] }
        this._lastSample = {}; // { callsign: {alt, spd, phase} }
        this._intervalId = null;
        this._filterCallsign = null;
        this._enabled = false;
    }

    /**
     * Start logging. Optionally filter to a single callsign.
     * @param {string} [callsign] - if provided, only log this aircraft
     */
    start(callsign = null) {
        if (this._enabled) {
            console.log('[FlightLogger] Already running. Call stop() first.');
            return;
        }

        this._filterCallsign = callsign;
        this._enabled = true;
        this._intervalId = setInterval(() => this._sample(), SAMPLE_INTERVAL_MS);

        const target = callsign ? `tracking ${callsign}` : 'tracking all arrivals';
        console.log(`[FlightLogger] Started — ${target}, sampling every ${SAMPLE_INTERVAL_MS / 1000}s`);
    }

    /**
     * Stop logging.
     */
    stop() {
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }

        this._enabled = false;
        const totalSamples = Object.values(this._history).reduce((sum, arr) => sum + arr.length, 0);
        console.log(`[FlightLogger] Stopped — ${totalSamples} samples across ${Object.keys(this._history).length} aircraft`);
    }

    /**
     * Print history as a formatted console table.
     * @param {string} [callsign] - if provided, only show this aircraft
     */
    dump(callsign = null) {
        const entries = callsign ? { [callsign]: this._history[callsign] } : this._history;

        for (const [cs, samples] of Object.entries(entries)) {
            if (!samples || samples.length === 0) continue;

            console.log(`\n=== ${cs} (${samples[0].type}) ===`);
            console.log(
                'Time      | Phase    | Alt(ft) | IAS(kt) | GS(kt) | TgtAlt | TgtSpd | MCP Alt | MCP Spd | Dist(nm) | NextFix  | Trend | Event'
            );
            console.log('-'.repeat(130));

            for (const s of samples) {
                const line = [
                    s.gameTime.padEnd(9),
                    s.phase.padEnd(8),
                    String(s.altitude).padStart(7),
                    String(s.ias).padStart(7),
                    String(s.groundSpeed).padStart(6),
                    String(s.targetAlt).padStart(6),
                    String(s.targetSpd).padStart(6),
                    String(s.mcpAlt).padStart(7),
                    String(s.mcpSpd).padStart(7),
                    s.distNm.padStart(8),
                    (s.nextFix || '-').padEnd(8),
                    s.trend.padStart(5),
                    s.event || ''
                ].join(' | ');

                console.log(line);
            }
        }
    }

    /**
     * Export all history as a JSON string (for copy-paste analysis).
     * @returns {string}
     */
    export() {
        const json = JSON.stringify(this._history, null, 2);
        console.log(json);
        return json;
    }

    /**
     * Clear all history.
     */
    clear() {
        this._history = {};
        this._lastSample = {};
        console.log('[FlightLogger] History cleared');
    }

    /**
     * Sample all arrival aircraft and log significant changes.
     * @private
     */
    _sample() {
        if (!window.aircraftController) return;

        const list = window.aircraftController.aircraft.list;
        if (!list) return;

        for (const aircraft of list) {
            if (!aircraft.isArrival || !aircraft.isArrival()) continue;
            if (this._filterCallsign && aircraft.callsign !== this._filterCallsign) continue;

            this._sampleAircraft(aircraft);
        }
    }

    /**
     * Sample a single aircraft and determine if a log entry should be created.
     * @param {AircraftModel} aircraft
     * @private
     */
    _sampleAircraft(aircraft) {
        const cs = aircraft.callsign;
        const alt = Math.round(aircraft.altitude);
        const ias = Math.round(aircraft.speed);
        const gs = Math.round(aircraft.groundSpeed);
        const phase = aircraft.flightPhase;
        const targetAlt = aircraft.target ? Math.round(aircraft.target.altitude) : 0;
        const targetSpd = aircraft.target ? Math.round(aircraft.target.speed) : 0;
        const distNm = nm(aircraft.distance).toFixed(1);
        const mcpAlt = aircraft.mcp ? aircraft.mcp.altitude : 0;
        const mcpSpd = aircraft.mcp ? aircraft.mcp.speed : 0;
        const nextFix = aircraft.fms.waypoints.length > 0 ? aircraft.fms.waypoints[0].name : '-';
        const trend = aircraft.trend > 0 ? 'CLB' : aircraft.trend < 0 ? 'DES' : 'LVL';

        const last = this._lastSample[cs];
        let event = '';

        // Determine if this sample is worth logging
        let shouldLog = false;

        if (!last) {
            // First sample for this aircraft
            shouldLog = true;
            event = 'FIRST_CONTACT';
        } else {
            // Phase change
            if (last.phase !== phase) {
                shouldLog = true;
                event = `PHASE:${last.phase}->${phase}`;
            }

            // Significant altitude change
            if (Math.abs(last.alt - alt) >= ALT_CHANGE_THRESHOLD) {
                shouldLog = true;
                if (!event) event = `ALT:${last.alt}->${alt}`;
            }

            // Crossed FL100 boundary
            if ((last.alt >= 10000 && alt < 10000) || (last.alt < 10000 && alt >= 10000)) {
                shouldLog = true;
                event = 'CROSSED_FL100';
            }

            // Crossed 6000ft boundary
            if ((last.alt >= 6000 && alt < 6000) || (last.alt < 6000 && alt >= 6000)) {
                shouldLog = true;
                event = 'CROSSED_6000';
            }

            // Crossed 4000ft boundary
            if ((last.alt >= 4000 && alt < 4000) || (last.alt < 4000 && alt >= 4000)) {
                shouldLog = true;
                event = 'CROSSED_4000';
            }

            // Significant speed change
            if (Math.abs(last.ias - ias) >= SPEED_CHANGE_THRESHOLD) {
                shouldLog = true;
                if (!event) event = `SPD:${last.ias}->${ias}`;
            }

            // Trend change (started/stopped climbing/descending)
            if (last.trend !== trend) {
                shouldLog = true;
                if (!event) event = `TREND:${last.trend}->${trend}`;
            }

            // Next fix changed (passed a waypoint)
            if (last.nextFix !== nextFix) {
                shouldLog = true;
                event = `PASSED:${last.nextFix}`;
            }

            // Target altitude changed (controller issued new clearance)
            if (last.targetAlt !== targetAlt && Math.abs(last.targetAlt - targetAlt) >= 100) {
                shouldLog = true;
                if (!event) event = `TGT_ALT:${last.targetAlt}->${targetAlt}`;
            }

            // Target speed changed
            if (last.targetSpd !== targetSpd && Math.abs(last.targetSpd - targetSpd) >= 5) {
                shouldLog = true;
                if (!event) event = `TGT_SPD:${last.targetSpd}->${targetSpd}`;
            }
        }

        // Update last sample regardless of whether we log
        this._lastSample[cs] = { alt, ias, gs, phase, trend, nextFix, targetAlt, targetSpd };

        if (!shouldLog) return;

        // Build the game time string (from TimeKeeper if available)
        let gameTime = '?';
        try {
            const elapsed = window.timeKeeper
                ? window.timeKeeper.accumulatedDeltaTime
                : 0;
            const mins = Math.floor(elapsed / 60);
            const secs = Math.floor(elapsed % 60);
            gameTime = `${String(mins).padStart(3, '0')}:${String(secs).padStart(2, '0')}`;
        } catch (e) {
            // ignore
        }

        const sample = {
            gameTime,
            phase,
            altitude: alt,
            ias,
            groundSpeed: gs,
            targetAlt,
            targetSpd,
            mcpAlt,
            mcpSpd,
            distNm,
            nextFix,
            trend,
            event,
            type: aircraft.model.icao
        };

        if (!this._history[cs]) {
            this._history[cs] = [];
        }

        this._history[cs].push(sample);

        // Also print to console in real-time
        const tag = `[${cs}]`;
        const msg = `${tag} FL${String(Math.round(alt / 100)).padStart(3, '0')} ` +
            `IAS:${ias}kt GS:${gs}kt ` +
            `tgt:FL${String(Math.round(targetAlt / 100)).padStart(3, '0')}/${targetSpd}kt ` +
            `${distNm}nm ${trend} fix:${nextFix} — ${event}`;

        console.log(`%c${msg}`, event.startsWith('CROSSED') ? 'color: orange' : 'color: #8f8');
    }
}
