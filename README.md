# Sequential Adaptor SQLite

SQLite storage backend for sequential-ecosystem.

## Installation

```bash
npm install sequential-adaptor sequential-adaptor-sqlite
```

## Usage

```javascript
import { SQLiteAdapter } from 'sequential-adaptor-sqlite';
import { TaskExecutor } from 'sequential-adaptor';

const adapter = new SQLiteAdapter(':memory:');
await adapter.init();

const executor = new TaskExecutor(adapter);
```

## Via Registry

```javascript
import { createAdapter } from 'sequential-adaptor';

const adapter = await createAdapter('sqlite', { dbPath: './tasks.db' });
```

## Database Paths

```javascript
new SQLiteAdapter(':memory:')
new SQLiteAdapter('./tasks.db')
new SQLiteAdapter('/path/to/database.db')
```

## Environment Variables

```bash
SQLITE_DB_PATH=./tasks.db
```

## Features

- File-based storage
- WAL mode for concurrency
- Suitable for development and small deployments

## License

MIT
