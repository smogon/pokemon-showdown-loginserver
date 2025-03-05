import * as child_process from 'child_process';
import * as crypto from 'crypto';

export function toID(text: any): string {
	if (text?.id) {
		text = text.id;
	} else if (text?.userid) {
		text = text.userid;
	}
	if (typeof text !== 'string' && typeof text !== 'number') return '';
	return `${text}`.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function time() {
	// Date.now() is in milliseconds but Unix timestamps are in seconds
	return Math.trunc(Date.now() / 1000);
}

export function bash(command: string, cwd?: string): Promise<[number, string, string]> {
	return new Promise(resolve => {
		child_process.exec(command, {
			cwd: cwd || `${__dirname}/../..`,
		}, (error, stdout, stderr) => {
			resolve([error?.code || 0, stdout, stderr]);
		});
	});
}

export async function updateserver(path?: string) {
	let [code, stdout, stderr] = await bash(`git fetch`, path);
	if (code) throw new Error(`updateserver: Crash while fetching - make sure this is a Git repository`);
	if (!stdout && !stderr) {
		return true; // no changes. we're fine.
	}

	[code, stdout, stderr] = await bash(`git rev-parse HEAD`, path);
	if (code || stderr) throw new Error(`updateserver: Crash while grabbing hash`);
	const oldHash = String(stdout).trim();

	[code, stdout, stderr] = await bash(`git stash save "PS /updateserver autostash"`, path);
	let stashedChanges = true;
	if (code) throw new Error(`updateserver: Crash while stashing`);
	if ((stdout + stderr).includes("No local changes")) {
		stashedChanges = false;
	} else if (stderr) {
		throw new Error(`updateserver: Crash while stashing`);
	}

	// errors can occur while rebasing or popping the stash; make sure to recover
	try {
		[code] = await bash(`git rebase --no-autostash FETCH_HEAD`, path);
		if (code) {
			// conflict while rebasing
			await bash(`git rebase --abort`, path);
			throw new Error(`restore`);
		}

		if (stashedChanges) {
			[code] = await bash(`git stash pop`, path);
			if (code) {
				// conflict while popping stash
				await bash(`git reset HEAD .`, path);
				await bash(`git checkout .`, path);
				throw new Error(`restore`);
			}
		}

		return true;
	} catch {
		// failed while rebasing or popping the stash
		await bash(`git reset --hard ${oldHash}`, path);
		if (stashedChanges) await bash(`git stash pop`, path);
		return false;
	}
}

export function stripNonAscii(str: string) {
	return str.replace(/[^(\x20-\x7F)]+/g, '');
}

export function md5(str: string) {
	return crypto.createHash('md5').update(str).digest('hex');
}

export function encode(text: string) {
	return Uint8Array.from(Buffer.from(text));
}

export function signAsync(algo: string, data: string, key: string) {
	return new Promise<string>((resolve, reject) => {
		crypto.sign(algo, encode(data), key, (err, out) => {
			if (err) return reject(err);
			return resolve(out.toString('hex'));
		});
	});
}

export function escapeHTML(str: string | number) {
	if (str === null || str === undefined) return '';
	return `${str}`
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

export class TimeSorter {
	private data: Record<string, { min: number, max: number, count: number }> = {};
	add(key: string, timestamp: number) {
		if (this.data[key]) {
			if (this.data[key].min > timestamp) {
				this.data[key].min = timestamp;
			}
			if (timestamp > this.data[key].max) {
				this.data[key].max = timestamp;
			}
			this.data[key].count++;
		} else {
			this.data[key] = { min: timestamp, max: timestamp, count: 1 };
		}
	}
	toJSON(): TimeSorter['data'] {
		return this.data;
	}
	merge(other: TimeSorter | TimeSorter['data']) {
		if (other instanceof TimeSorter) {
			other = other.toJSON();
		}
		for (const k in other) {
			if (this.data[k]) {
				if (other[k].min < this.data[k].min) {
					this.data[k].min = other[k].min;
				}
				if (other[k].max > this.data[k].max) {
					this.data[k].max = other[k].max;
				}
				this.data[k].count += other[k].count;
			} else {
				this.data[k] = other[k];
			}
		}
	}
}
