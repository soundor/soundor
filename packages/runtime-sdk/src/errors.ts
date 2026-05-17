export class SoundorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SoundorError';
  }
}
