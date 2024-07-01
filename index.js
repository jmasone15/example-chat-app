import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { error } from 'node:console';

const db = await open({
	filename: 'chat.db',
	driver: sqlite3.Database
});

await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_offset TEXT UNIQUE,
        content TEXT
    );
`);

const app = express();
const server = createServer(app);
const io = new Server(server, {
	connectionStateRecovery: {}
});

const PORT = process.env.PORT || 3001;
const __dirname = dirname(fileURLToPath(import.meta.url));

app.get('/', (req, res) => {
	res.sendFile(join(__dirname, 'index.html'));
});

io.on('connection', async (socket) => {
	console.log('a user connected');

	socket.on('chat message', async (msg, clientOffset, callback) => {
		let result;

		try {
			result = await db.run(
				'INSERT INTO messages (content, client_offset) VALUES (?, ?)',
				msg,
				clientOffset
			);
		} catch (e) {
			if (e.errno === 19) {
				callback();
			} else {
				console.error(e);
			}
			return;
		}

		io.emit('chat message', msg, result.lastID);

		callback();
	});

	if (!socket.recovered) {
		try {
			await db.each(
				'SELECT id, content FROM messages WHERE id > ?',
				[socket.handshake.auth.serverOffset || 0],
				(err, row) => {
					socket.emit('chat message', row.content, row.id);
				}
			);
		} catch (e) {
			console.error(error);
			return;
		}
	}

	socket.on('disconnect', () => {
		console.log('user disconnected');
	});
});

server.listen(PORT, () => {
	console.log(`Server running at http://localhost:${PORT}`);
});
