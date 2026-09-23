from __future__ import annotations

import asyncio
import html
import ipaddress
import logging
import os
import secrets
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urlparse

from fastapi import HTTPException
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.error import BadRequest, TelegramError, TimedOut
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from backend.api_v1.middleware import ensure_redis_or_fail
from backend.bots.policy import apply_bot_entitlement_filters, record_successful_download, resolve_bot_policy
from backend.campaigns import (
    filter_formats_by_campaign,
    format_campaign_message,
    get_campaign_snapshot,
    resolve_campaign_access,
)
from backend.download_handler import create_temp_output, download_selected_media
from backend.extractor_runtime import build_user_facing_extractor_error
from backend.extractor_service import MediaExtractionError, get_formats
from backend.format_parser import MAX_TELEGRAM_BYTES, MAX_TELEGRAM_MB, filter_for_telegram
from backend.media_url import normalize_media_url
from backend.storage_handler import create_delivery_artifact

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("nexus.telegram.bot")

TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
NEXUS_WEB_URL = os.environ.get("NEXUS_WEB_URL", "http://localhost:3000")
BOT_ART_PATH = Path(
    os.environ.get(
        "TELEGRAM_BOT_ART",
        r"C:\Users\NITIN MISHRA\Downloads\Gemini_Generated_Image_yv8egjyv8egjyv8e.png",
    )
)

if not TELEGRAM_TOKEN:
    raise SystemExit("TELEGRAM_BOT_TOKEN is missing")

SESSIONS: dict[str, dict] = {}
OWNER_TELEGRAM_ID = str(os.environ.get("OWNER_TELEGRAM_ID") or os.environ.get("OWNER_ID") or "").strip()
TELEGRAM_PLATFORM = "telegram"
TELEGRAM_GATEKEEPER_CHANNEL = os.environ.get("TELEGRAM_GATEKEEPER_CHANNEL", "@NEXUSMEDIAENGINE").strip() or "@NEXUSMEDIAENGINE"
TELEGRAM_DAILY_EXTRACTION_LIMIT = int(os.environ.get("TELEGRAM_DAILY_EXTRACTION_LIMIT", "10") or "10")
TELEGRAM_UPGRADE_URL = (
    os.environ.get("NEXUS_BOT_UPGRADE_URL", "").strip()
    or "https://nexus-engine.me/upgrade"
)
TELEGRAM_JOIN_DENIED_COPY = (
    "🔒 ACCESS DENIED: Unregistered Node.\n"
    "To utilize the NEXUS zero-trace extraction engine, your Telegram ID must be verified.\n"
    f"1. Join the core channel: {TELEGRAM_GATEKEEPER_CHANNEL}\n"
    "2. Return here and paste your link again."
)
TELEGRAM_ALLOWED_MEMBER_STATUSES = {"creator", "administrator", "member"}
TELEGRAM_REDIS_FAILURE_COPY = (
    "NEXUS CONTROL PLANE UNAVAILABLE\n"
    "Temporary Redis interruption detected. Please retry in a moment."
)


def is_owner(user_id: int) -> bool:
    return bool(OWNER_TELEGRAM_ID) and str(user_id) == OWNER_TELEGRAM_ID


def _portal_url(url: str) -> str:
    return f"{NEXUS_WEB_URL.rstrip('/')}/?url={quote(url, safe='')}"


def _is_telegram_safe_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return False
        host = (parsed.hostname or "").strip().lower()
        if not host or host == "localhost":
            return False
        try:
            ip = ipaddress.ip_address(host)
            return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved)
        except ValueError:
            return True
    except Exception:
        return False


def _portal_button(url: str) -> InlineKeyboardButton | None:
    portal = _portal_url(url)
    if not _is_telegram_safe_url(portal):
        return None
    return InlineKeyboardButton("Open In NEXUS", url=portal)


def _portal_rows(url: str) -> list[list[InlineKeyboardButton]]:
    button = _portal_button(url)
    return [[button]] if button else []


def _public_base_url() -> str | None:
    candidate = NEXUS_WEB_URL.rstrip("/")
    return candidate if _is_telegram_safe_url(candidate) else None


def _fallback_rows(fallback_url: str | None, source_url: str) -> list[list[InlineKeyboardButton]]:
    rows: list[list[InlineKeyboardButton]] = []
    if fallback_url and _is_telegram_safe_url(fallback_url):
        rows.append([InlineKeyboardButton("Secure Download Link", url=fallback_url)])
    rows.extend(_portal_rows(source_url))
    return rows


def _website_note(url: str) -> str:
    if _portal_button(url):
        return ""
    return "\nPublic NEXUS handoff is hidden while the website is running on a local URL."


async def _safe_edit(message, text: str, reply_markup=None) -> bool:
    try:
        await message.edit_text(text, reply_markup=reply_markup)
        return True
    except TimedOut:
        log.warning("Telegram message edit timed out")
        return False
    except BadRequest as exc:
        if "message is not modified" in str(exc).lower():
            return True
        log.warning("Telegram message edit rejected: %s", exc)
        return False
    except TelegramError as exc:
        log.warning("Telegram message edit failed: %s", exc)
        return False


def _start_text() -> str:
    return (
        "NEXUS ZERO-TRACE EXTRACTION NODE\n\n"
        "Welcome to the live interception channel.\n"
        "Send any public media URL and I will lock the signal, reveal the clean formats, track live progress, and deliver the final file when it fits Telegram safely.\n\n"
        f"Direct Telegram delivery limit: {MAX_TELEGRAM_MB} MB\n"
        f"Core channel verification: {TELEGRAM_GATEKEEPER_CHANNEL}\n"
        "Oversized payloads fall back to NEXUS web delivery when a public handoff URL is configured.\n\n"
        "Commands:\n"
        "/start - reopen the control panel\n"
        "/help - view usage guidance\n"
        "/status - check bot readiness"
    )


async def _start_text_with_campaign() -> str:
    text = _start_text()
    try:
        snapshot = await get_campaign_snapshot()
    except Exception:
        return text

    campaign_message = format_campaign_message(snapshot.get("active_message"))
    if not campaign_message:
        return text

    return f"{text}\n\n<b>LIVE CAMPAIGN</b>\n<b>{html.escape(campaign_message)}</b>"


def _help_text() -> str:
    return (
        "NEXUS OPERATOR GUIDE\n\n"
        "1. Send a public media link\n"
        f"2. Stay verified in {TELEGRAM_GATEKEEPER_CHANNEL}\n"
        "3. Choose Video or Audio\n"
        "4. Select the quality you want\n"
        "5. NEXUS extracts, tracks progress, and delivers the clean file\n\n"
        "Notes:\n"
        f"- Telegram direct delivery is limited to {MAX_TELEGRAM_MB} MB\n"
        "- Core-channel verification is required before extraction begins\n"
        "- Larger files stay on the web handoff path when public delivery is available"
    )


def _status_text() -> str:
    return (
        "NEXUS STATUS\n\n"
        "Core engine: online\n"
        "Telegram delivery: armed\n"
        f"Channel verification: {TELEGRAM_GATEKEEPER_CHANNEL}\n"
        f"Direct send ceiling: {MAX_TELEGRAM_MB} MB"
    )


def _telegram_growth_key(user_id: int) -> str:
    return f"user_limit:{str(user_id)}"


def _seconds_until_next_utc_midnight() -> int:
    now = datetime.now(timezone.utc)
    next_midnight = datetime.combine((now + timedelta(days=1)).date(), datetime.min.time(), tzinfo=timezone.utc)
    return max(1, int((next_midnight - now).total_seconds()))


async def check_membership(bot, user_id: int) -> bool:
    try:
        member = await bot.get_chat_member(chat_id='@NEXUSMEDIAENGINE', user_id=user_id)
        status = str(getattr(member, "status", "") or "").strip().lower()
        return status in TELEGRAM_ALLOWED_MEMBER_STATUSES
    except TelegramError as exc:
        log.warning("Telegram channel membership verification failed for %s: %s", user_id, exc)
        return False


async def _send_gatekeeper_denial(message) -> None:
    rows = [[InlineKeyboardButton(f"Join {TELEGRAM_GATEKEEPER_CHANNEL}", url=f"https://t.me/{TELEGRAM_GATEKEEPER_CHANNEL.lstrip('@')}")]]
    await message.reply_text(TELEGRAM_JOIN_DENIED_COPY, reply_markup=InlineKeyboardMarkup(rows))


async def _consume_phantom_extraction_slot(user_id: int, daily_limit: int) -> tuple[bool, int]:
    if daily_limit <= 0:
        return True, 0

    try:
        redis_client = await ensure_redis_or_fail()
        key = _telegram_growth_key(user_id)
        current_usage = await redis_client.incr(key)
        ttl = await redis_client.ttl(key)
        if ttl is None or ttl < 0:
            await redis_client.expire(key, _seconds_until_next_utc_midnight())
        return current_usage <= daily_limit, int(current_usage)
    except Exception as exc:
        log.error("Telegram phantom limit Redis failure for %s: %s", user_id, exc, exc_info=True)
        raise HTTPException(status_code=503, detail=TELEGRAM_REDIS_FAILURE_COPY) from exc


def _build_paywall_copy(limit: int) -> str:
    visible_limit = max(1, int(limit or TELEGRAM_DAILY_EXTRACTION_LIMIT))
    return (
        f"⚠️ SYSTEM HALTED: Daily Bandwidth Exhausted ({visible_limit}/{visible_limit})\n"
        "Your residential proxy allocation for today has been consumed.\n"
        "To bypass limits and resume extraction instantly:\n"
        f'⚡ <a href="{TELEGRAM_UPGRADE_URL}">Upgrade to NEXUS Elite</a>\n'
        "Otherwise, your free quota will reset at 00:00 GMT."
    )


async def _send_paywall_drop(message, daily_limit: int) -> None:
    rows = [[InlineKeyboardButton("Upgrade to NEXUS Elite", url=TELEGRAM_UPGRADE_URL)]]
    await message.reply_text(
        _build_paywall_copy(daily_limit),
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(rows),
        disable_web_page_preview=True,
    )


async def _process_extraction_request(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    *,
    url: str,
    user_id: int,
    bypass_owner_controls: bool = False,
) -> None:
    if not bypass_owner_controls:
        base_policy = resolve_bot_policy(TELEGRAM_PLATFORM, is_owner=False)
        campaign_access = await resolve_campaign_access(
            user_id=str(user_id),
            plan=str(base_policy.get("plan") or "free"),
            is_owner=False,
        )
        if not await check_membership(context.bot, user_id):
            await _send_gatekeeper_denial(update.message)
            return

        try:
            allowed, usage_count = await _consume_phantom_extraction_slot(
                user_id,
                int(campaign_access.get("limit") or TELEGRAM_DAILY_EXTRACTION_LIMIT),
            )
            if not allowed:
                log.info("Telegram phantom limit reached for user %s at usage %s", user_id, usage_count)
                await _send_paywall_drop(update.message, int(campaign_access.get("limit") or TELEGRAM_DAILY_EXTRACTION_LIMIT))
                return
        except HTTPException as exc:
            await update.message.reply_text(str(exc.detail or TELEGRAM_REDIS_FAILURE_COPY))
            return
    else:
        log.info("[ADMIN_ACCESS] Telegram owner bypass engaged for %s", user_id)
        base_policy = resolve_bot_policy(TELEGRAM_PLATFORM, is_owner=True)
        campaign_access = await resolve_campaign_access(
            user_id=str(user_id),
            plan=str(base_policy.get("plan") or "enterprise"),
            is_owner=True,
        )

    status_message = await update.message.reply_text("Signal received... 0%")

    try:
        await _safe_edit(status_message, "Inspecting signal... 35%")
        payload = await asyncio.to_thread(get_formats, url)
        filtered_video = apply_bot_entitlement_filters(payload["video_formats"], base_policy)
        filtered_audio = apply_bot_entitlement_filters(payload["audio_formats"], base_policy)
        filtered_video = filter_formats_by_campaign(filtered_video, campaign_access.get("quality"))
        filtered_audio = filter_formats_by_campaign(filtered_audio, campaign_access.get("quality"))
        telegram_video = filter_for_telegram(filtered_video)
        telegram_audio = filter_for_telegram(filtered_audio)

        if not telegram_video and not telegram_audio:
            await _safe_edit(
                status_message,
                (
                    f"No Telegram-safe formats fit the current campaign lane ({', '.join(campaign_access.get('quality') or [])}).\n"
                    "Use the NEXUS website for higher-size delivery and alternate download paths."
                ),
            )
            return

        session_id = secrets.token_urlsafe(8)
        SESSIONS[session_id] = {
            "user_id": user_id,
            "url": url,
            "title": payload["title"],
            "thumbnail": payload.get("thumbnail"),
            "uploader": payload.get("uploader"),
            "duration": payload.get("duration"),
            "video_formats": telegram_video,
            "audio_formats": telegram_audio,
        }

        await _safe_edit(status_message, "Metadata acquired. Choose a download type below.")
        await _send_type_picker(update.message, session_id, SESSIONS[session_id])
    except MediaExtractionError as exc:
        await _safe_edit(status_message, build_user_facing_extractor_error(url, exc, action="metadata probe"))
    except Exception as exc:
        log.error("Telegram extraction failed: %s", exc, exc_info=True)
        await _safe_edit(status_message, build_user_facing_extractor_error(url, exc, action="metadata probe"))


def _format_button_label(item: dict) -> str:
    size = item.get("size_mb")
    warning = " [too large]" if item.get("blocked") else ""
    return f"{item['quality']} • {size}MB{warning}"


def _build_format_keyboard(session_id: str, media_type: str, formats: list[dict]) -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(_format_button_label(item), callback_data=f"fmt:{session_id}:{media_type}:{item['format_id']}")]
        for item in formats
    ]
    rows.extend(_portal_rows(SESSIONS[session_id]["url"]))
    return InlineKeyboardMarkup(rows)


def _type_picker_keyboard(session_id: str, url: str) -> InlineKeyboardMarkup:
    rows = [[
        InlineKeyboardButton("Video", callback_data=f"type:{session_id}:video"),
        InlineKeyboardButton("Audio", callback_data=f"type:{session_id}:audio"),
    ]]
    rows.extend(_portal_rows(url))
    return InlineKeyboardMarkup(rows)


async def _send_type_picker(message, session_id: str, payload: dict) -> None:
    text = (
        "NEXUS Signal Locked\n\n"
        f"{payload['title'][:90]}\n"
        f"Source: {(payload.get('uploader') or 'Unknown')[:40]}\n"
        f"Duration: {payload.get('duration') or 'Unknown'}\n\n"
        f"Choose your extraction path.{_website_note(payload['url'])}"
    )
    await message.reply_text(text, reply_markup=_type_picker_keyboard(session_id, payload["url"]))


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    start_text = await _start_text_with_campaign()
    if BOT_ART_PATH.exists():
        with BOT_ART_PATH.open("rb") as image_handle:
            await update.message.reply_photo(photo=image_handle, caption=start_text, parse_mode="HTML")
        return
    await update.message.reply_text(start_text, parse_mode="HTML")


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(_help_text())


async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(_status_text())


async def handle_url(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    raw_url = (update.message.text or "").strip()
    if not raw_url.startswith(("http://", "https://")):
        await update.message.reply_text("Invalid or unsupported URL")
        return

    url = normalize_media_url(raw_url)
    user_id = update.effective_user.id

    if is_owner(user_id):
        await _process_extraction_request(
            update,
            context,
            url=url,
            user_id=user_id,
            bypass_owner_controls=True,
        )
        return

    await _process_extraction_request(
        update,
        context,
        url=url,
        user_id=user_id,
        bypass_owner_controls=False,
    )


async def handle_type_selection(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    _, session_id, media_type = query.data.split(":", 2)
    session = SESSIONS.get(session_id)
    if not session:
        await query.edit_message_text("Session expired. Send the URL again.")
        return
    if query.from_user.id != session["user_id"]:
        await query.edit_message_text("This extraction panel belongs to another user.")
        return

    formats = session["video_formats"] if media_type == "video" else session["audio_formats"]
    if not formats:
        await query.edit_message_text("No formats available for that selection.")
        return

    heading = "Select video quality:" if media_type == "video" else "Select audio quality:"
    await query.edit_message_text(
        f"{heading}{_website_note(session['url'])}",
        reply_markup=_build_format_keyboard(session_id, media_type, formats),
    )


async def handle_format_selection(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    _, session_id, media_type, format_id = query.data.split(":", 3)
    session = SESSIONS.get(session_id)
    if not session:
        await query.edit_message_text("Session expired. Send the URL again.")
        return
    if query.from_user.id != session["user_id"]:
        await query.edit_message_text("This extraction panel belongs to another user.")
        return

    formats = session["video_formats"] if media_type == "video" else session["audio_formats"]
    choice = next((item for item in formats if item["format_id"] == format_id), None)
    if not choice:
        await query.edit_message_text("Selected format is no longer available.")
        return

    user_id = query.from_user.id
    owner_mode = is_owner(user_id)

    if choice.get("blocked"):
        rows = _fallback_rows(None, session["url"])
        await query.edit_message_text(
            f"File too large for Telegram direct send. Use website download instead.{_website_note(session['url'])}",
            reply_markup=InlineKeyboardMarkup(rows) if rows else None,
        )
        return

    temp_dir, output_template = create_temp_output(session["title"])
    progress_message = await query.message.reply_text("Download pipeline armed... 0%")
    progress_state = {"last_percent": -1}
    completed = False
    artifact_url: str | None = None

    def on_progress(snapshot) -> None:
        percent = int(snapshot.percent or 0)
        if percent == progress_state["last_percent"]:
            return
        if percent < 100 and percent % 5 != 0:
            return
        progress_state["last_percent"] = percent
        text = f"Downloading... {percent}%"
        if snapshot.speed:
            text += f"\nSpeed: {snapshot.speed}"
        if snapshot.eta:
            text += f"\nETA: {snapshot.eta}"
        asyncio.create_task(_safe_edit(progress_message, text))

    try:
        output_path = await download_selected_media(
            url=session["url"],
            selector=choice["download_selector"],
            format_type=media_type,
            output_template=output_template,
            progress_callback=on_progress,
        )

        file_size = output_path.stat().st_size
        if file_size > MAX_TELEGRAM_BYTES:
            public_base_url = _public_base_url()
            if public_base_url:
                artifact = create_delivery_artifact(
                    file_path=output_path,
                    filename=output_path.name,
                    job_id=f"tg_{session_id}_{format_id}",
                    retention_hours=24,
                    base_url=public_base_url,
                )
                artifact_url = artifact.url
                record_successful_download(TELEGRAM_PLATFORM, user_id, is_owner=owner_mode)
            rows = _fallback_rows(artifact_url, session["url"])
            await _safe_edit(
                progress_message,
                (
                    "File too large for Telegram direct send.\n"
                    f"{'Secure download link is ready below.' if artifact_url else 'Use website download instead.'}"
                    f"{_website_note(session['url'])}"
                ),
                reply_markup=InlineKeyboardMarkup(rows) if rows else None,
            )
            return

        with output_path.open("rb") as handle:
            await context.bot.send_document(
                chat_id=progress_message.chat_id,
                document=handle,
                filename=output_path.name,
                caption=session["title"][:900],
            )

        record_successful_download(TELEGRAM_PLATFORM, user_id, is_owner=owner_mode)

        completed = True
        await _safe_edit(
            progress_message,
            "Delivery complete.\nSignal extracted cleanly and the final media is now live in your channel.",
        )
    except MediaExtractionError as exc:
        rows = _fallback_rows(artifact_url, session["url"])
        await _safe_edit(
            progress_message,
            f"{build_user_facing_extractor_error(session['url'], exc, action='download')}\n\nUse website download instead.{_website_note(session['url'])}",
            reply_markup=InlineKeyboardMarkup(rows) if rows else None,
        )
    except Exception as exc:
        log.error("Telegram download failed: %s", exc, exc_info=True)
        if completed:
            return
        rows = _fallback_rows(artifact_url, session["url"])
        await _safe_edit(
            progress_message,
            f"{build_user_facing_extractor_error(session['url'], exc, action='download')}{_website_note(session['url'])}",
            reply_markup=InlineKeyboardMarkup(rows) if rows else None,
        )
    finally:
        if not artifact_url:
            shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    app = Application.builder().token(TELEGRAM_TOKEN).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("status", cmd_status))
    app.add_handler(CallbackQueryHandler(handle_type_selection, pattern=r"^type:"))
    app.add_handler(CallbackQueryHandler(handle_format_selection, pattern=r"^fmt:"))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_url))
    log.info("NEXUS Telegram bot online.")
    app.run_polling(drop_pending_updates=True)
