import asyncio
import os
import sys

# Ensure backend folder is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.middleware.credit_gate import (
    reserve_credits,
    commit_credits,
    refund_credits,
    populate_hot_balance_if_needed,
    supabase
)
from backend.api_v1.middleware import _get_redis_client

USER_ID = "1c867df5-a7af-4807-a204-02dc6785e0a4"
JOB_ID = "test_verification_job_123"

async def test_flow():
    redis_client = _get_redis_client()
    if redis_client is None:
        print("FAIL: Redis client not available")
        return
    if supabase is None:
        print("FAIL: Supabase client not available")
        return

    print("Step 1: Set initial credits in Supabase to 10")
    supabase.table("profiles").update({"clip_credits": 10, "total_credits_consumed": 0}).eq("id", USER_ID).execute()
    
    # Clear Redis cache
    balance_key = f"tenant:{USER_ID}:credits"
    reserved_key = f"tenant:{USER_ID}:reserved"
    await redis_client.delete(balance_key)
    await redis_client.delete(reserved_key)

    print("Step 2: Populate hot balance and verify")
    await populate_hot_balance_if_needed(USER_ID)
    hot_bal = await redis_client.hget(balance_key, "available")
    print(f"  Hot balance in Redis: {hot_bal}")
    assert int(hot_bal) == 10, f"Expected 10, got {hot_bal}"

    print("Step 3: Reserve 1 credit")
    status, val1, val2 = await reserve_credits(USER_ID, JOB_ID, cost=1, operation="download")
    print(f"  Reserve status: {status}, val1 (new balance): {val1}, val2 (cost): {val2}")
    assert status == 1, f"Expected 1, got {status}"
    assert val1 == 9, f"Expected new balance 9, got {val1}"

    # Verify Redis reservation
    reserved_cost = await redis_client.hget(reserved_key, JOB_ID)
    print(f"  Reserved in Redis: {reserved_cost}")
    assert int(reserved_cost) == 1, f"Expected 1, got {reserved_cost}"

    # Verify Supabase is still 10 (deferred update)
    res = supabase.table("profiles").select("clip_credits,total_credits_consumed").eq("id", USER_ID).maybe_single().execute()
    db_credits = res.data["clip_credits"]
    db_consumed = res.data["total_credits_consumed"]
    print(f"  Supabase credits: {db_credits}, consumed: {db_consumed}")
    assert db_credits == 10, f"Expected 10, got {db_credits}"
    assert db_consumed == 0, f"Expected 0, got {db_consumed}"

    print("Step 4: Commit 1 credit")
    await commit_credits(USER_ID, JOB_ID, cost=1)

    # Verify reservation is deleted
    reserved_cost = await redis_client.hget(reserved_key, JOB_ID)
    print(f"  Reserved after commit: {reserved_cost}")
    assert reserved_cost is None, f"Expected None, got {reserved_cost}"

    # Verify Supabase is now 9, and consumed is 1
    res = supabase.table("profiles").select("clip_credits,total_credits_consumed").eq("id", USER_ID).maybe_single().execute()
    db_credits = res.data["clip_credits"]
    db_consumed = res.data["total_credits_consumed"]
    print(f"  Supabase credits after commit: {db_credits}, consumed: {db_consumed}")
    assert db_credits == 9, f"Expected 9, got {db_credits}"
    assert db_consumed == 1, f"Expected 1, got {db_consumed}"

    print("Step 5: Test Refund flow")
    # Reset Supabase to 10
    supabase.table("profiles").update({"clip_credits": 10, "total_credits_consumed": 0}).eq("id", USER_ID).execute()
    await redis_client.delete(balance_key)
    await redis_client.delete(reserved_key)
    await populate_hot_balance_if_needed(USER_ID)

    # Reserve
    status, val1, val2 = await reserve_credits(USER_ID, JOB_ID, cost=1, operation="download")
    print(f"  Reserved for refund test. Status: {status}, new balance: {val1}")
    assert status == 1
    assert val1 == 9

    # Refund
    await refund_credits(USER_ID, JOB_ID, cost=1)

    # Verify reservation is deleted and Redis balance is back to 10
    reserved_cost = await redis_client.hget(reserved_key, JOB_ID)
    hot_bal = await redis_client.hget(balance_key, "available")
    print(f"  Reserved after refund: {reserved_cost}, Redis balance: {hot_bal}")
    assert reserved_cost is None
    assert int(hot_bal) == 10

    # Verify Supabase remains 10
    res = supabase.table("profiles").select("clip_credits").eq("id", USER_ID).maybe_single().execute()
    db_credits = res.data["clip_credits"]
    print(f"  Supabase credits after refund: {db_credits}")
    assert db_credits == 10

    print("Step 6: Test Insufficient credits")
    # Set Supabase to 0
    supabase.table("profiles").update({"clip_credits": 0, "total_credits_consumed": 0}).eq("id", USER_ID).execute()
    await redis_client.delete(balance_key)
    await populate_hot_balance_if_needed(USER_ID)

    status, val1, val2 = await reserve_credits(USER_ID, JOB_ID, cost=1, operation="download")
    print(f"  Reserve status (expecting -1): {status}, val1 (available): {val1}, val2 (cost): {val2}")
    assert status == -1, f"Expected -1, got {status}"
    assert val1 == 0, f"Expected available 0, got {val1}"

    # Reset Supabase back to 10 for the user to keep things clean
    supabase.table("profiles").update({"clip_credits": 10, "total_credits_consumed": 0}).eq("id", USER_ID).execute()
    await redis_client.delete(balance_key)
    print("ALL TESTS PASSED SUCCESSFULLY! 🚀")

if __name__ == "__main__":
    asyncio.run(test_flow())
