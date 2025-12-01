import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Create a mock logger module
const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

register('./loader.js', import.meta.url);

export { mockLogger };
