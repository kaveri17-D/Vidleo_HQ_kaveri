from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class PaddlePlanDefinition:
    code: str
    marketing_name: str
    description: str
    unit_amount: int  # in cents USD
    currency: str = "USD"
    interval: str = "month"
    lookup_key: str = ""
    env_price_id: str | None = None

    @property
    def display_amount(self) -> str:
        return f"${self.unit_amount / 100:.2f}/{self.interval}"


PADDLE_PLAN_CATALOG: dict[str, PaddlePlanDefinition] = {
    "pro": PaddlePlanDefinition(
        code="pro",
        marketing_name="Power User",
        description="The creator's standard for fast personal extraction with higher daily throughput.",
        unit_amount=999,
        lookup_key="nexus_power_user_monthly",
        env_price_id="PADDLE_PRICE_ID_PRO",
    ),
    "premium": PaddlePlanDefinition(
        code="premium",
        marketing_name="4K Compute",
        description="Priority compute lane for high-resolution extraction workflows.",
        unit_amount=2499,
        lookup_key="nexus_4k_compute_monthly",
        env_price_id="PADDLE_PRICE_ID_PREMIUM",
    ),
    "api": PaddlePlanDefinition(
        code="api",
        marketing_name="Developer Access",
        description="Professional automation tier for API-first extraction workloads.",
        unit_amount=9999,
        lookup_key="nexus_developer_access_monthly",
        env_price_id="PADDLE_PRICE_ID_API",
    ),
    "api_growth": PaddlePlanDefinition(
        code="api_growth",
        marketing_name="Scale Lane",
        description="Higher-volume recurring API lane for teams scaling automated extraction.",
        unit_amount=19999,
        lookup_key="nexus_scale_lane_monthly",
        env_price_id="PADDLE_PRICE_ID_API_GROWTH",
    ),
}


def get_plan_definition(plan: str) -> PaddlePlanDefinition:
    normalized = str(plan or "").strip().lower()
    if normalized not in PADDLE_PLAN_CATALOG:
        raise KeyError(f"Unsupported Paddle plan: {plan}")
    return PADDLE_PLAN_CATALOG[normalized]


def list_plan_definitions() -> list[dict[str, Any]]:
    return [asdict(plan) for plan in PADDLE_PLAN_CATALOG.values()]


def get_paddle_price_id_from_env(plan: str) -> str | None:
    """Return the Paddle Price ID from environment variable for a given plan."""
    import os
    definition = get_plan_definition(plan)
    if definition.env_price_id:
        return os.environ.get(definition.env_price_id)
    return None


def build_customer_portal_return_url(base_url: str) -> str:
    return f"{base_url.rstrip('/')}/pricing?billing=manage&provider=paddle"
