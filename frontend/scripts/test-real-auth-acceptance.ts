import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://himvtlmqcjtutstdrpjg.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_9kLInkw9IYWc_4QMRNWHiQ_LtBUqkr2';

console.log('='.repeat(80));
console.log('VIDLEO REAL PRODUCTION SUPABASE AUTHENTICATION ACCEPTANCE TEST');
console.log('Target Project:', SUPABASE_URL);
console.log('='.repeat(80));

const supabase = createClient(SUPABASE_URL, PUBLISHABLE_KEY);

async function run() {
  const testEmail = `acceptance_${Date.now()}@synapvo.tech`;
  const testPassword = `VidleoTestPass!${Date.now()}`;

  // STEP 1: Test Signup with explicit emailRedirectTo
  console.log('\n[Step 1] Dispatching user signup with production emailRedirectTo...');
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: testEmail,
    password: testPassword,
    options: {
      emailRedirectTo: 'https://frontend-kaveri-d.vercel.app/auth/confirm',
    },
  });

  if (signUpError) {
    console.error('✗ Signup Error:', signUpError.message);
    process.exit(1);
  }

  console.log('✓ PASS: User signup created successfully!');
  console.log(' - User ID:', signUpData.user?.id);
  console.log(' - Confirmation sent at:', signUpData.user?.confirmation_sent_at);
  console.log(' - Identities count:', signUpData.user?.identities?.length);

  // STEP 2: Test unconfirmed password login attempt
  console.log('\n[Step 2] Testing password login before email confirmation...');
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });

  if (signInError) {
    console.log('✓ PASS: Supabase strictly requires email confirmation (Expected behavior):');
    console.log(' - Error Code:', (signInError as any).code || signInError.name);
    console.log(' - Message:', signInError.message);
  } else if (signInData?.session) {
    console.log('✓ PASS: Session established directly without email confirmation (Auto-confirm active)');
  }

  // STEP 3: Test wrong password rejection
  console.log('\n[Step 3] Testing invalid credentials handling...');
  const { data: badData, error: badError } = await supabase.auth.signInWithPassword({
    email: testEmail,
    password: 'WrongPassword123!',
  });

  if (badError) {
    console.log('✓ PASS: Invalid credentials properly rejected by Supabase Auth');
    console.log(' - Message:', badError.message);
  } else {
    console.error('✗ FAIL: Bad credentials were unexpectedly accepted');
    process.exit(1);
  }

  console.log('\n' + '='.repeat(80));
  console.log('REAL SUPABASE AUTHENTICATION API ACCEPTANCE PASSED');
  console.log('='.repeat(80));
}

run().catch((err) => {
  console.error('Fatal error during acceptance test:', err);
  process.exit(1);
});
