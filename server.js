const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const app = express();
app.use(express.json());

const CONNECTIONS_PATH = path.join("O:", "repos", "AlbionPacketAnalyze", "packetAnalyze", "location_connections.json");
const PLAYER_DATA_PATH = path.join("O:", "repos", "AlbionPacketAnalyze", "packetAnalyze", "player_data.json");

let connections = [];
let connectionsHash = "";
let locationMap = {};
let currentPlayerLocationId = null;

function readJson(path) {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function writeJson(path, data) {
    fs.writeFileSync(path, JSON.stringify(data, null, 4));
}

function logConnectionChange(action, fromId, toId) {
    console.log(`[${new Date().toISOString()}] ${action}: ${fromId} <-> ${toId}`);
}

function hashConnection({ from, to, type }) {
    // Only include the relevant parts (sorted to avoid order-based mismatches)
    const key = `${type}:${from.id}->${to.id}`;
    return key;
}

function hashData(connections) {
    const keys = connections.map(hashConnection).sort(); // Ensure order consistency
    return crypto.createHash('sha1').update(keys.join(',')).digest('hex');
}

function reloadPlayerData() {
    try {
        const data = readJson(PLAYER_DATA_PATH);
        const newId = data?.player?.location?.id;

        if (newId && newId !== currentPlayerLocationId) {
            currentPlayerLocationId = newId;
            console.log("Player location updated:", currentPlayerLocationId);
        }
    } catch (err) {
        console.error('Error reading or parsing player_data.json:', err.message);
    }
}

// Parse the file and extract unique walk-connections
function reloadConnections() {
    try {
        const data = readJson(CONNECTIONS_PATH);
    
        if (!data || !Array.isArray(data.connections) || typeof data.locations !== 'object') {
            console.error('Invalid JSON structure in location_connections.json');
            return;
        }

        locationMap = data.locations;

        const locations = data.locations;
        const seen = new Set();
        const newConnections = [];
    
        for (const obj of data.connections) {
            if (obj.type !== 'walk') continue;
            const fromId = obj.from;
            const toId = obj.to;

            // removing duplicates
            const key = `${fromId}->${toId}`;
            const rev = `${toId}->${fromId}`;

            if (seen.has(key) || seen.has(rev)) continue;
            seen.add(key);

            newConnections.push({
                from: { id: fromId },
                to: { id: toId },
                type: obj.type,
                timestamp: obj.timestamp
            });
        }

        const newHash = hashData(newConnections);
        if (newHash !== connectionsHash) {
            connections = newConnections;
            connectionsHash = newHash;
            console.log('Connections updated:', newConnections.length);
        }
    } catch (err) {
        console.error('Error reading or parsing location_connections.json:', err.message);
    }
}

app.post('/api/connection/add', (req, res) => {
    const { from, to } = req.body;
    if (!from || !to || from === to) {
        return res.status(400).json({ message: "Invalid connection data" });
    }

    const data = readJson(CONNECTIONS_PATH);
    if (!data.connections) data.connections = [];

    const exists = data.connections.some(c =>
        (c.from === from && c.to === to) ||
        (c.from === to && c.to === from)
    );

    if (exists) {
        return res.status(200).json({ message: "Connection already exists" });
    }

    const newConn = {
        from,
        to,
        type: "walk",
        timestamp: new Date().toISOString()
    };

    data.connections.push(newConn);
    writeJson(CONNECTIONS_PATH, data);
    logConnectionChange("ADDED", from, to);

    // Re-read updated connections
    reloadConnections();
    res.json({ message: "Connection added" });
});

app.post('/api/connection/remove', (req, res) => {
    const { from, to } = req.body;
    if (!from || !to || from === to) {
        return res.status(400).json({ message: "Invalid connection data" });
    }

    const data = readJson(CONNECTIONS_PATH);
    if (!Array.isArray(data.connections)) {
        return res.status(500).json({ message: "Invalid data structure in JSON" });
    }

    const before = data.connections.length;

    data.connections = data.connections.filter(c =>
        !(
            c.type === 'walk' &&
            ((c.from === from && c.to === to) || (c.from === to && c.to === from))
        )
    );

    const after = data.connections.length;
    const removed = before !== after;

    if (removed) {
        writeJson(CONNECTIONS_PATH, data);
        logConnectionChange("REMOVED", from, to);
        reloadConnections();
    }

    res.json({ message: removed ? "Connection removed" : "Connection not found" });
});

let debounceTimer = null;
fs.watch(CONNECTIONS_PATH, (event, name) => {
    if (event === 'change') {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => reloadConnections(), 100);
    }
});
let playerDebounceTimer = null;
fs.watch(PLAYER_DATA_PATH, (event) => {
    if (event === 'change') {
        clearTimeout(playerDebounceTimer);
        playerDebounceTimer = setTimeout(() => reloadPlayerData(), 100);
    }
});

reloadConnections();
reloadPlayerData();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/map.json', (req, res) => {
    const clientHash = req.headers['if-none-match'];
    if (clientHash === connectionsHash) {
        res.status(304).end(); // Not Modified
    } else {
        res.setHeader('ETag', connectionsHash);
        res.json({
            connections,
            locations: locationMap
        });
    }
});
app.get('/player.json', (req, res) => {
    res.json({ id: currentPlayerLocationId });
});

app.listen(3000, () => console.log('Listening on http://localhost:3000'));
