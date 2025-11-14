# CLAUDE.md - tasker-adaptor-sqlite

## Project Identity

**Purpose**: SQLite file-based storage backend for `tasker-sequential` task management system
**Type**: Storage adapter implementation (ES modules)
**License**: MIT
**Key Feature**: Zero native dependencies via sql.js (pure JavaScript SQLite)

## Architecture

### Core Class: `SQLiteAdapter`

Extends `StorageAdapter` from `tasker-adaptor` package.

**Constructor**: `new SQLiteAdapter(dbPath = ':memory:')`
- `:memory:` → ephemeral in-memory database
- `./path/to/db.db` → persistent file-based storage

**Initialization**: Must call `await adapter.init()` before use
- Lazy-loads SQL.js library (module-level singleton)
- Creates/loads database file
- Initializes schema if needed
- Returns self for chaining

**Cleanup**: Call `await adapter.close()` to persist changes
- Exports in-memory database to file
- Required for file-based databases only

### Database Schema (4 Tables)

| Table | Purpose | Key Indexes |
|-------|---------|-------------|
| `task_runs` | Top-level task execution records | task_identifier, status |
| `stack_runs` | Sequential execution stack records | task_run_id, status, parent_stack_run_id |
| `task_functions` | Stored task code/metadata | identifier (UNIQUE) |
| `keystore` | Generic key-value storage | key (UNIQUE) |

**Common Fields**:
- All tables: `id` (INTEGER PRIMARY KEY AUTOINCREMENT), `created_at`, `updated_at` (TIMESTAMP)
- Run records: `status`, `input`, `result`, `error` (JSON stored as TEXT)
- Stack runs: `parent_stack_run_id`, `suspended_at`, `resume_payload` for hierarchical execution

### Public API (15 Methods)

**Lifecycle**:
```javascript
await adapter.init()           // Initialize database
await adapter.close()          // Persist and close
```

**TaskRun CRUD**:
```javascript
await adapter.createTaskRun(taskRun)
await adapter.getTaskRun(id)
await adapter.updateTaskRun(id, updates)
await adapter.queryTaskRuns(filter)
```

**StackRun CRUD**:
```javascript
await adapter.createStackRun(stackRun)
await adapter.getStackRun(id)
await adapter.updateStackRun(id, updates)
await adapter.queryStackRuns(filter)  // Supports array values for IN clauses
await adapter.getPendingStackRuns()   // Specialized query: status IN ('pending', 'suspended')
```

**TaskFunction Storage** (upsert pattern):
```javascript
await adapter.storeTaskFunction(taskFunction)  // INSERT OR REPLACE
await adapter.getTaskFunction(identifier)
```

**Keystore Operations**:
```javascript
await adapter.setKeystore(key, value)    // Upsert
await adapter.getKeystore(key)
await adapter.deleteKeystore(key)
```

## Code Conventions & Patterns

### Data Serialization

- Uses `tasker-storage-utils` `Serializer` for all JSON operations
- Complex objects (input, result, error, metadata) stored as JSON TEXT
- Automatic serialization on write, deserialization on read
- Null-coalescing (`??`) for optional fields with defaults

### SQL Safety

**Always uses parameterized queries**:
```javascript
// Good: Prevents SQL injection
db.run('SELECT * FROM task_runs WHERE id = ?', [id])

// Never: Direct string interpolation
db.run(`SELECT * FROM task_runs WHERE id = ${id}`) // ❌
```

**Filter pattern**:
```javascript
// Object keys = column names
// Array values = IN clause
await queryStackRuns({
  task_run_id: 123,
  status: ['pending', 'running']  // → WHERE status IN (?, ?)
})
```

### Error Handling

- Try-catch around database operations (load, table creation, file export)
- Uses `logger.error()` from `tasker-logging` (never `console.error`)
- Graceful degradation: Load failure → new in-memory database
- Table creation: Ignores "table already exists" errors

### Async/Await Discipline

- All public methods are async (adapter interface requirement)
- `initSQL()` uses module-level caching (calls once, returns cached Promise)
- No sync operations except final file write (`fs.writeFileSync`)

### Field Defaults & Normalization

```javascript
// Status defaults
status: updates.status ?? existingRecord.status ?? 'pending'

// Timestamp handling
updated_at: CURRENT_TIMESTAMP  // Database-managed

// Parsing pattern
_parseTaskRun(row) {
  return {
    ...this.serializer.deserialize(row, RECORD_TYPES.TASK_RUN),
    // Normalization logic
  }
}
```

## Dependencies & Their Roles

| Package | Version | Purpose |
|---------|---------|---------|
| `sql.js` | ^1.10.2 | Pure JS SQLite implementation (no native bindings) |
| `tasker-adaptor` | ^1.0.0 | Base `StorageAdapter` interface |
| `tasker-storage-utils` | ^1.0.0 | `Serializer`, `CRUDPatterns`, `RECORD_TYPES` |
| `tasker-validators` | ^1.0.0 | Validation utilities (documented but not directly used) |
| `tasker-logging` | (imported) | Centralized logger service |
| `sequential-flow` | ^1.0.0 | Peer dependency: orchestration engine |

**Missing from package.json**: `tasker-logging` (add if causing import errors)

## Development Guidelines

### File Structure

```
src/
├── index.js      # Exports { SQLiteAdapter }
└── sqlite.js     # Main implementation (373 lines)
```

**No build step**: Pure ES modules, run directly with Node.js

### Testing

**Defined**: `npm test` → `node tests/test-sqlite-adapter.js`
**Status**: Test file doesn't exist yet

**Create tests for**:
- In-memory vs file-based persistence
- CRUD operations for all record types
- Filter/query patterns (especially array IN clauses)
- Error handling (invalid SQL, missing fields)
- Concurrent access patterns
- Database file creation/loading

### Git Workflow

**Current Branch**: `claude/create-comprehensive-claude-md-015UhM3wCsU3ASPXXvxH9EoZ`
**Main Branch**: Not specified (check remote)

**Ignored Files** (.gitignore):
- `node_modules/`, `*.db`, `*.db-shm`, `*.db-wal` (database artifacts)
- `.env`, `.env.local` (secrets)
- `*.log`, `dist/`, `build/` (outputs)
- IDE files (`.vscode/`, `.idea/`, `.DS_Store`)

## Critical Implementation Notes

### sql.js Persistence Model

**Not like better-sqlite3**:
- Database loads entirely into memory on `init()`
- Changes persist in memory during runtime
- Must call `close()` to export to file
- File write happens in one operation (no incremental writes)

**Implication**: Large databases = high memory usage

### Initialization Sequence

```javascript
const adapter = new SQLiteAdapter('./data/tasks.db')
await adapter.init()  // REQUIRED before any operations
// ... use adapter ...
await adapter.close() // REQUIRED for persistence
```

**Common Mistake**: Forgetting `init()` → "Database not initialized" errors

### Filter Query Syntax

```javascript
// Single value → WHERE column = ?
{ status: 'pending' }

// Array value → WHERE column IN (?, ?, ?)
{ status: ['pending', 'running', 'suspended'] }

// Multiple conditions → WHERE col1 = ? AND col2 IN (?)
{ task_run_id: 123, status: ['pending', 'running'] }

// Empty filter → No WHERE clause (returns all)
{}
```

### Timestamp Behavior

- `created_at`: Set by database on INSERT (DEFAULT CURRENT_TIMESTAMP)
- `updated_at`: Set by database on INSERT, updated on UPDATE via explicit SET
- Format: ISO 8601 string (YYYY-MM-DD HH:MM:SS)
- Timezone: UTC (sql.js default)

### Serialization Edge Cases

**Handles**:
- `null` values → stored as NULL
- `undefined` → treated as missing field (excluded from INSERT/UPDATE)
- Complex objects → JSON.stringify
- JSON parsing errors → logged but may throw

**Watch for**:
- Circular references in objects (will throw on serialize)
- Very large JSON strings (sqlite TEXT field limits)

## Recent Evolution

**Commit History** (newest first):
1. `76162f9` - Migrate to `logger` service (removed `console.error`)
2. `f04338e` - Refactor to use `tasker-storage-utils` and `tasker-validators`
3. `e8d21c2` - Fix sql.js undefined value binding errors
4. `f392213` - **Major change**: sql.js (pure JS) replaced better-sqlite3 (native)
5. `b8b21d4` - Initial commit

**Key Migration**: better-sqlite3 → sql.js for cross-platform compatibility

## Performance Characteristics

**Strengths**:
- Fast in-memory operations
- No network latency (file-based)
- Indexed queries (task_identifier, status, parent relationships)
- Suitable for dev/test and small production workloads

**Limitations**:
- Entire database in memory (not streaming)
- Single file persistence (no WAL mode streaming benefits)
- No connection pooling (single-user model)
- Export/import overhead on init/close

**Use Cases**:
- ✅ Local development
- ✅ Testing environments
- ✅ Small-scale production (<10k records)
- ✅ Embedded/edge deployments
- ❌ High-concurrency production
- ❌ Multi-process shared database

## Integration Points

**Orchestration**: Works with `sequential-flow` peer dependency
**Alternative**: `tasker-adaptor-supabase` for PostgreSQL backend
**Shared Patterns**: Uses same `tasker-storage-utils` as other adapters

**Compatibility**: Designed to be drop-in replacement for other storage adapters via common interface

## Quick Reference

### Create Adapter
```javascript
import { SQLiteAdapter } from 'tasker-adaptor-sqlite'

// In-memory (testing)
const adapter = new SQLiteAdapter()

// File-based (production)
const adapter = new SQLiteAdapter('./data/tasks.db')

await adapter.init()
```

### Common Operations
```javascript
// Create task run
const taskRun = await adapter.createTaskRun({
  task_identifier: 'my-task',
  status: 'pending',
  input: { foo: 'bar' }
})

// Query with filters
const pending = await adapter.queryTaskRuns({
  status: ['pending', 'running']
})

// Update
await adapter.updateTaskRun(taskRun.id, {
  status: 'completed',
  result: { success: true }
})

// Cleanup
await adapter.close()
```

### Debugging Tips

**Enable SQL logging**: Modify `db.run()` calls to log statements
**Inspect database**: Use sqlite3 CLI or DB Browser for SQLite on `.db` files
**Check timestamps**: Verify updated_at changes on updates (proves persistence)
**Memory usage**: Monitor for large databases (all in RAM)

## When to Choose This Adapter

**Choose SQLiteAdapter if**:
- Need local development environment without database server
- Building embedded application or edge deployment
- Want zero-config testing setup
- Cross-platform compatibility required (no native dependencies)
- Database size < 100MB (memory-friendly)

**Choose alternative if**:
- Multi-user concurrent access required → Supabase/PostgreSQL adapter
- Database > 1GB → Server-based solution
- Need real-time subscriptions → Supabase adapter
- Require connection pooling → Server-based database

---

**Last Updated**: 2025-11-14
**For Questions**: See README.md or tasker ecosystem documentation
