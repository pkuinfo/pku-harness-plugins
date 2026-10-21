import { describe, expect, test } from 'bun:test';

import { deliveryBlocker } from './notify';

describe('deliveryBlocker', () => {
  test('null when notifications and exact alarms are on, whatever the battery', () => {
    expect(deliveryBlocker({ notifications: 'granted', exactAlarms: true, batteryOptimized: false })).toBeNull();
    expect(deliveryBlocker({ notifications: 'granted', exactAlarms: true, batteryOptimized: true })).toBeNull();
  });
  test('notifications come first', () => {
    expect(deliveryBlocker({ notifications: 'undetermined', exactAlarms: false, batteryOptimized: true })).toBe('notifications');
    expect(deliveryBlocker({ notifications: 'denied', exactAlarms: true, batteryOptimized: false })).toBe('notifications');
  });
  test('then exact alarms', () => {
    expect(deliveryBlocker({ notifications: 'granted', exactAlarms: false, batteryOptimized: false })).toBe('exactAlarms');
  });
});
