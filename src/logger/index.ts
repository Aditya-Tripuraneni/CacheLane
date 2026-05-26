import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LoggerOptions {
  logDir?: string;
  maxFileSize?: number;
  maxFiles?: number;
  sessionId?: string;
  minLevel?: LogLevel;
}

export class Logger {
  private logDir: string;
  private logFile: string;
  private maxFileSize: number;
  private maxFiles: number;
  private currentFileSize = 0;
  private sessionId: string;
  private minLevel: number;
  private initializationFailed = false;

  constructor(options: LoggerOptions = {}) {
    this.logDir = options.logDir || path.join(os.homedir(), '.cachelane');
    this.logFile = path.join(this.logDir, 'cachelane.log');
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.maxFiles = options.maxFiles || 5;
    this.sessionId = options.sessionId || 'unknown';
    
    const envLevel = process.env.CACHELANE_DEBUG === '1' ? 'debug' : 'info';
    this.minLevel = LEVELS[options.minLevel || envLevel as LogLevel];

    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      
      if (fs.existsSync(this.logFile)) {
        const stats = fs.statSync(this.logFile);
        this.currentFileSize = stats.size;
        if (this.currentFileSize >= this.maxFileSize) {
          this.rotateSync();
        }
      }
    } catch {
      // Fail-open: if we can't create dir or stat file, we just disable logging
      this.initializationFailed = true;
    }
  }

  public setSessionId(id: string) {
    this.sessionId = id;
  }

  private rotateSync() {
    try {
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const oldFile = i === 1 ? this.logFile : `${this.logFile}.${i - 1}`;
        const newFile = `${this.logFile}.${i}`;
        if (fs.existsSync(oldFile)) {
          if (i === this.maxFiles) {
            fs.unlinkSync(oldFile);
          } else {
            fs.renameSync(oldFile, newFile);
          }
        }
      }
      this.currentFileSize = 0;
    } catch {
      // Fail-open: if rotation fails, we might just keep writing to the same file or stop logging.
      this.currentFileSize = 0;
    }
  }

  public log(level: LogLevel, event: string, message: string, error?: unknown, extras?: Record<string, unknown>) {
    if (this.initializationFailed || LEVELS[level] < this.minLevel) {
      return;
    }

    const payload: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      pid: process.pid,
      session_id: this.sessionId,
      event,
      message,
      ...extras,
    };

    if (level === 'error' && error instanceof Error) {
      payload.err = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    } else if (level === 'error' && error !== undefined) {
      payload.err = {
        message: String(error),
      };
    }

    const line = JSON.stringify(payload) + '\n';
    const lineSize = Buffer.byteLength(line);

    try {
      if (this.currentFileSize + lineSize > this.maxFileSize) {
        this.rotateSync();
      }

      fs.appendFileSync(this.logFile, line);
      this.currentFileSize += lineSize;
    } catch {
      // Fail-open: ignore write errors
    }
  }

  public debug(event: string, message: string, extras?: Record<string, unknown>) {
    this.log('debug', event, message, undefined, extras);
  }

  public info(event: string, message: string, extras?: Record<string, unknown>) {
    this.log('info', event, message, undefined, extras);
  }

  public warn(event: string, message: string, extras?: Record<string, unknown>) {
    this.log('warn', event, message, undefined, extras);
  }

  public error(event: string, message: string, error?: unknown, extras?: Record<string, unknown>) {
    this.log('error', event, message, error, extras);
  }
}

// Export a singleton instance for default usage
export const logger = new Logger();
