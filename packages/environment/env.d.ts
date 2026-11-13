declare module 'soundor:env' {
  /** Public build-time configuration. Projects add their configured keys through generated declarations. */
  export interface Environment {
    readonly DEV: boolean;
    readonly PROD: boolean;
    readonly MODE: 'development' | 'production';
  }
  /** Frozen, explicitly configured values. Contains no implicit process environment or secrets. */
  export const env: Readonly<Environment>;
}
