/**
 * Abstract base class for game modes.
 *
 * Each game mode is a self-contained game experience with its own rendering,
 * input handling, command set, and traffic generation. Modes share the underlying
 * simulation layer (AircraftController, AirportModel, TimeKeeper, EventBus).
 *
 * @class BaseGameMode
 */
export default class BaseGameMode {
    /**
     * @constructor
     * @param name {string} unique mode identifier
     */
    constructor(name) {
        this._name = name;
        this._isActive = false;
    }

    /**
     * @for BaseGameMode
     * @property name
     * @type {string}
     */
    get name() {
        return this._name;
    }

    /**
     * @for BaseGameMode
     * @property isActive
     * @type {boolean}
     */
    get isActive() {
        return this._isActive;
    }

    /**
     * Whether this mode is available for the current airport.
     * Override in subclass to check for required data (e.g., ground data for tower mode).
     *
     * @for BaseGameMode
     * @method isAvailable
     * @return {boolean}
     */
    isAvailable() {
        return true;
    }

    /**
     * One-time initialization after airport data is loaded.
     * Called by GameModeController.initializeModes().
     *
     * @for BaseGameMode
     * @method init
     */
    init() {
        // override in subclass
    }

    /**
     * Activate this mode — show canvases, bind input handlers, start spawner.
     *
     * @for BaseGameMode
     * @method activate
     */
    activate() {
        this._isActive = true;
    }

    /**
     * Deactivate this mode — hide canvases, unbind input handlers, stop spawner.
     *
     * @for BaseGameMode
     * @method deactivate
     */
    deactivate() {
        this._isActive = false;
    }

    /**
     * Per-frame update — simulation tick for this mode's concerns.
     *
     * @for BaseGameMode
     * @method update
     */
    update() {
        // override in subclass
    }

    /**
     * Per-frame render — draw this mode's visuals.
     *
     * @for BaseGameMode
     * @method render
     */
    render() {
        // override in subclass
    }

    /**
     * Handle a command string in this mode's context.
     *
     * @for BaseGameMode
     * @method handleCommand
     * @param commandString {string}
     * @return {array} [success, responseMessage]
     */
    handleCommand(commandString) {
        return [false, 'command not implemented'];
    }

    /**
     * Reset mode state (e.g., on traffic reset).
     *
     * @for BaseGameMode
     * @method reset
     */
    reset() {
        // override in subclass
    }
}
