/**
 * @file Simplified logging utility for the Related Notes plugin.
 */
export class Logger {
  private static readonly PREFIX = '[Related Notes]';

  static info(message: string) {
    console.info(`${this.PREFIX} ${message}`);
  }

  static warn(message: string) {
    console.warn(`${this.PREFIX} ${message}`);
  }

  static error(message: string, error?: any) {
    console.error(`${this.PREFIX} ${message}`, error || '');
  }
}
