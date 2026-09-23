from __future__ import annotations

import asyncio
import logging
import os
import secrets
import shutil
from datetime import datetime, timedelta, timezone
from typing import Final
from urllib.parse import quote

import discord
from discord import app_commands
from fastapi import HTTPException

from backend.api_v1.middleware import ensure_redis_or_fail
from backend.bots.policy import apply_bot_entitlement_filters, resolve_bot_policy
from backend.campaigns import (
    filter_formats_by_campaign,
    format_campaign_message,
    get_campaign_snapshot,
    resolve_campaign_access,
)
from backend.download_handler import create_temp_output, download_selected_media
from backend.extractor_runtime import build_user_facing_extractor_error
from backend.extractor_service import MediaExtractionError, get_formats
from backend.media_url import normalize_media_url
from backend.storage_handler import create_delivery_artifact

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("nexus.discord.bot")

DISCORD_TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
NEXUS_WEB_URL = os.environ.get("NEXUS_WEB_URL", "https://nexus-engine.me").strip() or "https://nexus-engine.me"
NEXUS_API_PUBLIC_URL = os.environ.get("NEXUS_API_PUBLIC_URL", "https://nexus-engine.me").strip() or "https://nexus-engine.me"
DISCORD_GUILD_ID: Final[int] = int(
    (os.environ.get("DISCORD_GUILD_ID") or os.environ.get("DISCORD_CORE_GUILD_ID") or "1490459520726601788").strip()
)
OWNER_DISCORD_ID = str(os.environ.get("OWNER_DISCORD_ID", "").strip())
DISCORD_CORE_INVITE_URL = os.environ.get("DISCORD_CORE_INVITE_URL", "").strip()
DISCORD_UPGRADE_URL: Final[str] = "https://nexus-engine.me/upgrade"
YOUTUBE_PROXY_POOL = os.environ.get("YOUTUBE_PROXY_POOL", "").strip()
DISCORD_DAILY_LIMIT: Final[int] = 10
DISCORD_COLOR_PRIMARY: Final[int] = 0x00E5FF
DISCORD_COLOR_DENY: Final[int] = 0xFF4D6D
DISCORD_COLOR_WARNING: Final[int] = 0xFFB300
DISCORD_COLOR_SUCCESS: Final[int] = 0x00E676
EMERGENCY_ALLOWANCE: dict[str, bool] = {}

if not DISCORD_TOKEN:
    raise SystemExit("DISCORD_BOT_TOKEN is missing")


def _first_proxy_from_pool(raw_pool: str) -> str | None:
    for item in (raw_pool or "").split(","):
        proxy = item.strip().strip('"').strip("'")
        if not proxy:
            continue
        if not proxy.startswith(("http://", "https://", "socks5://", "socks5h://")):
            proxy = f"http://{proxy}"
        return proxy
    return None


_fallback_pool_proxy = _first_proxy_from_pool(YOUTUBE_PROXY_POOL)
if _fallback_pool_proxy:
    if not os.environ.get("PROXY_URL", "").strip():
        os.environ["PROXY_URL"] = _fallback_pool_proxy
    if not os.environ.get("RESIDENTIAL_PROXY_URL", "").strip():
        os.environ["RESIDENTIAL_PROXY_URL"] = _fallback_pool_proxy


def _portal_url(url: str) -> str:
    return f"{NEXUS_WEB_URL.rstrip('/')}/?url={quote(url, safe='')}"


def _limit_key(user_id: int) -> str:
    return f"user_limit:{str(user_id)}"


def _utc_day_key(user_id: int) -> str:
    return f"{str(user_id)}:{datetime.now(timezone.utc).date().isoformat()}"


def _is_owner(user_id: int | str) -> bool:
    return bool(OWNER_DISCORD_ID) and str(user_id) == OWNER_DISCORD_ID


def _seconds_until_next_utc_midnight() -> int:
    now = datetime.now(timezone.utc)
    next_midnight = datetime.combine((now + timedelta(days=1)).date(), datetime.min.time(), tzinfo=timezone.utc)
    return max(1, int((next_midnight - now).total_seconds()))


def _gate_denied_embed() -> discord.Embed:
    return discord.Embed(
        title="🔒 ACCESS DENIED: Unregistered Node",
        description=(
            "To utilize the NEXUS zero-trace extraction engine, "
            "your Discord ID must be verified in the Core Server."
        ),
        color=DISCORD_COLOR_DENY,
    )


def _limit_exhausted_embed() -> discord.Embed:
    return _limit_exhausted_embed_for_limit(DISCORD_DAILY_LIMIT)


def _limit_exhausted_embed_for_limit(limit: int) -> discord.Embed:
    visible_limit = max(1, int(limit or DISCORD_DAILY_LIMIT))
    return discord.Embed(
        title=f"⚠️ SYSTEM HALTED: Daily Bandwidth Exhausted ({visible_limit}/{visible_limit})",
        description=(
            "Your residential proxy allocation for today has been consumed. "
            "Free quota resets at 00:00 GMT."
        ),
        color=DISCORD_COLOR_WARNING,
    )


def _redis_failure_embed() -> discord.Embed:
    return discord.Embed(
        title="NEXUS CONTROL PLANE DEGRADED",
        description="Redis is temporarily unavailable. Emergency extraction lane has been engaged.",
        color=DISCORD_COLOR_WARNING,
    )


def _error_embed(detail: str) -> discord.Embed:
    return discord.Embed(
        title="Extraction Failed",
        description=detail[:4096],
        color=DISCORD_COLOR_DENY,
    )


def _success_embed(payload: dict, source_url: str, *, emergency_mode: bool = False) -> discord.Embed:
    embed = discord.Embed(
        title=(payload.get("title") or "NEXUS Extraction Result")[:256],
        description="📡 SIGNAL LOCKED: Extracting via Residential Proxy...",
        color=DISCORD_COLOR_SUCCESS,
        url=_portal_url(source_url),
    )
    embed.add_field(name="Output Control", value="Choose Video or Audio quality from the selectors below.", inline=False)
    embed.add_field(name="Source", value=(payload.get("uploader") or "Unknown")[:256], inline=True)
    embed.add_field(name="Duration", value=str(payload.get("duration") or "Unknown")[:256], inline=True)
    embed.add_field(
        name="Formats Detected",
        value=f"{len(payload.get('video_formats') or [])} video / {len(payload.get('audio_formats') or [])} audio",
        inline=True,
    )
    embed.add_field(
        name="Proxy Route",
        value="Residential pool active" if YOUTUBE_PROXY_POOL else "Direct / extractor-managed",
        inline=True,
    )
    if payload.get("thumbnail"):
        embed.set_thumbnail(url=payload["thumbnail"])
    if emergency_mode:
        embed.set_footer(text="Emergency extraction lane used while Redis was unavailable.")
    return embed


class JoinCoreView(discord.ui.View):
    def __init__(self, invite_url: str | None):
        super().__init__(timeout=300)
        if invite_url:
            self.add_item(discord.ui.Button(label="Join NEXUS Core", url=invite_url))


class UpgradeView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=300)
        self.add_item(discord.ui.Button(label="⚡ Upgrade to NEXUS Elite", url=DISCORD_UPGRADE_URL))


def _sort_video_formats(formats: list[dict]) -> list[dict]:
    return sorted(
        formats,
        key=lambda item: (
            int(item.get("height") or 0),
            int(item.get("fps") or 0),
            1 if str(item.get("ext") or "").lower() == "mp4" else 0,
            int(item.get("filesize") or 0),
        ),
        reverse=True,
    )


def _sort_audio_formats(formats: list[dict]) -> list[dict]:
    return sorted(
        formats,
        key=lambda item: (
            int(item.get("abr") or 0),
            1 if str(item.get("ext") or "").lower() == "mp3" else 0,
            int(item.get("filesize") or 0),
        ),
        reverse=True,
    )


def _format_size_label(item: dict) -> str:
    size_mb = item.get("size_mb") or item.get("size")
    if size_mb:
        return f"{size_mb} MB"
    return "Size unknown"


def _format_select_label(item: dict, media_type: str) -> str:
    if media_type == "video":
        height = item.get("height")
        if height:
            return f"{height}p"
        return str(item.get("label") or "Video")
    abr = item.get("abr")
    if abr:
        return f"{int(abr)} kbps"
    return str(item.get("label") or "Audio")


def _format_select_description(item: dict, media_type: str) -> str:
    ext = str(item.get("ext") or "").upper()
    details: list[str] = [_format_size_label(item)]
    if media_type == "video" and item.get("fps"):
        details.append(f"{int(item['fps'])}fps")
    if media_type == "audio" and ext:
        details.append(ext)
    elif media_type == "video" and ext:
        details.append(ext)
    return " • ".join(part[:40] for part in details)[:100]


def _download_ready_embed(source_url: str, choice: dict, artifact_url: str, filename: str) -> discord.Embed:
    media_type = str(choice.get("type") or "video").lower()
    label = _format_select_label(choice, media_type)
    embed = discord.Embed(
        title="NEXUS Delivery Ready",
        description="Your selected lane has been rendered and armed for secure download.",
        color=DISCORD_COLOR_SUCCESS,
        url=artifact_url,
    )
    embed.add_field(name="Selected Format", value=label, inline=True)
    embed.add_field(name="Package", value=filename[:256], inline=True)
    embed.add_field(name="Download", value=f"[Secure Download Link]({artifact_url})", inline=False)
    embed.add_field(name="Control Panel", value=f"[Open In NEXUS]({_portal_url(source_url)})", inline=False)
    return embed


class DownloadReadyView(discord.ui.View):
    def __init__(self, artifact_url: str, source_url: str):
        super().__init__(timeout=300)
        self.add_item(discord.ui.Button(label="Download Selected Format", url=artifact_url))
        self.add_item(discord.ui.Button(label="Open In NEXUS", url=_portal_url(source_url)))


class FormatSelect(discord.ui.Select):
    def __init__(
        self,
        *,
        requester_id: int,
        source_url: str,
        media_type: str,
        title: str,
        formats: list[dict],
    ) -> None:
        self.requester_id = requester_id
        self.source_url = source_url
        self.media_type = media_type
        self.title = title
        self.formats_by_id = {str(item["format_id"]): item for item in formats[:25]}
        emoji = "🎬" if media_type == "video" else "🎧"
        options = [
            discord.SelectOption(
                label=_format_select_label(item, media_type)[:100],
                description=_format_select_description(item, media_type),
                value=str(item["format_id"]),
                emoji=emoji,
            )
            for item in self.formats_by_id.values()
        ]
        placeholder = "Choose video quality" if media_type == "video" else "Choose audio quality"
        super().__init__(placeholder=placeholder, min_values=1, max_values=1, options=options)

    async def callback(self, interaction: discord.Interaction) -> None:
        if interaction.user.id != self.requester_id:
            await interaction.response.send_message(
                embed=_error_embed("This extraction panel belongs to another operator."),
                ephemeral=True,
            )
            return

        choice = self.formats_by_id.get(self.values[0])
        if not choice:
            await interaction.response.send_message(
                embed=_error_embed("Selected format is no longer available. Please run /extract again."),
                ephemeral=True,
            )
            return

        await interaction.response.defer(ephemeral=True, thinking=True)
        temp_dir, output_template = create_temp_output(self.title or "nexus-discord")
        artifact = None

        try:
            output_path = await download_selected_media(
                url=self.source_url,
                selector=str(choice.get("download_selector") or choice.get("format_id") or ""),
                format_type=self.media_type,
                output_template=output_template,
            )
            artifact = create_delivery_artifact(
                file_path=output_path,
                filename=output_path.name,
                job_id=f"discord_{interaction.user.id}_{secrets.token_hex(6)}",
                retention_hours=24,
                base_url=NEXUS_API_PUBLIC_URL,
            )
            await interaction.followup.send(
                embed=_download_ready_embed(self.source_url, choice, artifact.url, output_path.name),
                view=DownloadReadyView(artifact.url, self.source_url),
                ephemeral=True,
            )
            if artifact.mode == "r2_signed":
                shutil.rmtree(temp_dir, ignore_errors=True)
        except MediaExtractionError as exc:
            shutil.rmtree(temp_dir, ignore_errors=True)
            await interaction.followup.send(
                embed=_error_embed(build_user_facing_extractor_error(self.source_url, exc, action="download")),
                ephemeral=True,
            )
        except Exception as exc:
            shutil.rmtree(temp_dir, ignore_errors=True)
            log.error("Discord format delivery failed for %s: %s", interaction.user.id, exc, exc_info=True)
            await interaction.followup.send(
                embed=_error_embed(build_user_facing_extractor_error(self.source_url, exc, action="download")),
                ephemeral=True,
            )


class ExtractionResultView(discord.ui.View):
    def __init__(self, *, requester_id: int, source_url: str, payload: dict):
        super().__init__(timeout=600)
        video_formats = _sort_video_formats(list(payload.get("video_formats") or []))
        audio_formats = _sort_audio_formats(list(payload.get("audio_formats") or []))
        title = str(payload.get("title") or "NEXUS Extraction")

        if video_formats:
            self.add_item(
                FormatSelect(
                    requester_id=requester_id,
                    source_url=source_url,
                    media_type="video",
                    title=title,
                    formats=video_formats,
                )
            )
        if audio_formats:
            self.add_item(
                FormatSelect(
                    requester_id=requester_id,
                    source_url=source_url,
                    media_type="audio",
                    title=title,
                    formats=audio_formats,
                )
            )
        self.add_item(discord.ui.Button(label="Open In NEXUS", url=_portal_url(source_url)))


class NexusDiscordClient(discord.Client):
    def __init__(self) -> None:
        intents = discord.Intents.default()
        intents.guilds = True
        intents.members = True
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)
        self.core_guild_object = discord.Object(id=DISCORD_GUILD_ID)
        self.core_invite_url: str | None = DISCORD_CORE_INVITE_URL or None

    async def setup_hook(self) -> None:
        await self._ensure_core_invite_url()
        await self.tree.sync(guild=self.core_guild_object)
        log.info("Discord command tree synced to guild %s", DISCORD_GUILD_ID)

    async def _ensure_core_invite_url(self) -> str | None:
        if self.core_invite_url:
            return self.core_invite_url

        guild = self.get_guild(DISCORD_GUILD_ID)
        if guild is None:
            try:
                guild = await self.fetch_guild(DISCORD_GUILD_ID)
            except Exception as exc:
                log.warning("Unable to fetch core guild %s for invite resolution: %s", DISCORD_GUILD_ID, exc)
                return None

        try:
            invite = await guild.vanity_invite()
            if invite and invite.url:
                self.core_invite_url = invite.url
                return self.core_invite_url
        except Exception:
            pass

        me = guild.get_member(self.user.id) if self.user else None
        if me is None and self.user:
            try:
                me = await guild.fetch_member(self.user.id)
            except Exception:
                me = None

        for channel in getattr(guild, "text_channels", []):
            try:
                permissions = channel.permissions_for(me) if me else None
                if permissions and permissions.view_channel and permissions.create_instant_invite:
                    invite = await channel.create_invite(
                        max_age=0,
                        max_uses=0,
                        unique=False,
                        reason="NEXUS core join gate",
                    )
                    if invite and invite.url:
                        self.core_invite_url = invite.url
                        return self.core_invite_url
            except Exception:
                continue

        log.warning("No Discord core invite URL could be auto-resolved for guild %s", DISCORD_GUILD_ID)
        return None

    async def check_core_membership(self, user_id: int) -> bool:
        guild = self.get_guild(DISCORD_GUILD_ID)
        if guild is None:
            try:
                guild = await self.fetch_guild(DISCORD_GUILD_ID)
            except Exception as exc:
                log.warning("Core guild fetch failed for membership check %s: %s", user_id, exc)
                return False

        member = guild.get_member(user_id)
        if member is None:
            try:
                member = await guild.fetch_member(user_id)
            except discord.NotFound:
                return False
            except discord.Forbidden as exc:
                log.warning("Forbidden while fetching core guild member %s: %s", user_id, exc)
                return False
            except discord.HTTPException as exc:
                log.warning("HTTP error while fetching core guild member %s: %s", user_id, exc)
                return False

        return member is not None

    async def consume_daily_limit(self, user_id: int, daily_limit: int) -> tuple[bool, int, bool]:
        if daily_limit <= 0:
            return True, 0, False

        key = _limit_key(user_id)
        try:
            redis_client = await ensure_redis_or_fail()
            current_usage = await redis_client.incr(key)
            ttl = await redis_client.ttl(key)
            if ttl is None or ttl < 0:
                await redis_client.expire(key, _seconds_until_next_utc_midnight())
            return current_usage <= daily_limit, int(current_usage), False
        except Exception as exc:
            emergency_key = _utc_day_key(user_id)
            log.critical("Discord Redis limit failure for %s: %s", user_id, exc, exc_info=True)
            if not EMERGENCY_ALLOWANCE.get(emergency_key):
                EMERGENCY_ALLOWANCE[emergency_key] = True
                return True, 1, True
            raise HTTPException(
                status_code=503,
                detail="Discord Redis runtime unavailable and emergency lane already consumed for today.",
            ) from exc


client = NexusDiscordClient()


async def execute_extraction(
    interaction: discord.Interaction,
    normalized: str,
    *,
    owner_bypass: bool = False,
) -> None:
    emergency_mode = False
    base_policy = resolve_bot_policy("discord", is_owner=owner_bypass)
    campaign_access = await resolve_campaign_access(
        user_id=str(interaction.user.id),
        plan=str(base_policy.get("plan") or ("enterprise" if owner_bypass else "free")),
        is_owner=owner_bypass,
    )

    if not owner_bypass:
        if not await client.check_core_membership(interaction.user.id):
            await interaction.response.send_message(
                embed=_gate_denied_embed(),
                view=JoinCoreView(await client._ensure_core_invite_url()),
                ephemeral=True,
            )
            return

        try:
            allowed, usage_count, emergency_mode = await client.consume_daily_limit(
                interaction.user.id,
                int(campaign_access.get("limit") or DISCORD_DAILY_LIMIT),
            )
        except HTTPException as exc:
            await interaction.response.send_message(
                embed=_error_embed(str(exc.detail or "Rate limiter unavailable.")),
                ephemeral=True,
            )
            return

        if not allowed or usage_count > int(campaign_access.get("limit") or DISCORD_DAILY_LIMIT):
            await interaction.response.send_message(
                embed=_limit_exhausted_embed_for_limit(int(campaign_access.get("limit") or DISCORD_DAILY_LIMIT)),
                view=UpgradeView(),
                ephemeral=True,
            )
            return
    else:
        log.info("[ADMIN_ACCESS] Discord owner bypass engaged for %s", interaction.user.id)

    if not (YOUTUBE_PROXY_POOL or os.environ.get("PROXY_URL", "").strip() or os.environ.get("RESIDENTIAL_PROXY_URL", "").strip()):
        await interaction.response.send_message(
            embed=_error_embed("Residential proxy pool unavailable. Extraction has been temporarily locked."),
            ephemeral=True,
        )
        return

    await interaction.response.defer(ephemeral=True, thinking=True)
    status_embed = discord.Embed(
        title="📡 SIGNAL LOCKED: Extracting via Residential Proxy...",
        color=DISCORD_COLOR_PRIMARY,
    )
    if emergency_mode:
        status_embed.description = "Emergency extraction lane active while Redis is unavailable."
    await interaction.edit_original_response(embed=status_embed, view=None)

    try:
        payload = await asyncio.to_thread(get_formats, normalized)
        payload["video_formats"] = filter_formats_by_campaign(
            apply_bot_entitlement_filters(list(payload.get("video_formats") or []), base_policy),
            campaign_access.get("quality"),
        )
        payload["audio_formats"] = filter_formats_by_campaign(
            apply_bot_entitlement_filters(list(payload.get("audio_formats") or []), base_policy),
            campaign_access.get("quality"),
        )
        if not payload["video_formats"] and not payload["audio_formats"]:
            await interaction.edit_original_response(
                embed=_error_embed(
                    "No formats are available in the current campaign lane. "
                    f"Allowed outputs: {', '.join(campaign_access.get('quality') or [])}."
                ),
                view=None,
            )
            return
        await interaction.edit_original_response(
            embed=_success_embed(payload, normalized, emergency_mode=emergency_mode),
            view=ExtractionResultView(requester_id=interaction.user.id, source_url=normalized, payload=payload),
        )
    except MediaExtractionError as exc:
        await interaction.edit_original_response(
            embed=_error_embed(build_user_facing_extractor_error(normalized, exc, action="metadata probe")),
            view=None,
        )
    except Exception as exc:
        log.error("Discord extraction failed for %s: %s", interaction.user.id, exc, exc_info=True)
        await interaction.edit_original_response(
            embed=_error_embed(build_user_facing_extractor_error(normalized, exc, action="metadata probe")),
            view=None,
        )


@client.tree.command(name="extract", description="Extract media metadata through the NEXUS residential lane.", guild=client.core_guild_object)
@app_commands.describe(url="Public media URL")
async def extract_command(interaction: discord.Interaction, url: str) -> None:
    normalized = normalize_media_url((url or "").strip())
    if not normalized.startswith(("http://", "https://")):
        await interaction.response.send_message("Invalid or unsupported URL.", ephemeral=True)
        return

    if _is_owner(interaction.user.id):
        await execute_extraction(interaction, normalized, owner_bypass=True)
        return

    await execute_extraction(interaction, normalized, owner_bypass=False)


@client.tree.command(name="nexus", description="Show the NEXUS Discord lane status.", guild=client.core_guild_object)
async def nexus_status_command(interaction: discord.Interaction) -> None:
    snapshot = await get_campaign_snapshot()
    campaign_message = format_campaign_message(snapshot.get("active_message"))
    base_policy = resolve_bot_policy("discord", is_owner=_is_owner(interaction.user.id))
    campaign_access = await resolve_campaign_access(
        user_id=str(interaction.user.id),
        plan=str(base_policy.get("plan") or "free"),
        is_owner=_is_owner(interaction.user.id),
    )
    limit_value = int(campaign_access.get("limit") or 0)
    embed = discord.Embed(
        title="NEXUS Discord Lane",
        description="Slash commands are synced directly to the Core Guild for instant deployment.",
        color=DISCORD_COLOR_PRIMARY,
    )
    embed.add_field(name="Core Guild", value=str(DISCORD_GUILD_ID), inline=True)
    embed.add_field(name="Daily Limit", value="Unlimited" if limit_value <= 0 else f"{limit_value} daily extractions", inline=True)
    embed.add_field(name="Upgrade", value=f"[NEXUS Elite]({DISCORD_UPGRADE_URL})", inline=True)
    if campaign_message:
        embed.add_field(name="Live Campaign", value=f"**{campaign_message}**", inline=False)
    await interaction.response.send_message(
        embed=embed,
        view=JoinCoreView(await client._ensure_core_invite_url()),
        ephemeral=True,
    )


if __name__ == "__main__":
    log.info("NEXUS Discord bot online.")
    client.run(DISCORD_TOKEN)
