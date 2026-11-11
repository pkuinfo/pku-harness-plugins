import { defineTool, withModelImage, type PhoneService, type ToolContext } from '@pku-harness/sdk';
import { z } from 'zod';
import { loadCopilotVision } from './preferences';

/**
 * Vision fallback for apps that hide their accessibility tree from Copilot (WeChat ≥ 8.0.5x).
 * Off unless the user turned on "Let the AI see screenshots" in /copilot. `look` shows the model
 * a screenshot of the controlled display (never the user's own screen, never a protected one);
 * `tapAt` / `typeAt` act on a point of that screenshot and ask the user every time.
 */
export const SCREENSHOTS_OFF = 'Screenshots are off. Tell the user, in one sentence, that this app hides its contents from Copilot and that they can turn on "Let the AI see screenshots" in /copilot (Settings → Copilot) if they want you to continue by looking at screenshots.';
export const NO_IMAGE_MODEL = 'The current chat model cannot read images. Tell the user to switch to a model that reads images (for example DeepSeek-V4.1-Flash) in the model picker, then ask again.';

const session = z.object({ sessionId: z.string().uuid() });
const point = session.extend({
  snapshotId: z.string().min(1),
  x: z.number().int().min(0).max(10_000),
  y: z.number().int().min(0).max(10_000),
  target: z.string().trim().min(1).max(80),
});

async function requireVision(context: ToolContext) {
  if (context.actor !== 'agent' || !context.turn) throw new Error('Screenshots are only for the AI in a chat reply.');
  if (!(await loadCopilotVision(context.kv)).screenshots) throw new Error(SCREENSHOTS_OFF);
  if (!context.turn.acceptsImages) throw new Error(NO_IMAGE_MODEL);
}

/** What the approval prompt shows: the AI's own words for the target (quoted) and the point. */
const pointTarget = (input: z.infer<typeof point>, packageName: string) => ({ label: `“${input.target}” (${input.x}, ${input.y})`, context: packageName });

export function createVisionTools(control: (context: ToolContext) => PhoneService) {
  return {
    look: defineTool({
      title: '查看截图',
      description: 'Only when observe shows no or too few usable elements for an allowed app (for example WeChat) and the user turned screenshots on. Shows you a screenshot of the controlled app (never the user’s own screen; protected screens are refused) in the next message, plus the screen’s elements if any. Its snapshotId and width×height (screenshot pixels, origin top-left) are what tapAt/typeAt take. The screenshot carries a magenta grid: a line every tenth of the width and height, with its pixel value labelled on the top and left edges. Read a target’s position off those rulers (between which labelled lines it lies) instead of estimating pixels. Look again after every action.',
      input: session, effect: 'read', untrusted: true, serial: true,
      execute: async (a, c) => {
        await requireVision(c);
        const shot = await control(c).look(a.sessionId, c.signal);
        // Native refuses protected screens; never pass one on even if it slipped through.
        if (shot.screen.protected) throw new Error('This protected screen requires the user; it is never captured.');
        const mediaType = shot.image.mediaType === 'image/png' ? 'image/png' : 'image/jpeg';
        return withModelImage({
          sessionId: shot.screen.sessionId,
          snapshotId: shot.screen.snapshotId,
          packageName: shot.screen.packageName,
          width: shot.image.width,
          height: shot.image.height,
          coordinates: `tapAt/typeAt take x 0–${shot.image.width - 1} (left→right) and y 0–${shot.image.height - 1} (top→bottom) in this screenshot's pixels, with this snapshotId.`,
          elements: shot.screen.elements,
        }, { data: shot.image.data, mediaType });
      },
    }),
    tapAt: defineTool({
      title: '点按截图位置',
      description: 'Tap a point of the latest look screenshot (x, y in its pixels; its snapshotId). target: what you are tapping, as written on the screen (e.g. "发送"); the user approves every tap. Never use it when observe or look returned an element you could tap instead, and never for payments or passwords.',
      input: point, effect: 'write', untrusted: true, alwaysAsk: true, serial: true,
      resolveEffect: async (a, services) => {
        const assessed = await services.phone.assessAt(a.sessionId, a.snapshotId, a.x, a.y);
        return { effect: assessed.effect, target: pointTarget(a, assessed.target.context ?? '') };
      },
      execute: async (a, c) => {
        await requireVision(c);
        return control(c).execute(a.sessionId, 'tapAt', { snapshotId: a.snapshotId, x: a.x, y: a.y, authorizedEffect: c.effect }, c.signal);
      },
    }),
    typeAt: defineTool({
      title: '在截图位置输入',
      description: 'Tap the input field at a point of the latest look screenshot, then enter text (replacing what it holds). target: the field as shown on the screen (e.g. "输入框"); the user approves every call. Typing never sends: tap the send button separately. Never for passwords. Look again to check the result.',
      input: point.extend({ text: z.string().min(1).max(10_000) }), effect: 'write', untrusted: true, alwaysAsk: true, serial: true,
      resolveEffect: async (a, services) => {
        const assessed = await services.phone.assessAt(a.sessionId, a.snapshotId, a.x, a.y);
        return { effect: assessed.effect, target: pointTarget(a, assessed.target.context ?? '') };
      },
      execute: async (a, c) => {
        await requireVision(c);
        return control(c).execute(a.sessionId, 'typeAt', { snapshotId: a.snapshotId, x: a.x, y: a.y, text: a.text, authorizedEffect: c.effect }, c.signal);
      },
    }),
  };
}
