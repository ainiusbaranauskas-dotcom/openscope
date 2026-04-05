import BaseGameMode from './BaseGameMode';

/**
 * Approach/radar game mode — wraps the existing OpenScope approach control experience.
 *
 * This mode delegates to the existing controllers (CanvasController, InputController,
 * ScopeModel, SpawnScheduler) that were previously called directly from AppController.
 * It serves as the "default" mode and preserves all existing behavior.
 *
 * @class ApproachMode
 * @extends BaseGameMode
 */
export default class ApproachMode extends BaseGameMode {
    /**
     * @constructor
     * @param canvasController {CanvasController}
     * @param inputController {InputController}
     * @param aircraftController {AircraftController}
     * @param scopeModel {ScopeModel}
     */
    constructor(canvasController, inputController, aircraftController, scopeModel) {
        super('approach');

        this._canvasController = canvasController;
        this._inputController = inputController;
        this._aircraftController = aircraftController;
        this._scopeModel = scopeModel;
    }

    /**
     * @for ApproachMode
     * @method isAvailable
     * @return {boolean}
     */
    isAvailable() {
        return true;
    }

    /**
     * @for ApproachMode
     * @method activate
     */
    activate() {
        super.activate();

        this._canvasController.show();
        this._inputController.enable();
    }

    /**
     * @for ApproachMode
     * @method deactivate
     */
    deactivate() {
        super.deactivate();

        this._canvasController.hide();
        this._inputController.disable();
    }

    /**
     * @for ApproachMode
     * @method update
     */
    update() {
        this._aircraftController.update();
    }

    /**
     * @for ApproachMode
     * @method render
     */
    render() {
        this._canvasController.canvasUpdatePost();
        this._aircraftController.updateAircraftStrips();
    }

    /**
     * @for ApproachMode
     * @method reset
     */
    reset() {
        // SpawnScheduler and SpawnPatternCollection handle their own reset via EventBus
    }
}
