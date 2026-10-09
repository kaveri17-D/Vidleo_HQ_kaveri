const FATAL_DECODE_PATTERNS = [
  /invalid\s+nal\s+unit\s+size/i,
  /error\s+splitting\s+the\s+input\s+into\s+nal\s+units/i,
  /missing\s+picture\s+in\s+access\s+unit/i,
  /error\s+while\s+decoding/i,
  /decoding\s+error/i,
  /invalid\s+data\s+found\s+when\s+processing\s+input/i,
];

/** Returns true for decoder/sample corruption, not ordinary FFmpeg notices. */
export function hasFatalDecodeDiagnostics(logs: string | string[]): boolean {
  const text = Array.isArray(logs) ? logs.join('\n') : logs;
  return FATAL_DECODE_PATTERNS.some((pattern) => pattern.test(text));
}
