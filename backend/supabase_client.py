import httpx
import logging
import json
from typing import Any, Optional

log = logging.getLogger("nexus.supabase_client")

class SupabaseResponse:
    def __init__(self, data: Any, error: Any = None):
        self.data = data
        self.error = error

class QueryBuilder:
    def __init__(self, table: str, url: str, key: str, service_key: str = None):
        self.table = table
        self.url = f"{url}/rest/v1/{table}"
        self.key = key
        self.service_key = service_key or key
        self.headers = {
            "apikey": self.service_key,
            "Authorization": f"Bearer {self.service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }
        self.params = {}
        self.inserted_data = None
        self.updated_data = None
        self.upsert_data = None
        self.delete_mode = False

    def select(self, columns: str = "*") -> "QueryBuilder":
        self.params["select"] = columns
        return self

    def eq(self, column: str, value: Any) -> "QueryBuilder":
        self.params[column] = f"eq.{value}"
        return self
        
    def order(self, column: str, desc: bool = False) -> "QueryBuilder":
        self.params["order"] = f"{column}.{'desc' if desc else 'asc'}"
        return self

    def limit(self, count: int) -> "QueryBuilder":
        self.params["limit"] = str(count)
        return self

    def maybe_single(self) -> "QueryBuilder":
        self.headers["Accept"] = "application/vnd.pgrst.object+json"
        return self
        
    def maybeSingle(self) -> "QueryBuilder":
        return self.maybe_single()

    def execute(self) -> SupabaseResponse:
        if self.inserted_data is not None:
            return self.execute_post(self.inserted_data, "POST")
        if self.updated_data is not None:
            return self.execute_post(self.updated_data, "PATCH")
        if self.upsert_data is not None:
            return self.execute_post(self.upsert_data, "UPSERT")
        if self.delete_mode:
            return self.execute_delete()

        with httpx.Client() as client:
            try:
                res = client.get(self.url, headers=self.headers, params=self.params, timeout=10.0)
                if res.status_code >= 400:
                    log.error(f"Supabase GET Failed: {res.text}")
                    return SupabaseResponse(None, res.json())
                return SupabaseResponse(res.json() if res.text else None)
            except Exception as e:
                log.error(f"Supabase Execute Error: {e}")
                return SupabaseResponse(None, str(e))

    def insert(self, data: dict) -> "QueryBuilder":
        self.inserted_data = data
        return self

    def update(self, data: dict) -> "QueryBuilder":
        self.updated_data = data
        return self

    def upsert(self, data: dict, on_conflict: str | None = None) -> "QueryBuilder":
        self.upsert_data = data
        self.headers["Prefer"] = "return=representation,resolution=merge-duplicates"
        if on_conflict:
            self.params["on_conflict"] = on_conflict
        return self

    def delete(self) -> "QueryBuilder":
        self.delete_mode = True
        self.headers["Prefer"] = "return=minimal"
        return self

    def execute_post(self, data: dict, method: str = "POST") -> SupabaseResponse:
        with httpx.Client() as client:
            try:
                if method in {"POST", "UPSERT"}:
                    resp = client.post(self.url, headers=self.headers, json=data, params=self.params, timeout=10.0)
                else: # PATCH
                    resp = client.patch(self.url, headers=self.headers, json=data, params=self.params, timeout=10.0)
                
                if resp.status_code >= 400:
                    return SupabaseResponse(None, resp.json())
                return SupabaseResponse(resp.json() if resp.text else None)
            except Exception as e:
                return SupabaseResponse(None, str(e))

    def execute_delete(self) -> SupabaseResponse:
        with httpx.Client() as client:
            try:
                resp = client.delete(self.url, headers=self.headers, params=self.params, timeout=10.0)
                if resp.status_code >= 400:
                    return SupabaseResponse(None, resp.json())
                return SupabaseResponse(resp.json() if resp.text else None)
            except Exception as e:
                return SupabaseResponse(None, str(e))

    # Overloading execute for POST/PATCH
    def execute_insert(self) -> SupabaseResponse:
        return self.execute_post(self.inserted_data, "POST")

    def execute_update(self) -> SupabaseResponse:
        return self.execute_post(self.updated_data, "PATCH")

# Mock RPC Client
class RPCBuilder:
    def __init__(self, fn: str, url: str, key: str):
        self.url = f"{url}/rest/v1/rpc/{fn}"
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def execute(self, params: dict = None) -> SupabaseResponse:
        with httpx.Client() as client:
            res = client.post(self.url, headers=self.headers, json=params or {}, timeout=10.0)
            return SupabaseResponse(res.json() if res.text else None)

class Client:
    def __init__(self, url: str, key: str):
        self.url = url
        self.key = key

    def table(self, table: str) -> QueryBuilder:
        return QueryBuilder(table, self.url, self.key)
        
    def from_(self, table: str) -> QueryBuilder:
        return self.table(table)

    def rpc(self, fn: str, params: dict = None) -> Any:
        # We handle this manually in our code usually
        class RPCWrapper:
            def __init__(self, parent, fn, params):
                self.parent = parent
                self.fn = fn
                self.params = params
            def execute(self):
                with httpx.Client() as client:
                    res = client.post(f"{self.parent.url}/rest/v1/rpc/{self.fn}", 
                                      headers={"apikey": self.parent.key, "Authorization": f"Bearer {self.parent.key}"},
                                      json=self.params or {})
                    return SupabaseResponse(res.json() if res.text else None)
        return RPCWrapper(self, fn, params)

def create_client(url: str, key: str) -> Client:
    return Client(url, key)
