import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { availableParallelism } from 'node:os';
import cluster from 'node:cluster';
import { createAdapter, setupPrimary } from '@socket.io/cluster-adapter';

const PORT = process.env.PORT || 3001;

// Challenges for Jordan
// - Broadcast a message to connected users when someone connects or disconnects. DONE
// - Add support for nicknames. DONE
// - Don’t send the same message to the user that sent it. Instead, append the message directly as soon as they press enter.
// - Add “{user} is typing” functionality.
// - Show who’s online.
// - Add private messaging.

if (false) {
	const numCPUs = availableParallelism();

	for (let i = 0; i < numCPUs; i++) {
		cluster.fork({
			PORT: PORT + i
		});
	}

	setupPrimary();
} else {
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
		// adapter: createAdapter()
	});

	const __dirname = dirname(fileURLToPath(import.meta.url));

	app.get('/', (req, res) => {
		res.sendFile(join(__dirname, 'index.html'));
	});

	io.on('connection', async (socket) => {
		socket.once('self', (msg) => {
			socket.broadcast.emit('user connected', `${msg} has joined the chat!`);
		});

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
				console.error(e);
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
}
