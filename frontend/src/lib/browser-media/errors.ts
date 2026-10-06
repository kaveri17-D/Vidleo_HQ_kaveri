/**
 * Typed Error classes for browser media operations
 */

export class BrowserMediaError extends Error {
  public readonly code: string;
  public readonly stage?: string;
  public readonly details?: any;

  constructor(message: string, code = 'BROWSER_MEDIA_ERROR', stage?: string, details?: any) {
    super(message);
    this.name = 'BrowserMediaError';
    this.code = code;
    this.stage = stage;
    this.details = details;
  }
}

export class CapabilityError extends BrowserMediaError {
  constructor(message: string, details?: any) {
    super(message, 'CAPABILITY_NOT_SUPPORTED', 'checking_capabilities', details);
    this.name = 'CapabilityError';
  }
}

export class InputSizeExceededError extends BrowserMediaError {
  constructor(inputSizeBytes: number, maxSafeBytes: number) {
    const inputMB = (inputSizeBytes / (1024 * 1024)).toFixed(1);
    const maxMB = (maxSafeBytes / (1024 * 1024)).toFixed(1);
    super(
      `Input media size (${inputMB}MB) exceeds safe browser processing threshold (${maxMB}MB). Server routing recommended.`,
      'INPUT_SIZE_EXCEEDED',
      'checking_capabilities',
      { inputSizeBytes, maxSafeBytes }
    );
    this.name = 'InputSizeExceededError';
  }
}

export class DurationExceededError extends BrowserMediaError {
  constructor(durationSeconds: number, maxSeconds: number) {
    super(
      `Media duration (${Math.round(durationSeconds)}s) exceeds safe client processing threshold (${maxSeconds}s).`,
      'DURATION_EXCEEDED',
      'checking_capabilities',
      { durationSeconds, maxSeconds }
    );
    this.name = 'DurationExceededError';
  }
}

export class EngineLoadError extends BrowserMediaError {
  constructor(message: string, originalError?: any) {
    super(`Failed to load WebAssembly media engine: ${message}`, 'ENGINE_LOAD_FAILED', 'loading_engine', originalError);
    this.name = 'EngineLoadError';
  }
}

export class OperationCancelledError extends BrowserMediaError {
  constructor() {
    super('Browser media processing was cancelled by user.', 'OPERATION_CANCELLED', 'cancelled');
    this.name = 'OperationCancelledError';
  }
}

export class FFmpegExecutionError extends BrowserMediaError {
  public readonly exitCode?: number;
  public readonly logOutput?: string[];

  constructor(message: string, exitCode?: number, logOutput?: string[]) {
    super(message, 'FFMPEG_EXECUTION_FAILED', 'processing', { exitCode, logOutput });
    this.name = 'FFmpegExecutionError';
    this.exitCode = exitCode;
    this.logOutput = logOutput;
  }
}
