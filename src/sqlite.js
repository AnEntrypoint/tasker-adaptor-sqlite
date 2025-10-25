import Database from 'better-sqlite3';
import { StorageAdapter } from 'tasker-adaptor';

/**
 * SQLite storage adapter
 * Stores task data in a local SQLite database
 */
export class SQLiteAdapter extends StorageAdapter {
  constructor(dbPath = ':memory:') {
    super();
    this.dbPath = dbPath;
    this.db = null;
  }

  async init() {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    await this._createTables();
  }

  async _createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_identifier TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        input TEXT,
        result TEXT,
        error TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS stack_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_run_id INTEGER NOT NULL REFERENCES task_runs(id),
        parent_stack_run_id INTEGER,
        operation TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        input TEXT,
        result TEXT,
        error TEXT,
        suspended_at TEXT,
        resume_payload TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS task_functions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identifier TEXT NOT NULL UNIQUE,
        code TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS keystore (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_task_runs_identifier ON task_runs(task_identifier);
      CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status);
      CREATE INDEX IF NOT EXISTS idx_stack_runs_task ON stack_runs(task_run_id);
      CREATE INDEX IF NOT EXISTS idx_stack_runs_status ON stack_runs(status);
      CREATE INDEX IF NOT EXISTS idx_stack_runs_parent ON stack_runs(parent_stack_run_id);
    `);
  }

  async createTaskRun(taskRun) {
    const stmt = this.db.prepare(`
      INSERT INTO task_runs (task_identifier, status, input, result, error)
      VALUES (?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      taskRun.task_identifier,
      taskRun.status || 'pending',
      taskRun.input ? JSON.stringify(taskRun.input) : null,
      taskRun.result ? JSON.stringify(taskRun.result) : null,
      taskRun.error ? JSON.stringify(taskRun.error) : null
    );

    return this._getTaskRunById(info.lastInsertRowid);
  }

  async getTaskRun(id) {
    return this._getTaskRunById(id);
  }

  _getTaskRunById(id) {
    const stmt = this.db.prepare('SELECT * FROM task_runs WHERE id = ?');
    const row = stmt.get(id);
    return row ? this._parseTaskRun(row) : null;
  }

  _parseTaskRun(row) {
    return {
      id: row.id,
      task_identifier: row.task_identifier,
      status: row.status,
      input: row.input ? JSON.parse(row.input) : null,
      result: row.result ? JSON.parse(row.result) : null,
      error: row.error ? JSON.parse(row.error) : null,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  async updateTaskRun(id, updates) {
    const keys = Object.keys(updates);
    const values = keys.map(k => {
      const v = updates[k];
      if (v === null) return null;
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    });

    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const stmt = this.db.prepare(`
      UPDATE task_runs
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(...values, id);
    return this._getTaskRunById(id);
  }

  async queryTaskRuns(filter) {
    let sql = 'SELECT * FROM task_runs WHERE 1=1';
    const values = [];

    Object.entries(filter).forEach(([key, value]) => {
      sql += ` AND ${key} = ?`;
      values.push(value);
    });

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...values);
    return rows.map(r => this._parseTaskRun(r));
  }

  async createStackRun(stackRun) {
    const stmt = this.db.prepare(`
      INSERT INTO stack_runs (task_run_id, parent_stack_run_id, operation, status, input, result, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      stackRun.task_run_id,
      stackRun.parent_stack_run_id || null,
      stackRun.operation,
      stackRun.status || 'pending',
      stackRun.input ? JSON.stringify(stackRun.input) : null,
      stackRun.result ? JSON.stringify(stackRun.result) : null,
      stackRun.error ? JSON.stringify(stackRun.error) : null
    );

    return this._getStackRunById(info.lastInsertRowid);
  }

  async getStackRun(id) {
    return this._getStackRunById(id);
  }

  _getStackRunById(id) {
    const stmt = this.db.prepare('SELECT * FROM stack_runs WHERE id = ?');
    const row = stmt.get(id);
    return row ? this._parseStackRun(row) : null;
  }

  _parseStackRun(row) {
    return {
      id: row.id,
      task_run_id: row.task_run_id,
      parent_stack_run_id: row.parent_stack_run_id,
      operation: row.operation,
      status: row.status,
      input: row.input ? JSON.parse(row.input) : null,
      result: row.result ? JSON.parse(row.result) : null,
      error: row.error ? JSON.parse(row.error) : null,
      suspended_at: row.suspended_at,
      resume_payload: row.resume_payload ? JSON.parse(row.resume_payload) : null,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  async updateStackRun(id, updates) {
    const keys = Object.keys(updates);
    const values = keys.map(k => {
      const v = updates[k];
      if (v === null) return null;
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    });

    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const stmt = this.db.prepare(`
      UPDATE stack_runs
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(...values, id);
    return this._getStackRunById(id);
  }

  async queryStackRuns(filter) {
    let sql = 'SELECT * FROM stack_runs WHERE 1=1';
    const values = [];

    Object.entries(filter).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        sql += ` AND ${key} IN (${value.map(() => '?').join(',')})`;
        values.push(...value);
      } else {
        sql += ` AND ${key} = ?`;
        values.push(value);
      }
    });

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...values);
    return rows.map(r => this._parseStackRun(r));
  }

  async getPendingStackRuns() {
    const stmt = this.db.prepare(`
      SELECT * FROM stack_runs
      WHERE status IN ('pending', 'suspended_waiting_child')
      ORDER BY created_at ASC
    `);

    const rows = stmt.all();
    return rows.map(r => this._parseStackRun(r));
  }

  async storeTaskFunction(taskFunction) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO task_functions (identifier, code, metadata)
      VALUES (?, ?, ?)
    `);

    stmt.run(
      taskFunction.identifier,
      taskFunction.code,
      taskFunction.metadata ? JSON.stringify(taskFunction.metadata) : null
    );

    return this.getTaskFunction(taskFunction.identifier);
  }

  async getTaskFunction(identifier) {
    const stmt = this.db.prepare('SELECT * FROM task_functions WHERE identifier = ?');
    const row = stmt.get(identifier);
    if (!row) return null;

    return {
      id: row.id,
      identifier: row.identifier,
      code: row.code,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  async setKeystore(key, value) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO keystore (key, value)
      VALUES (?, ?)
    `);

    const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
    stmt.run(key, valueStr);
  }

  async getKeystore(key) {
    const stmt = this.db.prepare('SELECT value FROM keystore WHERE key = ?');
    const row = stmt.get(key);
    if (!row) return null;

    try {
      return JSON.parse(row.value);
    } catch (e) {
      return row.value;
    }
  }

  async deleteKeystore(key) {
    const stmt = this.db.prepare('DELETE FROM keystore WHERE key = ?');
    stmt.run(key);
  }

  async close() {
    if (this.db) {
      this.db.close();
    }
  }
}

export default SQLiteAdapter;
