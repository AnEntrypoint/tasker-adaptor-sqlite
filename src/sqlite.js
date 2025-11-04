import initSqlJs from 'sql.js';
import { StorageAdapter } from 'tasker-adaptor';
import { Serializer, CRUDPatterns, RECORD_TYPES } from 'tasker-storage-utils';
import logger from 'tasker-logging';
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
    this.serializer = new Serializer();
    this.crudPatterns = new CRUDPatterns();
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
        logger.error('Error loading database', { error: err.message, dbPath: this.dbPath });
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
          logger.error('Error creating table', { error: err.message, statement: stmt.substring(0, 50) });
        }
      }
    }
  }

  async createTaskRun(taskRun) {
    const prepared = this.crudPatterns.buildTaskRunCreate(taskRun);

    const sql = `
      INSERT INTO task_runs (task_identifier, status, input, result, error)
      VALUES (?, ?, ?, ?, ?)
    `;

    this.db.run(sql, [
      prepared.task_identifier ?? null,
      prepared.status ?? 'pending',
      prepared.input || null,
      prepared.result || null,
      prepared.error || null
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
    const deserialized = this.serializer.deserializeRecord(row);
    return this.crudPatterns.normalizeTaskRunRecord(deserialized);
  }

  async updateTaskRun(id, updates) {
    const prepared = this.crudPatterns.buildTaskRunUpdate(updates);
    const keys = Object.keys(prepared);
    const values = keys.map(k => prepared[k]);

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
    const prepared = this.crudPatterns.buildStackRunCreate(stackRun);

    const sql = `
      INSERT INTO stack_runs (task_run_id, parent_stack_run_id, operation, status, input, result, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    this.db.run(sql, [
      prepared.task_run_id ?? null,
      prepared.parent_stack_run_id ?? null,
      prepared.operation ?? null,
      prepared.status ?? 'pending',
      prepared.input || null,
      prepared.result || null,
      prepared.error || null
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
    const deserialized = this.serializer.deserializeRecord(row);
    return this.crudPatterns.normalizeStackRunRecord(deserialized);
  }

  async updateStackRun(id, updates) {
    const prepared = this.crudPatterns.buildStackRunUpdate(updates);
    const keys = Object.keys(prepared);
    const values = keys.map(k => prepared[k]);

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
    const prepared = this.crudPatterns.buildTaskFunctionCreate(taskFunction);

    const sql = `
      INSERT OR REPLACE INTO task_functions (identifier, code, metadata)
      VALUES (?, ?, ?)
    `;

    this.db.run(sql, [
      prepared.identifier || taskFunction.identifier,
      prepared.code,
      prepared.metadata || null
    ]);

    return this.getTaskFunction(prepared.identifier || taskFunction.identifier);
  }

  async getTaskFunction(identifier) {
    const result = this.db.exec('SELECT * FROM task_functions WHERE identifier = ?', [identifier]);
    if (!result[0]) return null;

    const row = result[0];
    const cols = row.columns;
    const values = row.values[0];

    const obj = {};
    cols.forEach((col, i) => obj[col] = values[i]);

    const deserialized = this.serializer.deserializeRecord(obj);
    return this.crudPatterns.normalizeTaskFunctionRecord(deserialized);
  }

  async setKeystore(key, value) {
    const prepared = this.crudPatterns.buildKeystoreCreate({ key, value });

    const sql = `
      INSERT OR REPLACE INTO keystore (key, value)
      VALUES (?, ?)
    `;

    this.db.run(sql, [prepared.key, prepared.value]);
  }

  async getKeystore(key) {
    const result = this.db.exec('SELECT value FROM keystore WHERE key = ?', [key]);
    if (!result[0]) return null;

    const value = result[0].values[0][0];
    return this.serializer.deserializeObject(value);
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
        logger.error('Error saving database', { error: err.message, dbPath: this.dbPath });
      }
    }

    if (this.db) {
      this.db.close();
    }
  }
}

export default SQLiteAdapter;
