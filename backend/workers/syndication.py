import os
import time
import random
import asyncio
import logging
import hashlib
import httpx

from backend.api_v1.middleware import ensure_redis_or_fail

log = logging.getLogger("nexus.syndication")

def get_endpoint_hash(endpoint_url: str) -> str:
    return hashlib.sha256(endpoint_url.encode("utf-8")).hexdigest()

async def check_circuit_breaker(redis_client, endpoint_url: str) -> bool:
    """
    Checks if the circuit for the given endpoint is OPEN.
    Returns True if the circuit is CLOSED (allowed to proceed).
    Returns False if the circuit is OPEN (fast-fail).
    """
    if not redis_client:
        return True  # Fallback: if Redis is down, fail-open
    
    endpoint_hash = get_endpoint_hash(endpoint_url)
    state_key = f"circuit:state:{endpoint_hash}"
    state = await redis_client.get(state_key)
    
    if state:
        state_str = state.decode("utf-8") if isinstance(state, bytes) else str(state)
        if state_str == "OPEN":
            log.warning(f"Circuit is OPEN for endpoint {endpoint_url}. Fast-failing delivery.")
            return False
            
    return True

async def record_circuit_success(redis_client, endpoint_url: str):
    """
    Resets the circuit breaker metrics on successful request.
    """
    if not redis_client:
        return
    endpoint_hash = get_endpoint_hash(endpoint_url)
    try:
        async with redis_client.pipeline(transaction=True) as pipe:
            pipe.delete(f"circuit:state:{endpoint_hash}")
            pipe.delete(f"circuit:attempts:{endpoint_hash}")
            pipe.delete(f"circuit:failures:{endpoint_hash}")
            await pipe.execute()
    except Exception as exc:
        log.error(f"Failed resetting circuit metrics in Redis: {exc}")

async def record_circuit_failure(redis_client, endpoint_url: str):
    """
    Increments failures and trips the circuit to OPEN if failure rate is > 50%
    over a 5-minute sliding window (minimum 5 attempts).
    """
    if not redis_client:
        return
    endpoint_hash = get_endpoint_hash(endpoint_url)
    attempts_key = f"circuit:attempts:{endpoint_hash}"
    failures_key = f"circuit:failures:{endpoint_hash}"
    state_key = f"circuit:state:{endpoint_hash}"
    
    try:
        async with redis_client.pipeline(transaction=True) as pipe:
            pipe.incr(attempts_key)
            pipe.expire(attempts_key, 300)  # 5-minute sliding window
            pipe.incr(failures_key)
            pipe.expire(failures_key, 300)
            res = await pipe.execute()
            
        attempts = int(res[0])
        failures = int(res[2])
        
        if attempts >= 5 and (failures / attempts) > 0.5:
            await redis_client.set(state_key, "OPEN", ex=600)  # Trip circuit for 600s
            log.error(
                f"Circuit TRIPPED to OPEN for endpoint {endpoint_url} (fails: {failures}/{attempts}). "
                f"Fast-failing deliveries for 600 seconds."
            )
    except Exception as exc:
        log.error(f"Failed updating circuit metrics in Redis: {exc}")

async def dispatch_bot_notification(platform: str, recipient_id: str, message: str, file_url: str = None) -> bool:
    """
    Dispatches notifications directly to Telegram or Discord API endpoints.
    """
    if not platform or not recipient_id:
        return False

    platform = platform.lower().strip()
    if platform == "telegram":
        token = os.environ.get("TELEGRAM_BOT_TOKEN")
        if not token:
            log.error("TELEGRAM_BOT_TOKEN is not configured.")
            return False
            
        async with httpx.AsyncClient(timeout=15.0) as client:
            if file_url:
                try:
                    url = f"https://api.telegram.org/bot{token}/sendDocument"
                    data = {
                        "chat_id": recipient_id,
                        "document": file_url,
                        "caption": message,
                        "parse_mode": "HTML"
                    }
                    res = await client.post(url, data=data)
                    if res.status_code == 200:
                        return True
                    log.warning(f"Failed to send direct file to Telegram: {res.text}. Falling back to text.")
                except Exception as exc:
                    log.warning(f"Exception sending Telegram file: {exc}. Falling back to text.")
            
            # Text fallback
            try:
                url = f"https://api.telegram.org/bot{token}/sendMessage"
                text_content = f"{message}\n\nDownload: {file_url}" if file_url else message
                data = {
                    "chat_id": recipient_id,
                    "text": text_content,
                    "parse_mode": "HTML"
                }
                res = await client.post(url, data=data)
                return res.status_code == 200
            except Exception as exc:
                log.error(f"Telegram text notification failed: {exc}")
                return False

    elif platform == "discord":
        token = os.environ.get("DISCORD_BOT_TOKEN")
        if not token:
            log.error("DISCORD_BOT_TOKEN is not configured.")
            return False
            
        headers = {
            "Authorization": f"Bot {token}",
            "Content-Type": "application/json"
        }
        
        async with httpx.AsyncClient(timeout=15.0) as client:
            target_channel_id = recipient_id
            try:
                dm_url = "https://discord.com/api/v10/users/@me/channels"
                dm_res = await client.post(dm_url, headers=headers, json={"recipient_id": recipient_id})
                if dm_res.status_code == 200:
                    target_channel_id = dm_res.json()["id"]
            except Exception as exc:
                log.warning(f"Discord DM channel resolution failed for {recipient_id}: {exc}. Using as direct channel.")
            
            try:
                msg_url = f"https://discord.com/api/v10/channels/{target_channel_id}/messages"
                text_content = f"{message}\n\n**Download:** {file_url}" if file_url else message
                payload = {"content": text_content}
                res = await client.post(msg_url, headers=headers, json=payload)
                return res.status_code == 200
            except Exception as exc:
                log.error(f"Discord message dispatch failed: {exc}")
                return False

    else:
        log.error(f"Unsupported bot platform: {platform}")
        return False

async def execute_webhook_delivery(
    job_id: str,
    endpoint_url: str,
    payload: dict,
    target_bot_platform: str = None,
    bot_recipient_id: str = None
) -> dict:
    """
    Delivers webhook payloads to endpoints with idempotency, circuit breaking,
    and exponential backoff retry policies.
    """
    log.info(f"Initiating delivery for job {job_id} to endpoint {endpoint_url}")
    
    # 1. Resolve Redis Client
    redis_client = None
    try:
        redis_client = await ensure_redis_or_fail()
    except Exception as exc:
        log.warning(f"Redis is unavailable for circuit breaker checks: {exc}")

    # 2. Check Circuit Breaker
    if not await check_circuit_breaker(redis_client, endpoint_url):
        raise RuntimeError(f"Circuit breaker is OPEN for endpoint: {endpoint_url}")

    # 3. Generate Idempotency Key
    idempotency_payload = f"{job_id}:{endpoint_url}"
    idempotency_key = hashlib.sha256(idempotency_payload.encode("utf-8")).hexdigest()
    
    headers = {
        "Content-Type": "application/json",
        "X-Nexus-Idempotency-Key": idempotency_key
    }

    # 4. HTTP POST Delivery with Exponential Backoff
    max_attempts = 5
    last_exception = None
    
    for attempt in range(max_attempts):
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                res = await client.post(endpoint_url, headers=headers, json=payload)
                
                # Check status
                if res.status_code in [200, 201, 202, 204]:
                    log.info(f"Webhook delivery succeeded for job {job_id} (attempt {attempt + 1})")
                    await record_circuit_success(redis_client, endpoint_url)
                    
                    # Send optional bot notification
                    if target_bot_platform and bot_recipient_id:
                        msg = f"<b>Nexus Clip Ready</b>\nJob ID: <code>{job_id}</code>\nWebhook status: {res.status_code}"
                        await dispatch_bot_notification(
                            platform=target_bot_platform,
                            recipient_id=bot_recipient_id,
                            message=msg,
                            file_url=payload.get("download_url")
                        )
                        
                    return {
                        "status": "success",
                        "status_code": res.status_code,
                        "attempts": attempt + 1
                    }
                
                # Check for transient HTTP error codes (502/503/504)
                elif res.status_code in [502, 503, 504]:
                    raise httpx.HTTPStatusError(
                        f"Transient HTTP error: {res.status_code}",
                        request=res.request,
                        response=res
                    )
                else:
                    # Non-transient HTTP error (e.g. 400, 401, 403, 404)
                    log.error(f"Non-transient HTTP failure {res.status_code} received from endpoint {endpoint_url}")
                    await record_circuit_failure(redis_client, endpoint_url)
                    return {
                        "status": "failed",
                        "status_code": res.status_code,
                        "attempts": attempt + 1,
                        "error": res.text
                    }
                    
        except Exception as exc:
            log.warning(f"Transient delivery error on attempt {attempt + 1} for job {job_id}: {exc}")
            last_exception = exc
            
            # Apply backoff with jitter if not final attempt
            if attempt < max_attempts - 1:
                delay = min(30.0, 2.0 ** attempt + random.uniform(0.1, 1.0))
                await asyncio.sleep(delay)
                
    # If we fall through, all retries failed due to transient issues
    log.error(f"All {max_attempts} webhook delivery attempts failed for job {job_id}. Last error: {last_exception}")
    await record_circuit_failure(redis_client, endpoint_url)
    
    # Notify bot of delivery failure if target specified
    if target_bot_platform and bot_recipient_id:
        msg = f"⚠️ <b>Nexus Webhook Delivery Failed</b>\nJob ID: <code>{job_id}</code>\nAll retry attempts exhausted."
        await dispatch_bot_notification(
            platform=target_bot_platform,
            recipient_id=bot_recipient_id,
            message=msg
        )
        
    raise RuntimeError(f"Webhook delivery failed after {max_attempts} attempts: {last_exception}")


# ─── Social Platform Upload Adapters ──────────────────────────────────────────

import abc
import io
import asyncio

class BaseSocialAdapter(abc.ABC):
    @abc.abstractmethod
    async def publish_video(
        self,
        video_url: str,
        caption: str,
        access_token: str,
        refresh_token: str = None,
        platform_user_id: str = None
    ) -> str:
        """
        Publishes video to the target social media platform.
        Returns the published post/video ID or confirmation handle.
        """
        pass


class InstagramReelsAdapter(BaseSocialAdapter):
    async def publish_video(
        self,
        video_url: str,
        caption: str,
        access_token: str,
        refresh_token: str = None,
        platform_user_id: str = None
    ) -> str:
        """
        Meta Graph API Reels publishing:
        1. Initialize container (POST to /media)
        2. Poll status (GET to /{container_id})
        3. Publish container (POST to /media_publish)
        """
        if not platform_user_id:
            raise ValueError("Instagram Reels publishing requires platform_user_id (Instagram Business Account ID).")

        async with httpx.AsyncClient(timeout=30.0) as client:
            # Stage A: Initialize Reels Container
            init_url = f"https://graph.facebook.com/v18.0/{platform_user_id}/media"
            params = {
                "media_type": "REELS",
                "video_url": video_url,
                "caption": caption,
                "access_token": access_token
            }
            log.info("Instagram Reels Stage A: Initializing media container for account %s", platform_user_id)
            res = await client.post(init_url, params=params)
            if res.status_code >= 400:
                raise RuntimeError(f"Instagram container initialization failed: {res.text}")
            
            container_id = res.json().get("id")
            if not container_id:
                raise RuntimeError(f"Instagram initialization response missing container id: {res.text}")

            # Stage B: Poll Container Status
            status_url = f"https://graph.facebook.com/v18.0/{container_id}"
            status_params = {
                "fields": "status_code,id",
                "access_token": access_token
            }
            
            max_attempts = 30
            poll_interval = 5.0
            log.info("Instagram Reels Stage B: Polling container status for ID %s", container_id)
            
            for attempt in range(max_attempts):
                status_res = await client.get(status_url, params=status_params)
                if status_res.status_code < 400:
                    status_data = status_res.json()
                    status_code = status_data.get("status_code")
                    log.info("Instagram Container %s Status: %s (attempt %d/%d)", container_id, status_code, attempt + 1, max_attempts)
                    
                    if status_code == "FINISHED":
                        break
                    elif status_code in ["ERROR", "EXPIRED"]:
                        raise RuntimeError(f"Instagram media container processing failed: {status_data}")
                else:
                    log.warning("Instagram container status check failed (HTTP %d): %s", status_res.status_code, status_res.text)
                
                await asyncio.sleep(poll_interval)
            else:
                raise TimeoutError(f"Instagram media container processing timed out after {max_attempts * poll_interval}s.")

            # Stage C: Publish Reels Container
            publish_url = f"https://graph.facebook.com/v18.0/{platform_user_id}/media_publish"
            publish_params = {
                "creation_id": container_id,
                "access_token": access_token
            }
            log.info("Instagram Reels Stage C: Publishing container %s", container_id)
            pub_res = await client.post(publish_url, params=publish_params)
            if pub_res.status_code >= 400:
                raise RuntimeError(f"Instagram publish failed: {pub_res.text}")
                
            published_id = pub_res.json().get("id")
            return published_id or container_id


class TikTokPostingAdapter(BaseSocialAdapter):
    async def publish_video(
        self,
        video_url: str,
        caption: str,
        access_token: str,
        refresh_token: str = None,
        platform_user_id: str = None
    ) -> str:
        """
        TikTok Content Posting API v2:
        POSTs a pull-from-URL video upload request.
        """
        api_url = "https://open.tiktokapis.com/v2/post/publish/video/init/"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }
        body = {
            "post_info": {
                "title": caption,
                "privacy_level": "PUBLIC_TO_EVERYONE",
                "video_cover_timestamp_ms": 0
            },
            "source_info": {
                "source": "PULL_FROM_URL",
                "video_url": video_url
            }
        }
        
        log.info("TikTok Adapter: Dispatching POST request to publish video from R2 URL")
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(api_url, headers=headers, json=body)
            if res.status_code >= 400:
                raise RuntimeError(f"TikTok content publishing API failed with HTTP {res.status_code}: {res.text}")
            
            res_data = res.json()
            data_block = res_data.get("data") or {}
            publish_id = data_block.get("publish_id")
            if not publish_id:
                raise RuntimeError(f"TikTok publish initialization missing publish_id: {res_data}")
            return publish_id


class YouTubeShortsAdapter(BaseSocialAdapter):
    async def publish_video(
        self,
        video_url: str,
        caption: str,
        access_token: str,
        refresh_token: str = None,
        platform_user_id: str = None
    ) -> str:
        """
        YouTube Shorts API:
        Streams R2 video bytes in memory directly to YouTube resumable v3 video upload API.
        """
        log.info("YouTube Shorts Adapter: Resolving media details and initializing resumable session...")
        async with httpx.AsyncClient(timeout=60.0) as client:
            # 1. Fetch file length via HEAD
            try:
                head_res = await client.head(video_url)
                content_length = head_res.headers.get("Content-Length")
            except Exception as e:
                log.warning("Could not determine R2 file length via HEAD request: %s", e)
                content_length = None

            # 2. Resumable Upload Session Handshake
            init_url = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status"
            init_headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json; charset=UTF-8",
                "X-Upload-Content-Type": "video/mp4"
            }
            if content_length:
                init_headers["X-Upload-Content-Length"] = content_length

            init_body = {
                "snippet": {
                    "title": caption[:100],  # YouTube 100 character limit
                    "description": caption,
                    "categoryId": "22"       # People & Blogs category
                },
                "status": {
                    "privacyStatus": "public",
                    "selfDeclaredMadeForKids": False
                }
            }

            init_res = await client.post(init_url, headers=init_headers, json=init_body)
            if init_res.status_code not in [200, 201]:
                raise RuntimeError(f"YouTube resumable session initialization failed: {init_res.text}")

            upload_session_url = init_res.headers.get("Location")
            if not upload_session_url:
                raise RuntimeError("YouTube resumable session missing Location header.")

            log.info("YouTube Session established. Streaming bytes from R2 directly to Google Ingest API...")

            # 3. Stream from R2 directly to Google Ingest
            async def upload_generator():
                async with client.stream("GET", video_url) as r2_stream:
                    async for chunk in r2_stream.aiter_bytes(chunk_size=1024*1024):  # 1MB chunk size
                        yield chunk

            put_headers = {
                "Content-Type": "video/mp4"
            }
            if content_length:
                put_headers["Content-Length"] = content_length

            put_res = await client.put(upload_session_url, headers=put_headers, content=upload_generator())
            if put_res.status_code not in [200, 201]:
                raise RuntimeError(f"YouTube chunked transfer failed: {put_res.text}")

            video_data = put_res.json()
            video_id = video_data.get("id")
            if not video_id:
                raise RuntimeError(f"YouTube upload finished but missing video id in response: {video_data}")
            
            log.info("YouTube Video published successfully. Video ID: %s", video_id)
            return video_id


async def execute_platform_upload(
    user_id: str,
    platform: str,
    access_token: str,
    refresh_token: str,
    video_url: str,
    caption: str,
    job_id: str
) -> str:
    """
    Selects adapter, executes zero-disk upload pipeline, and returns post ID.
    """
    platform_clean = platform.lower().strip()
    log.info("Resolving adapter for platform: %s (Job ID: %s)", platform_clean, job_id)

    if platform_clean == "instagram":
        adapter = InstagramReelsAdapter()
        platform_user_id = None
        try:
            from backend.api_v1.middleware import supabase
            secret_key = os.environ.get("SOCIAL_ENCRYPTION_KEY", "nexus_social_secret_key_default")
            rpc_res = supabase.rpc("get_decrypted_social_account", {
                "target_user_id": user_id,
                "target_platform": "instagram",
                "secret_key": secret_key
            }).execute()
            if not rpc_res.error and rpc_res.data and len(rpc_res.data) > 0:
                platform_user_id = rpc_res.data[0].get("platform_user_id")
        except Exception as exc:
            log.warning("Could not resolve Instagram Business Account ID from DB: %s. Using default fallback.", exc)
            
        if not platform_user_id:
            platform_user_id = "me"
            
        return await adapter.publish_video(
            video_url=video_url,
            caption=caption,
            access_token=access_token,
            refresh_token=refresh_token,
            platform_user_id=platform_user_id
        )

    elif platform_clean == "tiktok":
        adapter = TikTokPostingAdapter()
        return await adapter.publish_video(
            video_url=video_url,
            caption=caption,
            access_token=access_token,
            refresh_token=refresh_token
        )

    elif platform_clean in ["youtube", "youtube_shorts"]:
        adapter = YouTubeShortsAdapter()
        return await adapter.publish_video(
            video_url=video_url,
            caption=caption,
            access_token=access_token,
            refresh_token=refresh_token
        )

    else:
        raise ValueError(f"Unsupported social syndication target platform: {platform}")

