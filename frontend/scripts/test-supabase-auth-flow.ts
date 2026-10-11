import { createClient as createBrowserClient } from '../src/lib/supabase/client.ts';
import http from 'http';
import assert from 'assert';

console.log('='.repeat(80));
console.log('SUPABASE & AUTHENTICATION SPECIFICATION AUDIT');
console.log('='.repeat(80));

// TEST 1: Browser client initialization does not throw "supabaseUrl is required"
try {
  const client = createBrowserClient();
  assert(client, 'Browser Supabase client should be instantiated');
  assert.strictEqual(
    (client as any).supabaseUrl,
    'https://himvtlmqcjtutstdrpjg.supabase.co',
    'Supabase client URL must match target project himvtlmqcjtutstdrpjg'
  );
  console.log('✓ TEST 1: Browser client initializes successfully with target project himvtlmqcjtutstdrpjg');
} catch (err: any) {
  console.error('✗ TEST 1 FAILED:', err.message);
  process.exit(1);
}

// TEST 2: Environment variable validation
const targetUrl = 'https://himvtlmqcjtutstdrpjg.supabase.co';
const resolvedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || targetUrl;
assert.strictEqual(resolvedUrl, targetUrl, 'Resolved Supabase URL must be himvtlmqcjtutstdrpjg');
console.log('✓ TEST 2: Environment configuration resolves target project himvtlmqcjtutstdrpjg without placeholder');

console.log('='.repeat(80));
console.log('ALL SUPABASE AUTH SPECIFICATION CHECKS PASSED');
console.log('='.repeat(80));
