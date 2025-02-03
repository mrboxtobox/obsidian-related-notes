export class Logger {
  private static readonly PREFIX = '[Related Notes]';
  private static debugMode = false;

  static setDebugMode(enabled: boolean) {
    this.debugMode = enabled;
    this.info('Debug logging ' + (enabled ? 'enabled' : 'disabled'));
  }

  static debug(message: string, ...args: any[]) {
    if (this.debugMode) {
      console.info(`${this.PREFIX} ${message}`, ...args);
    }
  }

  static info(message: string, ...args: any[]) {
    console.info(`${this.PREFIX} ${message}`, ...args);
  }

  static warn(message: string, ...args: any[]) {
    console.warn(`${this.PREFIX} ${message}`, ...args);
  }

  static error(message: string, error?: any) {
    if (error) {
      console.error(`${this.PREFIX} ${message}`, error);
      if (error.stack) {
        console.error(`${this.PREFIX} Stack trace:`, error.stack);
      }
    } else {
      console.error(`${this.PREFIX} ${message}`);
    }
  }

  static time(label: string) {
    if (this.debugMode) {
      console.time(`${this.PREFIX} ${label}`);
    }
  }

  static timeEnd(label: string) {
    if (this.debugMode) {
      console.timeEnd(`${this.PREFIX} ${label}`);
    }
  }
}
