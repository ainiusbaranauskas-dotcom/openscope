import BaseGameMode from './BaseGameMode';
import AirportController from '../airport/AirportController';
import TowerCanvasController from '../canvas/TowerCanvasController';
import TowerCommandParser from '../commands/TowerCommandParser';
import TowerInputController from '../input/TowerInputController';
import TowerSpawnController from '../trafficGenerator/TowerSpawnController';

/**
 * Tower/ground control game mode.
 *
 * Provides a zoomed-in 2D overhead view of the airport apron with full ground
 * control operations: pushback, taxi routing, hold short, runway crossing.
 *
 * This mode has its own canvas, input handling, command set, and traffic generation,
 * completely independent from the approach mode.
 *
 * @class TowerMode
 * @extends BaseGameMode
 */
export default class TowerMode extends BaseGameMode {
    /**
     * @constructor
     * @param $canvasesElement {jQuery} root canvases container for creating tower canvas
     * @param aircraftController {AircraftController}
     */
    constructor($canvasesElement, aircraftController) {
        super('tower');

        this._$canvasesElement = $canvasesElement;
        this._aircraftController = aircraftController;
        this._towerCanvasController = null;
        this._towerInputController = null;
        this._towerSpawnController = null;
        this._isInitialized = false;
    }

    /**
     * Tower mode is only available when the airport has ground data
     *
     * @for TowerMode
     * @method isAvailable
     * @return {boolean}
     */
    isAvailable() {
        const airport = AirportController.current;

        if (!airport) {
            return false;
        }

        return airport.hasGroundData();
    }

    /**
     * @for TowerMode
     * @method init
     */
    init() {
        if (!this.isAvailable()) {
            return;
        }

        if (this._isInitialized) {
            return;
        }

        this._towerCanvasController = new TowerCanvasController(
            this._$canvasesElement,
            this._aircraftController
        );

        this._towerInputController = new TowerInputController(
            this._$canvasesElement,
            this._towerCanvasController,
            this._aircraftController
        );

        this._towerSpawnController = new TowerSpawnController(
            this._aircraftController
        );

        this._isInitialized = true;
    }

    /**
     * @for TowerMode
     * @method activate
     */
    activate() {
        super.activate();

        if (this._towerCanvasController) {
            this._towerCanvasController.show();
        }

        if (this._towerInputController) {
            this._towerInputController.enable();
        }

        if (this._towerSpawnController) {
            this._towerSpawnController.start();
        }
    }

    /**
     * @for TowerMode
     * @method deactivate
     */
    deactivate() {
        super.deactivate();

        if (this._towerCanvasController) {
            this._towerCanvasController.hide();
        }

        if (this._towerInputController) {
            this._towerInputController.disable();
        }

        if (this._towerSpawnController) {
            this._towerSpawnController.stop();
        }
    }

    /**
     * @for TowerMode
     * @method update
     */
    update() {
        if (this._towerSpawnController) {
            this._towerSpawnController.update();
        }

        // Update all aircraft (drives ground movement model)
        this._aircraftController.update();
    }

    /**
     * @for TowerMode
     * @method render
     */
    render() {
        if (this._towerCanvasController) {
            this._towerCanvasController.canvasUpdatePost();
        }
    }

    /**
     * Handle a tower command string directed at an aircraft
     *
     * @for TowerMode
     * @method handleCommand
     * @param callsign {string} aircraft callsign
     * @param commandString {string} command to execute
     * @return {object} { success, message }
     */
    handleCommand(callsign, commandString) {
        const aircraft = this._aircraftController.findAircraftByCallsign(callsign);

        if (!aircraft) {
            return { success: false, message: `Aircraft "${callsign}" not found` };
        }

        const result = TowerCommandParser.executeCommand(aircraft, commandString);

        console.log(`[Tower] ${callsign} ${commandString} → ${result.message}`);

        return result;
    }

    /**
     * @for TowerMode
     * @method reset
     */
    reset() {
        if (this._towerSpawnController) {
            this._towerSpawnController.reset();
        }
    }
}
