import { test } from 'node:test';
import assert from 'node:assert';

// Create a mock logger before importing SQLiteAdapter
const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

// Patch the logger module in require.cache equivalent for ESM
global.loggerInstance = mockLogger;

// Dynamically patch the sqlite.js module's logger before importing
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// For ESM, we need to use import assertions or dynamic imports
// Let's just create a wrapper that patches the module
async function getAdapterModule() {
  const mod = await import('../src/index.js');
  return mod;
}

// Simple workaround: create our own simple SQLiteAdapter test-friendly version
// by importing and then patching the logger
const { SQLiteAdapter: OriginalAdapter } = await getAdapterModule();

const createAdapter = () => new OriginalAdapter(':memory:');

test('SQLiteAdapter - Initialization', async (t) => {
  await t.test('initializes in-memory database', async () => {
    const adapter = createAdapter();
    await adapter.init();
    assert.ok(adapter.db, 'Database should be initialized');
  });

  await t.test('creates required tables on init', async () => {
    const adapter = createAdapter();
    await adapter.init();
    const tables = adapter.db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = tables.length > 0 ? tables[0].values.map(row => row[0]) : [];
    assert.ok(tableNames.includes('task_runs'), 'Should create task_runs table');
    assert.ok(tableNames.includes('stack_runs'), 'Should create stack_runs table');
  });
});

test('SQLiteAdapter - TaskRun CRUD', async (t) => {
  let adapter;

  t.beforeEach(async () => {
    adapter = createAdapter();
    await adapter.init();
  });

  await t.test('creates task run with auto-generated ID', async () => {
    const result = await adapter.createTaskRun({
      task_identifier: 'test-task',
      status: 'pending',
      input: { userId: '123' }
    });
    assert.ok(result.id, 'Should have ID');
    assert.equal(result.task_identifier, 'test-task');
  });

  await t.test('retrieves created task run', async () => {
    const created = await adapter.createTaskRun({
      task_identifier: 'test-task',
      status: 'pending',
      input: { foo: 'bar' }
    });
    const retrieved = await adapter.getTaskRun(created.id);
    assert.equal(retrieved.task_identifier, 'test-task');
  });

  await t.test('returns null for non-existent task run', async () => {
    const result = await adapter.getTaskRun('non-existent-id');
    assert.equal(result, null);
  });

  await t.test('updates task run status', async () => {
    const created = await adapter.createTaskRun({
      task_identifier: 'test-task',
      status: 'pending'
    });
    const updated = await adapter.updateTaskRun(created.id, {
      status: 'running'
    });
    assert.equal(updated.status, 'running');
  });

  await t.test('queries task runs with filter', async () => {
    await adapter.createTaskRun({
      task_identifier: 'task-1',
      status: 'pending'
    });
    await adapter.createTaskRun({
      task_identifier: 'task-2',
      status: 'completed'
    });
    const results = await adapter.queryTaskRuns({ status: 'pending' });
    assert.equal(results.length, 1);
  });
});

test('SQLiteAdapter - StackRun CRUD', async (t) => {
  let adapter;

  t.beforeEach(async () => {
    adapter = createAdapter();
    await adapter.init();
  });

  await t.test('creates stack run with parent reference', async () => {
    const taskRun = await adapter.createTaskRun({
      task_identifier: 'test-task',
      status: 'pending'
    });
    const result = await adapter.createStackRun({
      task_run_id: taskRun.id,
      operation: 'fetch',
      status: 'pending'
    });
    assert.ok(result.id);
    assert.equal(result.task_run_id, taskRun.id);
  });

  await t.test('updates stack run', async () => {
    const taskRun = await adapter.createTaskRun({
      task_identifier: 'test-task',
      status: 'pending'
    });
    const stackRun = await adapter.createStackRun({
      task_run_id: taskRun.id,
      operation: 'fetch',
      status: 'pending'
    });
    const updated = await adapter.updateStackRun(stackRun.id, {
      status: 'completed'
    });
    assert.equal(updated.status, 'completed');
  });

  await t.test('gets pending stack runs', async () => {
    const taskRun = await adapter.createTaskRun({
      task_identifier: 'test-task',
      status: 'pending'
    });
    await adapter.createStackRun({
      task_run_id: taskRun.id,
      operation: 'op1',
      status: 'pending'
    });
    const pending = await adapter.getPendingStackRuns();
    assert.ok(pending.length > 0);
  });
});

test('SQLiteAdapter - TaskFunction Storage', async (t) => {
  let adapter;

  t.beforeEach(async () => {
    adapter = createAdapter();
    await adapter.init();
  });

  await t.test('stores and retrieves task function', async () => {
    const code = 'export async function task(input) { return input; }';
    const stored = await adapter.storeTaskFunction({
      name: 'my-task',
      code
    });
    const retrieved = await adapter.getTaskFunction(stored.id);
    assert.equal(retrieved.code, code);
  });
});

test('SQLiteAdapter - Keystore', async (t) => {
  let adapter;

  t.beforeEach(async () => {
    adapter = createAdapter();
    await adapter.init();
  });

  await t.test('stores and retrieves key-value pair', async () => {
    await adapter.setKeystore('api-key', 'secret-value');
    const value = await adapter.getKeystore('api-key');
    assert.equal(value, 'secret-value');
  });

  await t.test('deletes keystore entry', async () => {
    await adapter.setKeystore('api-key', 'secret');
    await adapter.deleteKeystore('api-key');
    const value = await adapter.getKeystore('api-key');
    assert.equal(value, null);
  });
});

test('SQLiteAdapter - Data Serialization', async (t) => {
  let adapter;

  t.beforeEach(async () => {
    adapter = createAdapter();
    await adapter.init();
  });

  await t.test('preserves complex input structure', async () => {
    const input = {
      userId: '123',
      metadata: { timestamp: Date.now(), tags: ['important'] },
      nested: { deep: { value: true } }
    };
    const taskRun = await adapter.createTaskRun({
      task_identifier: 'complex-task',
      status: 'pending',
      input
    });
    const retrieved = await adapter.getTaskRun(taskRun.id);
    assert.deepEqual(retrieved.input, input);
  });

  await t.test('handles null values', async () => {
    const taskRun = await adapter.createTaskRun({
      task_identifier: 'test-task',
      status: 'pending',
      input: { nullValue: null }
    });
    const retrieved = await adapter.getTaskRun(taskRun.id);
    assert.strictEqual(retrieved.input.nullValue, null);
  });
});

test('SQLiteAdapter - Edge Cases', async (t) => {
  let adapter;

  t.beforeEach(async () => {
    adapter = createAdapter();
    await adapter.init();
  });

  await t.test('handles multiple concurrent creates', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        adapter.createTaskRun({
          task_identifier: `task-${i}`,
          status: 'pending'
        })
      );
    }
    const results = await Promise.all(promises);
    assert.equal(results.length, 10);
  });

  await t.test('maintains parent-child relationships', async () => {
    const taskRun = await adapter.createTaskRun({
      task_identifier: 'parent-task',
      status: 'running'
    });
    const parentStack = await adapter.createStackRun({
      task_run_id: taskRun.id,
      operation: 'parent',
      status: 'suspended'
    });
    const childStack = await adapter.createStackRun({
      task_run_id: taskRun.id,
      parent_stack_run_id: parentStack.id,
      operation: 'child',
      status: 'completed'
    });
    const retrieved = await adapter.getStackRun(childStack.id);
    assert.equal(retrieved.parent_stack_run_id, parentStack.id);
  });
});
