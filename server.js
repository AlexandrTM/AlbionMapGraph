const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const app = express();

const PLAYER_PATH = path.join("O:", "repos", "AlbionPacketAnalyze", "packetAnalyze", "player_path.json");
let connections = [];

function hashConnection({ from, to, type }) {
    // Only include the relevant parts (sorted to avoid order-based mismatches)
    const key = `${type}:${from.id}->${to.id}`;
    return key;
}

function hashData(connections) {
    const keys = connections.map(hashConnection).sort(); // Ensure order consistency
    return crypto.createHash('sha1').update(keys.join(',')).digest('hex');
}

connections = [];
connectionsHash = "";

// Parse the file and extract unique walk-connections
function reloadConnections() {
    try {
        const json = fs.readFileSync(PLAYER_PATH, 'utf8');
        const data = JSON.parse(json);
    
        const seen = new Set();
        const newConnections = [];
    
        data.forEach(obj => {
            if (obj.type !== 'walk') return;
            const key = `${obj.from.id}->${obj.to.id}`;
            const rev = `${obj.to.id}->${obj.from.id}`;
            if (!seen.has(key) && !seen.has(rev)) {
                seen.add(key);
                newConnections.push(obj);
            }
        });

        const newHash = hashData(newConnections);
        if (newHash !== connectionsHash) {
            connections = newConnections;
            connectionsHash = newHash;
            console.log('Connections updated:', newConnections.length);
        }
    } catch (err) {
        console.error('Error reading or parsing player_path.json:', err.message);
    }
}

let debounceTimer = null;
fs.watch(PLAYER_PATH, (event, name) => {
    if (event === 'change') {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => reloadConnections(), 100);
    }
});

reloadConnections();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/map.json', (req, res) => {
    const clientHash = req.headers['if-none-match'];
    if (clientHash === connectionsHash) {
        res.status(304).end(); // Not Modified
    } else {
        res.setHeader('ETag', connectionsHash);
        res.json(connections);
    }
});

app.listen(3000, () => console.log('Listening on http://localhost:3000'));
