import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { after, before, suite, test } from 'node:test';

import { Server } from '../server.ts';

void suite('team changes', () => {
	let server: Server;
	let origin: string;

	void before(async () => {
		server = new Server(0, '127.0.0.1');
		await once(server.server, 'listening');
		const address = server.server.address();
		assert(address && typeof address === 'object');
		origin = `http://127.0.0.1:${address.port}`;
	});

	void after(async () => {
		await new Promise<void>(resolve => server.server.close(() => resolve()));
	});

	async function request(action: string, method: string, requestOrigin?: string, sid?: string) {
		const body = new URLSearchParams({ teamid: '1', ...(sid ? { sid } : {}) });
		const response = await fetch(`${origin}/api/${action}${method === 'GET' ? `?${body}` : ''}`, {
			method,
			headers: {
				...(requestOrigin ? { origin: requestOrigin } : {}),
				...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
			},
			...(method === 'POST' ? { body } : {}),
		});
		const text = await response.text();
		assert.equal(text.charAt(0), ']');
		return JSON.parse(text.slice(1));
	}

	for (const action of ['editteam', 'deleteteam', 'copyteam']) {
		void test(`${action} rejects cross-site requests and permits same-origin POST`, async () => {
			assert.equal((await request(action, 'GET', origin)).actionerror, 'Invalid team change request.');
			assert.equal(
				(await request(action, 'POST', 'https://attacker.example')).actionerror,
				'Invalid team change request.'
			);
			assert.match((await request(action, 'POST', origin)).actionerror, /Must be logged in/);
			assert.match(
				(await request(action, 'POST', 'https://attacker.example', 'dummy')).actionerror,
				/Must be logged in/
			);
		});
	}
});
