import StaticPositionModel from '../../base/StaticPositionModel';
import { distance2d } from '../../math/distance';

/**
 * A node in the taxiway graph
 *
 * @class TaxiwayNode
 */
class TaxiwayNode {
    /**
     * @constructor
     * @param name {string}
     * @param gpsPosition {array} [lat, lon]
     * @param airportPositionModel {StaticPositionModel}
     * @param magneticNorth {number}
     */
    constructor(name, gpsPosition, airportPositionModel, magneticNorth) {
        this.name = name;
        this.positionModel = new StaticPositionModel(
            gpsPosition,
            airportPositionModel,
            magneticNorth
        );
        this.edges = [];
        this.isHoldShort = false;
        this.runway = null;
    }

    /**
     * @for TaxiwayNode
     * @property relativePosition
     * @type {array}
     */
    get relativePosition() {
        return this.positionModel.relativePosition;
    }
}

/**
 * An edge in the taxiway graph connecting two nodes
 *
 * @class TaxiwayEdge
 */
class TaxiwayEdge {
    /**
     * @constructor
     * @param fromNode {TaxiwayNode}
     * @param toNode {TaxiwayNode}
     * @param name {string} taxiway name (e.g., "B", "D")
     * @param bidirectional {boolean}
     */
    constructor(fromNode, toNode, name, bidirectional = true) {
        this.from = fromNode;
        this.to = toNode;
        this.name = name;
        this.bidirectional = bidirectional;

        const fromPos = fromNode.relativePosition;
        const toPos = toNode.relativePosition;

        this.distance = distance2d(fromPos, toPos);
    }
}

/**
 * Graph representation of the airport taxiway network.
 * Provides A* pathfinding between nodes.
 *
 * @class TaxiwayGraph
 */
export default class TaxiwayGraph {
    /**
     * @constructor
     * @param taxiwayData {object} { nodes: {name: [lat,lon]}, edges: [{from, to, name, bidirectional}] }
     * @param airportPositionModel {StaticPositionModel}
     * @param magneticNorth {number}
     */
    constructor(taxiwayData, airportPositionModel, magneticNorth) {
        this._nodes = {};
        this._edges = [];

        this._init(taxiwayData, airportPositionModel, magneticNorth);
    }

    /**
     * @for TaxiwayGraph
     * @property nodes
     * @type {object}
     */
    get nodes() {
        return this._nodes;
    }

    /**
     * @for TaxiwayGraph
     * @property edges
     * @type {array<TaxiwayEdge>}
     */
    get edges() {
        return this._edges;
    }

    /**
     * @for TaxiwayGraph
     * @method _init
     * @param taxiwayData {object}
     * @param airportPositionModel {StaticPositionModel}
     * @param magneticNorth {number}
     * @private
     */
    _init(taxiwayData, airportPositionModel, magneticNorth) {
        if (!taxiwayData) {
            return;
        }

        // Build nodes
        for (const nodeName in taxiwayData.nodes) {
            const gps = taxiwayData.nodes[nodeName];

            this._nodes[nodeName] = new TaxiwayNode(nodeName, gps, airportPositionModel, magneticNorth);
        }

        // Build edges
        for (const edgeData of taxiwayData.edges) {
            const fromNode = this._nodes[edgeData.from];
            const toNode = this._nodes[edgeData.to];

            if (!fromNode || !toNode) {
                console.warn(`TaxiwayGraph: skipping edge ${edgeData.from} -> ${edgeData.to}, node not found`);

                continue;
            }

            const edge = new TaxiwayEdge(fromNode, toNode, edgeData.name, edgeData.bidirectional !== false);

            this._edges.push(edge);
            fromNode.edges.push(edge);

            if (edge.bidirectional) {
                const reverseEdge = new TaxiwayEdge(toNode, fromNode, edgeData.name, true);

                this._edges.push(reverseEdge);
                toNode.edges.push(reverseEdge);
            }

            // Mark hold-short nodes from edge data (legacy)
            if (edgeData.isHoldShort) {
                toNode.isHoldShort = true;
                toNode.runway = edgeData.runway || null;
            }
        }

        // Mark hold-short nodes from holdShortNodes section
        if (taxiwayData.holdShortNodes) {
            for (const nodeName in taxiwayData.holdShortNodes) {
                const node = this._nodes[nodeName];

                if (node) {
                    node.isHoldShort = true;
                    node.runway = taxiwayData.holdShortNodes[nodeName];
                }
            }
        }
    }

    /**
     * Get a node by name
     *
     * @for TaxiwayGraph
     * @method getNode
     * @param name {string}
     * @return {TaxiwayNode|undefined}
     */
    getNode(name) {
        return this._nodes[name];
    }

    /**
     * Find the nearest node to a given relative position
     *
     * @for TaxiwayGraph
     * @method findNearestNode
     * @param relativePosition {array} [x, y] in km
     * @return {TaxiwayNode|null}
     */
    findNearestNode(relativePosition) {
        let nearest = null;
        let minDist = Infinity;

        for (const name in this._nodes) {
            const node = this._nodes[name];
            const dist = distance2d(relativePosition, node.relativePosition);

            if (dist < minDist) {
                minDist = dist;
                nearest = node;
            }
        }

        return nearest;
    }

    /**
     * Find the hold-short node for a given runway
     *
     * @for TaxiwayGraph
     * @method getHoldShortNode
     * @param runwayName {string}
     * @return {TaxiwayNode|null}
     */
    getHoldShortNode(runwayName) {
        for (const name in this._nodes) {
            const node = this._nodes[name];

            if (node.isHoldShort && node.runway === runwayName) {
                return node;
            }
        }

        return null;
    }

    /**
     * A* pathfinding from one node to another
     *
     * @for TaxiwayGraph
     * @method findPath
     * @param fromNodeName {string}
     * @param toNodeName {string}
     * @return {array<TaxiwayNode>|null} ordered list of nodes, or null if no path
     */
    findPath(fromNodeName, toNodeName) {
        const startNode = this._nodes[fromNodeName];
        const goalNode = this._nodes[toNodeName];

        if (!startNode || !goalNode) {
            return null;
        }

        if (startNode === goalNode) {
            return [startNode];
        }

        const openSet = new Set([startNode]);
        const cameFrom = new Map();
        const gScore = new Map();
        const fScore = new Map();

        gScore.set(startNode, 0);
        fScore.set(startNode, this._heuristic(startNode, goalNode));

        while (openSet.size > 0) {
            // Find node in openSet with lowest fScore
            let current = null;
            let lowestF = Infinity;

            for (const node of openSet) {
                const f = fScore.has(node) ? fScore.get(node) : Infinity;

                if (f < lowestF) {
                    lowestF = f;
                    current = node;
                }
            }

            if (current === goalNode) {
                return this._reconstructPath(cameFrom, current);
            }

            openSet.delete(current);

            for (const edge of current.edges) {
                const neighbor = edge.to;
                const currentG = gScore.has(current) ? gScore.get(current) : Infinity;
                const tentativeG = currentG + edge.distance;
                const neighborG = gScore.has(neighbor) ? gScore.get(neighbor) : Infinity;

                if (tentativeG < neighborG) {
                    cameFrom.set(neighbor, { node: current, edge });
                    gScore.set(neighbor, tentativeG);
                    fScore.set(neighbor, tentativeG + this._heuristic(neighbor, goalNode));

                    if (!openSet.has(neighbor)) {
                        openSet.add(neighbor);
                    }
                }
            }
        }

        return null;
    }

    /**
     * Get the route description (taxiway names) for a path
     *
     * @for TaxiwayGraph
     * @method getRouteDescription
     * @param path {array<TaxiwayNode>}
     * @return {string} e.g., "B, D, E"
     */
    getRouteDescription(path) {
        if (!path || path.length < 2) {
            return '';
        }

        const taxiwayNames = [];
        let lastTaxiway = null;

        // Walk through the path and collect taxiway names from edges
        for (let i = 0; i < path.length - 1; i++) {
            const currentNode = path[i];
            const nextNode = path[i + 1];

            const edge = currentNode.edges.find((e) => e.to === nextNode);

            if (edge && edge.name !== lastTaxiway) {
                taxiwayNames.push(edge.name);
                lastTaxiway = edge.name;
            }
        }

        return taxiwayNames.join(', ');
    }

    /**
     * Heuristic function for A* — straight-line distance
     *
     * @for TaxiwayGraph
     * @method _heuristic
     * @param nodeA {TaxiwayNode}
     * @param nodeB {TaxiwayNode}
     * @return {number}
     * @private
     */
    _heuristic(nodeA, nodeB) {
        return distance2d(nodeA.relativePosition, nodeB.relativePosition);
    }

    /**
     * Reconstruct path from A* cameFrom map
     *
     * @for TaxiwayGraph
     * @method _reconstructPath
     * @param cameFrom {Map}
     * @param current {TaxiwayNode}
     * @return {array<TaxiwayNode>}
     * @private
     */
    _reconstructPath(cameFrom, current) {
        const path = [current];

        while (cameFrom.has(current)) {
            current = cameFrom.get(current).node;
            path.unshift(current);
        }

        return path;
    }
}
