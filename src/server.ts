/**
 * HTTP server routing.
 * By Mia.
 * @author mia-pi-git
 */
import {Config} from './config-loader';
import {Dispatcher, ActionError} from './dispatcher';
import * as http from 'http';
import * as https from 'https';

/**
 * API request output should not be valid JavaScript.
 * This is to protect against a CSRF-like attack. Imagine you have an API:
 *     https://example.com/getmysecrets.json
 * Which returns:
 *     {"yoursecrets": [1, 2, 3]}
 *
 * An attacker could trick a user into visiting a site overriding the
 * Array or Object constructor, and then containing:
 *     <script src="https://example.com/getmysecrets.json"></script>
 *
 * This could let them steal the secrets. In modern times, browsers
 * are protected against this kind of attack, but our `]` adds some
 * safety for older browsers.
 *
 * Adding `]` to the beginning makes sure that the output is a syntax
 * error in JS, so treating it as a JS file will simply crash and fail.
 */
const DISPATCH_PREFIX = ']';

export function toID(text: any): string {
	if (text?.id) {
		text = text.id;
	} else if (text?.userid) {
		text = text.userid;
	}
	if (typeof text !== 'string' && typeof text !== 'number') return '';
	return ('' + text).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export class Router {
	server: http.Server;
	port: number;
	awaitingEnd?: () => void;
	closing?: Promise<void>;
	activeRequests = 0;
	constructor(port = (Config.port || 8000)) {
		this.port = port;
		const handle = (
			req: http.IncomingMessage, res: http.ServerResponse
		) => void this.handle(req, res);

		this.server = Config.ssl
			? https.createServer(Config.ssl, handle)
			: http.createServer(handle);

		this.server.listen(port);
	}
	static crashlog(error: any, source = '', details = {}) {
		if (!Config.pspath) {
			return console.log(`${source} crashed`, error, details);
		}
		try {
			const {crashlogger} = require(Config.pspath);
			crashlogger(error, source, details, Config.crashguardemail);
		} catch (e) {
			// don't have data/pokemon-showdown built? something else went wrong? oh well
			console.log('CRASH', error);
			console.log('SUBCRASH', e);
		}
	}
	async handle(req: http.IncomingMessage, res: http.ServerResponse) {
		const body = await Dispatcher.getBody(req);
		this.ensureHeaders(res);
		if (body.json) {
			if (typeof body.json === 'string') {
				body.json = Dispatcher.safeJSON(body.json);
			}
			if (!Array.isArray(body.json)) {
				body.json = [{actionerror: "Invalid JSON sent - must be an array."}];
			}
			const results = [];
			const restData: {[k: string]: any} = {...body, json: null};
			for (const curBody of body.json) {
				if (curBody.actionerror) {
					results.push(curBody);
					continue;
				}
				if (curBody.act === 'json') {
					results.push({actionerror: "Cannot request /api/json in a JSON request."});
					continue;
				}
				// for when extra stuff is sent inside the main body - ie
				// {serverid: string, json: [...]}
				for (const k in restData) {
					if (restData[k] && !curBody[k]) {
						curBody[k] = restData[k];
					}
				}
				const result = await this.handleOne(curBody, req, res);
				if ((result as any).error) {
					this.tryEnd();
					return;
				}
				results.push(result);
			}
			if (results.length) res.writeHead(200).end(Router.stringify(results));
		} else {
			// fall back onto null so it can be json stringified
			const result = await this.handleOne(body, req, res) || null;
			// returning null should be allowed
			if (!result || !(result as any).error) {
				res.writeHead(200).end(Router.stringify(result));
			}
			this.tryEnd();
		}
	}
	tryEnd() {
		if (!this.activeRequests && this.awaitingEnd) this.awaitingEnd();
	}
	ensureHeaders(res: http.ServerResponse) {
		if (!res.getHeader('Content-Type')) {
			res.setHeader('Content-Type', 'text/plain; charset=utf-8');
		}
	}
	async handleOne(
		body: {[k: string]: any},
		req: http.IncomingMessage,
		res: http.ServerResponse
	) {
		const act = Dispatcher.parseAction(req, body);
		if (!act) {
			return {actionerror: "Invalid request action sent."};
		}
		const dispatcher = new Dispatcher(req, res, {body, act});
		this.activeRequests++;
		try {
			const result = await dispatcher.executeActions();
			this.activeRequests--;
			if (this.awaitingEnd) res.setHeader('connection', 'close');
			if (result === null) {
				// didn't make a request to action.php or /api/
				return {code: 404};
			}
			return result;
		} catch (e: any) {
			this.activeRequests--;
			if (this.awaitingEnd) res.setHeader('connection', 'close');
			if (e instanceof ActionError) {
				return {actionerror: e.message};
			}

			for (const k of ['pass', 'password']) delete body[k];
			Router.crashlog(e, 'an API request', body);
			if (Config.devmode && Config.devmode === body.devmode) {
				res.writeHead(200).end(
					e.message + '\n' +
					e.stack + '\n' +
					JSON.stringify(body)
				);
			} else {
				res.writeHead(503).end();
			}
			return {error: true};
		}
	}
	close() {
		if (this.closing) return this.closing;
		this.server.close();
		if (!this.activeRequests) return Promise.resolve();
		this.closing = new Promise<void>(resolve => {
			this.awaitingEnd = resolve;
		});
		return this.closing;
	}
	static stringify(response: any) {
		if (typeof response === 'string') {
			return response; // allow ending with just strings;
		}
		// see DISPATCH_PREFIX
		return DISPATCH_PREFIX + JSON.stringify(response);
	}
}
