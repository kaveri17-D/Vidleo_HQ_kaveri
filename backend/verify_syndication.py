import os
import sys
import asyncio
import hashlib
from unittest.mock import AsyncMock, patch
import httpx

# Ensure backend folder is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.api_v1.middleware import ensure_redis_or_fail
from backend.workers.syndication import (
    execute_webhook_delivery,
    dispatch_bot_notification,
    get_endpoint_hash
)

# Set dummy bot tokens for testing
os.environ["TELEGRAM_BOT_TOKEN"] = "12345:telegram-token"
os.environ["DISCORD_BOT_TOKEN"] = "discord-token-12345"

async def test_successful_webhook_delivery(redis_client):
    print("Step 1: Test Successful Webhook Delivery...")
    endpoint_url = "https://mockclient.com/webhooks/nexus"
    job_id = "job_test_success_123"
    payload = {"clip_id": "clip_abc", "download_url": "https://r2.nexus.me/clip.mp4"}
    
    # Reset circuit breaker states first
    endpoint_hash = get_endpoint_hash(endpoint_url)
    await redis_client.delete(f"circuit:state:{endpoint_hash}")
    await redis_client.delete(f"circuit:attempts:{endpoint_hash}")
    await redis_client.delete(f"circuit:failures:{endpoint_hash}")

    mock_response = httpx.Response(200, json={"status": "ok"})
    
    async def mock_post(url, headers, json, *args, **kwargs):
        assert headers.get("X-Nexus-Idempotency-Key") is not None
        expected_key = hashlib.sha256(f"{job_id}:{endpoint_url}".encode()).hexdigest()
        assert headers["X-Nexus-Idempotency-Key"] == expected_key
        return mock_response

    with patch("httpx.AsyncClient.post", side_effect=mock_post):
        result = await execute_webhook_delivery(job_id, endpoint_url, payload)
        print("  Result status:", result["status"])
        assert result["status"] == "success"
        assert result["status_code"] == 200
        print("  [PASS] Webhook delivered with correct idempotency headers.")

async def test_circuit_breaker_tripping(redis_client):
    print("\nStep 2: Test Circuit Breaker Tripping...")
    endpoint_url = "https://failing-client.com/webhooks"
    job_id = "job_test_failure_456"
    payload = {"clip_id": "clip_def"}

    endpoint_hash = get_endpoint_hash(endpoint_url)
    await redis_client.delete(f"circuit:state:{endpoint_hash}")
    await redis_client.delete(f"circuit:attempts:{endpoint_hash}")
    await redis_client.delete(f"circuit:failures:{endpoint_hash}")

    # Set mock response to 502 Bad Gateway
    mock_response_fail = httpx.Response(502, text="Bad Gateway")

    async def mock_post_fail(*args, **kwargs):
        return mock_response_fail

    # Fast retries for testing
    with patch("asyncio.sleep", AsyncMock()):
        with patch("httpx.AsyncClient.post", side_effect=mock_post_fail):
            for i in range(5):
                try:
                    await execute_webhook_delivery(f"{job_id}_{i}", endpoint_url, payload)
                except Exception as exc:
                    print(f"  Caught loop exception on call {i}: {exc}")
                    pass
            
            # Check state in Redis: it should be tripped to OPEN now because of 5 failures
            state = await redis_client.get(f"circuit:state:{endpoint_hash}")
            if state:
                state_str = state.decode("utf-8") if isinstance(state, bytes) else str(state)
            else:
                state_str = None
            print("  Circuit state in Redis after failures:", state_str)
            assert state_str == "OPEN", f"Expected circuit state to be OPEN, got {state_str}"
            print("  [PASS] Circuit successfully tripped to OPEN after 5 failed attempts.")

            # Test that subsequent request fast-fails instantly without calling POST
            post_called = False
            async def mock_post_check(*args, **kwargs):
                nonlocal post_called
                post_called = True
                return httpx.Response(200)

            with patch("httpx.AsyncClient.post", side_effect=mock_post_check):
                try:
                    await execute_webhook_delivery("new_job_789", endpoint_url, payload)
                    print("  [FAIL] Expected fast-fail exception but request succeeded.")
                    assert False
                except Exception as exc:
                    print("  Caught expected fast-fail exception:", exc)
                    assert "Circuit breaker is OPEN" in str(exc)
                    assert not post_called, "Should not make HTTP request when circuit is OPEN"
                    print("  [PASS] Fast-fail mechanism works, preventing network calls.")

async def test_bot_notifications():
    print("\nStep 3: Test Bot Delivery Alerts...")
    
    mock_telegram_success = httpx.Response(200, json={"ok": True})
    mock_discord_success = httpx.Response(200, json={"id": "channel_id"})

    async def mock_bot_post(url, *args, **kwargs):
        if "api.telegram.org" in str(url):
            return mock_telegram_success
        elif "discord.com/api" in str(url):
            return mock_discord_success
        return httpx.Response(404)

    with patch("httpx.AsyncClient.post", side_effect=mock_bot_post):
        tg_res = await dispatch_bot_notification("telegram", "11223344", "Test message", "https://url.com/file.mp4")
        discord_res = await dispatch_bot_notification("discord", "55667788", "Test message", "https://url.com/file.mp4")
        
        print("  Telegram dispatch status:", tg_res)
        print("  Discord dispatch status:", discord_res)
        assert tg_res is True
        assert discord_res is True
        print("  [PASS] Discord and Telegram bot delivery bridges dispatched alerts successfully.")

async def main():
    try:
        redis_client = await ensure_redis_or_fail()
        await test_successful_webhook_delivery(redis_client)
        await test_circuit_breaker_tripping(redis_client)
        await test_bot_notifications()
        print("\nALL PHASE 4 WEBHOOK AND SYNDICATION TESTS PASSED! 🚀")
    except Exception as exc:
        print(f"\nTEST SUITE FAILED: {exc}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
