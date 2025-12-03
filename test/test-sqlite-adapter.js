import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SQLiteAdapter } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('SQLiteAdapter - Initialization', async (t) => {
  await t.test('initializes in-memory adapter', async () => {
    const adapter = new SQLiteAdapter();
    await adapter.init();
    assert.ok(adapter.db);
    await adapter.close();
  });

  await t.test('initializes file-based adapter', async () => {
    const dbPath = path.join(__dirname, 'file-test.db');
    const adapter = new SQLiteAdapter(dbPath);
    await adapter.init();
    assert.ok(adapter.db);
    assert.ok(fs.existsSync(dbPath));
    await adapter.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  await t.test('loads existing database file', async () => {
    const dbPath = path.join(__dirname, 'load-test.db');
    const adapter1 = new SQLiteAdapter(dbPath);
    await adapter1.init();
    const run1 = await adapter1.createTaskRun({
      id: 1,
      task_identifier: 'test-task',
      status: 'completed'
    });
    await adapter1.close();

    const adapter2 = new SQLiteAdapter(dbPath);
    await adapter2.init();
    const run2 = await adapter2.getTaskRun(run1.id);
    assert.ok(run2);
    assert.equal(run2.task_identifier, 'test-task');
    await adapter2.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });
});

test('SQLiteAdapter - TaskRun CRUD', async (t) => {
  let adapter;

  t.beforeEach(async () => {
    adapter = new SQLiteAdapter();
    await adapter.init();
  });

  t.afterEach(async () => {
    await adapter.close();
  });

  await t.test('creates a task run', async () => {
    const taskRun = await adapter.createTaskRun({
      id: 1,
      task_identifier: 'my-task',
      status: 'pending'
    });
    assert.ok(taskRun.id);
    assert.equal(taskRun.task_identifier, 'my-task');
  });

  await t.test('retrieves a task run by id', async () => {
    const created = await adapter.createTaskRun({
      id: 1,
      task_identifier: 'test-task',
      status: 'running'
    });
    const retrieved = await adapter.getTaskRun(created.id);
    assert.ok(retrieved);
    assert.equal(retrieved.id, created.id);
  });

  await t.test('returns null for nonexistent task run', async () => {
    const result = await adapter.getTaskRun(99999);
    assert.equal(result, null);
  });

  await t.test('updates a task run', async () => {
    const created = await adapter.createTaskRun({
      id: 1,
      task_identifier: 'update-test',
      status: 'pending'
    });
    const updated = await adapter.updateTaskRun(created.id, {
      status: 'completed'
    });
    assert.equal(updated.status, 'completed');
  });

  await t.test('queries task runs by identifier', async () => {
    await adapter.createTaskRun({ id: 1, task_identifier: 'task-a', status: 'pending' });
    await adapter.createTaskRun({ id: 2, task_identifier: 'task-b', status: 'running' });
    const results = await adapter.queryTaskRuns({ task_identifier: 'task-a' });
    assert.equal(results.length, 1);
  });

  await t.test('queries task runs by status', async () => {
    await adapter.createTaskRun({ id: 1, task_identifier: 'a', status: 'pending' });
    await adapter.createTaskRun({ id: 2, task_identifier: 'b', status: 'completed' });
    const results = await adapter.queryTaskRuns({ status: 'pending' });
    assert.equal(results.length, 1);
  });
});

test('SQLiteAdapter - StackRun CRUD', async (t) => {
  let adapter;

  t.beforeEach(async () => {
    adapter = new SQLiteAdapter();
    await adapter.init();
  });

  t.afterEach(async () => {
    await adapter.close();
  });

  await t.test('creates a stack run', async () => {
    const taskRun = await adapter.createTaskRun({
      id: 1,
      task_identifier: 'parent-task',
      status: 'running'
    });
    const stackRun = await adapter.createStackRun({
      id: 1,
      task_run_id: taskRun.id,
      operation: 'fetch_data',
      status: 'pending'
    });
    assert.ok(stackRun.id);
    assert.equal(stackRun.task_run_id, taskRun.id);
  });

  await t.test('queries stack runs with array filter', async () => {
    const taskRun = await adapter.createTaskRun({
      id: 1,
      task_identifier: 'test',
      status: 'running'
    });
    await adapter.createStackRun({
      id: 1,
      task_run_id: taskRun.id,
      operation: 'op1',
      status: 'pending'
    });
    await adapter.createStackRun({
      id: 2,
      task_run_id: taskRun.id,
      operation: 'op2',
      status: 'completed'
    });
    await adapter.createStackRun({
      id: 3,
      task_run_id: taskRun.id,
      operation: 'op3',
      status: 'failed'
    });
    const results = await adapter.queryStackRuns({
      status: ['pending', 'completed']
    });
    assert.ok(results.some(r => r.status === 'pending'));
    assert.ok(results.some(r => r.status === 'completed'));
  });

  await t.test('gets pending stack runs', async () => {
    const taskRun = await adapter.createTaskRun({
      id: 1,
      task_identifier: 'test',
      status: 'running'
    });
    await adapter.createStackRun({
      id: 1,
      task_run_id: taskRun.id,
      operation: 'op1',
      status: 'pending'
    });
    await adapter.createStackRun({
      id: 2,
      task_run_id: taskRun.id,
      operation: 'op2',
      status: 'suspended_waiting_child'
    });
    const pending = await adapter.getPendingStackRuns();
    assert.ok(pending.some(r => r.status === 'pending'));
  });
});

test('SQLiteAdapter - TaskFunction Storage', async (t) => {
  let adapter;

  t.beforeEach(async () => {
    adapter = new SQLiteAdapter();
    await adapter.init();
  });

  t.afterEach(async () => {
    await adapter.close();
  });

  await t.test('stores and retrieves a task function', async () => {
    const code = 'async function task() { return "result"; }';
    await adapter.storeTaskFunction({
      id: 1,
      identifier: 'test-func',
      code: code
    });
    const retrieved = await adapter.getTaskFunction('test-func');
    assert.ok(retrieved);
    assert.equal(retrieved.code, code);
  });

  await t.test('replaces existing task function', async () => {
    await adapter.storeTaskFunction({
      id: 1,
      identifier: 'upsert-test',
      code: 'version 1'
    });
    await adapter.storeTaskFunction({
      id: 1,
      identifier: 'upsert-test',
      code: 'version 2'
    });
    const retrieved = await adapter.getTaskFunction('upsert-test');
    assert.equal(retrieved.code, 'version 2');
  });
});

test('SQLiteAdapter - Keystore', async (t) => {
  let adapter;

  t.beforeEach(async () => {
    adapter = new SQLiteAdapter();
    await adapter.init();
  });

  t.afterEach(async () => {
    await adapter.close();
  });

  await t.test('stores and retrieves keystore values', async () => {
    const data = { userId: 123, name: 'test' };
    await adapter.setKeystore('user-prefs', JSON.stringify(data));
    const retrieved = await adapter.getKeystore('user-prefs');
    assert.deepEqual(retrieved, data);
  });

  await t.test('deletes a keystore value', async () => {
    await adapter.setKeystore('delete-key', JSON.stringify({ data: true }));
    await adapter.deleteKeystore('delete-key');
    const result = await adapter.getKeystore('delete-key');
    assert.equal(result, null);
  });
});

test('SQLiteAdapter - Persistence', async (t) => {
  await t.test('persists data to file on close', async () => {
    const dbPath = path.join(__dirname, 'persist-test.db');
    const adapter1 = new SQLiteAdapter(dbPath);
    await adapter1.init();
    const run = await adapter1.createTaskRun({
      id: 1,
      task_identifier: 'persist-task',
      status: 'completed'
    });
    await adapter1.close();

    const adapter2 = new SQLiteAdapter(dbPath);
    await adapter2.init();
    const retrieved = await adapter2.getTaskRun(run.id);
    assert.ok(retrieved);
    assert.equal(retrieved.task_identifier, 'persist-task');
    await adapter2.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  await t.test('multiple in-memory adapters are independent', async () => {
    const adapter1 = new SQLiteAdapter();
    const adapter2 = new SQLiteAdapter();
    await adapter1.init();
    await adapter2.init();

    const run1 = await adapter1.createTaskRun({
      id: 1,
      task_identifier: 'adapter-1-task',
      status: 'pending'
    });
    const run2 = await adapter2.createTaskRun({
      id: 1,
      task_identifier: 'adapter-2-task',
      status: 'pending'
    });

    assert.equal(run1.task_identifier, 'adapter-1-task');
    assert.equal(run2.task_identifier, 'adapter-2-task');

    await adapter1.close();
    await adapter2.close();
  });
});

test('SQLiteAdapter - Edge Cases', async (t) => {
  let adapter;

  t.beforeEach(async () => {
    adapter = new SQLiteAdapter();
    await adapter.init();
  });

  t.afterEach(async () => {
    await adapter.close();
  });

  await t.test('handles very long strings', async () => {
    const longString = 'x'.repeat(5000);
    const run = await adapter.createTaskRun({
      id: 1,
      task_identifier: longString,
      status: 'pending'
    });
    const retrieved = await adapter.getTaskRun(run.id);
    assert.equal(retrieved.task_identifier, longString);
  });

  await t.test('close is idempotent', async () => {
    await adapter.close();
    await adapter.close();
    assert.ok(true);
  });
});
