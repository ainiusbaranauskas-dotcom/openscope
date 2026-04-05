import _find from 'lodash/find';
import _filter from 'lodash/filter';
import GateModel from './GateModel';

/**
 * Collection of all gates/parking stands at the airport.
 *
 * @class GateCollection
 */
export default class GateCollection {
    /**
     * @constructor
     * @param gateDataList {array<object>}
     * @param airportPositionModel {StaticPositionModel}
     * @param magneticNorth {number}
     */
    constructor(gateDataList, airportPositionModel, magneticNorth) {
        this._gates = [];

        this._init(gateDataList, airportPositionModel, magneticNorth);
    }

    /**
     * @for GateCollection
     * @property gates
     * @type {array<GateModel>}
     */
    get gates() {
        return this._gates;
    }

    /**
     * @for GateCollection
     * @property length
     * @type {number}
     */
    get length() {
        return this._gates.length;
    }

    /**
     * @for GateCollection
     * @method _init
     * @param gateDataList {array<object>}
     * @param airportPositionModel {StaticPositionModel}
     * @param magneticNorth {number}
     * @private
     */
    _init(gateDataList, airportPositionModel, magneticNorth) {
        if (!gateDataList) {
            return;
        }

        this._gates = gateDataList.map(
            (gateData) => new GateModel(gateData, airportPositionModel, magneticNorth)
        );
    }

    /**
     * Find a gate by name
     *
     * @for GateCollection
     * @method findGateByName
     * @param name {string}
     * @return {GateModel|undefined}
     */
    findGateByName(name) {
        return _find(this._gates, { name });
    }

    /**
     * Get all available (unoccupied) gates, optionally filtered by size class
     *
     * @for GateCollection
     * @method getAvailableGates
     * @param sizeClass {string|null} optional ICAO size class filter
     * @return {array<GateModel>}
     */
    getAvailableGates(sizeClass = null) {
        let available = _filter(this._gates, (gate) => !gate.isOccupied);

        if (sizeClass) {
            available = _filter(available, { size: sizeClass });
        }

        return available;
    }

    /**
     * Get a random available gate
     *
     * @for GateCollection
     * @method getRandomAvailableGate
     * @param sizeClass {string|null}
     * @return {GateModel|null}
     */
    getRandomAvailableGate(sizeClass = null) {
        const available = this.getAvailableGates(sizeClass);

        if (available.length === 0) {
            return null;
        }

        const index = Math.floor(Math.random() * available.length);

        return available[index];
    }
}
