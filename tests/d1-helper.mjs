import { DatabaseSync } from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
export class D1 {
    constructor(sqlite) { this.sqlite = sqlite || new DatabaseSync(':memory:'); }
    prepare(sql) {
        if(!this.migrated){for(const file of readdirSync(new URL('../.openai/drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())this.sqlite.exec(readFileSync(new URL('../.openai/drizzle/'+file,import.meta.url),'utf8'));this.migrated=true;}
        const sqlite = this.sqlite;
        let args = [];
        const statement = {
            bind(...values) { args = values; return statement; },
            run() { return { success: true, results: sqlite.prepare(sql).all(...args) }; },
            first() { return sqlite.prepare(sql).get(...args) || null; },
            all() { return { success: true, results: sqlite.prepare(sql).all(...args) }; }
        };
        return statement;
    }
    async batch(statements) {
        this.sqlite.exec('BEGIN');
        try { const results = statements.map((s) => s.run()); this.sqlite.exec('COMMIT'); return results; }
        catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
    }
}
