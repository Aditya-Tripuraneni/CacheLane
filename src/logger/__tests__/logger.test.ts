import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from '../index';

describe('Logger', () => {
  let logDir: string;
  let logFile: string;

  beforeEach(() => {
    logDir = path.join(os.tmpdir(), `cachelane-test-${Date.now()}-${Math.random()}`);
    logFile = path.join(logDir, 'cachelane.log');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-24T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    if (fs.existsSync(logDir)) {
      fs.rmSync(logDir, { recursive: true, force: true });
    }
  });

  it('should initialize and create the log file directory', () => {
    new Logger({ logDir });
    expect(fs.existsSync(logDir)).toBe(true);
  });

  it('should write a JSON-lines formatted log', () => {
    const logger = new Logger({ logDir, sessionId: 'test-session-123' });
    logger.info('test_event', 'Hello world');

    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed).toMatchObject({
      ts: '2026-05-24T12:00:00.000Z',
      level: 'info',
      pid: process.pid,
      session_id: 'test-session-123',
      event: 'test_event',
      message: 'Hello world'
    });
    expect(parsed.err).toBeUndefined();
  });

  it('should include error details when level is error', () => {
    const logger = new Logger({ logDir });
    const err = new Error('Test error');
    err.name = 'TestError';
    logger.error('error_event', 'An error occurred', err);

    const content = fs.readFileSync(logFile, 'utf8');
    const parsed = JSON.parse(content.trim());

    expect(parsed.level).toBe('error');
    expect(parsed.err).toBeDefined();
    expect(parsed.err.name).toBe('TestError');
    expect(parsed.err.message).toBe('Test error');
    expect(parsed.err.stack).toBeDefined();
  });

  it('should filter logs based on minLevel', () => {
    const logger = new Logger({ logDir, minLevel: 'warn' });
    logger.debug('debug_event', 'debug msg');
    logger.info('info_event', 'info msg');
    logger.warn('warn_event', 'warn msg');
    logger.error('error_event', 'error msg');

    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(2);

    expect(JSON.parse(lines[0]).level).toBe('warn');
    expect(JSON.parse(lines[1]).level).toBe('error');
  });

  it('should respect CACHELANE_DEBUG env variable', () => {
    const orig = process.env.CACHELANE_DEBUG;
    process.env.CACHELANE_DEBUG = '1';
    
    const logger = new Logger({ logDir });
    logger.debug('debug_event', 'debug msg');
    
    process.env.CACHELANE_DEBUG = orig;

    const content = fs.readFileSync(logFile, 'utf8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.level).toBe('debug');
  });

  it('should rotate logs when maxFileSize is reached', () => {
    const maxFileSize = 100; // 100 bytes
    const logger = new Logger({ logDir, maxFileSize, maxFiles: 3 });

    // Write first line
    logger.info('ev1', 'Short message'); // Approx 105 bytes, over maxFileSize
    
    expect(fs.existsSync(logFile)).toBe(true);
    expect(fs.existsSync(`${logFile}.1`)).toBe(false);

    // Write second line (should trigger rotation because current size + new size > 100)
    logger.info('ev2', 'Another message');
    
    expect(fs.existsSync(`${logFile}.1`)).toBe(true); // ev1 is here
    expect(fs.existsSync(logFile)).toBe(true);        // ev2 is here

    // Write third line
    logger.info('ev3', 'Third message');

    expect(fs.existsSync(`${logFile}.2`)).toBe(true); // ev1 is here
    expect(fs.existsSync(`${logFile}.1`)).toBe(true); // ev2 is here
    expect(fs.existsSync(logFile)).toBe(true);        // ev3 is here

    // Write fourth line, pushing ev1 out
    logger.info('ev4', 'Fourth message');

    expect(fs.existsSync(`${logFile}.3`)).toBe(false); // maxFiles is 3, so .3 should not exist (.log, .1, .2)
    expect(fs.existsSync(`${logFile}.2`)).toBe(true); // ev2
    expect(fs.existsSync(`${logFile}.1`)).toBe(true); // ev3
    expect(fs.existsSync(logFile)).toBe(true);        // ev4
    
    const file2Content = fs.readFileSync(`${logFile}.2`, 'utf8');
    expect(JSON.parse(file2Content.trim()).event).toBe('ev2');
  });

  it('should not throw if logDir creation fails (fail-open)', () => {
    // /root is generally not writable, or a mock
    const readOnlyDir = '/dev/null/invalid-dir';
    expect(() => {
      const logger = new Logger({ logDir: readOnlyDir });
      logger.info('test', 'msg');
    }).not.toThrow();
  });
});
