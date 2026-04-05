import $ from 'jquery';
import _isNil from 'lodash/isNil';
import _lowerCase from 'lodash/lowerCase';
import AirportController from './airport/AirportController';
import AppController from './AppController';
import EventBus from './lib/EventBus';
import TimeKeeper from './engine/TimeKeeper';
import { DEFAULT_AIRPORT_ICAO } from './constants/airportConstants';
import { KEY_CODES } from './constants/inputConstants';
import { STORAGE_KEY } from './constants/storageKeys';
import { EVENT } from './constants/eventNames';
import { LOG } from './constants/logLevel';

window.zlsa = {};
window.zlsa.atc = {};

// TODO: KILL THE PROP!
const prop = {};

// IIEFs are pulled in here to add functions to the global space.
//
// This will need to be re-worked, and current global functions should be exported and
// imported as needed in each file.
require('./util');

// are you using a main loop? (you must call update() afterward disable/re-enable)
let UPDATE = true;

/**
 * @class App
 */
export default class App {
    /**
     * @constructor
     * @param $element {HTML Element|null}
     */
    constructor(element) {
        /**
         * Root DOM element.
         *
         * @property $element
         * @type {jQuery|HTML Element}
         * @default body
         */
        this.$element = $(element);
        this._appController = new AppController(this.$element);
        window.__appCtrl = this._appController;
        this.eventBus = EventBus;

        window.prop = prop;

        this.prop = prop;
        this.prop.complete = false;
        this.prop.log = LOG.DEBUG;
        this.prop.loaded = false;

        this.setupHandlers()
            ._fetchAirportLoadList();
    }

    /**
     * Fetch airportLoadList.json containing the list of available airports
     *
     * @for App
     * @method _fetchAirportLoadList
     */
    _fetchAirportLoadList() {
        $.getJSON('assets/airports/airportLoadList.json')
            .done((response) => this.onAirportLoadListFetchedHandler(response))
            .fail((jqXHR) => console.error(`Unable to load airport list: ${jqXHR.status}: ${jqXHR.statusText}`));
    }

    /**
     * Handler method called after successfully fetching airportLoadList.json
     *
     * @for App
     * @method _onAirportLoadListFetched
     */
    _onAirportLoadListFetched(data) {
        const airportLoadList = data.filter((airport) => airport.disabled !== true);
        // ICAO id of the initial airport. may be the default or a stored airport
        const initialAirportToLoad = this._getInitialAirport(airportLoadList);

        this.loadInitialAirport(airportLoadList, initialAirportToLoad);
    }

    /**
     * Check if a given icao exists in the list of available airports
     *
     * @for App
     * @method _isAirportIcaoInLoadList
     * @param icao {string}  icao
     * @param airportLoadList {array<object>}  List of available airports
     */
    _isAirportIcaoInLoadList(icao, airportLoadList) {
        return !_isNil(icao) && airportLoadList.some((airport) => airport.icao === icao);
    }

    /**
     * Obtain icao for the initial airport from localStorage if available
     * otherwise use `DEFAULT_AIRPORT_ICAO`
     *
     * @for App
     * @method _getInitialAirport
     * @param airportLoadList {array<object>}  List of airports to load
     */
    _getInitialAirport(airportLoadList) {
        let airportName = DEFAULT_AIRPORT_ICAO;
        const previousAirportIcaoFromLocalStorage = localStorage[STORAGE_KEY.ATC_LAST_AIRPORT];

        if (this._isAirportIcaoInLoadList(previousAirportIcaoFromLocalStorage, airportLoadList)) {
            airportName = _lowerCase(localStorage[STORAGE_KEY.ATC_LAST_AIRPORT]);
        }

        return airportName;
    }

    /**
     * Create event handlers
     *
     * @for App
     * @method setupHandlers
     * @chainable
     */
    setupHandlers() {
        this.onAirportLoadListFetchedHandler = this._onAirportLoadListFetched.bind(this);
        this.loadDefaultAiportAfterStorageIcaoFailureHandler = this.loadDefaultAiportAfterStorageIcaoFailure.bind(this);
        this.loadAirlinesAndAircraftHandler = this.loadAirlinesAndAircraft.bind(this);
        this.setupChildrenHandler = this.setupChildren.bind(this);
        this.onPauseHandler = this._onPause.bind(this);
        this.onUpdateHandler = this.update.bind(this);

        this.eventBus.on(EVENT.PAUSE_UPDATE_LOOP, this.onPauseHandler);

        // F9 toggles game mode — bound globally so it works regardless of active mode
        $(window).on('keydown', (event) => {
            if (event.originalEvent && event.originalEvent.code === KEY_CODES.F9) {
                event.preventDefault();
                this.eventBus.trigger(EVENT.GAME_MODE_TOGGLE);
            }
        });

        // Native listener fallback for F9 (covers programmatic dispatch)
        window.addEventListener('keydown', (event) => {
            if (event.code === 'F9') {
                event.preventDefault();
                this.eventBus.trigger(EVENT.GAME_MODE_TOGGLE);
            }
        });

        // Expose toggle for testing
        window.__toggleGameMode = () => this.eventBus.trigger(EVENT.GAME_MODE_TOGGLE);

        // Expose tower command for testing: __towerCmd('BTI589', 'pb')
        window.__towerCmd = (callsign, cmd) => {
            const towerMode = this._appController.gameModeController.getMode('tower');

            if (towerMode && towerMode.handleCommand) {
                return towerMode.handleCommand(callsign, cmd);
            }

            return { success: false, message: 'Tower mode not available' };
        };

        // Expose debug helpers
        window.__debugGraph = () => {
            const airport = AirportController.current;
            const graph = airport.taxiwayGraph;

            if (!graph) return 'No taxiway graph';

            window.__graph = graph;

            const nodeCount = Object.keys(graph.nodes).length;
            const edgeCount = graph.edges.length;
            const path = graph.findPath('N475', 'HOLD_F5');

            // Debug: check N475 edges
            const n475 = graph.getNode('N475');
            const n475Edges = n475 ? n475.edges.length : 'not found';
            const n475Neighbors = n475 ? n475.edges.map((e) => e.to.name).join(',') : '';

            return `Nodes: ${nodeCount}, Edges: ${edgeCount}, N475 edges: ${n475Edges} [${n475Neighbors}], Path: ${path ? path.length : 'NULL'}`;
        };

        // List tower aircraft for testing
        window.__towerAircraft = () => {
            const list = this._appController.aircraftController.aircraft.list;

            return list
                .filter((a) => a.groundMovementModel)
                .map((a) => {
                    const gmm = a.groundMovementModel;
                    const pos = a.relativePosition;
                    const gPos = a._groundRelativePosition;

                    return `${a.callsign} phase=${a.flightPhase} gate=${gmm.assignedGateName || '?'} ` +
                        `moving=${gmm.isMoving} spd=${gmm.groundSpeedKt.toFixed(1)} ` +
                        `holding=${gmm.isHoldingShort} dest=${gmm.hasReachedDestination} ` +
                        `pathIdx=${gmm._currentPathIndex}/${gmm._path.length} ` +
                        `pos=[${pos[0].toFixed(4)},${pos[1].toFixed(4)}] ` +
                        `gndPos=${gPos ? '[' + gPos[0].toFixed(4) + ',' + gPos[1].toFixed(4) + ']' : 'null'}`;
                })
                .join('\n');
        };

        return this;
    }

    /**
     * Used to load data for the initial airport using an icao from
     * either localStorage or `DEFAULT_AIRPORT_ICAO`
     *
     * If a localStorage airport cannot be found, we will attempt
     * to load the `DEFAULT_AIRPORT_ICAO`
     *
     * Lifecycle method. Should be called only once on initialization
     *
     * @for App
     * @method loadInitialAirport
     * @param airportLoadList {array<object>}  List of airports to load
     */
    loadInitialAirport(airportLoadList, initialAirportToLoad) {
        const initialAirportIcao = initialAirportToLoad.toLowerCase();

        $.getJSON(`assets/airports/${initialAirportIcao}.json`)
            .then((response) => this.loadAirlinesAndAircraftHandler(airportLoadList, initialAirportIcao, response))
            .catch((error) => this.loadDefaultAiportAfterStorageIcaoFailureHandler(airportLoadList));
    }

    /**
     * Used only when an attempt to load airport data with an icao in localStorage fails.
     * In this case we attempt to load the default airport with this method
     *
     * Lifecycle method. Should be called only once on initialization
     *
     * @for App
     * @method onLoadDefaultAirportAfterStorageIcaoFailure
     * @param {array<object>} airportLoadList
     */
    loadDefaultAiportAfterStorageIcaoFailure(airportLoadList) {
        $.getJSON(`assets/airports/${DEFAULT_AIRPORT_ICAO}.json`)
            .then((defaultAirportResponse) => this.loadAirlinesAndAircraftHandler(
                airportLoadList,
                DEFAULT_AIRPORT_ICAO,
                defaultAirportResponse
            ));
    }

    /**
     * Handler method called after data has loaded for the airline and aircraftTypeDefinitions datasets.
     *
     * Lifecycle method. Should be called only once on initialization
     *
     * @for App
     * @method loadAirlinesAndAircraft
     * @param {array>object>} airportLoadList
     * @param {string} initialAirportIcao
     * @param {object<string>} initialAirportResponse
     */
    loadAirlinesAndAircraft(airportLoadList, initialAirportIcao, initialAirportResponse) {
        const airlineListPromise = $.getJSON('assets/airlines/airlines.json');
        const aircraftListPromise = $.getJSON('assets/aircraft/aircraft.json');
        const airportGuideListPromise = $.getJSON('assets/guides/guides.json');

        // This is provides a way to get async data from several sources in the app before anything else runs
        // we need to resolve data from two sources before the app can proceede. This data should always
        // exist, if it doesn't, something has gone terribly wrong.
        $.when(airlineListPromise, aircraftListPromise, airportGuideListPromise)
            .done((airlineResponse, aircraftResponse, airportGuideResponse) => {
                this.setupChildrenHandler(
                    airportLoadList,
                    initialAirportIcao,
                    initialAirportResponse,
                    airlineResponse[0].airlines,
                    aircraftResponse[0].aircraft,
                    airportGuideResponse[0]
                );
            });
    }

    /**
     * Callback for a successful data load
     *
     * A first load of data occurs on startup where we load the initial airport, airline definitions and
     * aircraft type definitiions. this method is called onComplete of that data load and is used to
     * instantiate various classes with the loaded data.
     *
     * This method will fire `.enable()` that will finish the initialization lifecycle and begine the game loop.
     * Lifecycle method. Should be called only once on initialization
     *
     * @for App
     * @method setupChildren
     * @param airportLoadList {array}         List of all airports
     * @param initialAirportData {object}     Airport json for the initial airport, could be default or stored airport
     * @param airlineList {array}             List of all Airline definitions
     * @param aircraftTypeDefinitionList {array}  List of all Aircraft definitions
     * @param airportGuides {object}          Airport guide JSON
     */
    setupChildren(
        airportLoadList,
        initialAirportIcao,
        initialAirportData,
        airlineList,
        aircraftTypeDefinitionList,
        airportGuides
    ) {
        this._appController.setupChildren(
            airportLoadList,
            initialAirportIcao,
            initialAirportData,
            airlineList,
            aircraftTypeDefinitionList,
            airportGuides
        );

        this.enable();
    }

    /**
     * Lifecycle method. Should be called only once on initialization.
     *
     * Used to fire off `init` and `init_pre` methods and also start the game loop
     *
     * @for App
     * @method enable
     */
    enable() {
        return this.init_pre()
            .init()
            .done();
    }

    /**
     * @for App
     * @method disable
     */
    disable() {
        return this.destroy();
    }

    /**
     * Tear down the application
     *
     * Should never be called directly, only cia `this.disable()`
     *
     * @for App
     * @method destroy
     */
    destroy() {
        this.$element = null;

        return this;
    }

    // === CALLBACKS (all optional and do not need to be defined) ===
    // INIT:
    // module_init_pre()
    // module_init()
    // module_init_post()

    // module_done()
    // -- wait until all async has finished (could take a long time)
    // module_ready()
    // -- wait until first frame is ready (only triggered if UPDATE == true)
    // module_complete()

    // UPDATE:
    // module_update_pre()
    // module_update()
    // module_update_post()

    // RESIZE (called at least once during init and whenever page changes size)
    // module_resize()

    /**
     * @for App
     * @method init_pre
     */
    init_pre() {
        this._appController.init_pre();

        return this;
    }

    /**
     * @for App
     * @method init
     */
    init() {
        this._appController.init();

        return this;
    }

    /**
     * @for App
     * @method init_post
     */
    init_post() {
        return this;
    }

    /**
     * @for App
     * @method done
     */
    done() {
        this._appController.done();
        this._appController.resize();

        this.prop.loaded = true;

        if (UPDATE) {
            requestAnimationFrame(this.onUpdateHandler);
        }

        return this;
    }

    /**
     * @for App
     * @method complete
     */
    complete() {
        this._appController.complete();

        return this;
    }

    /**
     * @for App
     * @method updatePre
     */
    updatePre() {
        this._appController.updatePre();

        return this;
    }

    /**
     * @for App
     * @method updatePost
     */
    updatePost() {
        this._appController.updatePost();

        return this;
    }

    /**
     * @for App
     * @method update
     */
    update() {
        if (!this.prop.complete) {
            this.complete();

            this.prop.complete = true;
        }

        if (!UPDATE) {
            return this;
        }

        requestAnimationFrame(this.onUpdateHandler);

        this.updatePre();
        this.updatePost();
        TimeKeeper.update();

        return this;
    }

    /**
     * @for App
     * @method _onPause
     * @param shouldUpdate {boolean}
     */
    _onPause(shouldUpdate) {
        if (!UPDATE && shouldUpdate) {
            requestAnimationFrame(this.onUpdateHandler);
        }

        UPDATE = shouldUpdate;
    }
}
