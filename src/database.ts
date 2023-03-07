/**
 * Database abstraction layer that's vaguely ORM-like.
 * Modern (Promises, strict types, tagged template literals), but ORMs
 * are a bit _too_ magical for me, so none of that magic here.
 *
 * @author Zarel
 */

import * as mysql from 'mysql2';

export type BasicSQLValue = string | number | null;
export type SQLValue =
	BasicSQLValue | SQLStatement | {[k: string]: BasicSQLValue | SQLStatement} | BasicSQLValue[] |undefined;

export class SQLName {
	name: string;
	constructor(name: string) {
		this.name = name;
	}
}

export class SQLStatement {
	sql: string[];
	values: BasicSQLValue[];
	constructor(strings: TemplateStringsArray, values: SQLValue[]) {
		this.sql = [strings[0]];
		this.values = [];
		for (let i = 0; i < strings.length; i++) {
			this.append(values[i], strings[i + 1]);
		}
	}
	append(value: SQLValue, nextString = ''): this {
		if (value instanceof SQLStatement) {
			if (!value.sql.length) return this;
			const oldLength = this.sql.length;
			this.sql = this.sql.concat(value.sql.slice(1));
			this.sql[oldLength - 1] += value.sql[0];
			this.values = this.values.concat(value.values);
			if (nextString) this.sql[this.sql.length - 1] += nextString;
		} else if (typeof value === 'string' || typeof value === 'number') {
			this.values.push(value);
			this.sql.push(nextString);
		} else if (value === undefined) {
			this.sql[this.sql.length - 1] += nextString;
		} else if (Array.isArray(value)) {
			if (this.sql[this.sql.length - 1].endsWith(`\``)) {
				// "`a`, `b`" syntax
				for (const col of value) {
					this.append(col, `\`, `);
				}
				this.sql[this.sql.length - 1] = this.sql[this.sql.length - 1].slice(0, -2) + nextString;
			} else {
				// "1, 2" syntax
				for (const val of value) {
					this.append(val, `, `);
				}
				this.sql[this.sql.length - 1] = this.sql[this.sql.length - 1].slice(0, -2) + nextString;
			}
		} else if (this.sql[this.sql.length - 1].endsWith('(')) {
			// "(`a`, `b`) VALUES (1, 2)" syntax
			this.sql[this.sql.length - 1] += `\``;
			for (const col in value) {
				this.append(col, `\`, \``);
			}
			this.sql[this.sql.length - 1] = this.sql[this.sql.length - 1].slice(0, -3) + `\`) VALUES (`;
			for (const col in value) {
				this.append(col, `, `);
			}
			this.sql[this.sql.length - 1] = this.sql[this.sql.length - 1].slice(0, -2) + nextString;
		} else if (this.sql[this.sql.length - 1].toUpperCase().endsWith(' SET ')) {
			// "`a` = 1, `b` = 2" syntax
			this.sql[this.sql.length - 1] += `\``;
			for (const col in value) {
				this.append(col, `\` = `);
				this.append(value[col], `, \``);
			}
			this.sql[this.sql.length - 1] = this.sql[this.sql.length - 1].slice(0, -3) + nextString;
		} else {
			throw new Error(
				`Objects can only appear in (obj) or after SET; ` +
				`unrecognized: ${this.sql[this.sql.length - 1]}[obj]${nextString}`
			);
		}
		return this;
	}
}

/**
 * Tag function for SQL, with some magic.
 *
 * * `` SQL`UPDATE table SET a = ${'hello"'}` ``
 *   * `` 'UPDATE table SET a = "hello"' ``
 *
 * Values surrounded by `` \` `` become names:
 *
 * * ``` SQL`SELECT * FROM \`${'table'}\`` ```
 *   * `` 'SELECT * FROM `table`' ``
 *
 * Objects preceded by SET become setters:
 *
 * * `` SQL`UPDATE table SET ${{a: 1, b: 2}}` ``
 *   * `` 'UPDATE table SET `a` = 1, `b` = 2' ``
 *
 * Objects surrounded by `()` become keys and values:
 *
 * * `` SQL`INSERT INTO table (${{a: 1, b: 2}})` ``
 *   * `` 'INSERT INTO table (`a`, `b`) VALUES (1, 2)' ``
 *
 * Arrays become lists; surrounding by `` \` `` turns them into lists of names:
 *
 * * `` SQL`INSERT INTO table (\`${['a', 'b']}\`) VALUES (${[1, 2]})` ``
 *   * `` 'INSERT INTO table (`a`, `b`) VALUES (1, 2)' ``
 */
export function SQL(strings: TemplateStringsArray, ...values: (SQLValue | SQLStatement)[]) {
	return new SQLStatement(strings, values);
}

export interface ResultRow {[k: string]: BasicSQLValue}

export const connectedDatabases: Database[] = [];

export class Database {
	connection: mysql.Pool;
	prefix: string;
	constructor(config: mysql.PoolOptions & {prefix?: string}) {
		this.prefix = config.prefix || "";
		if (config.prefix) {
			config = {...config};
			delete config.prefix;
		}
		this.connection = mysql.createPool(config);
		connectedDatabases.push(this);
	}
	resolveSQL(query: SQLStatement): [string, BasicSQLValue[]] {
		let sql = query.sql[0];
		const values = [];
		for (let i = 0; i < query.values.length; i++) {
			const value = query.values[i];
			if (query.sql[i + 1].startsWith('`')) {
				sql = sql.slice(0, -1) + this.connection.escapeId('' + value) + query.sql[i + 1].slice(1);
			} else {
				sql += '?' + query.sql[i + 1];
				values.push(value);
			}
		}
		return [sql, values];
	}
	query<T = ResultRow>(query: SQLStatement): Promise<T[]> {
		return new Promise<T[]>((resolve, reject) => {
			const [sql, values] = this.resolveSQL(query);
			this.connection.query(sql, values, (e, results: any) => {
				if (e) {
					return reject(new Error(`${e.message} (${query.sql}) (${query.values}) [${e.code}]`));
				}
				if (Array.isArray(results)) {
					for (const row of results) {
						for (const col in row) {
							if (Buffer.isBuffer(row[col])) row[col] = row[col].toString();
						}
					}
				}
				return resolve(results);
			});
		});
	}
	async queryOne<T = ResultRow>(query: SQLStatement): Promise<T | undefined> {
		return (await this.query(query))?.[0] as T;
	}
	async queryOk(query: SQLStatement): Promise<mysql.OkPacket> {
		if (!['UPDATE', 'INSERT', 'DELETE', 'REPLACE'].some(i => query.sql.includes(i))) {
			throw new Error('Use `query` or `get` for non-insertion / update statements.');
		}
		return this.queryOne(query) as Promise<mysql.OkPacket>;
	}
	close() {
		this.connection.end();
	}
}

type PartialOrSQL<T> = {
	[P in keyof T]?: T[P] | SQLStatement;
};

export class DatabaseTable<Row> {
	db: Database;
	name: string;
	primaryKeyName: string;
	constructor(
		db: Database,
		name: string,
		primaryKeyName: string
	) {
		this.db = db;
		this.name = db.prefix + name;
		this.primaryKeyName = primaryKeyName;
	}
	escapeId(param: string) {
		return this.db.connection.escapeId(param);
	}

	// raw

	query<T = Row>(sql: SQLStatement) {
		return this.db.query<T>(sql);
	}
	queryOk(sql: SQLStatement) {
		return this.db.queryOk(sql);
	}

	// low-level

	selectAll<T = Row>(entries?: string[] | null | SQLStatement, where?: SQLStatement): Promise<T[]> {
		if (entries === null) entries = SQL`*`;
		if (Array.isArray(entries)) entries = SQL`\`${entries}\``;
		return this.query<T>(SQL`SELECT ${entries} FROM \`${this.name}\` ${where}`);
	}
	async selectOne<T = Row>(entries?: string[] | null | SQLStatement, where?: SQLStatement): Promise<T | undefined> {
		where = (where ? where.append(SQL` LIMIT 1`) : SQL` LIMIT 1`);
		return (await this.selectAll<T>(entries, where))?.[0];
	}
	updateAll(partialRow: PartialOrSQL<Row>, where?: SQLStatement) {
		return this.queryOk(SQL`UPDATE \`${this.name}\` SET ${partialRow as SQLValue} ${where}`);
	}
	updateOne(partialRow: PartialOrSQL<Row>, where?: SQLStatement) {
		where = (where ? where.append(SQL` LIMIT 1`) : SQL` LIMIT 1`);
		return this.updateAll(partialRow, where);
	}
	deleteAll(where?: SQLStatement) {
		return this.queryOk(SQL`DELETE FROM \`${this.name}\` ${where}`);
	}
	deleteOne(where: SQLStatement) {
		where = (where ? where.append(SQL` LIMIT 1`) : SQL` LIMIT 1`);
		return this.deleteAll(where);
	}
	insert(partialRow: PartialOrSQL<Row>, where?: SQLStatement) {
		return this.queryOk(SQL`INSERT INTO \`${this.name}\` (${partialRow as SQLValue}) ${where}`);
	}
	replace(partialRow: PartialOrSQL<Row>, where?: SQLStatement) {
		return this.queryOk(SQL`REPLACE INTO \`${this.name}\` (${partialRow as SQLValue}) ${where}`);
	}

	// high-level

	get(primaryKey: BasicSQLValue, entries?: string[]) {
		return this.selectOne(entries, SQL`WHERE \`${this.primaryKeyName}\` = ${primaryKey}`);
	}
	delete(primaryKey: BasicSQLValue) {
		return this.deleteAll(SQL`WHERE \`${this.primaryKeyName}\` = ${primaryKey} LIMIT 1`);
	}
	update(primaryKey: BasicSQLValue, data: PartialOrSQL<Row>) {
		return this.updateAll(data, SQL`WHERE \`${this.primaryKeyName}\` = ${primaryKey} LIMIT 1`);
	}
}
