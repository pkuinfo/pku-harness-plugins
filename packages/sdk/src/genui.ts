import { z } from 'zod';

/** A json-render spec as the agent writes it (components come from the host's catalog). */
export const specSchema = z.object({
  root: z.string().describe('id of the root element'),
  elements: z.record(
    z.string(),
    z.object({
      type: z.string(),
      props: z.record(z.string(), z.unknown()),
      children: z.array(z.string()).optional(),
      on: z.record(z.string(), z.unknown()).optional(),
      visible: z.unknown().optional(),
    }),
  ),
  state: z.record(z.string(), z.unknown()).optional().describe('initial state, e.g. { "form": { "amount": "50" } }'),
});

export type UISpec = z.infer<typeof specSchema>;

export type SpecCheck = { ok: true; spec: UISpec } | { ok: false; issues: string[] };
