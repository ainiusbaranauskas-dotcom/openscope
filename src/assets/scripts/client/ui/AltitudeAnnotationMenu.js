import $ from 'jquery';

const MIN_ALTITUDE = 10;
const MAX_ALTITUDE = 500;
const ALTITUDE_STEP = 10;

/**
 * HTML overlay dropdown menu for setting an informational altitude annotation
 * on a radar target's data block. This is purely cosmetic and does not
 * command the aircraft.
 *
 * @class AltitudeAnnotationMenu
 */
export default class AltitudeAnnotationMenu {
    constructor() {
        this._$menu = null;
        this._activeRadarTarget = null;

        this._onItemClick = this._onItemClick.bind(this);
        this._onOutsideClick = this._onOutsideClick.bind(this);

        this._init();
    }

    /**
     * @for AltitudeAnnotationMenu
     * @method _init
     */
    _init() {
        this._$menu = $('<div id="altitude-annotation-menu" class="altitude-annotation-menu"></div>');

        const $clearItem = $('<div class="altitude-annotation-item altitude-annotation-clear" data-altitude="">CLR</div>');
        this._$menu.append($clearItem);

        for (let alt = MIN_ALTITUDE; alt <= MAX_ALTITUDE; alt += ALTITUDE_STEP) {
            const $item = $(`<div class="altitude-annotation-item" data-altitude="${alt}">${alt}</div>`);
            this._$menu.append($item);
        }

        this._$menu.on('click', '.altitude-annotation-item', this._onItemClick);
        $('body').append(this._$menu);
        this.hide();
    }

    /**
     * @for AltitudeAnnotationMenu
     * @method show
     * @param radarTargetModel {RadarTargetModel}
     * @param pageX {number}
     * @param pageY {number}
     */
    show(radarTargetModel, pageX, pageY) {
        this._activeRadarTarget = radarTargetModel;

        // Position the menu, keeping it within viewport bounds
        const menuWidth = 55;
        const menuHeight = 200;
        const viewportWidth = $(window).width();
        const viewportHeight = $(window).height();

        let left = pageX;
        let top = pageY;

        if (left + menuWidth > viewportWidth) {
            left = viewportWidth - menuWidth;
        }

        if (top + menuHeight > viewportHeight) {
            top = viewportHeight - menuHeight;
        }

        this._$menu.css({ left, top }).show();

        // Scroll to the aircraft's current altitude region
        const currentAlt = Math.round(radarTargetModel.aircraftModel.altitude / 100);
        const $items = this._$menu.find('.altitude-annotation-item');

        for (let i = 0; i < $items.length; i++) {
            const itemAlt = parseInt($items.eq(i).data('altitude'), 10);

            if (itemAlt >= currentAlt) {
                const scrollTarget = Math.max(0, $items.eq(i).position().top - 60);
                this._$menu.scrollTop(scrollTarget);

                break;
            }
        }

        // Defer outside-click listener to avoid catching the opening click
        setTimeout(() => {
            $(document).on('mousedown.altAnnotation', this._onOutsideClick);
        }, 0);
    }

    /**
     * @for AltitudeAnnotationMenu
     * @method hide
     */
    hide() {
        this._$menu.hide();
        this._activeRadarTarget = null;
        $(document).off('mousedown.altAnnotation');
    }

    /**
     * @for AltitudeAnnotationMenu
     * @method _onItemClick
     * @param event {jQuery.Event}
     */
    _onItemClick(event) {
        const $target = $(event.currentTarget);
        const altitude = $target.data('altitude').toString();

        this._activeRadarTarget.annotatedAltitude = altitude;
        this.hide();
    }

    /**
     * @for AltitudeAnnotationMenu
     * @method _onOutsideClick
     * @param event {jQuery.Event}
     */
    _onOutsideClick(event) {
        if (!$(event.target).closest('#altitude-annotation-menu').length) {
            this.hide();
        }
    }
}
