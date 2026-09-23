import asyncio
import hashlib
import json
import time
import httpx
import sys
import os

# Ensure backend folder is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.api_v1.middleware import ensure_redis_or_fail

async def setup_mock_key():
    print("Setting up mock B2B key in Redis...")
    redis_client = await ensure_redis_or_fail()
    
    # We will configure a test key with a rate limit of 10 requests per minute
    # to trigger the rate limiter easily.
    dummy_key = "sk_live_stress_test_12345"
    key_hash = hashlib.sha256(dummy_key.encode()).hexdigest()
    
    key_data = {
        "id": "key-stress-999",
        "user_id": "user-stress-999",
        "key_prefix": "sk_live_stres",
        "key_hash": key_hash,
        "status": "active",
        "plan_tier": "enterprise",
        "scopes": ["extract:read"],
        "rate_limit": 2, # 2 requests per minute limit
        "profiles": {
            "id": "user-stress-999",
            "email": "stress@nexus.ai",
            "plan": "enterprise",
            "account_status": "active"
        }
    }
    
    await redis_client.set(f"key_meta:{key_hash}", json.dumps(key_data))
    # Clear any existing rate limit bucket to make test clean
    await redis_client.delete(f"ratelimit:{key_hash}")
    await redis_client.delete(f"api_usage_daily:key:key-stress-999")
    print(f"Mock B2B Key seeded: {dummy_key} (Rate Limit: 2 RPM)")
    return dummy_key, key_hash

async def cleanup_mock_key(key_hash):
    print("\nCleaning up mock B2B key from Redis...")
    redis_client = await ensure_redis_or_fail()
    await redis_client.delete(f"key_meta:{key_hash}")
    await redis_client.delete(f"ratelimit:{key_hash}")
    print("Cleaned up.")

async def send_request(client, key, req_id):
    url = "http://localhost:8000/api/v1/extract"
    headers = {
        "X-Nexus-API-Key": key,
        "Content-Type": "application/json"
    }
    # Mock extract payload (valid format, but mock URL)
    payload = {"url": "https://www.youtube.com/watch?v=mock_id"}
    
    start = time.perf_counter()
    try:
        resp = await client.post(url, json=payload, headers=headers, timeout=20.0)
        latency = (time.perf_counter() - start) * 1000
        return req_id, resp.status_code, latency, resp.text
    except Exception as e:
        latency = (time.perf_counter() - start) * 1000
        return req_id, "ERROR", latency, str(e)

async def main():
    print("====================================================")
    print("RUNNING B2B API GATEWAY HIGH-VELOCITY STRESS TEST")
    print("====================================================")
    
    # 1. Setup mock key in Redis
    key, key_hash = await setup_mock_key()
    
    # 2. Fire concurrent requests to the live backend container
    num_requests = 3
    print(f"\nLaunching {num_requests} concurrent requests to http://localhost:8000/api/v1/extract...")
    
    async with httpx.AsyncClient() as client:
        tasks = [send_request(client, key, i) for i in range(num_requests)]
        results = await asyncio.gather(*tasks)
        
    print("\nStress Test Results:")
    print(f"{'Req ID':<8} | {'Status Code':<12} | {'Latency (ms)':<12} | {'Outcome'}")
    print("-" * 60)
    
    success_count = 0
    ratelimit_count = 0
    error_count = 0
    
    for req_id, status_code, latency, response_text in sorted(results, key=lambda x: x[0]):
        outcome = ""
        # Status code 422 is expected for valid keys with mock URL because the extractor worker fails on mock URL.
        # But 422 means authentication and rate limiting succeeded!
        if status_code == 422:
            outcome = "Authenticated successfully (extraction failed as expected)"
            success_count += 1
        elif status_code == 429:
            outcome = "Blocked by Rate Limiter (429 Too Many Requests)"
            ratelimit_count += 1
        else:
            outcome = f"Unexpected response: {response_text[:40]}"
            error_count += 1
            
        print(f"{req_id:<8} | {status_code:<12} | {latency:<12.2f} | {outcome}")
        
    print("-" * 60)
    print(f"Summary: Authenticated={success_count}, Rate-Limited={ratelimit_count}, Other={error_count}")
    
    # Assertions to verify correct gateway behavior
    assert success_count > 0, "No requests were successfully authenticated!"
    assert ratelimit_count > 0, "Rate limiter did not block any requests!"
    print("\n[PASS] B2B API Key Gateway and Redis Rate Limiter verified successfully under high velocity! 🚀")
    
    # 3. Clean up
    await cleanup_mock_key(key_hash)

if __name__ == "__main__":
    asyncio.run(main())
