"""NEXUS Media Engine — Versioned MediaManifest Specification v1.0.0

This module defines the authoritative contract between the FastAPI Control Plane
and the client-side Browser MediaEngine.
"""
from __future__ import annotations

from typing import Any, List, Optional
from pydantic import BaseModel, Field


class StreamMediaItem(BaseModel):
    id: str
    url: str
    host: str
    format_id: str
    container: str
    codec: str
    type: str = Field(description="'progressive' | 'video' | 'audio'")
    bitrate: Optional[int] = None
    width: Optional[int] = None
    height: Optional[int] = None
    fps: Optional[float] = None
    duration: Optional[float] = None
    filesize: Optional[int] = None
    range_supported: bool = True
    cors_accessible: bool = True
    relay_required: bool = False
    headers_required: dict[str, str] = Field(default_factory=dict)
    expires_at: Optional[str] = None
    is_preferred: bool = False
    protocol: Optional[str] = "https"
    is_hls: bool = False
    hls_type: Optional[str] = None
    encryption: Optional[str] = None
    target_duration: Optional[float] = None


class MediaStreams(BaseModel):
    progressive: List[StreamMediaItem] = Field(default_factory=list)
    video: List[StreamMediaItem] = Field(default_factory=list)
    audio: List[StreamMediaItem] = Field(default_factory=list)
    hls: List[StreamMediaItem] = Field(default_factory=list)


class SourceMetadata(BaseModel):
    url: str
    canonical_url: str
    provider: str
    title: str
    duration: Optional[float] = None
    thumbnail: Optional[str] = None
    uploader: Optional[str] = None


class AccessRequirements(BaseModel):
    method: str = "GET"
    headers_required: dict[str, str] = Field(default_factory=dict)
    cookies_required: bool = False
    range_supported: bool = True
    ip_binding: bool = False
    expires_at: Optional[str] = None


class ManifestRefreshConfig(BaseModel):
    refresh_supported: bool = True
    refresh_url: str
    expires_at: Optional[str] = None


class ManifestFallbackConfig(BaseModel):
    server_fallback_allowed: bool = True
    reason: Optional[str] = None


class ManifestSecurity(BaseModel):
    ticket_required: bool = False
    allowed_hosts: List[str] = Field(default_factory=list)


class MediaManifest(BaseModel):
    manifest_version: str = "1"
    job_id: str
    source: SourceMetadata
    media: MediaStreams
    access: AccessRequirements
    refresh: ManifestRefreshConfig
    fallback: ManifestFallbackConfig
    security: ManifestSecurity
    created_at: str
