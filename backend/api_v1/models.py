from typing import List, Optional
from pydantic import BaseModel, HttpUrl, Field

class ExtractRequest(BaseModel):
    url: Optional[HttpUrl] = Field(None, description="The media URL to extract (YouTube, etc.)")
    source_url: Optional[HttpUrl] = Field(None, description="Alternative field for media URL")
    callback_url: Optional[HttpUrl] = Field(None, description="Webhook URL for async batch results")
    format_tier: str = Field("best", description="Quality tier: 'best', 'eco', 'audio'")
    watermark_text: Optional[str] = Field(None, description="Optional custom watermark overlay")

class BatchExtractRequest(BaseModel):
    urls: List[HttpUrl] = Field(..., max_items=50, description="List of URLs for batch processing")
    callback_url: HttpUrl = Field(..., description="Required webhook URL for batch status updates")

class JobResponse(BaseModel):
    job_id: str
    status: str = "accepted"
    message: str = "B2B Extraction process initiated."

class ExtractionResult(BaseModel):
    title: str
    thumbnail: Optional[str]
    duration: Optional[int]
    uploader: Optional[str]
    webpage_url: str
    formats: List[dict]
