import $ from 'jquery';
import EventBus from '../lib/EventBus';
import { EVENT } from '../constants/eventNames';

/**
 * Input controller for tower/ground mode.
 *
 * Handles pan/zoom on the tower canvas and command input routing.
 *
 * @class TowerInputController
 */
export default class TowerInputController {
    /**
     * @constructor
     * @param $element {jQuery} root element
     * @param towerCanvasController {TowerCanvasController}
     * @param aircraftController {AircraftController}
     */
    constructor($element, towerCanvasController, aircraftController) {
        this._$element = $element;
        this._$window = $(window);
        this._towerCanvasController = towerCanvasController;
        this._aircraftController = aircraftController;
        this._eventBus = EventBus;

        this._isDragging = false;
        this._lastMouseX = 0;
        this._lastMouseY = 0;
        this._isEnabled = false;

        this._onMouseDownHandler = this._onMouseDown.bind(this);
        this._onMouseMoveHandler = this._onMouseMove.bind(this);
        this._onMouseUpHandler = this._onMouseUp.bind(this);
        this._onWheelHandler = this._onWheel.bind(this);
    }

    /**
     * @for TowerInputController
     * @method enable
     */
    enable() {
        if (this._isEnabled) {
            return;
        }

        this._isEnabled = true;
        const container = document.getElementById('tower-canvases');

        if (container) {
            container.addEventListener('mousedown', this._onMouseDownHandler);
            container.addEventListener('mousemove', this._onMouseMoveHandler);
            container.addEventListener('mouseup', this._onMouseUpHandler);
            container.addEventListener('wheel', this._onWheelHandler, { passive: false });
        }
    }

    /**
     * @for TowerInputController
     * @method disable
     */
    disable() {
        if (!this._isEnabled) {
            return;
        }

        this._isEnabled = false;
        const container = document.getElementById('tower-canvases');

        if (container) {
            container.removeEventListener('mousedown', this._onMouseDownHandler);
            container.removeEventListener('mousemove', this._onMouseMoveHandler);
            container.removeEventListener('mouseup', this._onMouseUpHandler);
            container.removeEventListener('wheel', this._onWheelHandler);
        }
    }

    /**
     * @for TowerInputController
     * @method _onMouseDown
     * @private
     */
    _onMouseDown(event) {
        this._isDragging = true;
        this._lastMouseX = event.clientX;
        this._lastMouseY = event.clientY;
    }

    /**
     * @for TowerInputController
     * @method _onMouseMove
     * @private
     */
    _onMouseMove(event) {
        if (!this._isDragging) {
            return;
        }

        const dx = event.clientX - this._lastMouseX;
        const dy = event.clientY - this._lastMouseY;

        this._lastMouseX = event.clientX;
        this._lastMouseY = event.clientY;

        this._towerCanvasController.updatePan(dx, dy);
    }

    /**
     * @for TowerInputController
     * @method _onMouseUp
     * @private
     */
    _onMouseUp() {
        this._isDragging = false;
    }

    /**
     * @for TowerInputController
     * @method _onWheel
     * @private
     */
    _onWheel(event) {
        event.preventDefault();

        if (event.deltaY < 0) {
            this._towerCanvasController.zoomIn();
        } else {
            this._towerCanvasController.zoomOut();
        }
    }
}
