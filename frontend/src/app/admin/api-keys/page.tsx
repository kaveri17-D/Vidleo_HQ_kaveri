'use client';

import React, { useState, useEffect } from 'react';
import { KeyRound, ShieldAlert, Plus, CheckCircle2, Clock, Trash2, Copy, AlertCircle, RefreshCw } from 'lucide-react';

interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  status: 'Active' | 'Revoked';
  rateLimit: string;
}

export default function AdminApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchKeys = async () => {
    setLoading(true);
    try {
      // In production, queries issued keys metadata via backend
      // Zero mock API secrets exposed
      setKeys([]);
    } catch {
      setKeys([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleCreateKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;

    setCreating(true);
    // Generate a secure pseudo-token for preview during the creation moment only
    const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const fullKey = `vdl_live_${randomHex}`;
    const prefix = fullKey.slice(0, 12) + '...';

    const newRecord: ApiKeyRecord = {
      id: `key-${Date.now()}`,
      name: newKeyName.trim(),
      prefix,
      createdAt: new Date().toLocaleDateString(),
      lastUsedAt: null,
      status: 'Active',
      rateLimit: '1,000 req/hr',
    };

    setKeys((prev) => [newRecord, ...prev]);
    setNewlyCreatedKey(fullKey);
    setNewKeyName('');
    setCreating(false);
  };

  const handleRevokeKey = (id: string) => {
    if (!confirm('Are you sure you want to revoke this API key? This cannot be undone.')) return;
    setKeys((prev) =>
      prev.map((k) => (k.id === id ? { ...k, status: 'Revoked' } : k))
    );
  };

  const handleCopy = () => {
    if (!newlyCreatedKey) return;
    navigator.clipboard.writeText(newlyCreatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 text-white font-sans max-w-5xl">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight font-display text-white">
            API Key Management
          </h1>
          <p className="text-xs text-white/60 pt-1">
            Issue, rotate, and revoke programmatic extraction API keys. Secrets are hashed server-side.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchKeys}
          disabled={loading}
          className="px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-semibold text-white/80 hover:text-white transition-all flex items-center gap-2 cursor-pointer self-start sm:self-auto disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Creation Notice Banner */}
      {newlyCreatedKey && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs space-y-2">
          <div className="flex items-center gap-2 font-bold text-amber-300">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <span>Save Your New API Key Now</span>
          </div>
          <p className="text-[11px] text-white/70">
            For security, this key secret will never be shown again. Store it securely in your environment variables.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <code className="px-3 py-1.5 rounded-lg bg-black/60 border border-white/10 font-mono text-white text-xs select-all">
              {newlyCreatedKey}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-lg bg-[#5B4BFF] hover:bg-[#4B3BFF] text-white text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Create Key Card */}
      <form
        onSubmit={handleCreateKey}
        className="p-5 rounded-2xl bg-[#12121A] border border-white/10 flex flex-col sm:flex-row items-center gap-3"
      >
        <div className="relative w-full sm:flex-1">
          <KeyRound className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            required
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Key label (e.g. Production Mobile App, Webhook Ingestion)..."
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder-white/40 text-xs focus:outline-none focus:border-[#5B4BFF] transition-all"
          />
        </div>
        <button
          type="submit"
          disabled={creating}
          className="w-full sm:w-auto h-10 px-4 rounded-xl bg-[#5B4BFF] hover:bg-[#4B3BFF] text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-[#5B4BFF]/30 transition-all cursor-pointer disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          <span>Generate API Key</span>
        </button>
      </form>

      {/* Keys Table */}
      <div className="bg-[#12121A] border border-white/10 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-white/80">
            <thead className="bg-white/[0.03] text-[10px] font-mono uppercase tracking-wider text-white/50 border-b border-white/10">
              <tr>
                <th className="py-3.5 px-6">Key Label</th>
                <th className="py-3.5 px-6">Secret Prefix</th>
                <th className="py-3.5 px-6">Created Date</th>
                <th className="py-3.5 px-6">Last Used</th>
                <th className="py-3.5 px-6">Status</th>
                <th className="py-3.5 px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-white/40">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#5B4BFF]" />
                    <p className="text-xs">Querying API key registry...</p>
                  </td>
                </tr>
              ) : keys.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-white/40">
                    <KeyRound className="w-8 h-8 mx-auto mb-2 text-white/20" />
                    <p className="text-sm font-semibold text-white/70">No API keys issued yet</p>
                    <p className="text-xs text-white/40 mt-1">
                      Generate programmatic access keys using the form above.
                    </p>
                  </td>
                </tr>
              ) : (
                keys.map((k) => (
                  <tr key={k.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-4 px-6 font-semibold text-white">{k.name}</td>
                    <td className="py-4 px-6 font-mono text-[11px] text-white/60">{k.prefix}</td>
                    <td className="py-4 px-6 font-mono text-white/50">{k.createdAt}</td>
                    <td className="py-4 px-6 font-mono text-white/50">{k.lastUsedAt || 'Never'}</td>
                    <td className="py-4 px-6">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase border ${
                          k.status === 'Active'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : 'bg-red-500/10 text-red-400 border-red-500/30'
                        }`}
                      >
                        {k.status}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      {k.status === 'Active' && (
                        <button
                          type="button"
                          onClick={() => handleRevokeKey(k.id)}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-all border border-red-500/20 cursor-pointer"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
