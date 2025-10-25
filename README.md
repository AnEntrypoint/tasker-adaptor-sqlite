# Tasker Adaptor SQLite

SQLite file-based storage backend for `tasker-sequential` via `tasker-adaptor`.

Perfect for local development and testing without requiring a database server.

## Features

- **File-Based Storage**: No server setup required
- **Zero Dependencies**: SQLite is embedded
- **WAL Mode**: Write-Ahead Logging for better concurrency
- **Fast Prototyping**: Ideal for development and testing
- **Production Ready**: Can be used for small deployments

## Installation

```bash
npm install tasker-adaptor tasker-adaptor-sqlite
```

## Quick Start

```javascript
import { SQLiteAdapter } from 'tasker-adaptor-sqlite';
import { TaskExecutor } from 'tasker-adaptor';

// Create in-memory database (perfect for testing)
const adapter = new SQLiteAdapter(':memory:');

// Or use file-based database
const adapter = new SQLiteAdapter('./tasks.db');

await adapter.init();

const executor = new TaskExecutor(adapter);
const result = await executor.execute(taskRun, taskCode);
```

## Database Location

```javascript
// In-memory (testing, ephemeral)
new SQLiteAdapter(':memory:')

// File-based (persistent)
new SQLiteAdapter('./tasks.db')
new SQLiteAdapter('/path/to/database.db')
```

## Performance

- **Connection**: Instant (file-based)
- **Queries**: Very fast for small-medium datasets
- **Concurrency**: WAL mode supports multiple readers
- **Scalability**: Suitable for up to thousands of tasks

For millions of tasks or high concurrency, use Supabase backend.

## Environment Variables

```bash
# Optional - customize database path
SQLITE_DB_PATH=./tasks.db
```

## Testing

```bash
npm test
```

## Integration with tasker-adaptor

This package extends `tasker-adaptor` with SQLite-specific storage:

```javascript
import { SQLiteAdapter } from 'tasker-adaptor-sqlite';
import { TaskExecutor, StackProcessor, ServiceClient } from 'tasker-adaptor';

const adapter = new SQLiteAdapter('./tasks.db');
await adapter.init();

const executor = new TaskExecutor(adapter);
const processor = new StackProcessor(adapter);
```

## Other Backends

- **tasker-adaptor-supabase** - Production Supabase backend
- **tasker-adaptor** - Base interfaces and core logic

## License

MIT
