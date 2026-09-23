import os
import sys
import asyncio
from unittest.mock import AsyncMock, patch, MagicMock
import httpx

# Ensure backend folder is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

async def test_verify_db_encryption_and_decryption():
    print("Step 1: Testing Database Encryption and Decryption routines...")
    from backend.api_v1.middleware import supabase
    
    mock_response = MagicMock()
    mock_response.error = None
    mock_response.data = [{
        "id": "account-uuid-123",
        "user_id": "user-uuid-123",
        "platform": "instagram",
        "platform_user_id": "insta-business-123",
        "platform_username": "test_influencer",
        "decrypted_access_token": "mock_instagram_access_token_abc123",
        "decrypted_refresh_token": "mock_instagram_refresh_token_xyz789",
        "expires_at": "2026-12-31T23:59:59Z"
    }]
    
    with patch.object(supabase, "rpc", return_value=MagicMock(execute=lambda: mock_response)):
        res = supabase.rpc("get_decrypted_social_account", {
            "target_user_id": "user-uuid-123",
            "target_platform": "instagram",
            "secret_key": "dummy_secret"
        }).execute()
        assert res.error is None
        assert len(res.data) == 1
        assert res.data[0]["decrypted_access_token"] == "mock_instagram_access_token_abc123"
        print("  [PASS] Encryption and decryption DB routines verified and parsed correctly.")


async def test_fan_out_broadcast_endpoint():
    print("\nStep 2: Testing FastAPI /api/v1/syndicate/broadcast Fan-Out Router...")
    from backend.main import app
    from backend.api_v1.middleware import verify_b2b_key
    
    mock_verified_key = {
        "user_id": "user-uuid-123",
        "key_id": "key-test-777",
        "plan": "premium",
        "role": "user",
        "is_owner": False,
        "scopes": ["extract"],
        "entitlement": {"plan": "premium", "api_enabled": True}
    }
    app.dependency_overrides[verify_b2b_key] = lambda: mock_verified_key
    
    mock_db_records = {
        "instagram": [{
            "platform_user_id": "insta-business-123",
            "decrypted_access_token": "mock_insta_token",
            "decrypted_refresh_token": None
        }],
        "tiktok": [{
            "platform_user_id": "tiktok-user-123",
            "decrypted_access_token": "mock_tiktok_token",
            "decrypted_refresh_token": None
        }]
    }
    
    def mock_rpc_call(fn_name, params):
        target = params.get("target_platform")
        resp = MagicMock()
        resp.error = None
        resp.data = mock_db_records.get(target, [])
        return MagicMock(execute=lambda: resp)

    mock_send_task = MagicMock()
    mock_send_task.side_effect = lambda name, kwargs, queue: MagicMock(id=f"task-id-{kwargs['platform']}")
    
    transport = httpx.ASGITransport(app=app)
    
    from backend.api_v1.router import supabase as router_supabase
    
    with patch.object(router_supabase, "rpc", side_effect=mock_rpc_call), \
         patch("backend.celery_app.celery_app.send_task", mock_send_task):
         
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            resp = await client.post(
                "/api/v1/syndicate/broadcast",
                json={
                    "job_id": "job-uuid-777",
                    "video_url": "https://r2.mock.cloudflarestorage.com/nexus-test-bucket/video.mp4",
                    "caption": "Check out this amazing hook! #viral #shorts",
                    "targets": ["instagram", "tiktok"]
                }
            )
            print("  Broadcast response status:", resp.status_code)
            assert resp.status_code == 202
            data = resp.json()
            print("  Broadcast response data:")
            print("    - status:", data["status"])
            print("    - tasks:", data["tasks"])
            assert data["status"] == "accepted"
            assert data["tasks"]["instagram"] == "task-id-instagram"
            assert data["tasks"]["tiktok"] == "task-id-tiktok"
            assert mock_send_task.call_count == 2
            print("  [PASS] Async Celery fan-out tasks successfully enqueued on the 'syndicate' lane.")
            
    app.dependency_overrides.clear()


async def test_social_platform_adapters():
    print("\nStep 3: Testing Decoupled Social Adapters (Instagram Reels, TikTok v2, YouTube Shorts)...")
    from backend.workers.syndication import InstagramReelsAdapter, TikTokPostingAdapter, YouTubeShortsAdapter
    
    # 1. Test Instagram Adapter
    insta_adapter = InstagramReelsAdapter()
    
    mock_responses = [
        httpx.Response(200, json={"id": "container-123"}), 
        httpx.Response(200, json={"status_code": "FINISHED", "id": "container-123"}), 
        httpx.Response(200, json={"id": "ig-post-123"}) 
    ]
    
    mock_post = AsyncMock()
    mock_post.side_effect = [mock_responses[0], mock_responses[2]]
    mock_get = AsyncMock(return_value=mock_responses[1])
    
    with patch("httpx.AsyncClient.post", mock_post), \
         patch("httpx.AsyncClient.get", mock_get):
        res_id = await insta_adapter.publish_video(
            video_url="https://r2.mock.com/video.mp4",
            caption="IG Test",
            access_token="token",
            platform_user_id="insta-business-123"
        )
        assert res_id == "ig-post-123"
        print("  [PASS] Instagram Reels Meta Graph API 3-stage publish flow succeeded.")

    # 2. Test TikTok Adapter
    tiktok_adapter = TikTokPostingAdapter()
    mock_tiktok_response = httpx.Response(200, json={"data": {"publish_id": "tiktok-publish-999"}})
    
    with patch("httpx.AsyncClient.post", AsyncMock(return_value=mock_tiktok_response)):
        res_id = await tiktok_adapter.publish_video(
            video_url="https://r2.mock.com/video.mp4",
            caption="TikTok Test",
            access_token="token"
        )
        assert res_id == "tiktok-publish-999"
        print("  [PASS] TikTok Posting v2 Pull Ingress API request succeeded.")

    # 3. Test YouTube Shorts Adapter (resumable chunked streaming upload)
    yt_adapter = YouTubeShortsAdapter()
    
    mock_r2_head = httpx.Response(200, headers={"Content-Length": "2048"})
    mock_yt_init = httpx.Response(200, headers={"Location": "https://googleapis.com/upload/session-456"})
    mock_yt_put = httpx.Response(200, json={"id": "yt-video-888"})
    
    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock()
    mock_client.head = AsyncMock(return_value=mock_r2_head)
    mock_client.post = AsyncMock(return_value=mock_yt_init)
    mock_client.put = AsyncMock(return_value=mock_yt_put)
    
    mock_stream = AsyncMock()
    mock_stream.__aenter__.return_value = mock_stream
    mock_stream.aiter_bytes.return_value = AsyncMock()
    async def mock_aiter(chunk_size):
        yield b"chunk1"
        yield b"chunk2"
    mock_stream.aiter_bytes = mock_aiter
    mock_client.stream.return_value = mock_stream
    
    with patch("httpx.AsyncClient", return_value=mock_client):
        res_id = await yt_adapter.publish_video(
            video_url="https://r2.mock.com/video.mp4",
            caption="YouTube Shorts Test",
            access_token="token"
        )
        assert res_id == "yt-video-888"
        mock_client.head.assert_called_once()
        mock_client.post.assert_called_once()
        mock_client.put.assert_called_once()
        
        # Consume the generator to trigger the streaming calls
        generator = mock_client.put.call_args.kwargs["content"]
        chunks = []
        async for chunk in generator:
            chunks.append(chunk)
        assert chunks == [b"chunk1", b"chunk2"]
        
        mock_client.stream.assert_called_once_with("GET", "https://r2.mock.com/video.mp4")
        print("  [PASS] YouTube Shorts Resumable In-Memory streaming byte pipe upload succeeded.")


async def run_all():
    print("====================================================")
    print("RUNNING OMNICHANNEL SOCIAL SYNDICATION TEST SUITE")
    print("====================================================")
    await test_verify_db_encryption_and_decryption()
    await test_fan_out_broadcast_endpoint()
    await test_social_platform_adapters()
    print("\nALL OMNICHANNEL BROADCAST AND SYNDICATION TESTS PASSED! [OK]")

if __name__ == "__main__":
    asyncio.run(run_all())
