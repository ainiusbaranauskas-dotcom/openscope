import _sample from 'lodash/sample';
import AirportController from '../airport/AirportController';
import TimeKeeper from '../engine/TimeKeeper';
import GameController from '../game/GameController';
import { FLIGHT_PHASE, FLIGHT_CATEGORY } from '../constants/aircraftConstants';

// Default spawn rates (per hour)
const DEFAULT_DEPARTURE_RATE = 4;
const DEFAULT_ARRIVAL_RATE = 4;

// Default airlines with weights
const DEFAULT_AIRLINES = [
    ['bti', 5],
    ['ryr', 3],
    ['wzz', 2]
];

/**
 * Tower mode traffic generation controller.
 *
 * Spawns departures at gates and arrivals on short final.
 * Completely independent from the approach mode SpawnScheduler.
 *
 * @class TowerSpawnController
 */
export default class TowerSpawnController {
    /**
     * @constructor
     * @param aircraftController {AircraftController}
     */
    constructor(aircraftController) {
        this._aircraftController = aircraftController;
        this._isRunning = false;
        this._timeSinceLastDeparture = 0;
        this._timeSinceLastArrival = 0;
        this._departureInterval = 0;
        this._arrivalInterval = 0;
        this._airlines = DEFAULT_AIRLINES;
        this._maxGroundAircraft = 8;
        this._hasSpawnedInitial = false;

        this._init();
    }

    /**
     * @for TowerSpawnController
     * @method _init
     * @private
     */
    _init() {
        const airport = AirportController.current;

        if (!airport || !airport.groundData) {
            return;
        }

        const spawnPatterns = airport.groundData.spawnPatterns || {};
        const depConfig = spawnPatterns.departures || {};
        const arrConfig = spawnPatterns.arrivals || {};

        const depRate = depConfig.frequency || DEFAULT_DEPARTURE_RATE;
        const arrRate = arrConfig.frequency || DEFAULT_ARRIVAL_RATE;

        this._departureInterval = 3600 / depRate; // seconds between spawns
        this._arrivalInterval = 3600 / arrRate;

        if (depConfig.airlines) {
            this._airlines = depConfig.airlines;
        }

        // Stagger initial spawns
        this._timeSinceLastDeparture = this._departureInterval * 0.7;
        this._timeSinceLastArrival = this._arrivalInterval * 0.3;
    }

    /**
     * Start the spawn controller
     *
     * @for TowerSpawnController
     * @method start
     */
    start() {
        if (this._isRunning) {
            return;
        }

        this._isRunning = true;

        if (!this._hasSpawnedInitial) {
            this._spawnInitialDepartures();
            this._hasSpawnedInitial = true;
        }
    }

    /**
     * Stop the spawn controller
     *
     * @for TowerSpawnController
     * @method stop
     */
    stop() {
        this._isRunning = false;
        this._hasSpawnedInitial = false;
    }

    /**
     * @for TowerSpawnController
     * @method reset
     */
    reset() {
        this._timeSinceLastDeparture = 0;
        this._timeSinceLastArrival = 0;
    }

    /**
     * Per-frame update — check if it's time to spawn new aircraft
     *
     * @for TowerSpawnController
     * @method update
     */
    update() {
        if (!this._isRunning) {
            return;
        }

        const dt = TimeKeeper.getDeltaTimeForGameStateAndTimewarp();

        if (dt <= 0) {
            return;
        }

        this._timeSinceLastDeparture += dt;
        this._timeSinceLastArrival += dt;

        // Count current ground aircraft
        const groundCount = this._countGroundAircraft();

        if (groundCount >= this._maxGroundAircraft) {
            return;
        }

        if (this._timeSinceLastDeparture >= this._departureInterval) {
            this._spawnDeparture();
            this._timeSinceLastDeparture = 0;
        }

        if (this._timeSinceLastArrival >= this._arrivalInterval) {
            this._spawnArrival();
            this._timeSinceLastArrival = 0;
        }
    }

    /**
     * Spawn initial departures at gates on mode activation
     *
     * @for TowerSpawnController
     * @method _spawnInitialDepartures
     * @private
     */
    _spawnInitialDepartures() {
        const count = Math.min(3, this._getAvailableGateCount());

        for (let i = 0; i < count; i++) {
            this._spawnDeparture();
        }
    }

    /**
     * Spawn a departure at an available gate
     *
     * @for TowerSpawnController
     * @method _spawnDeparture
     * @private
     */
    _spawnDeparture() {
        const airport = AirportController.current;

        if (!airport || !airport.gateCollection) {
            return;
        }

        const gate = this._getRandomConnectedGate(airport);

        if (!gate) {
            return;
        }

        const airlineIcao = this._pickRandomAirline();
        const aircraftModel = this._aircraftController.createTowerDeparture(gate, airlineIcao);

        if (!aircraftModel) {
            return;
        }

        gate.assignAircraft(aircraftModel);

        console.log(`[Tower] Departure: ${aircraftModel.callsign} at stand ${gate.name}`);
    }

    /**
     * Spawn an arrival on short final
     *
     * @for TowerSpawnController
     * @method _spawnArrival
     * @private
     */
    _spawnArrival() {
        const airline = this._pickRandomAirline();
        const callsign = `${airline}${Math.floor(Math.random() * 9000) + 1000}`;

        console.log(`[Tower] Arrival spawned: ${callsign} on short final`);
    }

    /**
     * Pick a random airline based on weights
     *
     * @for TowerSpawnController
     * @method _pickRandomAirline
     * @return {string}
     * @private
     */
    _pickRandomAirline() {
        const totalWeight = this._airlines.reduce((sum, [, weight]) => sum + weight, 0);
        let random = Math.random() * totalWeight;

        for (const [code, weight] of this._airlines) {
            random -= weight;

            if (random <= 0) {
                return code;
            }
        }

        return this._airlines[0][0];
    }

    /**
     * Count aircraft currently in ground phases
     *
     * @for TowerSpawnController
     * @method _countGroundAircraft
     * @return {number}
     * @private
     */
    _countGroundAircraft() {
        const aircraftList = this._aircraftController.aircraft.list;
        let count = 0;

        for (let i = 0; i < aircraftList.length; i++) {
            const phase = aircraftList[i].flightPhase;

            if (phase === FLIGHT_PHASE.APRON ||
                phase === FLIGHT_PHASE.PUSHBACK ||
                phase === FLIGHT_PHASE.TAXI ||
                phase === FLIGHT_PHASE.TAXI_OUT ||
                phase === FLIGHT_PHASE.TAXI_IN ||
                phase === FLIGHT_PHASE.HOLD_SHORT ||
                phase === FLIGHT_PHASE.WAITING) {
                count++;
            }
        }

        return count;
    }

    /**
     * Get number of available gates
     *
     * @for TowerSpawnController
     * @method _getAvailableGateCount
     * @return {number}
     * @private
     */
    /**
     * Get a random available gate that is connected to the taxiway graph
     *
     * @for TowerSpawnController
     * @method _getRandomConnectedGate
     * @param airport {AirportModel}
     * @return {GateModel|null}
     * @private
     */
    _getRandomConnectedGate(airport) {
        const available = airport.gateCollection.getAvailableGates();
        const graph = airport.taxiwayGraph;

        if (!graph || available.length === 0) {
            return null;
        }

        // Filter to only gates whose stand node has edges in the graph
        const connected = available.filter((gate) => {
            const node = graph.getNode(`STAND_${gate.name}`);

            return node && node.edges && node.edges.length > 0;
        });

        if (connected.length === 0) {
            return null;
        }

        return connected[Math.floor(Math.random() * connected.length)];
    }

    _getAvailableGateCount() {
        const airport = AirportController.current;

        if (!airport || !airport.gateCollection) {
            return 0;
        }

        return airport.gateCollection.getAvailableGates().length;
    }
}
