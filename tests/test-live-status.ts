import assert from 'assert';
import { deviceManager } from '../src/server/deviceManager';

console.log('▶ Testing Live Machine & Hub Status system...');

const testDev = deviceManager.registerWorker({
  id: 'test-live-pc',
  name: 'Test Live PC',
  status: 'online',
  os: 'Windows 11',
  hostname: 'DESKTOP-TEST',
  defaultWorkspace: 'C:\\test',
} as any, { close: () => {}, terminate: () => {} } as any);

assert(testDev.status === 'online', 'Device registered online');

// 1. Live Heartbeat with RAM
const updated = deviceManager.updateHeartbeat('test-live-pc', { total: 16000, free: 8000, used: 8000 }, 1.5);
assert(updated !== null, 'Heartbeat returned updated device');
assert(updated?.memoryUsage?.used === 8000, 'RAM usage updated live');
assert(updated?.cpuUsage === 1.5, 'CPU usage updated live');
console.log('✔ Live Heartbeat and RAM telemetry verified');

// 2. Live Limits update
const withLimits = deviceManager.updateDeviceLimits('test-live-pc', { brainStorageSizeMb: 45.2 }, { loggedIn: true, email: 'user@example.com' });
assert(withLimits !== null, 'Limits returned updated device');
assert((withLimits as any)?.cursorAuthStatus?.email === 'user@example.com', 'Cursor live auth verified');
console.log('✔ Live Limits & Auth telemetry verified');

// 3. Online count
assert(deviceManager.getOnlineDevicesCount() >= 1, 'Online devices count accurate');
console.log('✔ Online devices count verified');

// Cleanup
deviceManager.unregisterWorker('test-live-pc');

console.log('\n🎉 LIVE STATUS TEST PASSED!\n');
process.exit(0);
