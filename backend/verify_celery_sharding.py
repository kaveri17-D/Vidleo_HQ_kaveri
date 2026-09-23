import os
import sys

# Ensure backend folder is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.celery_app import celery_app, celery_available
import backend.tasks

def verify_sharding():
    print("Step 1: Check Celery availability...")
    if not celery_available:
        print("  Celery is not available. Ensure Celery is installed.")
        sys.exit(1)
    print("  Celery is available. Broker URL:", celery_app.conf.broker_url)

    print("\nStep 2: Check registered tasks...")
    registered_tasks = set(celery_app.tasks.keys())
    
    expected_tasks = [
        "tasks.metadata_probe_task",
        "tasks.download_delivery_task",
        "backend.workers.proxy_state.metadata_probe_task",
        "backend.workers.proxy_state.link_validation_task",
        "backend.workers.syndication.webhook_dispatch_task",
        "backend.workers.syndication.execute_platform_upload_task",
    ]

    missing = []
    for task_name in expected_tasks:
        if task_name in registered_tasks:
            print(f"  [PASS] Task registered: {task_name}")
        else:
            print(f"  [FAIL] Task NOT registered: {task_name}")
            missing.append(task_name)

    print("\nStep 3: Check queue routing maps...")
    routes = celery_app.conf.task_routes
    if not routes:
        print("  [FAIL] No task routing configured.")
        sys.exit(1)

    expected_routes = {
        "tasks.metadata_probe_task": "meta",
        "backend.workers.proxy_state.metadata_probe_task": "meta",
        "backend.workers.proxy_state.link_validation_task": "meta",
        "tasks.download_delivery_task": "render",
        "backend.workers.syndication.webhook_dispatch_task": "syndicate",
        "backend.workers.syndication.execute_platform_upload_task": "syndicate",
    }

    mismatches = []
    for task_name, expected_queue in expected_routes.items():
        route = routes.get(task_name)
        if not route:
            print(f"  [FAIL] No route defined for {task_name}")
            mismatches.append(task_name)
            continue
        
        actual_queue = route.get("queue")
        if actual_queue == expected_queue:
            print(f"  [PASS] {task_name} -> Queue: {actual_queue}")
        else:
            print(f"  [FAIL] {task_name} -> Queue: {actual_queue} (Expected: {expected_queue})")
            mismatches.append(task_name)

    print("\nStep 4: Check Celery hardening parameters...")
    prefetch = celery_app.conf.worker_prefetch_multiplier
    acks_late = celery_app.conf.task_acks_late
    max_tasks = celery_app.conf.worker_max_tasks_per_child

    print(f"  Prefetch multiplier (expected 1): {prefetch}")
    print(f"  Acks late (expected True): {acks_late}")
    print(f"  Max tasks per child (expected 50): {max_tasks}")

    assert prefetch == 1, "Prefetch multiplier must be 1"
    assert acks_late is True, "Acks late must be True"
    assert max_tasks == 50, "Max tasks per child must be 50"
    print("  [PASS] Hardening parameters are correct.")

    if missing or mismatches:
        print(f"\nVerification FAILED: {len(missing)} missing tasks, {len(mismatches)} incorrect routes.")
        sys.exit(1)
    else:
        print("\nALL CELERY ROUTING AND SHARDING VERIFICATIONS PASSED!")

if __name__ == "__main__":
    verify_sharding()
