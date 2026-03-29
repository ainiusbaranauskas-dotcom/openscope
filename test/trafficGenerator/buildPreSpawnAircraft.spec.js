import ava from 'ava';
import sinon from 'sinon';
import _floor from 'lodash/floor';
import RouteModel from '../../src/assets/scripts/client/aircraft/FlightManagementSystem/RouteModel';
import {
    _calculateOffsetsToEachWaypointInRoute,
    _calculateAltitudeOffsets,
    _calculateAltitudeAtOffset,
    _calculateIdealSpawnAltitudeAtOffset,
    buildPreSpawnAircraft
} from '../../src/assets/scripts/client/trafficGenerator/buildPreSpawnAircraft';
import { airportModelFixture } from '../fixtures/airportFixtures';
import {
    createNavigationLibraryFixture,
    resetNavigationLibraryFixture
} from '../fixtures/navigationLibraryFixtures';
import { ARRIVAL_PATTERN_MOCK } from './_mocks/spawnPatternMocks';

let sandbox;

ava.beforeEach(() => {
    sandbox = sinon.createSandbox();
    createNavigationLibraryFixture();
});

ava.afterEach(() => {
    sandbox.restore();
    resetNavigationLibraryFixture();
});

ava('_calculateOffsetsToEachWaypointInRoute() returns array of distances between waypoints, ignoring vector waypoints', (t) => {
    const routeModel = new RouteModel('PGS..MLF..OAL..KEPEC..BOACH..CHIPZ..#340');
    const waypointModelList = routeModel.waypoints;
    const expectedResult = [
        0,
        166.20954056162077,
        391.7193092657528,
        553.2190261558699,
        575.1449276267966,
        613.1666698503408
    ];
    const result = _calculateOffsetsToEachWaypointInRoute(waypointModelList);

    t.deepEqual(result, expectedResult);
});

ava('_calculateAltitudeOffsets returns an array of the altitudes required and their ATDs', (t) => {
    const routeModel = new RouteModel('PGS.TYSSN4.KLAS01L');
    const waypointModelList = routeModel.waypoints;
    const waypointOffsetMap = _calculateOffsetsToEachWaypointInRoute(waypointModelList);
    const expectedResult = [
        [18.958610430426404, 19000],
        [41.52033243401482, 12000],
        [60.46996764011041, 10000],
        [70.68723901280046, 8000]
    ];
    const result = _calculateAltitudeOffsets(waypointModelList, waypointOffsetMap);

    t.deepEqual(result, expectedResult);
});

ava('_calculateAltitudeAtOffset throws when there are no altitude restrictions ahead nor behind', (t) => {
    const altitudesAtOffsets = [];
    const offsetDistanceMock = 25;

    t.throws(() => _calculateAltitudeAtOffset(altitudesAtOffsets, offsetDistanceMock));
});

ava('_calculateAltitudeAtOffset returns altitude of previous restriction when there are restrictions behind but none ahead', (t) => {
    const altitudesAtOffsets = [
        [18.958610430426404, 19000],
        [41.52033243401482, 12000],
        [60.46996764011041, 10000],
        [70.68723901280046, 8000]
    ];
    const offsetDistanceMock = 75;
    const expectedResult = 8000;
    const result = _calculateAltitudeAtOffset(altitudesAtOffsets, offsetDistanceMock);

    t.true(result === expectedResult);
});

ava('_calculateAltitudeAtOffset returns altitude of next restriction when there are restrictions ahead but none behind', (t) => {
    const altitudesAtOffsets = [
        [18.958610430426404, 19000],
        [41.52033243401482, 12000],
        [60.46996764011041, 10000],
        [70.68723901280046, 8000]
    ];
    const offsetDistanceMock = 15;
    const expectedResult = 19000;
    const result = _calculateAltitudeAtOffset(altitudesAtOffsets, offsetDistanceMock);

    t.true(result === expectedResult);
});

ava('_calculateAltitudeAtOffset returns the interpolated altitude along the optimal descent path', (t) => {
    const altitudesAtOffsets = [
        [18.958610430426404, 19000],
        [41.52033243401482, 12000]
    ];
    const offsetDistanceMock = (18.958610430426404 + 41.52033243401482) / 2;
    const expectedResult = _floor((19000 + 12000) / 2, -3);
    const result = _calculateAltitudeAtOffset(altitudesAtOffsets, offsetDistanceMock);

    t.true(result === expectedResult);
});

ava('_calculateIdealSpawnAltitudeAtOffset() returns cruise altitude when before TOD and no restrictions exist', (t) => {
    const altitudesAtOffsets = [];
    const spawnAltitudeMock = 23000;
    const airspaceCeilingMock = 11000;
    const spawnSpeedMock = 360;
    const totalDistanceMock = 60;
    // TOD = 60 - (23000-11000)/300 = 60 - 40 = 20; offset 18 < 20 → before TOD
    const offsetDistanceMock = 18;
    const expectedResult = 23000;
    const result = _calculateIdealSpawnAltitudeAtOffset(altitudesAtOffsets, offsetDistanceMock, spawnSpeedMock, spawnAltitudeMock, totalDistanceMock, airspaceCeilingMock);

    t.true(expectedResult === result);
});

ava('_calculateIdealSpawnAltitudeAtOffset() returns descent profile altitude when past TOD', (t) => {
    const altitudesAtOffsets = [
        [18.958610430426404, 19000],
        [41.52033243401482, 12000],
        [60.46996764011041, 10000],
        [70.68723901280046, 8000]
    ];
    const spawnAltitudeMock = 23000;
    const airspaceCeilingMock = 11000;
    const spawnSpeedMock = 360;
    const totalDistanceMock = 85;
    // TOD = 18.959 - (23000-19000)/300 = 18.959 - 13.333 = 5.625
    // offset 6.5 > 5.625 → past TOD
    // alt = 23000 - (6.5 - 5.625) * 300 = 23000 - 262.5 = 22737.5 → floor to 22000
    const offsetDistanceMock = 6.5;
    const expectedResult = 22000;
    const result = _calculateIdealSpawnAltitudeAtOffset(altitudesAtOffsets, offsetDistanceMock, spawnSpeedMock, spawnAltitudeMock, totalDistanceMock, airspaceCeilingMock);

    t.true(expectedResult === result);
});

ava('_calculateIdealSpawnAltitudeAtOffset() continues descent profile past first restriction, respecting FL150 floor', (t) => {
    const altitudesAtOffsets = [
        [18.958610430426404, 19000],
        [41.52033243401482, 12000],
        [60.46996764011041, 10000],
        [70.68723901280046, 8000]
    ];
    const spawnAltitudeMock = 23000;
    const airspaceCeilingMock = 11000;
    const spawnSpeedMock = 360;
    const totalDistanceMock = 85;
    // TOD = 5.625; offset 25 → past TOD by 19.375nm
    // alt = 23000 - 19.375 * 300 = 23000 - 5812.5 = 17187.5 → floor to 17000
    const offsetDistanceMock = 25;
    const expectedResult = 17000;
    const result = _calculateIdealSpawnAltitudeAtOffset(altitudesAtOffsets, offsetDistanceMock, spawnSpeedMock, spawnAltitudeMock, totalDistanceMock, airspaceCeilingMock);

    t.true(expectedResult === result);
});

ava('_calculateIdealSpawnAltitudeAtOffset() clamps at FL150 floor for deep-route spawn points', (t) => {
    const altitudesAtOffsets = [
        [18.958610430426404, 19000],
        [41.52033243401482, 12000],
        [60.46996764011041, 10000],
        [70.68723901280046, 8000]
    ];
    const spawnAltitudeMock = 23000;
    const airspaceCeilingMock = 11000;
    const spawnSpeedMock = 360;
    const totalDistanceMock = 85;
    // TOD = 5.625; offset 50 → past TOD by 44.375nm
    // alt = 23000 - 44.375 * 300 = 23000 - 13312.5 = 9687.5 → clamped to FL150
    const offsetDistanceMock = 50;
    const expectedResult = 15000;
    const result = _calculateIdealSpawnAltitudeAtOffset(altitudesAtOffsets, offsetDistanceMock, spawnSpeedMock, spawnAltitudeMock, totalDistanceMock, airspaceCeilingMock);

    t.true(expectedResult === result);
});

ava('_calculateIdealSpawnAltitudeAtOffset() applies FL150 floor regardless of spawn altitude', (t) => {
    const altitudesAtOffsets = [
        [10, 11000],
        [25, 8000]
    ];
    const spawnAltitudeMock = 28000;
    const airspaceCeilingMock = 11000;
    const spawnSpeedMock = 280;
    const totalDistanceMock = 80;
    // TOD = 10 - (28000-11000)/300 = 10 - 56.667 = -46.667
    // offset 70 → past TOD by 116.667nm
    // alt = 28000 - 116.667 * 300 = 28000 - 35000 = -7000 → clamped to FL150
    const offsetDistanceMock = 70;
    const expectedResult = 15000;
    const result = _calculateIdealSpawnAltitudeAtOffset(altitudesAtOffsets, offsetDistanceMock, spawnSpeedMock, spawnAltitudeMock, totalDistanceMock, airspaceCeilingMock);

    t.true(expectedResult === result);
});

ava('_calculateIdealSpawnAltitudeAtOffset() handles array spawn altitude and returns cruise when before TOD', (t) => {
    const altitudesAtOffsets = [
        [18.958610430426404, 19000],
        [41.52033243401482, 12000],
        [60.46996764011041, 10000],
        [70.68723901280046, 8000]
    ];
    const spawnAltitudeMock = [23000, 23456];
    const airspaceCeilingMock = 11000;
    const spawnSpeedMock = 250;
    const totalDistanceMock = 85;
    // offset 0 is well before TOD for any spawnAlt in [23000, 23456]
    const offsetDistanceMock = 0;
    const result = _calculateIdealSpawnAltitudeAtOffset(altitudesAtOffsets, offsetDistanceMock, spawnSpeedMock, spawnAltitudeMock, totalDistanceMock, airspaceCeilingMock);

    // Result should be the resolved spawn altitude (between 23000 and 23456, rounded to nearest 1000)
    t.true(result >= 23000 && result <= 24000);
});

ava('buildPreSpawnAircraft() throws when called with missing parameters', (t) => {
    const expectedMessage = /Invalid parameter\(s\) passed to buildPreSpawnAircraft\. Expected spawnPatternJson and currentAirport to be defined, but received .*/;

    t.throws(() => buildPreSpawnAircraft(), {
        instanceOf: TypeError,
        message: expectedMessage
    });
    t.throws(() => buildPreSpawnAircraft(ARRIVAL_PATTERN_MOCK), {
        instanceOf: TypeError,
        message: expectedMessage
    });
    t.throws(() => buildPreSpawnAircraft(airportModelFixture), {
        instanceOf: TypeError,
        message: expectedMessage
    });
    t.throws(() => buildPreSpawnAircraft(null, airportModelFixture), {
        instanceOf: TypeError,
        message: expectedMessage
    });
    t.throws(() => buildPreSpawnAircraft(ARRIVAL_PATTERN_MOCK, null), {
        instanceOf: TypeError,
        message: expectedMessage
    });
});

ava('buildPreSpawnAircraft() throws when passed invalid spawnPatternJson', (t) => {
    const expectedMessage = /Invalid spawnPatternJson passed to buildPreSpawnAircraft\. Expected a non-empty object, but received .*/;

    t.throws(() => buildPreSpawnAircraft({}, airportModelFixture), {
        instanceOf: TypeError,
        message: expectedMessage
    });
    t.throws(() => buildPreSpawnAircraft([], airportModelFixture), {
        instanceOf: TypeError,
        message: expectedMessage
    });
    t.throws(() => buildPreSpawnAircraft(42, airportModelFixture), {
        instanceOf: TypeError,
        message: expectedMessage
    });
    t.throws(() => buildPreSpawnAircraft('threeve', airportModelFixture), {
        instanceOf: TypeError,
        message: expectedMessage
    });
    t.throws(() => buildPreSpawnAircraft(false, airportModelFixture), {
        instanceOf: TypeError,
        message: expectedMessage
    });
});

ava('buildPreSpawnAircraft() throws when passed invalid currentAirport', (t) => {
    const expectedMessage = /Invalid currentAirport passed to buildPreSpawnAircraft\. Expected instance of AirportModel, but received .*/;

    t.throws(() => buildPreSpawnAircraft(ARRIVAL_PATTERN_MOCK, {}), {
        instanceOf: TypeError,
        message: expectedMessage
    });
    t.throws(() => buildPreSpawnAircraft(ARRIVAL_PATTERN_MOCK, []), {
        instanceOf: TypeError,
        message: expectedMessage
    });
    t.throws(() => buildPreSpawnAircraft(ARRIVAL_PATTERN_MOCK, 42), {
        instanceOf: TypeError,
        message: expectedMessage
    });
    t.throws(() => buildPreSpawnAircraft(ARRIVAL_PATTERN_MOCK, 'threeve'), {
        instanceOf: TypeError,
        message: expectedMessage
    });
    t.throws(() => buildPreSpawnAircraft(ARRIVAL_PATTERN_MOCK, false), {
        instanceOf: TypeError,
        message: expectedMessage
    });
});

ava('buildPreSpawnAircraft() does not throw when passed valid parameters', (t) => {
    t.notThrows(() => buildPreSpawnAircraft(ARRIVAL_PATTERN_MOCK, airportModelFixture));
});

// ava('buildPreSpawnAircraft() returns an array of objects with correct keys', (t) => {
//     const results = buildPreSpawnAircraft(ARRIVAL_PATTERN_MOCK, airportModelFixture);
//
//     t.true(_isArray(results));
//
//     _map(results, (result) => {
//         t.true(typeof result.heading === 'number');
//         t.true(typeof result.nextFix === 'string');
//         t.true(_isArray(result.positionModel.relativePosition));
//     });
// });
