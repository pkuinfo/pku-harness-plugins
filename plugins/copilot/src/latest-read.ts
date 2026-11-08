/** Only the newest read may update the screen; a user action revokes pending reads. */
export class LatestPhoneRead {
  private revision = 0;

  begin(): () => boolean {
    const revision = ++this.revision;
    return () => revision === this.revision;
  }

  invalidate(): void { this.revision++; }
}
