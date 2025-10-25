import initSqlJs from 'sql.js';
import { StorageAdapter } from 'tasker-adaptor';
import fs from 'fs';
import path from 'path';

let SQL;

const initSQL = async () => {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
};

export class SQLiteAdapter extends StorageAdapter {
  constructor(dbPath = ':memory:') {
    super();
    this.dbPath = dbPath;
    this.db = null;
  }

  async init() {
    await initSQL();

    if (this.dbPath === ':memory:') {
      this.db = new SQL.Database();
    } else {
      try {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        if (fs.existsSync(this.dbPath)) {
          const buffer = fs.readFileSync(this.dbPath);
          this.db = new SQL.Database(buffer);
        } else {
          this.db = new SQL.Database();
        }
      } catch (err) {
        console.error('Error loading database:', err);
        this.db = new SQL.Database();
      }
    }

    await this._createTables();
  }

  async _createTables() {
    const statements = [
      `CREATE TABLE IF NOT EXISTS task_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_identifier TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        input TEXT,
        result TEXT,
        error TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS stack_runs (
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
      )`,

      `CREATE TABLE IF NOT EXISTS task_functions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identifier TEXT NOT NULL UNIQUE,
        code TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS keystore (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE INDEX IF NOT EXISTS idx_task_runs_identifier ON task_runs(task_identifier)`,
      `CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status)`,
      `CREATE INDEX IF NOT EXISTS idx_stack_runs_task ON stack_runs(task_run_id)`,
      `CREATE INDEX IF NOT EXISTS idx_stack_runs_status ON stack_runs(status)`,
      `CREATE INDEX IF NOT EXISTS idx_stack_runs_parent ON stack_runs(parent_stack_run_id)`
    ];

    for (const stmt of statements) {
      try {
        this.db.run(stmt);
      } catch (err) {
        if (!err.message.includes('already exists')) {
          console.error('Error creating table:', err);
        }
      }
    }
  }

  async createTaskRun(taskRun) {
    const sql = `
      INSERT INTO task_runs (task_identifier, status, input, result, error)
      VALUES (?, ?, ?, ?, ?)
    `;

    this.db.run(sql, [
      taskRun.task_identifier ?? null,
      taskRun.status ?? 'pending',
      taskRun.input ? JSON.stringify(taskRun.input) : null,
      taskRun.result ? JSON.stringify(taskRun.result) : null,
      taskRun.error ? JSON.stringify(taskRun.error) : null
    ]);

    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const lastId = result[0]?.values[0]?.[0];
    return this._getTaskRunById(lastId);
  }

  async getTaskRun(id) {
    return this._getTaskRunById(id);
  }

  _getTaskRunById(id) {
    const result = this.db.exec('SELECT * FROM task_runs WHERE id = ?', [id]);
    if (!result[0]) return null;

    const row = result[0];
    const cols = row.columns;
    const values = row.values[0];

    const obj = {};
    cols.forEach((col, i) => obj[col] = values[i]);

    return this._parseTaskRun(obj);
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
      if (v === null || v === undefined) return null;
      if (typeof v === 'object') return JSON.stringify(v);
      return v ?? null;
    });

    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const sql = `
      UPDATE task_runs
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    this.db.run(sql, [...values, id]);
    return this._getTaskRunById(id);
  }

  async queryTaskRuns(filter) {
    let sql = 'SELECT * FROM task_runs WHERE 1=1';
    const values = [];

    Object.entries(filter).forEach(([key, value]) => {
      sql += ` AND ${key} = ?`;
      values.push(value);
    });

    const result = this.db.exec(sql, values);
    if (!result[0]) return [];

    const cols = result[0].columns;
    return result[0].values.map(row => {
      const obj = {};
      cols.forEach((col, i) => obj[col] = row[i]);
      return this._parseTaskRun(obj);
    });
  }

  async createStackRun(stackRun) {
    const sql = `
      INSERT INTO stack_runs (task_run_id, parent_stack_run_id, operation, status, input, result, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    this.db.run(sql, [
      stackRun.task_run_id ?? null,
      stackRun.parent_stack_run_id ?? null,
      stackRun.operation ?? null,
      stackRun.status ?? 'pending',
      stackRun.input ? JSON.stringify(stackRun.input) : null,
      stackRun.result ? JSON.stringify(stackRun.result) : null,
      stackRun.error ? JSON.stringify(stackRun.error) : null
    ]);

    const result = this.db.exec('SELECT last_insert_rowid() as id');
    const lastId = result[0]?.values[0]?.[0];
    return this._getStackRunById(lastId);
  }

  async getStackRun(id) {
    return this._getStackRunById(id);
  }

  _getStackRunById(id) {
    const result = this.db.exec('SELECT * FROM stack_runs WHERE id = ?', [id]);
    if (!result[0]) return null;

    const row = result[0];
    const cols = row.columns;
    const values = row.values[0];

    const obj = {};
    cols.forEach((col, i) => obj[col] = values[i]);

    return this._parseStackRun(obj);
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
      if (v === null || v === undefined) return null;
      if (typeof v === 'object') return JSON.stringify(v);
      return v ?? null;
    });

    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const sql = `
      UPDATE stack_runs
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    this.db.run(sql, [...values, id]);
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

    const result = this.db.exec(sql, values);
    if (!result[0]) return [];

    const cols = result[0].columns;
    return result[0].values.map(row => {
      const obj = {};
      cols.forEach((col, i) => obj[col] = row[i]);
      return this._parseStackRun(obj);
    });
  }

  async getPendingStackRuns() {
    const sql = `
      SELECT * FROM stack_runs
      WHERE status IN ('pending', 'suspended_waiting_child')
      ORDER BY created_at ASC
    `;

    const result = this.db.exec(sql);
    if (!result[0]) return [];

    const cols = result[0].columns;
    return result[0].values.map(row => {
      const obj = {};
      cols.forEach((col, i) => obj[col] = row[i]);
      return this._parseStackRun(obj);
    });
  }

  async storeTaskFunction(taskFunction) {
    const sql = `
      INSERT OR REPLACE INTO task_functions (identifier, code, metadata)
      VALUES (?, ?, ?)
    `;

    this.db.run(sql, [
      taskFunction.identifier,
      taskFunction.code,
      taskFunction.metadata ? JSON.stringify(taskFunction.metadata) : null
    ]);

    return this.getTaskFunction(taskFunction.identifier);
  }

  async getTaskFunction(identifier) {
    const result = this.db.exec('SELECT * FROM task_functions WHERE identifier = ?', [identifier]);
    if (!result[0]) return null;

    const row = result[0];
    const cols = row.columns;
    const values = row.values[0];

    const obj = {};
    cols.forEach((col, i) => obj[col] = values[i]);

    return {
      id: obj.id,
      identifier: obj.identifier,
      code: obj.code,
      metadata: obj.metadata ? JSON.parse(obj.metadata) : null,
      created_at: obj.created_at,
      updated_at: obj.updated_at
    };
  }

  async setKeystore(key, value) {
    const sql = `
      INSERT OR REPLACE INTO keystore (key, value)
      VALUES (?, ?)
    `;

    const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
    this.db.run(sql, [key, valueStr]);
  }

  async getKeystore(key) {
    const result = this.db.exec('SELECT value FROM keystore WHERE key = ?', [key]);
    if (!result[0]) return null;

    const value = result[0].values[0][0];
    try {
      return JSON.parse(value);
    } catch (e) {
      return value;
    }
  }

  async deleteKeystore(key) {
    this.db.run('DELETE FROM keystore WHERE key = ?', [key]);
  }

  async close() {
    if (this.db && this.dbPath !== ':memory:') {
      try {
        const data = this.db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(this.dbPath, buffer);
      } catch (err) {
        console.error('Error saving database:', err);
      }
    }

    if (this.db) {
      this.db.close();
    }
  }
}

export default SQLiteAdapter;
