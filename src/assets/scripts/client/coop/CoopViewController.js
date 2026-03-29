import $ from 'jquery';
import EventBus from '../lib/EventBus';
import AirportController from '../airport/AirportController';
import { COOP_EVENT } from '../constants/eventNames';
import { SELECTORS } from '../constants/selectors';

export default class CoopViewController {
    constructor($element, coopController) {
        this._eventBus = EventBus;
        this._coopController = coopController;
        this.$element = $element;
        this.$lobby = null;
        this.$lobbyMenu = null;
        this.$lobbyWaiting = null;
        this.$lobbyConnected = null;
        this.$error = null;
        this.$coopIcon = null;

        this._init();
        this._setupHandlers();
        this._enable();
    }

    _init() {
        this.$lobby = this.$element.find(SELECTORS.DOM_SELECTORS.COOP_LOBBY);
        this.$lobbyMenu = this.$element.find(SELECTORS.DOM_SELECTORS.COOP_LOBBY_MENU);
        this.$lobbyWaiting = this.$element.find(SELECTORS.DOM_SELECTORS.COOP_LOBBY_WAITING);
        this.$lobbyConnected = this.$element.find(SELECTORS.DOM_SELECTORS.COOP_LOBBY_CONNECTED);
        this.$error = this.$element.find(SELECTORS.DOM_SELECTORS.COOP_ERROR);
        this.$coopIcon = this.$element.find(SELECTORS.DOM_SELECTORS.TOGGLE_COOP).find('.coop-icon');
    }

    _setupHandlers() {
        this._onToggleCoopHandler = this._onToggleCoop.bind(this);
        this._onCreateRoomHandler = this._onCreateRoom.bind(this);
        this._onJoinRoomHandler = this._onJoinRoom.bind(this);
        this._onCloseLobbyHandler = this._onCloseLobby.bind(this);
        this._onLeaveRoomHandler = this._onLeaveRoom.bind(this);
    }

    _enable() {
        this.$element.find(SELECTORS.DOM_SELECTORS.TOGGLE_COOP).on('click', this._onToggleCoopHandler);
        $(SELECTORS.DOM_SELECTORS.COOP_CREATE_BTN).on('click', this._onCreateRoomHandler);
        $(SELECTORS.DOM_SELECTORS.COOP_JOIN_BTN).on('click', this._onJoinRoomHandler);
        $(SELECTORS.DOM_SELECTORS.COOP_CLOSE_BTN).on('click', this._onCloseLobbyHandler);
        $(SELECTORS.DOM_SELECTORS.COOP_LEAVE_BTN).on('click', this._onLeaveRoomHandler);

        this._eventBus.on(COOP_EVENT.ROOM_CREATED, (data) => this._showWaiting(data.code));
        this._eventBus.on(COOP_EVENT.ROOM_JOINED, (data) => this._showConnected(data.code));
        this._eventBus.on(COOP_EVENT.GUEST_JOINED, () => this._showConnected(this._coopController.roomCode));
        this._eventBus.on(COOP_EVENT.PARTNER_DISCONNECTED, (data) => this._onPartnerDisconnected(data));
        this._eventBus.on('coop-join-error', (data) => this._showError(data.message));
    }

    _onToggleCoop() {
        this.$lobby.toggleClass('open');
    }

    _onCreateRoom() {
        const airportIcao = AirportController.current.icao;
        this._hideError();
        this._coopController.createRoom(airportIcao);
    }

    _onJoinRoom() {
        const code = $(SELECTORS.DOM_SELECTORS.COOP_JOIN_CODE).val().trim().toUpperCase();

        if (code.length !== 4) {
            this._showError('Please enter a 4-character room code');

            return;
        }

        this._hideError();
        this._coopController.joinRoom(code);
    }

    _onCloseLobby() {
        this.$lobby.removeClass('open');
    }

    _onLeaveRoom() {
        this._coopController.leaveRoom();
        this._resetToMenu();
        this.$coopIcon.removeClass('active');
        this._removeIndicator();
    }

    _showWaiting(code) {
        this.$lobbyMenu.addClass('hidden');
        this.$lobbyWaiting.removeClass('hidden');
        this.$lobbyConnected.addClass('hidden');
        $(SELECTORS.DOM_SELECTORS.COOP_ROOM_CODE).text(code);
        $(SELECTORS.DOM_SELECTORS.COOP_CLOSE_BTN).addClass('hidden');
        $(SELECTORS.DOM_SELECTORS.COOP_LEAVE_BTN).removeClass('hidden');
    }

    _showConnected(code) {
        this.$lobbyMenu.addClass('hidden');
        this.$lobbyWaiting.addClass('hidden');
        this.$lobbyConnected.removeClass('hidden');
        $(SELECTORS.DOM_SELECTORS.COOP_CONNECTED_CODE).text(code);
        $(SELECTORS.DOM_SELECTORS.COOP_CLOSE_BTN).addClass('hidden');
        $(SELECTORS.DOM_SELECTORS.COOP_LEAVE_BTN).removeClass('hidden');
        this.$coopIcon.addClass('active');
        this._showIndicator(code);

        // Auto-close lobby after connection
        setTimeout(() => {
            this.$lobby.removeClass('open');
        }, 1500);
    }

    _showError(message) {
        this.$error.text(message).removeClass('hidden');
    }

    _hideError() {
        this.$error.addClass('hidden').text('');
    }

    _resetToMenu() {
        this.$lobbyMenu.removeClass('hidden');
        this.$lobbyWaiting.addClass('hidden');
        this.$lobbyConnected.addClass('hidden');
        $(SELECTORS.DOM_SELECTORS.COOP_CLOSE_BTN).removeClass('hidden');
        $(SELECTORS.DOM_SELECTORS.COOP_LEAVE_BTN).addClass('hidden');
        $(SELECTORS.DOM_SELECTORS.COOP_JOIN_CODE).val('');
        this._hideError();
    }

    _onPartnerDisconnected(data) {
        const reason = data.reason === 'host-left' ? 'Host left the room' : 'Partner disconnected';

        this._coopController.leaveRoom();
        this._resetToMenu();
        this._showError(reason);
        this.$lobby.addClass('open');
        this.$coopIcon.removeClass('active');
        this._removeIndicator();
    }

    _showIndicator(code) {
        this._removeIndicator();

        const role = this._coopController.isHost ? 'HOST' : 'GUEST';
        const $indicator = $(`<div id="coop-indicator"><span class="coop-indicator-dot"></span>${role} | ${code}</div>`);

        $('body').append($indicator);
    }

    _removeIndicator() {
        $('#coop-indicator').remove();
    }
}
