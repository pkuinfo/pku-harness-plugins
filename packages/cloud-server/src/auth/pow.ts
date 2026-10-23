/**
 * Proof-of-work state for `POST /v1/devices`. The salt rotates every `rotateS`; the previous
 * salt stays acceptable so a solve that started just before a rotation still succeeds.
 */
import { randomBytes } from 'node:crypto';

import { toB64url, verifyPow } from '@pku-harness/cloud-protocol';

import type { Storage } from '../db/storage';

interface SaltState {
  current: string;
  previous?: string;
  rotatedAt: number;
}

export class PowGate {
  private state?: SaltState;

  constructor(
    private readonly storage: Storage,
    readonly difficulty: number,
    private readonly rotateS: number,
  ) {}

  private async load(now: number): Promise<SaltState> {
    if (!this.state) {
      const raw = await this.storage.getSetting('pow_salt');
      this.state = raw ? (JSON.parse(raw) as SaltState) : { current: fresh(), rotatedAt: now };
      if (!raw) await this.save();
    }
    if (now - this.state.rotatedAt >= this.rotateS * 1000) {
      this.state = { current: fresh(), previous: this.state.current, rotatedAt: now };
      await this.save();
    }
    return this.state;
  }

  private async save() {
    await this.storage.setSetting('pow_salt', JSON.stringify(this.state));
  }

  /** What `GET /v1/meta` advertises. */
  async advertise(now: number): Promise<{ difficulty: number; salt: string }> {
    return { difficulty: this.difficulty, salt: (await this.load(now)).current };
  }

  async check(input: { salt: string; nonce: string; signPub: string; boxPub: string }, now: number): Promise<boolean> {
    const s = await this.load(now);
    if (input.salt !== s.current && input.salt !== s.previous) return false;
    return verifyPow({ salt: input.salt, signPub: input.signPub, boxPub: input.boxPub }, input.nonce, this.difficulty);
  }
}

const fresh = () => toB64url(new Uint8Array(randomBytes(12)));
