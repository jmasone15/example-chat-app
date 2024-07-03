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
// - Don’t send the same message to the user that sent it. Instead, append the message directly as soon as they press enter. DONE
// - Add “{user} is typing” functionality.
// - Show who’s online.
// - Add private messaging.
// - Deploy to Vercel

if (cluster.isPrimary) {
	const numCPUs = availableParallelism();

	for (let i = 0; i < 4; i++) {
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
		connectionStateRecovery: {},
		adapter: createAdapter()
	});

	const __dirname = dirname(fileURLToPath(import.meta.url));

	app.get('/', (req, res) => {
		res.sendFile(join(__dirname, 'index.html'));
	});

	io.on('connection', async (socket) => {
		socket.once('self', async (msg) => {
			socket.broadcast.emit('user connected', `${msg} has joined the chat!`);
			console.log(`${msg} connected`);

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
		});

		socket.on('typing', (nickname) => {
			socket.broadcast.emit('typing', nickname);
		});
		socket.on('done typing', (nickname) => {
			socket.broadcast.emit('done typing', nickname);
		});

		socket.on('chat message', async (msg, clientOffset) => {
			let result;

			try {
				result = await db.run(
					'INSERT INTO messages (content, client_offset) VALUES (?, ?)',
					msg,
					clientOffset
				);
			} catch (e) {
				if (e.errno !== 19) {
					console.error(e);
				}
				return;
			}

			socket.broadcast.emit('chat message', msg, result.lastID);
		});

		socket.on('disconnect', () => {
			console.log('user disconnected');
		});
	});

	server.listen(PORT, () => {
		console.log(`Server running at http://localhost:${PORT}`);
	});
}
