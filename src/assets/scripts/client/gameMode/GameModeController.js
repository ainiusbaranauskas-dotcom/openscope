import EventBus from '../lib/EventBus';
import { EVENT } from '../constants/eventNames';

/**
 * Manages game modes (approach, tower, etc.) and handles switching between them.
 *
 * Each mode is a self-contained game experience with its own rendering, input,
 * commands, and traffic generation. The controller manages the active mode lifecycle
 * and delegates update/render calls.
 *
 * @class GameModeController
 */
class GameModeController {
    constructor() {
        this._modes = {};
        this._activeModeName = null;
        this._activeMode = null;
        this._eventBus = EventBus;
    }

    /**
     * Register a game mode by name
     *
     * @for GameModeController
     * @method registerMode
     * @param name {string}
     * @param modeInstance {BaseGameMode}
     */
    registerMode(name, modeInstance) {
        this._modes[name] = modeInstance;
    }

    /**
     * Get list of registered mode names
     *
     * @for GameModeController
     * @method getModeNames
     * @return {string[]}
     */
    getModeNames() {
        return Object.keys(this._modes);
    }

    /**
     * Get a mode instance by name
     *
     * @for GameModeController
     * @method getMode
     * @param name {string}
     * @return {BaseGameMode|null}
     */
    getMode(name) {
        return this._modes[name] || null;
    }

    /**
     * Get the active mode instance
     *
     * @for GameModeController
     * @method getActiveMode
     * @return {BaseGameMode|null}
     */
    getActiveMode() {
        return this._activeMode;
    }

    /**
     * Get the name of the active mode
     *
     * @for GameModeController
     * @method getActiveModeName
     * @return {string|null}
     */
    getActiveModeName() {
        return this._activeModeName;
    }

    /**
     * Check if a mode is available (registered and reports itself as available)
     *
     * @for GameModeController
     * @method isModeAvailable
     * @param name {string}
     * @return {boolean}
     */
    isModeAvailable(name) {
        const mode = this._modes[name];

        if (!mode) {
            return false;
        }

        return mode.isAvailable();
    }

    /**
     * Switch to a named game mode. Deactivates the current mode and activates the new one.
     *
     * @for GameModeController
     * @method switchMode
     * @param name {string}
     */
    switchMode(name) {
        const nextMode = this._modes[name];

        if (!nextMode) {
            console.error(`GameModeController: unknown mode "${name}"`);

            return;
        }

        if (!nextMode.isAvailable()) {
            console.warn(`GameModeController: mode "${name}" is not available for this airport`);

            return;
        }

        if (this._activeMode) {
            this._activeMode.deactivate();
        }

        this._activeModeName = name;
        this._activeMode = nextMode;
        this._activeMode.activate();

        this._eventBus.trigger(EVENT.GAME_MODE_CHANGE, name);
    }

    /**
     * Cycle to the next available mode
     *
     * @for GameModeController
     * @method cycleMode
     */
    cycleMode() {
        const names = this.getModeNames().filter((name) => this.isModeAvailable(name));

        if (names.length <= 1) {
            return;
        }

        const currentIndex = names.indexOf(this._activeModeName);
        const nextIndex = (currentIndex + 1) % names.length;

        this.switchMode(names[nextIndex]);
    }

    /**
     * Delegate update to the active mode
     *
     * @for GameModeController
     * @method update
     */
    update() {
        if (this._activeMode) {
            this._activeMode.update();
        }
    }

    /**
     * Delegate render to the active mode
     *
     * @for GameModeController
     * @method render
     */
    render() {
        if (this._activeMode) {
            this._activeMode.render();
        }
    }

    /**
     * Called when airport changes — reset all modes
     *
     * @for GameModeController
     * @method onAirportChange
     */
    onAirportChange() {
        if (this._activeMode) {
            this._activeMode.deactivate();
        }

        this._activeMode = null;
        this._activeModeName = null;
    }

    /**
     * Reinitialize modes after airport data is ready
     *
     * @for GameModeController
     * @method initializeModes
     * @param defaultMode {string}
     */
    initializeModes(defaultMode = 'approach') {
        for (const name in this._modes) {
            this._modes[name].init();
        }

        this.switchMode(defaultMode);
    }
}

export default new GameModeController();
