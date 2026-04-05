import StaticPositionModel from '../../base/StaticPositionModel';

/**
 * Model representing a single gate/parking stand at the airport.
 *
 * @class GateModel
 */
export default class GateModel {
    /**
     * @constructor
     * @param gateData {object} { name, position: [lat, lon], heading, size }
     * @param airportPositionModel {StaticPositionModel} airport reference position
     * @param magneticNorth {number} magnetic north in radians
     */
    constructor(gateData, airportPositionModel, magneticNorth) {
        this.name = gateData.name;
        this.heading = gateData.heading || 0;
        this.size = gateData.size || 'C';
        this.surface = gateData.surface || 'asphalt';
        this.pcr = gateData.pcr || '';
        this.routeConstraints = gateData.routeConstraints || null;
        this.mutualExclusion = gateData.mutualExclusion || null;

        this._positionModel = new StaticPositionModel(
            gateData.position,
            airportPositionModel,
            magneticNorth
        );

        this._occupyingAircraft = null;
        this._isPushbackInProgress = false;
    }

    /**
     * @for GateModel
     * @property positionModel
     * @type {StaticPositionModel}
     */
    get positionModel() {
        return this._positionModel;
    }

    /**
     * @for GateModel
     * @property relativePosition
     * @type {array} [x, y] in km relative to airport
     */
    get relativePosition() {
        return this._positionModel.relativePosition;
    }

    /**
     * @for GateModel
     * @property gps
     * @type {array} [lat, lon]
     */
    get gps() {
        return [this._positionModel.latitude, this._positionModel.longitude];
    }

    /**
     * @for GateModel
     * @property isOccupied
     * @type {boolean}
     */
    get isOccupied() {
        return this._occupyingAircraft !== null;
    }

    /**
     * @for GateModel
     * @property isPushbackInProgress
     * @type {boolean}
     */
    get isPushbackInProgress() {
        return this._isPushbackInProgress;
    }

    /**
     * Assign an aircraft to this gate
     *
     * @for GateModel
     * @method assignAircraft
     * @param aircraftModel {AircraftModel}
     */
    assignAircraft(aircraftModel) {
        this._occupyingAircraft = aircraftModel;
    }

    /**
     * Release the gate
     *
     * @for GateModel
     * @method release
     */
    release() {
        this._occupyingAircraft = null;
        this._isPushbackInProgress = false;
    }

    /**
     * Mark pushback as in progress
     *
     * @for GateModel
     * @method startPushback
     */
    startPushback() {
        this._isPushbackInProgress = true;
    }

    /**
     * Mark pushback as complete and release the gate
     *
     * @for GateModel
     * @method completePushback
     */
    completePushback() {
        this._occupyingAircraft = null;
        this._isPushbackInProgress = false;
    }
}
