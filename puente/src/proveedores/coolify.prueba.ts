import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estadoDe } from './coolify.js';

describe('estado de un portal de Coolify', () => {
  it('traduce running/exited y la salud', () => {
    assert.deepEqual(estadoDe('running:healthy'), {
      status: 'running',
      healthy: true
    });
    assert.deepEqual(estadoDe('running:unhealthy'), {
      status: 'running',
      healthy: false
    });
    assert.deepEqual(estadoDe('exited:unhealthy'), {
      status: 'stopped',
      healthy: false
    });
    assert.equal(estadoDe('degraded:unhealthy').status, 'error');
    assert.equal(estadoDe(undefined).status, 'unknown');
  });
});
