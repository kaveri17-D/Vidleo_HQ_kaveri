import os
import sys
import asyncio
import hashlib
from unittest.mock import AsyncMock, patch, MagicMock
import httpx

# Ensure backend folder is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.api_v1.middleware import ensure_redis_or_fail
from backend.tasks import run_billing_reconciliation

class MockSupabaseResult:
    def __init__(self, data, error=None):
        self.data = data
        self.error = error

async def test_developer_key_generation_and_headers():
    print("Step 1: Testing B2B Developer Key Generation & Header Interception...")
    
    # We will test using httpx.AsyncClient to hit our endpoints
    from backend.main import app
    from backend.auth import get_current_user
    from backend.api_v1.middleware import verify_b2b_key

    # 1. Mock the user dependency so we are authenticated
    mock_user = {
        "id": "user-enterprise-999",
        "email": "enterprise@nexus.ai",
        "plan": "enterprise",
        "role": "user",
        "is_owner": False,
        "anonymous": False,
        "account_status": "active"
    }

    # 2. Mock create_api_key_record in middleware
    mock_record = {
        "id": "key-id-abc-123",
        "user_id": "user-enterprise-999",
        "key_prefix": "sk_live_abc123",
        "key_hash": hashlib.sha256(b"sk_live_dummykey").hexdigest(),
        "name": "Developer Key",
        "status": "active",
        "plan_tier": "enterprise",
        "scopes": ["extract:read", "download:create", "usage:read"],
        "rate_limit": 1200
    }

    async def mock_create(payload):
        return mock_record

    # Override get_current_user dependency
    app.dependency_overrides[get_current_user] = lambda: mock_user

    # Patch create_api_key_record
    patch_create = patch("backend.api_v1.router.create_api_key_record", side_effect=mock_create)

    transport = httpx.ASGITransport(app=app)

    with patch_create:
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            resp = await client.post("/api/v1/developer/keys")
            print("  Developer key generation status code:", resp.status_code)
            assert resp.status_code == 200
            json_data = resp.json()
            print("  Generated key payload properties:")
            print("    - key starts with:", json_data["key"][:8])
            print("    - prefix in data:", json_data["data"]["key_prefix"])
            assert json_data["key"].startswith("sk_live_")
            print("  [PASS] Cryptographic B2B Developer key generated successfully with correct prefix.")

    # 3. Test Header-based auth intercepting
    # Mock verify_b2b_key to bypass the DB check or verify it works with X-Nexus-API-Key
    mock_verified_key = {
        "user_id": "user-enterprise-999",
        "key_id": "key-id-abc-123",
        "plan": "enterprise",
        "role": "user",
        "is_owner": False,
        "scopes": ["extract:read"],
        "entitlement": {"plan": "enterprise", "api_enabled": True}
    }

    from fastapi import Request
    async def mock_verify(request: Request):
        # Assert header is read
        key = request.headers.get("X-Nexus-API-Key")
        assert key == "sk_live_test_key_123"
        return mock_verified_key

    # Patch verify_b2b_key dependency in FastAPI correctly
    app.dependency_overrides[verify_b2b_key] = mock_verify
    
    # Let's verify we can call extraction with X-Nexus-API-Key header
    # Mock ytdlp extraction to avoid network calls
    async def mock_extract_async(*args, **kwargs):
        return {"title": "B2B Test Video", "duration": 60}

    patch_extract = patch("backend.api_v1.router.extract_info_with_fallback", return_value={"title": "B2B Test Video", "duration": 60})
    patch_redis = patch("backend.api_v1.middleware.ensure_redis_or_fail", return_value=AsyncMock())

    with patch_extract, patch_redis:
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            resp = await client.post(
                "/api/v1/extract", 
                json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
                headers={"X-Nexus-API-Key": "sk_live_test_key_123"}
            )
            print("  B2B extract response status:", resp.status_code)
            if resp.status_code != 200:
                print("  B2B extract response content:", resp.text)
            assert resp.status_code == 200
            print("  [PASS] Header-based API key validation successfully authenticated.")

    app.dependency_overrides.clear()

async def test_prometheus_observability():
    print("\nStep 2: Testing Prometheus Observability & Celery metrics pull...")
    
    # Set mock Celery statistics in Redis
    redis_client = await ensure_redis_or_fail()
    await redis_client.set("metrics:tasks:success:tasks.metadata_probe_task", "105")
    await redis_client.set("metrics:tasks:failure:tasks.download_delivery_task", "7")
    
    from backend.main import app
    transport = httpx.ASGITransport(app=app)

    # Call /metrics endpoint
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        resp = await client.get("/metrics")
        assert resp.status_code == 200
        content = resp.text
    
    print("  Exposed Metrics sample checks:")
    lines = content.split("\n")
    success_line = [l for l in lines if 'nexus_celery_tasks_success_total{task_name="tasks.metadata_probe_task"}' in l]
    failure_line = [l for l in lines if 'nexus_celery_tasks_failure_total{task_name="tasks.download_delivery_task"}' in l]
    
    print("    - Success metric line:", success_line)
    print("    - Failure metric line:", failure_line)
    
    assert len(success_line) > 0 and "105" in success_line[0]
    assert len(failure_line) > 0 and "7" in failure_line[0]
    print("  [PASS] Prometheus metrics consolidated Celery metrics from Redis correctly.")

    # Clean up mock keys
    await redis_client.delete("metrics:tasks:success:tasks.metadata_probe_task")
    await redis_client.delete("metrics:tasks:failure:tasks.download_delivery_task")

async def test_paddle_metered_billing_overages():
    print("\nStep 3: Testing B2B Overage billing calculation & Paddle transaction sync...")
    
    # 1. Mock profiles in Supabase: one API user that exceeded their allowance, and one that is within limits
    mock_profiles = [
        {
            "id": "user-api-exceeded",
            "email": "developer-overage@nexus.ai",
            "plan": "api", # allowance: 150,000 requests / 30 days
            "paddle_customer_id": "ctm_9988",
            "paddle_subscription_id": "sub_7766"
        },
        {
            "id": "user-api-normal",
            "email": "developer-normal@nexus.ai",
            "plan": "api",
            "paddle_customer_id": "ctm_5544",
            "paddle_subscription_id": "sub_3322"
        }
    ]

    # Mock daily usage records in Supabase
    # user-api-exceeded has total 200,000 requests (overage = 50,000)
    # user-api-normal has total 40,000 requests (no overage)
    def mock_usage_query(table):
        mock_builder = MagicMock()
        mock_builder.select.return_value = mock_builder
        
        user_id_ref = [None]
        
        def mock_eq(column, val):
            if column == "user_id":
                user_id_ref[0] = val
            return mock_builder
            
        mock_builder.eq.side_effect = mock_eq
        mock_builder.gte.return_value = mock_builder
        
        def mock_execute():
            user_id = user_id_ref[0]
            if user_id == "user-api-exceeded":
                return MockSupabaseResult([{"request_count": 200000}])
            else:
                return MockSupabaseResult([{"request_count": 40000}])
                
        mock_builder.execute.side_effect = mock_execute
        return mock_builder

    mock_supabase_client = MagicMock()
    
    def mock_table(name):
        if name == "profiles":
            builder = MagicMock()
            builder.select.return_value = builder
            builder.execute.return_value = MockSupabaseResult(mock_profiles)
            return builder
        elif name == "api_key_usage_daily":
            return mock_usage_query(name)
        return MagicMock()

    mock_supabase_client.table.side_effect = mock_table

    # Mock Paddle billing client
    mock_paddle_client = MagicMock()
    mock_transactions = MagicMock()
    mock_paddle_client.transactions = mock_transactions

    patch_supabase = patch("backend.supabase_client.create_client", return_value=mock_supabase_client)
    patch_paddle_configured = patch("backend.payments.is_paddle_configured", return_value=True)
    patch_paddle_client = patch("backend.payments.get_paddle_client", return_value=mock_paddle_client)
    patch_reconcile = patch("backend.owner_router.refresh_billing_reconciliation_best_effort", return_value={"status": "ok"})

    os.environ["PADDLE_METERED_OVERAGE_PRICE_ID"] = "pri_overage_1122"

    print("  Running run_billing_reconciliation...")
    with patch_supabase, patch_paddle_configured, patch_paddle_client, patch_reconcile:
        # We need to set dummy environment variables so Supabase query runs
        os.environ["SUPABASE_URL"] = "https://mock.supabase.co"
        os.environ["SUPABASE_SERVICE_KEY"] = "mock-key"
        
        result = await run_billing_reconciliation()

    print("  Reconciliation result metered overages list count:", len(result["metered_overages"]))
    assert len(result["metered_overages"]) == 1
    
    overage = result["metered_overages"][0]
    print("  Overage calculations details:")
    print("    - User ID:", overage["user_id"])
    print("    - Usage requests:", overage["usage"])
    print("    - Overage cost:", overage["overage_cost"])
    print("    - Paddle billed status:", overage["paddle_billed"])
    print("    - Paddle errors reported:", overage["paddle_error"])

    assert overage["user_id"] == "user-api-exceeded"
    assert overage["usage"] == 200000
    # Overage = 200,000 - 150,000 = 50,000. Cost = 50,000 * 0.0005 = $25.0
    assert overage["overage_cost"] == 25.0
    assert overage["paddle_billed"] is True
    assert overage["paddle_error"] is None

    # Verify Paddle transaction payload creation
    mock_transactions.create.assert_called_once()
    payload = mock_transactions.create.call_args[0][0]
    print("  Paddle transaction payload verified:")
    print("    - items price ID:", payload["items"][0]["price_id"])
    print("    - items quantity:", payload["items"][0]["quantity"])
    print("    - customer ID:", payload["customer_id"])
    print("    - subscription ID:", payload["subscription_id"])

    assert payload["items"][0]["price_id"] == "pri_overage_1122"
    assert payload["items"][0]["quantity"] == 50000
    assert payload["customer_id"] == "ctm_9988"
    assert payload["subscription_id"] == "sub_7766"

    print("  [PASS] Metered billing overages computed accurately and pushed to Paddle.")

async def run_all():
    await test_developer_key_generation_and_headers()
    await test_prometheus_observability()
    await test_paddle_metered_billing_overages()
    print("\nALL ENTERPRISE GATEWAY, OBSERVABILITY, AND BILLING RECONCILIATION TESTS PASSED! 🚀")

if __name__ == "__main__":
    asyncio.run(run_all())
