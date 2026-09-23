import os
import sys
import asyncio
from unittest.mock import AsyncMock, patch, MagicMock
import httpx

# Ensure backend folder is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

async def test_verify_r2_upload_and_async_extraction():
    print("Step 1: Testing R2 Presigned Upload URL Generation...")
    
    from backend.main import app
    from backend.api_v1.middleware import verify_b2b_key
    from backend.auth import get_current_user

    # Mock user B2B auth
    mock_verified_key = {
        "user_id": "user-test-777",
        "key_id": "key-test-777",
        "plan": "premium",
        "role": "user",
        "is_owner": False,
        "scopes": ["extract"],
        "entitlement": {"plan": "premium", "api_enabled": True}
    }

    # Patch verify_b2b_key
    app.dependency_overrides[verify_b2b_key] = lambda: mock_verified_key

    # Mock R2 Client and boto3 calls
    mock_r2 = MagicMock()
    mock_r2.generate_presigned_url.side_effect = lambda ClientMethod, Params, ExpiresIn: (
        f"https://r2.mock.cloudflarestorage.com/{Params['Bucket']}/{Params['Key']}?sig=mocked_signature"
    )

    transport = httpx.ASGITransport(app=app)
    
    with patch("backend.storage_handler._get_r2_client", return_value=mock_r2), \
         patch.dict(os.environ, {"R2_BUCKET": "nexus-test-bucket", "R2_ENDPOINT_URL": "https://test.r2.com", "R2_ACCESS_KEY_ID": "test", "R2_SECRET_ACCESS_KEY": "test"}):
         
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            resp = await client.post(
                "/api/v1/developer/upload-url",
                json={"filename": "my_video.mp4", "content_type": "video/mp4"}
            )
            print("  Upload URL response status:", resp.status_code)
            assert resp.status_code == 200
            data = resp.json()
            print("  Upload URL response data:")
            print("    - upload_url:", data["upload_url"])
            print("    - file_url:", data["file_url"])
            print("    - object_key:", data["object_key"])
            assert "sig=mocked_signature" in data["upload_url"]
            assert "sig=mocked_signature" in data["file_url"]
            assert "nexus-uploads/user-test-777" in data["object_key"]
            print("  [PASS] Presigned upload and read URLs generated correctly for Cloudflare R2.")

    print("\nStep 2: Testing Async extraction queueing via /api/v1/extract...")
    
    # Mock celery tasks to verify correct routing without running actual ffmpeg processes
    mock_celery_task = MagicMock()
    
    with patch("backend.tasks.video_render_pipeline_task.apply_async", mock_celery_task), \
         patch("backend.api_v1.router.record_api_request_result", return_value=AsyncMock()):
         
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            resp = await client.post(
                "/api/v1/extract",
                json={
                    "source_url": "https://r2.mock.cloudflarestorage.com/nexus-test-bucket/my_video.mp4",
                    "watermark_text": "🎬 Custom Overlay"
                }
            )
            print("  Extraction dispatch status:", resp.status_code)
            assert resp.status_code == 202
            data = resp.json()
            print("  Extraction dispatch response:")
            print("    - job_id:", data["job_id"])
            print("    - status:", data["status"])
            assert data["status"] == "accepted"
            mock_celery_task.assert_called_once()
            print("  [PASS] Async extraction successfully dropped in Celery analysis lane.")

    # Reset dependency overrides
    app.dependency_overrides.clear()

async def test_supabase_jwt_auth_fallback():
    print("\nStep 3: Testing Supabase JWT Fallback in verify_b2b_key middleware...")
    
    from backend.main import app
    from backend.api_v1.middleware import verify_b2b_key
    
    # We mock get_current_user to return a valid dictionary for a Supabase token
    mock_supabase_user = {
        "id": "supabase-user-123",
        "email": "user@supabase.io",
        "plan": "premium",
        "role": "user",
        "is_owner": False,
        "anonymous": False,
        "account_status": "active",
        "entitlement": {"plan": "premium", "api_enabled": True}
    }
    
    # We patch ensure_redis_or_fail to mock rate limiting
    mock_redis = MagicMock()
    mock_pipeline = MagicMock()
    mock_redis.pipeline.return_value = mock_pipeline
    mock_pipeline.get.return_value = mock_pipeline
    mock_pipeline.set.return_value = mock_pipeline
    mock_pipeline.execute = AsyncMock(return_value=[None, True])
    mock_redis.set = AsyncMock()
    mock_ensure_redis = AsyncMock(return_value=mock_redis)

    transport = httpx.ASGITransport(app=app)
    
    # We mock ytdlp extraction to avoid network calls for standard extract path
    mock_probe = MagicMock()
    
    with patch("backend.api_v1.middleware.get_current_user", new_callable=AsyncMock) as mock_get_user, \
         patch("backend.middleware.credit_gate.get_current_user", mock_get_user), \
         patch("backend.api_v1.middleware.ensure_redis_or_fail", mock_ensure_redis), \
         patch("backend.api_v1.middleware.is_user_blacklisted", new_callable=AsyncMock) as mock_blacklist, \
         patch("backend.api_v1.router.extract_info_with_fallback", return_value={"title": "Supabase Test Video"}), \
         patch("backend.api_v1.router.record_api_request_result", return_value=AsyncMock()):
         
        mock_get_user.return_value = mock_supabase_user
        mock_blacklist.return_value = False
         
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            # Send standard Supabase token in the header and check if middleware resolves it
            resp = await client.post(
                "/api/v1/extract",
                json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
                headers={"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRsYXZycHB0dGd5d2d2cGlmb2FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NzEzNTYsImV4cCI6MjA5MDM0NzM1Nn0"}
            )
            print("  Fallback auth extract response status:", resp.status_code)
            assert resp.status_code == 200
            print("  [PASS] Supabase JWT token successfully validated and resolved by verify_b2b_key.")

async def run_all():
    await test_verify_r2_upload_and_async_extraction()
    await test_supabase_jwt_auth_fallback()
    print("\nALL INGESTION AND R2 UPLOAD GATEWAY TESTS PASSED! [OK]")

if __name__ == "__main__":
    asyncio.run(run_all())
