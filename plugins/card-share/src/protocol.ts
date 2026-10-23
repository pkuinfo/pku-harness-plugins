/**
 * card-share frames (docs/CLOUD.md §3.3). They travel inside the cloud channel's per-peer
 * envelopes, so the relay only ever sees ciphertext. The sharer's phone, the in-app viewer and
 * the web viewer (plugins/card-share/web) all validate with these same schemas.
 *
 * Pure zod, no React Native: the web viewer imports this file directly.
 */
import { z } from 'zod';

/** Bumped on breaking frame changes; viewers refuse metas with a newer version. */
export const FRAME_VERSION = 1;

/** Gates the viewer must pass before the first code (checked on the sharer's phone). */
export const gateKind = z.enum(['pin', 'name']);
export type GateKind = z.infer<typeof gateKind>;

/**
 * Channel meta, sealed with the link key by the host (`channels.open({ meta })`): anyone holding
 * the link reads it before joining. It never carries the full name or the PIN.
 */
export const shareMeta = z.object({
  v: z.literal(FRAME_VERSION),
  kind: z.literal('card-share'),
  /** Masked name the viewer completes, e.g. "王_明" (`_` = a hidden character). Absent: no name gate. */
  nameHint: z.string().min(1).max(32).optional(),
  pin: z.boolean(),
  /** Spend cap in yuan, shown to the viewer; null = none. */
  capYuan: z.number().nonnegative().nullable(),
  /** Display label for the card ("王同学的卡"), never the full name. */
  label: z.string().max(40).optional(),
});
export type ShareMeta = z.infer<typeof shareMeta>;

const pinAnswer = z.string().regex(/^\d{4,8}$/);
const nameAnswer = z.string().min(1).max(32);

/** Viewer → sharer. */
export const viewerFrame = z.discriminatedUnion('t', [
  /** Ask for a fresh code now (shown at the till, back from background, code looks stale). */
  z.object({ t: z.literal('want') }),
  /** Gate answers; send all required ones together. */
  z.object({ t: z.literal('gate'), pin: pinAnswer.optional(), name: nameAnswer.optional() }),
]);
export type ViewerFrame = z.infer<typeof viewerFrame>;

/** Why a share ended, as told to the viewer. */
export const endReason = z.enum(['owner', 'expired', 'cap', 'locked', 'revoked', 'server', 'error']);
export type EndReason = z.infer<typeof endReason>;

/** Sharer → viewer. */
export const ownerFrame = z.discriminatedUnion('t', [
  /** A payment code (QR content). `seq` grows by one per minted code. */
  z.object({
    t: z.literal('code'),
    code: z.string().min(1).max(512),
    issuedAt: z.number().int().nonnegative(),
    seq: z.number().int().positive(),
    /** Card balance in yuan when the code was minted. */
    balance: z.number().nullable().optional(),
    /** Seconds until the sharer pushes the next code. */
    refreshS: z.number().int().positive().optional(),
  }),
  z.object({
    t: z.literal('gate_result'),
    ok: z.boolean(),
    /** Attempts left before the share closes (on failure). */
    remaining: z.number().int().nonnegative().optional(),
    /** Which answers were wrong (on failure). */
    wrong: z.array(gateKind).optional(),
  }),
  /** The share is over; the viewer should drop any code it shows. */
  z.object({ t: z.literal('revoked'), reason: endReason }),
  z.object({
    t: z.literal('status'),
    /**
     * gate: answer `need` first · live: codes flow · paused: the sharer can't mint right now
     * (card service down, not in 数字卡 mode) · capped: spend cap reached.
     */
    state: z.enum(['gate', 'live', 'paused', 'capped']),
    need: z.array(gateKind).optional(),
    expiresAt: z.number().int().nonnegative(),
    spentYuan: z.number().nonnegative().optional(),
    capYuan: z.number().nonnegative().nullable().optional(),
    /** Plain text for `paused`. */
    message: z.string().max(200).optional(),
  }),
]);
export type OwnerFrame = z.infer<typeof ownerFrame>;

export function parseViewerFrame(msg: unknown): ViewerFrame | undefined {
  const r = viewerFrame.safeParse(msg);
  return r.success ? r.data : undefined;
}

export function parseOwnerFrame(msg: unknown): OwnerFrame | undefined {
  const r = ownerFrame.safeParse(msg);
  return r.success ? r.data : undefined;
}

export function parseMeta(meta: unknown): ShareMeta | undefined {
  const r = shareMeta.safeParse(meta);
  return r.success ? r.data : undefined;
}

/** Gates a meta asks for, in the order the viewer form shows them. */
export function gatesOf(meta: Pick<ShareMeta, 'nameHint' | 'pin'>): GateKind[] {
  const out: GateKind[] = [];
  if (meta.nameHint) out.push('name');
  if (meta.pin) out.push('pin');
  return out;
}
