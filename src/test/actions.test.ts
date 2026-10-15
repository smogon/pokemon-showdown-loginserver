/**
 * Tests for loginserver actions.
 */
import { strict as assert } from 'node:assert';
import * as crypto from 'node:crypto';
import { after, suite, test } from 'node:test';

import { Config } from '../config-loader.ts';
import { Ladder } from '../ladder.ts';
import { Server } from '../server.ts';
import * as tables from '../tables.ts';
import { toID } from '../utils.ts';

const token = '42354y6dhgfdsretr';

void suite('Loginserver actions', () => {
	const server = new Server(null);
	void after(() => server.close());

	void test('Should properly log userstats and userstats history', async () => {
		const { result } = await server.request('updateuserstats', {
			users: '20',
			date: `${Date.now()}`,
			servertoken: token,
			serverid: 'showdown',
		});
		assert(result.actionsuccess);
	});

	void suite('Users features', () => {
		void test("Should register and log in a user, then change the user's password", async () => {
			await tables.users.delete('catra').catch(() => null);
			const registration = await server.request('register', {
				username: 'Catra',
				password: 'applesauce',
				cpassword: 'applesauce',
				captcha: 'pikachu',
				challstr: crypto.randomBytes(128).toString('hex'),
				challengekeyid: '1',
			});
			// note: actionsuccess is false here because test config has no signing key
			assert(registration.result.curuser.userid === 'catra');
			assert(await tables.users.get('catra'), 'User was not registered');

			const login = await server.request('login', {
				name: 'catra',
				pass: 'applesauce',
				challengekeyid: '1',
				challstr: crypto.randomBytes(128).toString('hex'),
			});
			assert(login.result.actionsuccess, 'User was not logged in');
			assert(login.result.assertion.split(';').length > 1);

			const setCookie = login.context.response.getHeader('Set-Cookie');
			assert(typeof setCookie === 'string');
			const cookieMatch = /^sid=([^;]+)/.exec(setCookie);
			assert(cookieMatch, 'Login did not set a session cookie');
			const sid = decodeURIComponent(cookieMatch[1]);

			const { result } = await server.request('changepassword', {
				username: 'Catra',
				oldpassword: 'applesauce',
				cpassword: 'greyskull',
				password: 'greyskull',
				sid,
			});
			assert(result.actionsuccess, 'Received falsy success');

			const oldPasswordLogin = await server.request('login', {
				name: 'catra',
				pass: 'applesauce',
				challengekeyid: '1',
				challstr: crypto.randomBytes(128).toString('hex'),
			});
			assert.equal(oldPasswordLogin.result.actionerror, 'Wrong password.');

			const newPasswordLogin = await server.request('login', {
				name: 'catra',
				pass: 'greyskull',
				challengekeyid: '1',
				challstr: crypto.randomBytes(128).toString('hex'),
			});
			assert(newPasswordLogin.result.actionsuccess, 'User could not log in with the new password');
		});

		void test('Should give bot accounts the bot usertype', async t => {
			// the test config has no signing key, so use a throwaway one to get a real assertion
			const oldPrivateKey = Config.privatekey;
			t.after(() => {
				Config.privatekey = oldPrivateKey;
			});
			Config.privatekey = crypto.generateKeyPairSync('rsa', {
				modulusLength: 2048,
				privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
				publicKeyEncoding: { type: 'spki', format: 'pem' },
			}).privateKey;

			await tables.users.delete('entrapta').catch(() => null);
			await server.request('register', {
				username: 'Entrapta',
				password: 'imp0ssible',
				cpassword: 'imp0ssible',
				captcha: 'pikachu',
				challstr: crypto.randomBytes(128).toString('hex'),
				challengekeyid: '1',
			});
			await tables.users.update('entrapta', { group: 10 });

			const login = await server.request('login', {
				name: 'entrapta',
				pass: 'imp0ssible',
				challengekeyid: `${Config.challengekeyid}`,
				challstr: crypto.randomBytes(128).toString('hex'),
			});
			const [challenge, userid, userType] = login.result.assertion.split(';')[0].split(',');
			assert(challenge, `Login failed: ${login.result.assertion}`);
			assert.equal(userid, 'entrapta');
			assert.equal(userType, '10');
		});
	});

	// prepreplay no longer exists
	// void test('Should prepare replays', async () => {
	// 	await tables.replayPrep.delete('gen8randombattle-3096').catch(() => null);
	// 	await server.request('prepreplay', {
	// 		id: 'gen8randombattle-3096',
	// 		loghash: 'ec4730e807719f9b94327f4b5ab28034',
	// 		p1: 'Adora',
	// 		p2: 'Catra',
	// 		format: 'gen8randombattle',
	// 		rating: '1500',
	// 		hidden: '',
	// 		private: '0',
	// 		serverid: 'showdown',
	// 		servertoken: token,
	// 		inputlog: [
	// 			'>version 3eeccb002ecc608fb66c25b6abb3ef87f667f8b6',
	// 			'>version-origin a5d3aaee353a60c91076162238b2a6d09c284165',
	// 			'>start {"formatid":"gen8randombattle","seed":[17049,48118,24089,21353],"rated":"Rated battle"}',
	// 			'>player p1 {"name":"Adora","avatar":"169","rating":1000,"seed":[14989,14520,19847,43935]}',
	// 			'>player p2 {"name":"Catra","avatar":"miapi.png","rating":1069,"seed":[35058,54063,46942,19311]}',
	// 		].join('\n'),
	// 	});
	// 	const cached = await tables.replayPrep.get('gen8randombattle-3096');
	// 	assert(cached, 'Could not locate entry for prepped replay');
	// });

	void suite('Ladder', () => {
		void test('Should update the ladder', async () => {
			for (const id of ['catra', 'adora']) {
				await tables.ladder.deleteOne()`WHERE userid = ${id} AND formatid = ${'gen1randombattle'}`;
			}
			const { result } = await server.request('ladderupdate', {
				serverid: 'showdown',
				servertoken: token,
				p1: 'Catra',
				p2: 'Adora',
				format: 'gen1randombattle',
				score: '1',
			});
			assert(result.p1rating.elo === 1040, 'Received winner elo of ' + result.p1rating.elo);
			assert(result.p2rating.elo === 1000, 'Received loser elo of ' + result.p2rating.elo);
		});

		void test('Should fetch the MMR for a given user', async () => {
			const ladder = new Ladder('gen5randombattle');
			const p1 = 'shera';
			const p2 = 'catra';
			for (const player of [p1, p2]) {
				await tables.ladder.deleteAll()`WHERE userid = ${toID(player)} AND formatid = ${ladder.formatid}`;
			}
			const [p1rating] = await ladder.addMatch(p1, p2, 1);
			const { result } = await server.request('mmr', {
				format: 'gen5randombattle',
				user: 'shera',
				serverid: 'showdown',
				servertoken: token,
			});
			assert.strictEqual(p1rating.elo, result, `Expected elo ${p1rating.elo}, got ${result}`);
		});
	});
});
