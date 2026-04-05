import $ from 'jquery';
import AirportController from '../airport/AirportController';
import DynamicPositionModel from '../base/DynamicPositionModel';
import EventBus from '../lib/EventBus';
import { round } from '../math/core';
import { FLIGHT_PHASE } from '../constants/aircraftConstants';
import { EVENT } from '../constants/eventNames';

// Tower view colors
const TOWER_COLORS = {
    BACKGROUND: '#1a1a2e',
    TAXIWAY_LINE: '#666633',
    TAXIWAY_LABEL: '#999966',
    GATE_AVAILABLE: '#22aa22',
    GATE_OCCUPIED: '#aaaa22',
    GATE_PUSHBACK: '#aa2222',
    HOLD_SHORT_BAR: '#ffff00',
    RUNWAY_SURFACE: '#333344',
    RUNWAY_MARKING: '#ffffff',
    APRON_SURFACE: '#222233',
    AIRCRAFT_PARKED: '#4488ff',
    AIRCRAFT_TAXIING: '#ffaa00',
    AIRCRAFT_HOLDING: '#ff4444',
    DATA_BLOCK_TEXT: '#cccccc',
    DATA_BLOCK_BG: 'rgba(0, 0, 0, 0.6)',
    GRID_LINE: '#111122'
};

// Ground flight phases that are visible in tower mode
const TOWER_VISIBLE_PHASES = [
    FLIGHT_PHASE.APRON,
    FLIGHT_PHASE.PUSHBACK,
    FLIGHT_PHASE.TAXI,
    FLIGHT_PHASE.TAXI_OUT,
    FLIGHT_PHASE.TAXI_IN,
    FLIGHT_PHASE.HOLD_SHORT,
    FLIGHT_PHASE.WAITING,
    FLIGHT_PHASE.TAKEOFF,
    FLIGHT_PHASE.LANDING
];

/**
 * Canvas controller for the tower/ground view.
 *
 * Renders a zoomed-in 2D overhead view of the airport apron showing
 * taxiways, gates, and ground aircraft.
 *
 * Has its own viewport (zoom/pan) independent of the approach canvas.
 *
 * @class TowerCanvasController
 */
export default class TowerCanvasController {
    /**
     * @constructor
     * @param $parentElement {jQuery} parent element to append canvas to
     * @param aircraftController {AircraftController}
     */
    constructor($parentElement, aircraftController) {
        this._$parentElement = $parentElement;
        this._aircraftController = aircraftController;
        this._eventBus = EventBus;

        this._$container = null;
        this._staticCtx = null;
        this._dynamicCtx = null;

        // Viewport state (independent from approach view)
        this._panX = 0;
        this._panY = 0;
        this._scale = 800; // pixels per km — much more zoomed in than approach (~8px/km)
        this._width = 0;
        this._height = 0;

        this._needsStaticRedraw = true;
        this._isVisible = false;

        this._init();
    }

    /**
     * @for TowerCanvasController
     * @method _init
     * @private
     */
    _init() {
        // Append to body instead of #canvases to avoid being hidden when approach mode hides its canvases
        this._$container = $('<div id="tower-canvases" style="display:none; position:absolute; top:0; left:0; width:100%; height:100%; z-index:10;"></div>');

        const staticCanvas = $('<canvas id="tower-static"></canvas>')[0];
        const dynamicCanvas = $('<canvas id="tower-dynamic"></canvas>')[0];

        this._$container.append(staticCanvas);
        this._$container.append(dynamicCanvas);
        $('body').append(this._$container);

        this._staticCtx = staticCanvas.getContext('2d');
        this._dynamicCtx = dynamicCanvas.getContext('2d');

        // Style canvases to overlay
        $(staticCanvas).css({ position: 'absolute', top: 0, left: 0 });
        $(dynamicCanvas).css({ position: 'absolute', top: 0, left: 0, 'z-index': 1 });

        this._resize();

        $(window).on('resize', () => this._resize());
    }

    /**
     * @for TowerCanvasController
     * @method _resize
     * @private
     */
    _resize() {
        this._width = $(window).width();
        this._height = $(window).height();

        const canvases = this._$container.find('canvas');

        canvases.each((i, canvas) => {
            canvas.width = this._width;
            canvas.height = this._height;
        });

        this._centerOnApron();
        this._needsStaticRedraw = true;
    }

    /**
     * Center the viewport on the apron area (average of gate positions).
     * Falls back to airport reference point [0,0] if no gates exist.
     *
     * @for TowerCanvasController
     * @method _centerOnApron
     * @private
     */
    _centerOnApron() {
        const airport = AirportController.current;
        const gates = airport && airport.gateCollection && airport.gateCollection.gates;

        if (!gates || gates.length === 0) {
            this._panX = Math.round(this._width / 2);
            this._panY = Math.round(this._height / 2);

            return;
        }

        // Compute centroid of all gate positions in relative coords
        let sumX = 0;
        let sumY = 0;

        for (const gate of gates) {
            const [x, y] = gate.relativePosition;

            sumX += x;
            sumY += y;
        }

        const avgX = sumX / gates.length;
        const avgY = sumY / gates.length;

        // Pan so centroid maps to screen center
        // _toCanvas: canvasX = x * scale + panX, so panX = screenCenterX - avgX * scale
        this._panX = Math.round(this._width / 2 - avgX * this._scale);
        this._panY = Math.round(this._height / 2 - avgY * -this._scale);
    }

    /**
     * Show the tower canvases
     *
     * @for TowerCanvasController
     * @method show
     */
    show() {
        this._$container.show();
        this._isVisible = true;
        this._needsStaticRedraw = true;
    }

    /**
     * Hide the tower canvases
     *
     * @for TowerCanvasController
     * @method hide
     */
    hide() {
        this._$container.hide();
        this._isVisible = false;
    }

    /**
     * Main render method — called each frame when tower mode is active
     *
     * @for TowerCanvasController
     * @method canvasUpdatePost
     */
    canvasUpdatePost() {
        if (!this._isVisible) {
            return;
        }

        if (this._needsStaticRedraw) {
            this._drawStaticLayer();
            this._needsStaticRedraw = false;
        }

        this._drawDynamicLayer();
    }

    // --- Coordinate transforms (tower-specific viewport) ---

    /**
     * Convert relative position [x, y] (km from airport) to canvas pixels
     *
     * @for TowerCanvasController
     * @method _toCanvas
     * @param relativePosition {array} [x, y]
     * @return {array} [canvasX, canvasY]
     * @private
     */
    _toCanvas(relativePosition) {
        const [x, y] = relativePosition;

        return [
            round(x * this._scale + this._panX),
            round(y * -this._scale + this._panY)
        ];
    }

    // --- Static layer: taxiways, gates, apron geometry ---

    /**
     * @for TowerCanvasController
     * @method _drawStaticLayer
     * @private
     */
    _drawStaticLayer() {
        const cc = this._staticCtx;

        cc.clearRect(0, 0, this._width, this._height);

        // Background
        cc.fillStyle = TOWER_COLORS.BACKGROUND;
        cc.fillRect(0, 0, this._width, this._height);

        const airport = AirportController.current;

        if (!airport || !airport.hasGroundData()) {
            this._drawNoDataMessage(cc);

            return;
        }

        this._drawApronGeometry(cc, airport);
        this._drawTaxiwayNetwork(cc, airport);
        this._drawRunways(cc, airport);
        this._drawGates(cc, airport);
    }

    /**
     * @for TowerCanvasController
     * @method _drawNoDataMessage
     * @private
     */
    _drawNoDataMessage(cc) {
        cc.fillStyle = TOWER_COLORS.DATA_BLOCK_TEXT;
        cc.font = '20px monospace';
        cc.textAlign = 'center';
        cc.fillText('No ground data available for this airport', this._width / 2, this._height / 2);
    }

    /**
     * Draw apron pavement and geometry
     *
     * @for TowerCanvasController
     * @method _drawApronGeometry
     * @private
     */
    _drawApronGeometry(cc, airport) {
        const apronGeometry = airport.groundData.apronGeometry;

        if (!apronGeometry) {
            return;
        }

        for (const layer of apronGeometry) {
            if (layer.type === 'polygon' && layer.coords) {
                this._drawPolygon(cc, layer.coords, TOWER_COLORS.APRON_SURFACE, airport);
            } else if (layer.type === 'lines' && layer.lines) {
                this._drawLineSegments(cc, layer.lines, TOWER_COLORS.TAXIWAY_LINE, 1, airport);
            }
        }
    }

    /**
     * Draw a polygon from GPS coordinates
     *
     * @for TowerCanvasController
     * @method _drawPolygon
     * @private
     */
    _drawPolygon(cc, coords, fillColor, airport) {
        if (coords.length < 3) {
            return;
        }

        cc.beginPath();
        cc.fillStyle = fillColor;

        for (let i = 0; i < coords.length; i++) {
            const relPos = this._gpsToRelative(coords[i], airport);
            const [cx, cy] = this._toCanvas(relPos);

            if (i === 0) {
                cc.moveTo(cx, cy);
            } else {
                cc.lineTo(cx, cy);
            }
        }

        cc.closePath();
        cc.fill();
    }

    /**
     * Draw line segments from GPS coordinate pairs
     *
     * @for TowerCanvasController
     * @method _drawLineSegments
     * @private
     */
    _drawLineSegments(cc, lines, strokeColor, lineWidth, airport) {
        cc.strokeStyle = strokeColor;
        cc.lineWidth = lineWidth;

        for (const line of lines) {
            const [lat1, lon1, lat2, lon2] = line;
            const rel1 = this._gpsToRelative([lat1, lon1], airport);
            const rel2 = this._gpsToRelative([lat2, lon2], airport);
            const [x1, y1] = this._toCanvas(rel1);
            const [x2, y2] = this._toCanvas(rel2);

            cc.beginPath();
            cc.moveTo(x1, y1);
            cc.lineTo(x2, y2);
            cc.stroke();
        }
    }

    /**
     * Draw taxiway network from the graph
     *
     * @for TowerCanvasController
     * @method _drawTaxiwayNetwork
     * @private
     */
    _drawTaxiwayNetwork(cc, airport) {
        const graph = airport.taxiwayGraph;

        if (!graph) {
            return;
        }

        // Draw edges as taxiway centerlines
        cc.strokeStyle = TOWER_COLORS.TAXIWAY_LINE;
        cc.lineWidth = 3;

        for (const edge of graph.edges) {
            if (!edge.bidirectional || edge.from.name < edge.to.name) {
                // Draw each bidirectional edge only once
                const [x1, y1] = this._toCanvas(edge.from.relativePosition);
                const [x2, y2] = this._toCanvas(edge.to.relativePosition);

                cc.beginPath();
                cc.moveTo(x1, y1);
                cc.lineTo(x2, y2);
                cc.stroke();
            }
        }

        // Draw hold-short bars
        cc.strokeStyle = TOWER_COLORS.HOLD_SHORT_BAR;
        cc.lineWidth = 2;
        cc.setLineDash([4, 4]);

        for (const nodeName in graph.nodes) {
            const node = graph.nodes[nodeName];

            if (node.isHoldShort) {
                const [cx, cy] = this._toCanvas(node.relativePosition);

                cc.beginPath();
                cc.moveTo(cx - 8, cy - 8);
                cc.lineTo(cx + 8, cy + 8);
                cc.stroke();
            }
        }

        cc.setLineDash([]);

        // Draw taxiway labels at node positions
        cc.fillStyle = TOWER_COLORS.TAXIWAY_LABEL;
        cc.font = '10px monospace';
        cc.textAlign = 'center';

        const drawnLabels = new Set();

        const INTERNAL_EDGE_NAMES = new Set(['junction', 'apron', 'INT']);

        for (const edge of graph.edges) {
            if (edge.name && !drawnLabels.has(edge.name) && !INTERNAL_EDGE_NAMES.has(edge.name)) {
                const midX = (edge.from.relativePosition[0] + edge.to.relativePosition[0]) / 2;
                const midY = (edge.from.relativePosition[1] + edge.to.relativePosition[1]) / 2;
                const [cx, cy] = this._toCanvas([midX, midY]);

                cc.fillText(edge.name, cx, cy - 8);
                drawnLabels.add(edge.name);
            }
        }
    }

    /**
     * Draw runways
     *
     * @for TowerCanvasController
     * @method _drawRunways
     * @private
     */
    _drawRunways(cc, airport) {
        const graph = airport.taxiwayGraph;

        // Prefer drawing runway from graph's runway_threshold nodes if available
        // This ensures the runway aligns with the hand-authored taxiway graph
        if (graph) {
            const rwyNodes = [];

            for (const nodeName in graph.nodes) {
                const node = graph.nodes[nodeName];

                // Collect runway edges to draw the runway strip
                for (const edge of node.edges) {
                    if (edge.name === 'runway' && node.name < edge.to.name) {
                        rwyNodes.push([node, edge.to]);
                    }
                }
            }

            if (rwyNodes.length > 0) {
                cc.strokeStyle = TOWER_COLORS.RUNWAY_MARKING;
                cc.lineWidth = 8;

                for (const [nodeA, nodeB] of rwyNodes) {
                    const [x0, y0] = this._toCanvas(nodeA.relativePosition);
                    const [x1, y1] = this._toCanvas(nodeB.relativePosition);

                    cc.beginPath();
                    cc.moveTo(x0, y0);
                    cc.lineTo(x1, y1);
                    cc.stroke();
                }

                // Draw runway labels at threshold nodes
                cc.fillStyle = TOWER_COLORS.RUNWAY_MARKING;
                cc.font = '12px monospace';
                cc.textAlign = 'center';

                for (const nodeName in graph.nodes) {
                    const node = graph.nodes[nodeName];

                    if (nodeName.startsWith('RWY') && nodeName.includes('THR')) {
                        const [cx, cy] = this._toCanvas(node.relativePosition);

                        cc.fillText(node.runway || nodeName, cx, cy - 12);
                    }
                }

                return;
            }
        }

        // Fallback to airport runway model
        if (!airport.runways) {
            return;
        }

        cc.strokeStyle = TOWER_COLORS.RUNWAY_MARKING;
        cc.lineWidth = 8;

        for (const runwayPair of airport.runways) {
            if (runwayPair.length >= 2) {
                const rwy0 = runwayPair[0];
                const rwy1 = runwayPair[1];
                const [x0, y0] = this._toCanvas(rwy0.relativePosition);
                const [x1, y1] = this._toCanvas(rwy1.relativePosition);

                cc.beginPath();
                cc.moveTo(x0, y0);
                cc.lineTo(x1, y1);
                cc.stroke();

                cc.fillStyle = TOWER_COLORS.RUNWAY_MARKING;
                cc.font = '12px monospace';
                cc.textAlign = 'center';
                cc.fillText(rwy0.name, x0, y0 - 12);
                cc.fillText(rwy1.name, x1, y1 + 20);
            }
        }
    }

    /**
     * Draw gates with status colors
     *
     * @for TowerCanvasController
     * @method _drawGates
     * @private
     */
    _drawGates(cc, airport) {
        const gates = airport.gateCollection;

        if (!gates) {
            return;
        }

        cc.font = '9px monospace';
        cc.textAlign = 'center';

        for (const gate of gates.gates) {
            const [cx, cy] = this._toCanvas(gate.relativePosition);

            // Gate color by status
            if (gate.isPushbackInProgress) {
                cc.fillStyle = TOWER_COLORS.GATE_PUSHBACK;
            } else if (gate.isOccupied) {
                cc.fillStyle = TOWER_COLORS.GATE_OCCUPIED;
            } else {
                cc.fillStyle = TOWER_COLORS.GATE_AVAILABLE;
            }

            // Draw gate as a small rectangle
            const size = 6;

            cc.fillRect(cx - size / 2, cy - size / 2, size, size);

            // Gate label
            cc.fillStyle = TOWER_COLORS.DATA_BLOCK_TEXT;
            cc.fillText(gate.name, cx, cy - 8);
        }
    }

    // --- Dynamic layer: aircraft, data blocks ---

    /**
     * @for TowerCanvasController
     * @method _drawDynamicLayer
     * @private
     */
    _drawDynamicLayer() {
        const cc = this._dynamicCtx;

        cc.clearRect(0, 0, this._width, this._height);

        const aircraftList = this._aircraftController.aircraft && this._aircraftController.aircraft.list;

        if (!aircraftList || !aircraftList.length) {
            this._drawModeIndicator(cc);

            return;
        }

        for (let i = 0; i < aircraftList.length; i++) {
            const aircraft = aircraftList[i];

            if (!this._isVisibleInTowerMode(aircraft)) {
                continue;
            }

            this._drawGroundAircraft(cc, aircraft);
            this._drawGroundDataBlock(cc, aircraft);
        }

        // Draw mode indicator
        this._drawModeIndicator(cc);
    }

    /**
     * Check if an aircraft should be visible in tower mode
     *
     * @for TowerCanvasController
     * @method _isVisibleInTowerMode
     * @param aircraft {AircraftModel}
     * @return {boolean}
     * @private
     */
    _isVisibleInTowerMode(aircraft) {
        return TOWER_VISIBLE_PHASES.indexOf(aircraft.flightPhase) !== -1;
    }

    /**
     * Draw a single ground aircraft
     *
     * @for TowerCanvasController
     * @method _drawGroundAircraft
     * @private
     */
    _drawGroundAircraft(cc, aircraft) {
        const pos = aircraft.relativePosition;

        if (!pos) {
            return;
        }

        const [cx, cy] = this._toCanvas(pos);
        const heading = aircraft.heading || 0;

        // Color by phase
        switch (aircraft.flightPhase) {
            case FLIGHT_PHASE.APRON:
                cc.fillStyle = TOWER_COLORS.AIRCRAFT_PARKED;
                break;
            case FLIGHT_PHASE.HOLD_SHORT:
            case FLIGHT_PHASE.WAITING:
                cc.fillStyle = TOWER_COLORS.AIRCRAFT_HOLDING;
                break;
            default:
                cc.fillStyle = TOWER_COLORS.AIRCRAFT_TAXIING;
                break;
        }

        // Draw aircraft as a rotated triangle
        cc.save();
        cc.translate(cx, cy);
        cc.rotate(-heading);

        cc.beginPath();
        cc.moveTo(0, -8);
        cc.lineTo(-5, 6);
        cc.lineTo(5, 6);
        cc.closePath();
        cc.fill();

        cc.restore();
    }

    /**
     * Draw data block for a ground aircraft
     *
     * @for TowerCanvasController
     * @method _drawGroundDataBlock
     * @private
     */
    _drawGroundDataBlock(cc, aircraft) {
        const pos = aircraft.relativePosition;

        if (!pos) {
            return;
        }

        const [cx, cy] = this._toCanvas(pos);
        const callsign = aircraft.callsign || '';
        const type = aircraft.model && aircraft.model.icao ? aircraft.model.icao : '';
        const label = `${callsign} ${type}`;

        cc.font = '10px monospace';
        const textWidth = cc.measureText(label).width;

        // Background
        cc.fillStyle = TOWER_COLORS.DATA_BLOCK_BG;
        cc.fillRect(cx + 10, cy - 16, textWidth + 6, 14);

        // Text
        cc.fillStyle = TOWER_COLORS.DATA_BLOCK_TEXT;
        cc.textAlign = 'left';
        cc.fillText(label, cx + 13, cy - 5);

        // Leader line
        cc.strokeStyle = TOWER_COLORS.DATA_BLOCK_TEXT;
        cc.lineWidth = 1;
        cc.beginPath();
        cc.moveTo(cx, cy);
        cc.lineTo(cx + 10, cy - 9);
        cc.stroke();
    }

    /**
     * Draw mode indicator in corner
     *
     * @for TowerCanvasController
     * @method _drawModeIndicator
     * @private
     */
    _drawModeIndicator(cc) {
        cc.fillStyle = 'rgba(0, 0, 0, 0.5)';
        cc.fillRect(10, 10, 130, 28);
        cc.fillStyle = '#00ff88';
        cc.font = '14px monospace';
        cc.textAlign = 'left';
        cc.fillText('TOWER / GROUND', 18, 30);
    }

    // --- Utility ---

    /**
     * Convert GPS [lat, lon] to relative position [x, y] km from airport center.
     * Uses the same projection as StaticPositionModel (including magnetic north rotation)
     * so that apron geometry aligns with taxiway nodes and gates.
     *
     * @for TowerCanvasController
     * @method _gpsToRelative
     * @param gps {array} [lat, lon]
     * @param airport {AirportModel}
     * @return {array} [x, y] km
     * @private
     */
    _gpsToRelative(gps, airport) {
        return DynamicPositionModel.calculateRelativePosition(
            gps,
            airport.positionModel,
            airport.magneticNorth
        );
    }

    /**
     * Handle zoom in
     *
     * @for TowerCanvasController
     * @method zoomIn
     */
    zoomIn() {
        this._scale = Math.min(this._scale * 1.2, 5000);
        this._needsStaticRedraw = true;
    }

    /**
     * Handle zoom out
     *
     * @for TowerCanvasController
     * @method zoomOut
     */
    zoomOut() {
        this._scale = Math.max(this._scale / 1.2, 100);
        this._needsStaticRedraw = true;
    }

    /**
     * Handle pan
     *
     * @for TowerCanvasController
     * @method updatePan
     * @param dx {number}
     * @param dy {number}
     */
    updatePan(dx, dy) {
        this._panX += dx;
        this._panY += dy;
        this._needsStaticRedraw = true;
    }
}
