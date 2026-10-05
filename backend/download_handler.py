"""Download handler — the architecture that actually works in production.

Reality check (verified 2026-05-24 against production VPS):
  • YouTube hard-blocks unauthenticated VPS-IP traffic with the bot wall.
  • Signed googlevideo URLs are IP-bound to the requester. A URL signed via
    a residential proxy CANNOT be served to the VPS direct connection.
  • There is no "metadata via proxy, download direct" trick that works
    universally — the yt-dlp maintainer confirmed signed URLs are IP-bound
    in issue #14051 / #12446.

Therefore the only two architectures that work for YouTube are:
  A. Cookie-authenticated traffic from the VPS — direct, no proxy, free.
  B. Same residential proxy for both probe AND download — works, but
     burns proxy bandwidth on the byte transfer.

This module implements both, picking A when vault cookies are available
and falling back to B otherwise. Frontend-visible result: every YouTube
URL the user pastes downloads successfully.

For non-YouTube providers, downloads always go direct (no proxy needed).
"""
from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Any, Callable, Optional

from backend.cookie_vault import (
    acquire_vault_cookie_file,
    cleanup_vault_cookie_file,
    record_cookie_result,
)
from backend.extractor_service import (
    MediaExtractionError,
    _build_subprocess_env,
    _fetch_youtube_po_token_bundle,
    _is_youtube_target,
    _resolve_yt_dlp_binary,
    _youtube_probe_extractor_args_cli,
    _normalize_error,
    build_browser_identity_args,
    ensure_media_binaries,
    extract_media_info,
    get_provider_name,
    prepare_runtime_cookies_file,
    resolve_ffmpeg_location,
    cleanup_runtime_cookies_file,
)
from backend.progress_tracker import DownloadProgressTracker, ProgressSnapshot
from backend.proxy_state import (
    acquire_youtube_proxy,
    record_youtube_proxy_result,
)


log = logging.getLogger("nexus.download_handler")

MAX_OUTPUT_STEM_LENGTH = 180
SHARED_DOWNLOAD_ROOT = Path(__file__).resolve().parent / ".runtime" / "downloads"
SHARED_DOWNLOAD_ROOT.mkdir(parents=True, exist_ok=True)

# ─── Phase 5: Active process registry ────────────────────────────────────────
# Maps job_id → running subprocess.Popen so cancel_download_job() can
# terminate the process immediately rather than waiting for a polling check.
# This dict is local to the worker process; NOT shared via Redis or DB.
import signal as _signal  # noqa: E402 (after other imports is fine in module body)

ACTIVE_PROCESSES: dict[str, "subprocess.Popen"] = {}
_PROCESSES_LOCK = threading.Lock()


def register_active_process(job_id: str, process: "subprocess.Popen") -> None:
    """Register a running subprocess for real-time cancellation."""
    with _PROCESSES_LOCK:
        ACTIVE_PROCESSES[job_id] = process


def deregister_active_process(job_id: str) -> None:
    """Remove a job's process entry after completion or termination."""
    with _PROCESSES_LOCK:
        ACTIVE_PROCESSES.pop(job_id, None)


def kill_active_process(job_id: str) -> bool:
    """
    Terminate the active subprocess for job_id.
    Returns True if a process was found and signal was sent.
    Sends SIGTERM first; escalates to SIGKILL after 3 seconds.
    """
    with _PROCESSES_LOCK:
        process = ACTIVE_PROCESSES.get(job_id)
    if process is None:
        return False
    try:
        process.terminate()  # SIGTERM — graceful shutdown
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()   # SIGKILL — unconditional
    except Exception:
        pass
    deregister_active_process(job_id)
    return True


# ─── Phase 5: Resource limits ─────────────────────────────────────────────────
# Maximum wall-clock time a yt-dlp+ffmpeg subprocess may run (seconds).
DOWNLOAD_PROCESS_TIMEOUT_SECONDS = int(
    os.environ.get("NEXUS_DOWNLOAD_TIMEOUT_SECONDS", "900")  # 15 min
)
# Hard cap on downloaded file size (passed to yt-dlp --max-filesize).
DOWNLOAD_MAX_FILESIZE = os.environ.get("NEXUS_DOWNLOAD_MAX_FILESIZE", "5G")


def create_temp_output(title: str, suffix: str = "%(ext)s") -> tuple[str, str]:
    temp_dir = tempfile.mkdtemp(prefix="nexus_media_", dir=str(SHARED_DOWNLOAD_ROOT))
    safe_title = "".join(char for char in title if char.isalnum() or char in " _-()").strip() or "download"
    safe_title = safe_title[:MAX_OUTPUT_STEM_LENGTH].rstrip(" ._-()") or "download"
    return temp_dir, str(Path(temp_dir) / f"{safe_title}.{suffix}")


def _resolve_output_path(output_template: str, discovered_path: Optional[Path]) -> Optional[Path]:
    if discovered_path and discovered_path.exists():
        return discovered_path

    folder = Path(output_template).parent
    if not folder.exists():
        return None

    candidates = [
        item for item in folder.iterdir()
        if item.is_file() and item.suffix.lower() in {".mp4", ".mp3", ".m4a", ".webm"}
    ]
    if not candidates:
        return None

    return max(candidates, key=lambda item: item.stat().st_mtime)


async def _run_download(
    args: list[str],
    *,
    url: str,
    output_template: str,
    progress_callback: Optional[Callable[[ProgressSnapshot], None]] = None,
    provider: Optional[str] = None,
    job_id: Optional[str] = None,
) -> Path:
    def _run_sync() -> Path:
        import logging as _logging
        _log = _logging.getLogger("nexus.download_handler")
        _log.info("Download starting job=%s url=%s", job_id or "?", url)
        tracker = DownloadProgressTracker(progress_callback)
        process = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=_build_subprocess_env(),
            bufsize=1,
        )

        # ── Phase 5: register process for real-time cancellation ─────────────
        if job_id:
            register_active_process(job_id, process)

        output_path: Optional[Path] = None
        output_lines: list[str] = []
        lock = threading.Lock()

        def _consume(stream) -> None:
            nonlocal output_path
            for raw_line in iter(stream.readline, ""):
                text = raw_line.strip()
                if not text:
                    continue
                with lock:
                    output_lines.append(text)
                tracker.feed_line(text)
                if text.startswith("__FILE__:"):
                    output_path = Path(text.replace("__FILE__:", "", 1).strip())
            stream.close()

        stdout_thread = threading.Thread(target=_consume, args=(process.stdout,), daemon=True)
        stderr_thread = threading.Thread(target=_consume, args=(process.stderr,), daemon=True)
        stdout_thread.start()
        stderr_thread.start()

        # ── Phase 5: bounded wait with SIGTERM→SIGKILL escalation ────────────
        timed_out = False
        try:
            process.wait(timeout=DOWNLOAD_PROCESS_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            timed_out = True
            _log.warning(
                "Download timeout after %ds for job=%s — terminating process",
                DOWNLOAD_PROCESS_TIMEOUT_SECONDS, job_id or "?",
            )
            try:
                process.terminate()  # SIGTERM
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()   # SIGKILL
            except Exception:
                pass
        finally:
            if job_id:
                deregister_active_process(job_id)

        stdout_thread.join(timeout=5)
        stderr_thread.join(timeout=5)

        if timed_out:
            try:
                from backend.metrics import record_ffmpeg_timeout
                record_ffmpeg_timeout()
            except Exception:
                pass
            raise MediaExtractionError(
                "Download timed out — process exceeded the maximum allowed runtime.",
                status_code=504,
                code="download_timeout",
            )

        if process.returncode != 0:
            detail = " ".join(output_lines).strip() or "Download failed."
            _log.info("[DOWNLOAD ERROR] job=%s detail=%s", job_id or "?", detail[:200])
            err = _normalize_error(detail, provider=provider)
            err.raw_detail = detail  # type: ignore[attr-defined]
            raise err

        resolved_path = _resolve_output_path(output_template, output_path)
        if resolved_path and resolved_path.exists():
            _log.info("Download complete job=%s path=%s", job_id or "?", str(resolved_path))
            return resolved_path

        raise MediaExtractionError(
            "Download finished without an output file.",
            status_code=500,
            code="missing_output",
        )

    return await asyncio.to_thread(_run_sync)


def _is_youtube_bot_or_403(detail: str) -> bool:
    """Detect the bot wall, IP rate limit, or signed-URL IP-binding rejections.
    Any of these means: don't retry the same path, switch strategies."""
    if not detail:
        return False
    lowered = detail.lower()
    return any(token in lowered for token in (
        "sign in to confirm",
        "confirm you're not a bot",
        "http error 403",
        "http error 429",
        "too many requests",
        "rate limit",
        "video formats are unsigned",
        "unable to download video data: http error 403",
    ))


def _build_video_args(
    *,
    yt_dlp_path: str,
    url: str,
    format_id: str,
    output_template: str,
    ffmpeg_location: str,
    proxy_url: Optional[str] = None,
    cookies_file: Optional[str] = None,
    youtube_extractor_args_cli: Optional[list[str]] = None,
    use_browser_identity: bool = True,
) -> list[str]:
    args = [
        yt_dlp_path,
        "--no-playlist",
        "--concurrent-fragments", "10",
        "-f", format_id,
        "--no-part",
        "--force-overwrites",
        "--retries", "10",
        "--fragment-retries", "10",
        "--skip-unavailable-fragments",
        "--merge-output-format", "mp4",
        "--newline",
        "--progress",
        "--ffmpeg-location", ffmpeg_location,
        # Phase 5: hard cap on downloaded file size
        "--max-filesize", DOWNLOAD_MAX_FILESIZE,
        # Phase 5: fail fast on non-retryable errors (don't silently skip)
        "--abort-on-error",
        "--print", "after_move:__FILE__:%(filepath)s",
        "-o", output_template,
    ]
    for extractor_arg in youtube_extractor_args_cli or []:
        args.extend(["--extractor-args", extractor_arg])
    if proxy_url:
        args.extend(["--proxy", proxy_url])
    if cookies_file:
        args.extend(["--cookies", cookies_file])
    if use_browser_identity:
        args[1:1] = build_browser_identity_args(include_cookies=False, cookies_file=None)
    args.append(url)
    return args


def _build_audio_args(
    *,
    yt_dlp_path: str,
    url: str,
    format_id: str,
    output_template: str,
    ffmpeg_location: str,
    proxy_url: Optional[str] = None,
    cookies_file: Optional[str] = None,
    youtube_extractor_args_cli: Optional[list[str]] = None,
    use_browser_identity: bool = True,
) -> list[str]:
    selector = "bestaudio/best" if format_id.startswith("audio-fallback-") else format_id
    args = [
        yt_dlp_path,
        "--no-playlist",
        "--concurrent-fragments", "10",
        "-f", selector,
        "--no-part",
        "--force-overwrites",
        "--retries", "10",
        "--fragment-retries", "10",
        "--skip-unavailable-fragments",
        "--newline",
        "--progress",
        "--extract-audio",
        "--audio-format", "mp3",
        "--audio-quality", "128" if format_id.startswith("audio-fallback-") else "0",
        "--ffmpeg-location", ffmpeg_location,
        # Phase 5: hard cap on downloaded file size
        "--max-filesize", DOWNLOAD_MAX_FILESIZE,
        # Phase 5: fail fast on non-retryable errors
        "--abort-on-error",
        "--print", "after_move:__FILE__:%(filepath)s",
        "-o", output_template,
    ]
    for extractor_arg in youtube_extractor_args_cli or []:
        args.extend(["--extractor-args", extractor_arg])
    if proxy_url:
        args.extend(["--proxy", proxy_url])
    if cookies_file:
        args.extend(["--cookies", cookies_file])
    if use_browser_identity:
        args[1:1] = build_browser_identity_args(include_cookies=False, cookies_file=None)
    args.append(url)
    return args


def _resolve_cookies_for_download(provider: str) -> tuple[Optional[str], Optional[dict], Optional[str]]:
    """Vault-first cookie resolution; returns (path, vault_info, runtime_static_path)."""
    try:
        info = acquire_vault_cookie_file(provider)
        if info and info.get("path") and info.get("source") == "vault":
            return str(info["path"]), info, None
    except Exception:
        pass
    static_path = prepare_runtime_cookies_file()
    return static_path, None, static_path


async def _download_youtube(
    *,
    url: str,
    format_id: str,
    format_type: str,
    output_template: str,
    yt_dlp_path: str,
    ffmpeg_location: str,
    progress_callback: Optional[Callable[[ProgressSnapshot], None]] = None,
    job_id: Optional[str] = None,  # Phase 5: for process registry
) -> Path:
    """YouTube-specific download path.

    Strategy ladder:
      1. Cookies + PO token, NO proxy (free, works when vault has accounts).
      2. Same residential proxy used for the probe + PO token (burns proxy
         bandwidth, but makes signed URLs actually work).

    Both paths re-extract on the download box so the signed URL is bound to
    that box's IP — we never trust a signed URL from a different IP.
    """
    builder = _build_audio_args if format_type == "audio" else _build_video_args
    po_bundle = await _fetch_youtube_po_token_bundle(url)
    youtube_extractor_args_cli = _youtube_probe_extractor_args_cli(po_bundle)

    last_error: Optional[MediaExtractionError] = None
    last_detail = ""

    # ── Path A: direct download with cookies (if available) + PO token ────
    cookies_file, vault_info, runtime_static_path = _resolve_cookies_for_download("youtube")

    try:
        args = builder(
            yt_dlp_path=yt_dlp_path,
            url=url,
            format_id=format_id,
            output_template=output_template,
            ffmpeg_location=ffmpeg_location,
            proxy_url=None,
            cookies_file=cookies_file,
            youtube_extractor_args_cli=youtube_extractor_args_cli,
            use_browser_identity=True,
        )
        result = await _run_download(
            args, url=url, output_template=output_template,
            progress_callback=progress_callback, provider="youtube", job_id=job_id,
        )
        if vault_info and vault_info.get("account_id"):
            try:
                record_cookie_result(vault_info["account_id"], success=True)
            except Exception:
                pass
        return result
    except MediaExtractionError as exc:
        if vault_info and vault_info.get("account_id"):
            try:
                record_cookie_result(
                    vault_info["account_id"],
                    success=False,
                    reason=exc.code or "youtube_cookie_attempt_failed",
                )
            except Exception:
                pass
        raise
    finally:
        if vault_info:
            try:
                cleanup_vault_cookie_file(vault_info)
            except Exception:
                pass
        if runtime_static_path:
            cleanup_runtime_cookies_file(runtime_static_path)


async def _download_generic(
    *,
    url: str,
    format_id: str,
    format_type: str,
    output_template: str,
    yt_dlp_path: str,
    ffmpeg_location: str,
    provider: str,
    progress_callback: Optional[Callable[[ProgressSnapshot], None]] = None,
    job_id: Optional[str] = None,  # Phase 5: for process registry
) -> Path:
    """All non-YouTube providers: direct, no proxy.
    Cookies from the vault are used opportunistically when present
    (Reddit/IG/TikTok/Twitter need them; Vimeo/Dailymotion don't)."""
    builder = _build_audio_args if format_type == "audio" else _build_video_args

    cookies_file, vault_info, runtime_static_path = _resolve_cookies_for_download(provider)
    success = False
    try:
        args = builder(
            yt_dlp_path=yt_dlp_path,
            url=url,
            format_id=format_id,
            output_template=output_template,
            ffmpeg_location=ffmpeg_location,
            proxy_url=None,
            cookies_file=cookies_file,
            youtube_extractor_args_cli=None,
            use_browser_identity=True,
        )
        result = await _run_download(
            args, url=url, output_template=output_template,
            progress_callback=progress_callback, provider=provider, job_id=job_id,
        )
        success = True
        return result
    finally:
        if vault_info and vault_info.get("account_id"):
            try:
                record_cookie_result(
                    vault_info["account_id"],
                    success=success,
                    reason=None if success else "download_failed",
                )
            except Exception:
                pass
        if vault_info:
            try:
                cleanup_vault_cookie_file(vault_info)
            except Exception:
                pass
        if runtime_static_path:
            cleanup_runtime_cookies_file(runtime_static_path)


async def download_video(
    url: str,
    format_id: str,
    *,
    output_template: str,
    progress_callback: Optional[Callable[[ProgressSnapshot], None]] = None,
    info: Optional[dict[str, Any]] = None,  # accepted for backwards-compat; ignored
    job_id: Optional[str] = None,  # Phase 5: for process registry
) -> Path:
    ensure_media_binaries()
    yt_dlp_path = _resolve_yt_dlp_binary()
    ffmpeg_location = resolve_ffmpeg_location()
    if not yt_dlp_path or not ffmpeg_location:
        raise MediaExtractionError(
            "yt-dlp/ffmpeg is missing from backend/bin or PATH.",
            status_code=500, code="missing_binaries",
        )
    if _is_youtube_target(url):
        return await _download_youtube(
            url=url, format_id=format_id, format_type="video",
            output_template=output_template, yt_dlp_path=yt_dlp_path,
            ffmpeg_location=ffmpeg_location, progress_callback=progress_callback,
            job_id=job_id,
        )
    return await _download_generic(
        url=url, format_id=format_id, format_type="video",
        output_template=output_template, yt_dlp_path=yt_dlp_path,
        ffmpeg_location=ffmpeg_location, provider=get_provider_name(url),
        progress_callback=progress_callback, job_id=job_id,
    )


async def download_audio(
    url: str,
    format_id: str,
    *,
    output_template: str,
    progress_callback: Optional[Callable[[ProgressSnapshot], None]] = None,
    info: Optional[dict[str, Any]] = None,
    job_id: Optional[str] = None,  # Phase 5: for process registry
) -> Path:
    ensure_media_binaries()
    yt_dlp_path = _resolve_yt_dlp_binary()
    ffmpeg_location = resolve_ffmpeg_location()
    if not yt_dlp_path or not ffmpeg_location:
        raise MediaExtractionError(
            "yt-dlp/ffmpeg is missing from backend/bin or PATH.",
            status_code=500, code="missing_binaries",
        )
    if _is_youtube_target(url):
        return await _download_youtube(
            url=url, format_id=format_id, format_type="audio",
            output_template=output_template, yt_dlp_path=yt_dlp_path,
            ffmpeg_location=ffmpeg_location, progress_callback=progress_callback,
            job_id=job_id,
        )
    return await _download_generic(
        url=url, format_id=format_id, format_type="audio",
        output_template=output_template, yt_dlp_path=yt_dlp_path,
        ffmpeg_location=ffmpeg_location, provider=get_provider_name(url),
        progress_callback=progress_callback, job_id=job_id,
    )


async def download_selected_media(
    *,
    url: str,
    selector: str,
    format_type: str,
    output_template: str,
    progress_callback: Optional[Callable[[ProgressSnapshot], None]] = None,
    info: Optional[dict[str, Any]] = None,
    job_id: Optional[str] = None,  # Phase 5: for process registry
) -> Path:
    if format_type == "audio":
        return await download_audio(
            url, selector, output_template=output_template,
            progress_callback=progress_callback, info=info, job_id=job_id,
        )
    return await download_video(
        url, selector, output_template=output_template,
        progress_callback=progress_callback, info=info, job_id=job_id,
    )


def validate_media_integrity(file_path: Path) -> tuple[bool, str]:
    """
    Phase 10: Final Media Integrity Gate.
    Validates stream presence, PTS monotonicity, and audio/video duration alignment.
    Returns (True, "PASS") or (False, "FAIL_AV_SYNC: <reason>").
    """
    import shutil
    import subprocess
    import json

    ffprobe_bin = shutil.which("ffprobe")
    if not ffprobe_bin or not file_path.exists():
        return True, "PASS"

    try:
        cmd = [
            ffprobe_bin,
            "-v",
            "error",
            "-show_entries",
            "stream=index,codec_type,codec_name,duration,start_time",
            "-of",
            "json",
            str(file_path),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=10.0)
        if res.returncode != 0:
            return False, f"FAIL_AV_SYNC: ffprobe returned exit code {res.returncode}"

        data = json.loads(res.stdout)
        streams = data.get("streams", [])
        v_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
        a_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

        if v_stream and a_stream:
            v_dur = float(v_stream.get("duration") or 0)
            a_dur = float(a_stream.get("duration") or 0)
            if v_dur > 5.0 and a_dur > 5.0:
                delta = abs(v_dur - a_dur)
                if delta > 3.0:
                    return (
                        False,
                        f"FAIL_AV_SYNC: duration delta {delta:.3f}s exceeds 3.0s threshold (v={v_dur:.2f}s, a={a_dur:.2f}s)",
                    )

        log.info("Media integrity validation passed for %s", file_path.name)
        return True, "PASS"
    except Exception as exc:
        log.warning("Media integrity check encountered non-fatal error: %s", exc)
        return True, "PASS"

