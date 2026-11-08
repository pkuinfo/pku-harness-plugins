import { defineTool, type PhoneService, type ToolContext } from '@pku-harness/sdk';
import { z } from 'zod';

const session = z.object({ sessionId: z.string().uuid() });
const percent = z.number().finite().min(0).max(100);
const brightness = z.object({
  displayId: z.literal(0), percent,
  linear: z.number().finite(), minimum: z.number().finite(), maximum: z.number().finite(),
  adaptive: z.boolean(),
});
const change = z.object({ before: brightness, after: brightness, requestedPercent: percent, verified: z.boolean() });

/** Fixed device capability: no arbitrary settings keys, commands, or virtual-display actions. */
export function createBrightnessTools(control: (context: ToolContext) => PhoneService) {
  return {
    readBrightness: defineTool({
      title: '读取屏幕亮度',
      description: 'Read the physical main-screen brightness and adaptive mode, using Android’s perceptual percentage scale. Requires an active session with Settings selected. Does not open Settings or hand over control.',
      input: session.strict(), effect: 'read',
      execute: async (input, context) => brightness.parse(await control(context).readBrightness(input.sessionId, context.signal)),
    }),
    setBrightness: defineTool({
      title: '调整屏幕亮度',
      description: 'Set physical main-screen brightness to 0–100 perceptual percent and verify readback. Requires Settings selected. Optional adaptive=false selects manual mode for a fixed level; adaptive=true enables automatic adjustment; omission preserves the current mode. Automatic brightness may change the level after this result. No app handover is needed.',
      input: session.extend({ percent, adaptive: z.boolean().optional() }).strict(), effect: 'write',
      execute: async (input, context) => change.parse(await control(context).setBrightness(input.sessionId, input.percent, input.adaptive, context.signal)),
    }),
  };
}
