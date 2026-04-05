import { distance2d } from '../math/distance';
import { vectorize2dFromRadians, vscale, vadd, vsub } from '../math/vector';
import { degreesToRadians } from '../utilities/unitConverters';

// Speed constants in knots
const PUSHBACK_SPEED_KT = 4;
const TAXI_SPEED_KT = 20;
const TURN_SPEED_KT = 8;
const DECEL_DISTANCE_KM = 0.05; // start slowing 50m before a turn/stop

// Knots to km/s conversion
const KT_TO_KM_PER_SEC = 0.000514444;

/**
 * Manages ground movement for a single aircraft along a taxiway path.
 *
 * Interpolates position along taxiway graph edges, handles speed control
 * for turns and hold-short stopping.
 *
 * @class GroundMovementModel
 */
export default class GroundMovementModel {
    constructor() {
        this._path = [];
        this._currentPathIndex = 0;
        this._progressOnSegment = 0;
        this._groundSpeedKt = 0;
        this._targetSpeedKt = 0;
        this._isPushback = false;
        this._isHoldingShort = false;
        this._holdShortRunway = null;
        this._hasCrossRunwayClearance = false;
        this._hasReachedDestination = false;
        this._assignedGateName = null;
        this._holdAtNodeIndex = -1;
    }

    /**
     * @for GroundMovementModel
     * @property isMoving
     * @type {boolean}
     */
    get isMoving() {
        return this._groundSpeedKt > 0.5;
    }

    /**
     * @for GroundMovementModel
     * @property isHoldingShort
     * @type {boolean}
     */
    get isHoldingShort() {
        return this._isHoldingShort;
    }

    /**
     * @for GroundMovementModel
     * @property holdShortRunway
     * @type {string|null}
     */
    get holdShortRunway() {
        return this._holdShortRunway;
    }

    /**
     * @for GroundMovementModel
     * @property hasReachedDestination
     * @type {boolean}
     */
    get hasReachedDestination() {
        return this._hasReachedDestination;
    }

    /**
     * @for GroundMovementModel
     * @property groundSpeedKt
     * @type {number}
     */
    get groundSpeedKt() {
        return this._groundSpeedKt;
    }

    /**
     * @for GroundMovementModel
     * @property assignedGateName
     * @type {string|null}
     */
    get assignedGateName() {
        return this._assignedGateName;
    }

    /**
     * @for GroundMovementModel
     * @method setAssignedGate
     * @param gateName {string}
     */
    setAssignedGate(gateName) {
        this._assignedGateName = gateName;
    }

    /**
     * Set up pushback movement from gate to a pushback node
     *
     * @for GroundMovementModel
     * @method setPushbackPath
     * @param path {array<TaxiwayNode>} typically [gateNode, pushbackNode]
     */
    setPushbackPath(path) {
        this._path = path;
        this._currentPathIndex = 0;
        this._progressOnSegment = 0;
        this._isPushback = true;
        this._targetSpeedKt = PUSHBACK_SPEED_KT;
        this._hasReachedDestination = false;
    }

    /**
     * Set a taxi path (ordered list of TaxiwayNodes from A*)
     *
     * @for GroundMovementModel
     * @method setTaxiPath
     * @param path {array<TaxiwayNode>}
     */
    setTaxiPath(path) {
        this._path = path;
        this._currentPathIndex = 0;
        this._progressOnSegment = 0;
        this._isPushback = false;
        this._targetSpeedKt = TAXI_SPEED_KT;
        this._hasReachedDestination = false;
        this._isHoldingShort = false;

        // Find the last hold-short node in this path — that's where we stop.
        // All earlier hold-short nodes are intermediate crossings that we pass through.
        this._holdAtNodeIndex = -1;

        for (let i = path.length - 1; i >= 0; i--) {
            if (path[i].isHoldShort) {
                this._holdAtNodeIndex = i;
                break;
            }
        }
    }

    /**
     * Grant clearance to cross a runway
     *
     * @for GroundMovementModel
     * @method grantCrossRunwayClearance
     */
    grantCrossRunwayClearance() {
        this._hasCrossRunwayClearance = true;
    }

    /**
     * Continue taxi after a hold
     *
     * @for GroundMovementModel
     * @method continueTaxi
     */
    continueTaxi() {
        this._isHoldingShort = false;
        this._holdShortRunway = null;
        this._hasCrossRunwayClearance = false;
        this._targetSpeedKt = TAXI_SPEED_KT;
    }

    /**
     * Update ground movement — advance along the path
     *
     * @for GroundMovementModel
     * @method update
     * @param deltaTime {number} seconds since last update
     * @return {object|null} { relativePosition, heading } or null if no path
     */
    update(deltaTime) {
        if (this._path.length < 2 || this._hasReachedDestination) {
            return null;
        }

        if (this._isHoldingShort) {
            this._groundSpeedKt = Math.max(0, this._groundSpeedKt - 5 * deltaTime);

            return this._getCurrentState();
        }

        // Accelerate/decelerate toward target
        this._updateSpeed(deltaTime);

        // Advance along the current segment
        const fromNode = this._path[this._currentPathIndex];
        const toNode = this._path[this._currentPathIndex + 1];
        const fromPos = fromNode.relativePosition;
        const toPos = toNode.relativePosition;
        const segmentLength = distance2d(fromPos, toPos);

        if (segmentLength < 0.0001) {
            // Zero-length segment, skip
            this._advanceToNextSegment();

            return this._getCurrentState();
        }

        const distanceTraveled = this._groundSpeedKt * KT_TO_KM_PER_SEC * deltaTime;

        this._progressOnSegment += distanceTraveled / segmentLength;

        if (this._progressOnSegment >= 1.0) {
            this._advanceToNextSegment();
        }

        return this._getCurrentState();
    }

    /**
     * Get current interpolated position and heading
     *
     * @for GroundMovementModel
     * @method getCurrentPosition
     * @return {array} [x, y] relative position in km
     */
    getCurrentPosition() {
        if (this._path.length === 0) {
            return [0, 0];
        }

        if (this._hasReachedDestination || this._currentPathIndex >= this._path.length - 1) {
            return this._path[this._path.length - 1].relativePosition;
        }

        const fromPos = this._path[this._currentPathIndex].relativePosition;
        const toPos = this._path[this._currentPathIndex + 1].relativePosition;
        const t = Math.max(0, Math.min(1, this._progressOnSegment));

        return [
            fromPos[0] + (toPos[0] - fromPos[0]) * t,
            fromPos[1] + (toPos[1] - fromPos[1]) * t
        ];
    }

    /**
     * Get current heading in radians
     *
     * @for GroundMovementModel
     * @method getCurrentHeading
     * @return {number}
     */
    getCurrentHeading() {
        if (this._path.length < 2 || this._currentPathIndex >= this._path.length - 1) {
            return 0;
        }

        const fromPos = this._path[this._currentPathIndex].relativePosition;
        const toPos = this._path[this._currentPathIndex + 1].relativePosition;
        const dx = toPos[0] - fromPos[0];
        const dy = toPos[1] - fromPos[1];

        let heading = Math.atan2(dx, dy);

        if (this._isPushback) {
            heading += Math.PI;
        }

        return heading;
    }

    /**
     * Advance to the next segment in the path
     *
     * @for GroundMovementModel
     * @method _advanceToNextSegment
     * @private
     */
    _advanceToNextSegment() {
        this._currentPathIndex++;
        this._progressOnSegment = 0;

        if (this._currentPathIndex >= this._path.length - 1) {
            this._hasReachedDestination = true;
            this._groundSpeedKt = 0;

            return;
        }

        const nextNode = this._path[this._currentPathIndex + 1];
        const nextNodeIndex = this._currentPathIndex + 1;

        // Only hold at the designated hold-short node (the last one in the path),
        // not at intermediate runway crossings along the route
        if (nextNode.isHoldShort && !this._hasCrossRunwayClearance &&
            nextNodeIndex === this._holdAtNodeIndex) {
            this._isHoldingShort = true;
            this._holdShortRunway = nextNode.runway;
            this._targetSpeedKt = 0;
        }

        // Slow for turns
        this._updateTargetSpeedForTurn();
    }

    /**
     * Update speed — simple acceleration/deceleration toward target
     *
     * @for GroundMovementModel
     * @method _updateSpeed
     * @param deltaTime {number}
     * @private
     */
    _updateSpeed(deltaTime) {
        const accelRate = 3; // kt/s
        const decelRate = 5; // kt/s

        if (this._groundSpeedKt < this._targetSpeedKt) {
            this._groundSpeedKt = Math.min(
                this._targetSpeedKt,
                this._groundSpeedKt + accelRate * deltaTime
            );
        } else if (this._groundSpeedKt > this._targetSpeedKt) {
            this._groundSpeedKt = Math.max(
                this._targetSpeedKt,
                this._groundSpeedKt - decelRate * deltaTime
            );
        }
    }

    /**
     * Calculate target speed based on upcoming turn angle
     *
     * @for GroundMovementModel
     * @method _updateTargetSpeedForTurn
     * @private
     */
    _updateTargetSpeedForTurn() {
        if (this._isPushback) {
            this._targetSpeedKt = PUSHBACK_SPEED_KT;

            return;
        }

        if (this._currentPathIndex + 2 >= this._path.length) {
            this._targetSpeedKt = TAXI_SPEED_KT;

            return;
        }

        // Calculate the turn angle at the next node
        const prev = this._path[this._currentPathIndex].relativePosition;
        const curr = this._path[this._currentPathIndex + 1].relativePosition;
        const next = this._path[this._currentPathIndex + 2].relativePosition;

        const dx1 = curr[0] - prev[0];
        const dy1 = curr[1] - prev[1];
        const dx2 = next[0] - curr[0];
        const dy2 = next[1] - curr[1];

        const dot = dx1 * dx2 + dy1 * dy2;
        const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
        const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

        if (len1 < 0.0001 || len2 < 0.0001) {
            this._targetSpeedKt = TAXI_SPEED_KT;

            return;
        }

        const cosAngle = Math.max(-1, Math.min(1, dot / (len1 * len2)));
        const turnAngle = Math.acos(cosAngle);

        // Sharp turn (> 45 degrees) → slow down
        if (turnAngle > Math.PI / 4) {
            this._targetSpeedKt = TURN_SPEED_KT;
        } else {
            this._targetSpeedKt = TAXI_SPEED_KT;
        }
    }

    /**
     * Get current state for the update return value
     *
     * @for GroundMovementModel
     * @method _getCurrentState
     * @return {object}
     * @private
     */
    _getCurrentState() {
        return {
            relativePosition: this.getCurrentPosition(),
            heading: this.getCurrentHeading(),
            groundSpeed: this._groundSpeedKt
        };
    }
}
