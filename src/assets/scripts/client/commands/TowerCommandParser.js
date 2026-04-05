import AirportController from '../airport/AirportController';
import EventBus from '../lib/EventBus';
import TimeKeeper from '../engine/TimeKeeper';
import { FLIGHT_PHASE } from '../constants/aircraftConstants';
import { AIRCRAFT_EVENT } from '../constants/eventNames';

/**
 * Parses and executes tower/ground control commands on aircraft.
 *
 * Commands:
 *   pb                    - Pushback approved
 *   taxi <rwy>            - Taxi to runway hold-short (auto-route)
 *   taxi via <twys>       - Taxi via specific taxiways
 *   hs                    - Hold short (stop at next hold point)
 *   hold                  - Hold position (stop immediately)
 *   ct                    - Continue taxi
 *   xr                    - Cross runway cleared
 *   lu                    - Line up and wait
 *   cto                   - Cleared for takeoff
 *
 * @class TowerCommandParser
 */
export default class TowerCommandParser {
    /**
     * Execute a tower command on an aircraft
     *
     * @param aircraft {AircraftModel}
     * @param commandString {string}
     * @return {object} { success: boolean, message: string }
     */
    static executeCommand(aircraft, commandString) {
        if (!aircraft || !aircraft.groundMovementModel) {
            return { success: false, message: 'Aircraft has no ground movement capability' };
        }

        const parts = commandString.trim().toLowerCase().split(/\s+/);
        const cmd = parts[0];

        switch (cmd) {
            case 'pb':
            case 'pushback':
                return TowerCommandParser._executePushback(aircraft);

            case 'taxi':
                return TowerCommandParser._executeTaxi(aircraft, parts.slice(1));

            case 'hold':
            case 'hp':
                return TowerCommandParser._executeHold(aircraft);

            case 'ct':
            case 'continue':
                return TowerCommandParser._executeContinue(aircraft);

            case 'xr':
            case 'cross':
                return TowerCommandParser._executeCrossRunway(aircraft);

            case 'lu':
            case 'lineup':
                return TowerCommandParser._executeLineup(aircraft);

            case 'cto':
            case 'takeoff':
                return TowerCommandParser._executeTakeoff(aircraft);

            default:
                return { success: false, message: `Unknown tower command: ${cmd}` };
        }
    }

    /**
     * Pushback from gate
     * @private
     */
    static _executePushback(aircraft) {
        if (aircraft.flightPhase !== FLIGHT_PHASE.APRON) {
            return { success: false, message: 'Aircraft not at gate' };
        }

        const airport = AirportController.current;
        const graph = airport.taxiwayGraph;
        const gmm = aircraft.groundMovementModel;
        const gateName = gmm.assignedGateName;

        if (!graph || !gateName) {
            return { success: false, message: 'No taxiway graph or gate assignment' };
        }

        // Find the stand node and nearest taxiway node for pushback target
        const standNodeName = `STAND_${gateName}`;
        const standNode = graph.getNode(standNodeName);

        if (!standNode) {
            return { success: false, message: `Stand node ${standNodeName} not found in graph` };
        }

        // Find the first non-stand neighbor as pushback target
        let pushbackTarget = null;

        for (const edge of standNode.edges) {
            if (!edge.to.name.startsWith('STAND_')) {
                pushbackTarget = edge.to;
                break;
            }
        }

        if (!pushbackTarget) {
            return { success: false, message: 'No pushback path from this stand' };
        }

        gmm.setPushbackPath([standNode, pushbackTarget]);
        aircraft.setFlightPhase(FLIGHT_PHASE.PUSHBACK);

        return {
            success: true,
            message: `Pushback approved, pushing to ${pushbackTarget.name}`
        };
    }

    /**
     * Taxi to runway or specific route
     * @private
     */
    static _executeTaxi(aircraft, args) {
        const phase = aircraft.flightPhase;

        if (phase !== FLIGHT_PHASE.PUSHBACK && phase !== FLIGHT_PHASE.TAXI_OUT &&
            phase !== FLIGHT_PHASE.TAXI_IN && phase !== FLIGHT_PHASE.APRON) {
            return { success: false, message: 'Aircraft not in taxi-able phase' };
        }

        const airport = AirportController.current;
        const graph = airport.taxiwayGraph;
        const gmm = aircraft.groundMovementModel;

        if (!graph) {
            return { success: false, message: 'No taxiway graph available' };
        }

        // Determine target: runway hold-short or specific stand
        let targetNodeName = null;

        if (args.length === 0) {
            // Default: taxi to hold-short F (runway 01 threshold area)
            targetNodeName = 'HSF';
        } else if (args[0] === 'via') {
            // TODO: specific routing via taxiways
            return { success: false, message: 'Via routing not yet implemented' };
        } else {
            // Argument could be a runway number or stand name
            const arg = args[0].toUpperCase();

            // Try hold-short nodes
            for (const nodeName in graph.nodes) {
                const node = graph.nodes[nodeName];

                if (node.isHoldShort && nodeName.includes(arg)) {
                    targetNodeName = nodeName;
                    break;
                }
            }

            // Try stand node
            if (!targetNodeName) {
                const standName = `STAND_${arg}`;

                if (graph.getNode(standName)) {
                    targetNodeName = standName;
                }
            }

            // Try matching hold-short by name (HSF, HSD, HS438)
            if (!targetNodeName) {
                const hsName = `HS${arg}`;

                if (graph.getNode(hsName)) {
                    targetNodeName = hsName;
                }
            }

            // Default fallback
            if (!targetNodeName) {
                targetNodeName = 'HSF';
            }
        }

        // Determine starting node: use ground movement model's last reached node if available,
        // otherwise find nearest node to aircraft position
        const groundModel = aircraft.groundMovementModel;
        let startNodeName = null;

        if (groundModel._path && groundModel._path.length > 0) {
            // Use the last node reached in the current/previous path
            const lastIdx = groundModel.hasReachedDestination
                ? groundModel._path.length - 1
                : Math.min(groundModel._currentPathIndex + 1, groundModel._path.length - 1);

            startNodeName = groundModel._path[lastIdx].name;
        }

        if (!startNodeName) {
            const currentPos = aircraft.relativePosition;
            const nearestNode = graph.findNearestNode(currentPos);

            if (!nearestNode) {
                return { success: false, message: 'Cannot determine current position in graph' };
            }

            startNodeName = nearestNode.name;
        }

        const path = graph.findPath(startNodeName, targetNodeName);

        if (!path || path.length < 2) {
            return { success: false, message: `No path from ${startNodeName} to ${targetNodeName}` };
        }

        gmm.setTaxiPath(path);

        if (phase === FLIGHT_PHASE.PUSHBACK || phase === FLIGHT_PHASE.APRON) {
            aircraft.setFlightPhase(FLIGHT_PHASE.TAXI_OUT);
        }

        const routeDesc = graph.getRouteDescription(path);

        return {
            success: true,
            message: `Taxi to ${targetNodeName} via ${routeDesc || 'direct'}`
        };
    }

    /**
     * Hold position
     * @private
     */
    static _executeHold(aircraft) {
        const gmm = aircraft.groundMovementModel;

        gmm._targetSpeedKt = 0;
        gmm._isHoldingShort = true;

        return { success: true, message: 'Hold position' };
    }

    /**
     * Continue taxi
     * @private
     */
    static _executeContinue(aircraft) {
        aircraft.groundMovementModel.continueTaxi();

        return { success: true, message: 'Continue taxi' };
    }

    /**
     * Cross runway cleared
     * @private
     */
    static _executeCrossRunway(aircraft) {
        aircraft.groundMovementModel.grantCrossRunwayClearance();
        aircraft.groundMovementModel.continueTaxi();

        return { success: true, message: 'Cross runway, cleared' };
    }

    /**
     * Line up and wait
     * @private
     */
    static _executeLineup(aircraft) {
        if (aircraft.flightPhase !== FLIGHT_PHASE.HOLD_SHORT &&
            aircraft.flightPhase !== FLIGHT_PHASE.TAXI_OUT) {
            return { success: false, message: 'Aircraft not at hold-short' };
        }

        const airport = AirportController.current;
        const graph = airport.taxiwayGraph;
        const gmm = aircraft.groundMovementModel;

        // Find current node (the hold-short node)
        let currentNodeName = null;

        if (gmm._path && gmm._path.length > 0) {
            const idx = Math.min(gmm._currentPathIndex + 1, gmm._path.length - 1);

            currentNodeName = gmm._path[idx].name;
        }

        if (!currentNodeName) {
            const nearest = graph.findNearestNode(aircraft.relativePosition);

            currentNodeName = nearest ? nearest.name : null;
        }

        // Find the nearest lineup point
        let lineupNode = null;

        for (const nodeName in graph.nodes) {
            const node = graph.nodes[nodeName];

            if (nodeName.startsWith('LINEUP_')) {
                if (!lineupNode) {
                    lineupNode = nodeName;
                } else {
                    // Pick the closest lineup point
                    const pos = aircraft.relativePosition;
                    const dist1 = Math.sqrt(
                        Math.pow(graph.getNode(lineupNode).relativePosition[0] - pos[0], 2) +
                        Math.pow(graph.getNode(lineupNode).relativePosition[1] - pos[1], 2)
                    );
                    const dist2 = Math.sqrt(
                        Math.pow(node.relativePosition[0] - pos[0], 2) +
                        Math.pow(node.relativePosition[1] - pos[1], 2)
                    );

                    if (dist2 < dist1) {
                        lineupNode = nodeName;
                    }
                }
            }
        }

        if (!lineupNode || !currentNodeName) {
            // Fallback: just clear hold and continue
            gmm.grantCrossRunwayClearance();
            gmm.continueTaxi();
            aircraft.setFlightPhase(FLIGHT_PHASE.WAITING);

            return { success: true, message: 'Line up and wait' };
        }

        // Route from current hold-short to lineup point
        const path = graph.findPath(currentNodeName, lineupNode);

        if (path && path.length >= 2) {
            gmm.grantCrossRunwayClearance();
            gmm.setTaxiPath(path);
        } else {
            gmm.grantCrossRunwayClearance();
            gmm.continueTaxi();
        }

        aircraft.setFlightPhase(FLIGHT_PHASE.WAITING);

        return { success: true, message: `Line up and wait, runway via ${lineupNode}` };
    }

    /**
     * Cleared for takeoff
     * @private
     */
    static _executeTakeoff(aircraft) {
        if (aircraft.flightPhase !== FLIGHT_PHASE.WAITING) {
            return { success: false, message: 'Aircraft not lined up on runway' };
        }

        const departureRunway = aircraft.fms.departureRunwayModel;

        if (!departureRunway) {
            return { success: false, message: 'No departure runway assigned' };
        }

        // 1. Disconnect ground movement
        aircraft._groundRelativePosition = null;
        aircraft.groundMovementModel = null;

        // 2. Position aircraft on the runway (GPS coords now match the graph)
        aircraft.moveToRunway(departureRunway);

        // 4. Clear the FMS route
        try {
            aircraft.pilot.clearedAsFiled();
        } catch (e) {
            console.warn(`[Tower] clearedAsFiled warning for ${aircraft.callsign}: ${e.message}`);
        }

        // 5. Mark as tower departure so visibility checks are skipped during takeoff roll
        aircraft.isTowerDeparture = true;

        // 6. Call takeoff() — sets up MCP, triggers TAKEOFF phase, physics handle the rest
        try {
            aircraft.takeoff(departureRunway);
        } catch (e) {
            console.error(`[Tower] takeoff() failed for ${aircraft.callsign}: ${e.message}`);

            return { success: false, message: `Takeoff failed: ${e.message}` };
        }

        return { success: true, message: `Cleared for takeoff runway ${departureRunway.name}` };
    }
}
