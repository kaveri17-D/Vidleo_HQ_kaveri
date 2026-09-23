from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}


def normalize_media_url(url: str) -> str:
    try:
        parsed = urlparse(url.strip())
        hostname = parsed.hostname.lower() if parsed.hostname else ""
        if hostname == "dai.ly":
            video_id = parsed.path.lstrip("/").split("/")[0]
            if video_id:
                return urlunparse(("https", "www.dailymotion.com", f"/video/{video_id}", "", "", ""))
            return url.strip()

        if hostname not in YOUTUBE_HOSTS:
            return url.strip()

        query = parse_qs(parsed.query)
        video_id = query.get("v", [None])[0]

        if hostname == "youtu.be":
            video_id = parsed.path.lstrip("/").split("/")[0] or video_id

        path_parts = [part for part in parsed.path.split("/") if part]
        if not video_id and path_parts[:1] and path_parts[0] in {"shorts", "live"}:
            video_id = path_parts[1] if len(path_parts) > 1 else None

        if not video_id:
            return url.strip()

        normalized_query = {"v": video_id}
        timestamp = query.get("t", [None])[0]
        if timestamp:
            normalized_query["t"] = timestamp

        return urlunparse(
            (
                "https",
                "www.youtube.com",
                "/watch",
                "",
                urlencode(normalized_query),
                "",
            )
        )
    except Exception:
        return url.strip()
