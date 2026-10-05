/**
 * NEXUS Browser HLS — Centralized Resource Limits & Configuration Constants
 */

// Maximum playlist file size (2 MB)
export const MAX_HLS_PLAYLIST_BYTES = 2 * 1024 * 1024;

// Maximum number of segments allowed in a single media playlist (5,000 segments)
export const MAX_HLS_SEGMENTS = 5000;

// Maximum size for a single segment (50 MB)
export const MAX_HLS_SEGMENT_BYTES = 50 * 1024 * 1024;

// Maximum key file size (4 KB, standard AES-128 is 16 bytes)
export const MAX_HLS_KEY_BYTES = 4096;

// Maximum total media size for a single HLS asset (2 GB)
export const MAX_HLS_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

// Maximum allowed duration in seconds (4 hours = 14,400s)
export const MAX_HLS_DURATION_SECONDS = 14400;

// Strict bounded concurrency: MAX 2 segments in flight simultaneously
export const MAX_HLS_CONCURRENT_SEGMENTS = 2;

// Maximum transient retries per segment/resource
export const MAX_HLS_RETRIES = 3;

// Maximum redirect hops
export const MAX_HLS_REDIRECTS = 3;

// Initial retry backoff delay in milliseconds
export const HLS_RETRY_BACKOFF_MS = 500;
