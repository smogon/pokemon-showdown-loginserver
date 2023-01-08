/**
 * Mostly pruned from PS main.
 */

export const IPTools = new class {
	getCidrRange(cidr: string): {minIP: number; maxIP: number} | null {
		if (!cidr) return null;
		const index = cidr.indexOf('/');
		if (index <= 0) {
			const ip = IPTools.ipToNumber(cidr);
			if (ip === null) return null;
			return {minIP: ip, maxIP: ip};
		}
		const low = IPTools.ipToNumber(cidr.slice(0, index));
		const bits = this.parseExactInt(cidr.slice(index + 1));
		// fun fact: IPTools fails if bits <= 1 because JavaScript
		// does << with signed int32s.
		if (low === null || !bits || bits < 2 || bits > 32) return null;
		const high = low + (1 << (32 - bits)) - 1;
		return {minIP: low, maxIP: high};
	}
	parseExactInt(str: string): number {
		if (!/^-?(0|[1-9][0-9]*)$/.test(str)) return NaN;
		return parseInt(str);
	}
	ipToNumber(ip: string) {
		ip = ip.trim();
		if (ip.includes(':') && !ip.includes('.')) {
			// IPv6, which PS does not support
			return null;
		}
		if (ip.startsWith('::ffff:')) ip = ip.slice(7);
		else if (ip.startsWith('::')) ip = ip.slice(2);
		let num = 0;
		const parts = ip.split('.');
		if (parts.length !== 4) return null;
		for (const part of parts) {
			num *= 256;

			const partAsInt = this.parseExactInt(part);
			if (isNaN(partAsInt) || partAsInt < 0 || partAsInt > 255) return null;
			num += partAsInt;
		}
		return num;
	}
	checkPattern(rangeString: string, ip: string | number) {
		if (typeof ip !== 'number') ip = this.ipToNumber(ip) || 0;
		const range = this.getCidrRange(rangeString);
		if (!range) return false;
		return range.minIP <= ip && ip <= range.maxIP;
	}
};

export default IPTools;
