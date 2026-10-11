from backend.entitlements import build_effective_entitlement, PLAN_DEFAULTS

def test_free_and_guest_entitlements_support_4k():
    guest = PLAN_DEFAULTS["guest"]
    assert guest["4k_allowed"] is True
    assert guest["max_quality"] >= 2160
    assert guest["audio_limit"] >= 320

    free = PLAN_DEFAULTS["free"]
    assert free["4k_allowed"] is True
    assert free["max_quality"] >= 2160
    assert free["audio_limit"] >= 320

def test_effective_entitlement_for_unauthenticated_user():
    anon_ent = build_effective_entitlement({"anonymous": True, "plan": "free"})
    assert anon_ent["4k_allowed"] is True
    assert anon_ent["max_quality"] >= 2160
    assert anon_ent["audio_limit"] >= 320

if __name__ == "__main__":
    test_free_and_guest_entitlements_support_4k()
    test_effective_entitlement_for_unauthenticated_user()
    print("BACKEND FREE PRODUCT ENTITLEMENT TESTS: PASS")
