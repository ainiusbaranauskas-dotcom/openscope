const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const colors = require('ansi-colors');
const { Server } = require('socket.io');
const session = require('express-session');

const app = express();
const server = http.Server(app);
const io = new Server(server);

const PORT = process.env.PORT || 3003;
const GATE_PASSWORD = process.env.GATE_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Session middleware (shared between Express and Socket.io)
const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
});

app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

// Share session with Socket.io
io.engine.use(sessionMiddleware);

// Auth check helper
function isAuthenticated(req) {
    return !GATE_PASSWORD || (req.session && req.session.authenticated);
}

// Brute-force protection: 5 failed attempts per IP = locked for 15 min
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
}

function isLockedOut(ip) {
    const record = loginAttempts.get(ip);

    if (!record) {
        return false;
    }

    if (Date.now() - record.lastAttempt > LOCKOUT_MS) {
        loginAttempts.delete(ip);

        return false;
    }

    return record.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(ip) {
    const record = loginAttempts.get(ip) || { count: 0, lastAttempt: 0 };

    record.count++;
    record.lastAttempt = Date.now();
    loginAttempts.set(ip, record);
}

function clearAttempts(ip) {
    loginAttempts.delete(ip);
}

// Login page HTML
function getLoginPageHtml(error) {
    const errorHtml = error ? `<p class="error">${error}</p>` : '';

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>openScope - Login</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background: #1a1a2e;
            color: #e0e0e0;
            font-family: 'Courier New', monospace;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .login-box {
            background: #16213e;
            border: 1px solid #0f3460;
            border-radius: 8px;
            padding: 40px;
            width: 340px;
            text-align: center;
        }
        h1 {
            color: #00d4aa;
            font-size: 24px;
            margin-bottom: 8px;
        }
        .subtitle {
            color: #666;
            font-size: 12px;
            margin-bottom: 30px;
        }
        input[type="password"] {
            width: 100%;
            padding: 12px;
            background: #1a1a2e;
            border: 1px solid #0f3460;
            border-radius: 4px;
            color: #e0e0e0;
            font-family: inherit;
            font-size: 14px;
            margin-bottom: 16px;
            text-align: center;
            letter-spacing: 4px;
        }
        input[type="password"]:focus {
            outline: none;
            border-color: #00d4aa;
        }
        button {
            width: 100%;
            padding: 12px;
            background: #00d4aa;
            border: none;
            border-radius: 4px;
            color: #1a1a2e;
            font-family: inherit;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
        }
        button:hover { background: #00b894; }
        .error {
            color: #ff6b6b;
            font-size: 12px;
            margin-bottom: 16px;
        }
    </style>
</head>
<body>
    <div class="login-box">
        <h1>openScope</h1>
        <p class="subtitle">ATC Simulator — EYVI</p>
        ${errorHtml}
        <form method="POST" action="/login">
            <input type="password" name="password" placeholder="Enter password" autofocus required>
            <button type="submit">ENTER</button>
        </form>
    </div>
</body>
</html>`;
}

// Login routes
app.get('/login', (req, res) => {
    if (isAuthenticated(req)) {
        return res.redirect('/');
    }

    res.send(getLoginPageHtml());
});

app.post('/login', (req, res) => {
    const ip = getClientIp(req);

    if (isLockedOut(ip)) {
        return res.status(429).send(getLoginPageHtml('Too many attempts. Try again in 15 minutes.'));
    }

    if (req.body.password === GATE_PASSWORD) {
        clearAttempts(ip);
        req.session.authenticated = true;

        return res.redirect('/');
    }

    recordFailedAttempt(ip);

    const record = loginAttempts.get(ip);
    const remaining = MAX_ATTEMPTS - record.count;

    if (remaining <= 0) {
        return res.status(429).send(getLoginPageHtml('Too many attempts. Try again in 15 minutes.'));
    }

    res.send(getLoginPageHtml(`Incorrect password (${remaining} attempts remaining)`));
});

// Auth middleware for all other routes
app.use((req, res, next) => {
    if (req.path === '/login') {
        return next();
    }

    if (!isAuthenticated(req)) {
        return res.redirect('/login');
    }

    next();
});

// Coop room management
const rooms = new Map();

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;

    do {
        code = '';

        for (let i = 0; i < 4; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    } while (rooms.has(code));

    return code;
}

// Protect Socket.io connections with auth check
io.use((socket, next) => {
    if (!GATE_PASSWORD) {
        return next();
    }

    const req = socket.request;

    if (req.session && req.session.authenticated) {
        return next();
    }

    next(new Error('Authentication required'));
});

io.on('connection', (socket) => {
    console.log(colors.cyan(`[Coop] Client connected: ${socket.id}`));

    socket.on('create-room', (data) => {
        const code = generateRoomCode();
        const room = {
            code,
            hostSocketId: socket.id,
            guestSocketId: null,
            airportIcao: data.airportIcao
        };

        rooms.set(code, room);
        socket.join(code);
        socket.roomCode = code;
        socket.emit('room-created', { code, airportIcao: room.airportIcao });
        console.log(colors.green(`[Coop] Room ${code} created by ${socket.id} (airport: ${data.airportIcao})`));
    });

    socket.on('join-room', (data) => {
        const code = data.code.toUpperCase();
        const room = rooms.get(code);

        if (!room) {
            socket.emit('join-error', { message: 'Room not found' });

            return;
        }

        if (room.guestSocketId) {
            socket.emit('join-error', { message: 'Room is full' });

            return;
        }

        room.guestSocketId = socket.id;
        socket.join(code);
        socket.roomCode = code;
        socket.emit('room-joined', { code, airportIcao: room.airportIcao });
        io.to(room.hostSocketId).emit('guest-joined', { guestId: socket.id });
        console.log(colors.green(`[Coop] Guest ${socket.id} joined room ${code}`));
    });

    // Relay: guest command -> host
    socket.on('command', (data) => {
        const room = rooms.get(socket.roomCode);

        if (room && socket.id === room.guestSocketId) {
            io.to(room.hostSocketId).emit('remote-command', data);
        }
    });

    // Relay: host state sync -> guest
    socket.on('state-sync', (data) => {
        const room = rooms.get(socket.roomCode);

        if (room && socket.id === room.hostSocketId && room.guestSocketId) {
            io.to(room.guestSocketId).emit('state-sync', data);
        }
    });

    // Relay: host aircraft spawn -> guest
    socket.on('aircraft-spawn', (data) => {
        const room = rooms.get(socket.roomCode);

        if (room && socket.id === room.hostSocketId && room.guestSocketId) {
            io.to(room.guestSocketId).emit('aircraft-spawn', data);
        }
    });

    // Relay: host aircraft remove -> guest
    socket.on('aircraft-remove', (data) => {
        const room = rooms.get(socket.roomCode);

        if (room && socket.id === room.hostSocketId && room.guestSocketId) {
            io.to(room.guestSocketId).emit('aircraft-remove', data);
        }
    });

    // Relay: host command result -> guest
    socket.on('command-result', (data) => {
        const room = rooms.get(socket.roomCode);

        if (room && socket.id === room.hostSocketId && room.guestSocketId) {
            io.to(room.guestSocketId).emit('command-result', data);
        }
    });

    // Relay: host game event -> guest
    socket.on('game-event', (data) => {
        const room = rooms.get(socket.roomCode);

        if (room && socket.id === room.hostSocketId && room.guestSocketId) {
            io.to(room.guestSocketId).emit('game-event', data);
        }
    });

    socket.on('disconnect', () => {
        const code = socket.roomCode;

        if (!code) {
            return;
        }

        const room = rooms.get(code);

        if (!room) {
            return;
        }

        if (socket.id === room.hostSocketId) {
            // Host left - notify guest and destroy room
            if (room.guestSocketId) {
                io.to(room.guestSocketId).emit('partner-disconnected', { reason: 'host-left' });
            }

            rooms.delete(code);
            console.log(colors.yellow(`[Coop] Host left, room ${code} destroyed`));
        } else if (socket.id === room.guestSocketId) {
            // Guest left - notify host, keep room open
            room.guestSocketId = null;
            io.to(room.hostSocketId).emit('partner-disconnected', { reason: 'guest-left' });
            console.log(colors.yellow(`[Coop] Guest left room ${code}`));
        }
    });
});

app.use('/assets', express.static(path.join(__dirname, '/../../../assets')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '/../../../index.html'));
});

server.listen(PORT, () => {
    console.log(colors.green.bold(`\nListening on PORT ${PORT}`));
});
