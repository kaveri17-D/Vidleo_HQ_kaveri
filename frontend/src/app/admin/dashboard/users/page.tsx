'use client';

import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Search, 
  ShieldCheck, 
  UserCheck, 
  UserX, 
  Mail, 
  Calendar, 
  X, 
  AlertCircle, 
  RefreshCw,
  Clock,
  Download,
  CreditCard,
  ChevronRight,
  Loader2
} from 'lucide-react';

interface UserRecord {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt?: string;
}

interface UserDetailsData {
  user: UserRecord;
  credits: { bonusDownloadCredits: number; bonusApiCredits: number };
  history: any[];
}

export default function AdminUsersDashboardPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserDetails, setSelectedUserDetails] = useState<UserDetailsData | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/data?section=users', {
        method: 'GET',
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const openUserDetails = async (userId: string) => {
    setSelectedUserId(userId);
    setLoadingDetails(true);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/admin/data?section=user_details&userId=${userId}`, {
        method: 'GET',
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedUserDetails(data);
      }
    } catch (err) {
      console.error('Failed to load user details:', err);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleRoleToggle = async (userId: string, currentRole: string) => {
    const newRole = currentRole.toLowerCase() === 'admin' ? 'user' : 'admin';
    setActionLoading(true);
    setActionMessage(null);

    try {
      const res = await fetch('/api/admin/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'CHANGE_USER_ROLE',
          targetUserId: userId,
          newRole,
        }),
      });

      if (res.ok) {
        setActionMessage(`Role successfully updated to ${newRole}`);
        // Refresh local state
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
        );
        if (selectedUserDetails) {
          setSelectedUserDetails({
            ...selectedUserDetails,
            user: { ...selectedUserDetails.user, role: newRole },
          });
        }
      } else {
        const err = await res.json();
        setActionMessage(`Failed: ${err.error || 'Permission error'}`);
      }
    } catch {
      setActionMessage('Failed to update user role');
    } finally {
      setActionLoading(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.role.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole =
      roleFilter === 'All' || u.role.toLowerCase() === roleFilter.toLowerCase();
    return matchesSearch && matchesRole;
  });

  return (
    <div className="space-y-6 text-white font-sans">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold tracking-tight font-display text-white">
              User Directory & Access Control
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-[#5B4BFF]/20 border border-[#5B4BFF]/40 text-[#5B4BFF] text-[10px] font-mono font-bold uppercase">
              Supabase Auth & Roles
            </span>
          </div>
          <p className="text-xs text-white/60 pt-1">
            View registered user accounts, role definitions, and access permissions from public.user_roles.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchUsers}
          disabled={loading}
          className="px-3.5 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-semibold text-white/80 hover:text-white transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Users</span>
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-[#12121A] border border-white/10">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by ID, email, or role..."
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder-white/30 text-xs focus:outline-none focus:border-[#5B4BFF]"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {['All', 'Admin', 'User'].map((tab) => (
            <button
              key={tab}
              onClick={() => setRoleFilter(tab)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                roleFilter === tab
                  ? 'bg-[#5B4BFF] text-white shadow-md'
                  : 'bg-white/[0.05] text-white/60 hover:text-white'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-[#12121A] border border-white/10 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-white/80">
            <thead className="bg-white/[0.03] text-[10px] font-mono uppercase tracking-wider text-white/50 border-b border-white/10">
              <tr>
                <th className="px-6 py-4">Account / Identifier</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Created Date</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-white/40">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-[#5B4BFF]" />
                    <span className="font-mono text-xs">Querying public.user_roles...</span>
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-white/40">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="font-mono text-xs">No users found matching query</p>
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isAdmin = u.role.toLowerCase() === 'admin';
                  return (
                    <tr key={u.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-bold text-white text-xs">{u.email}</div>
                        <div className="text-[10px] font-mono text-white/40">{u.id}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                            isAdmin
                              ? 'bg-[#5B4BFF]/20 text-[#5B4BFF] border border-[#5B4BFF]/30'
                              : 'bg-white/10 text-white/70'
                          }`}
                        >
                          {isAdmin && <ShieldCheck className="w-3 h-3" />}
                          {u.role}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1.5 text-emerald-400 font-mono text-[11px]">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          {u.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-white/50 text-[11px]">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => openUserDetails(u.id)}
                          className="px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-[11px] font-semibold text-white/90 hover:text-white transition-all inline-flex items-center gap-1 cursor-pointer"
                        >
                          <span>Inspect</span>
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Details Drawer Modal */}
      {selectedUserId && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-[#12121A] border border-white/15 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl relative">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#5B4BFF]/20 text-[#5B4BFF] flex items-center justify-center">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">User Details & Controls</h3>
                  <p className="text-[11px] font-mono text-white/40">ID: {selectedUserId}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUserId(null)}
                className="w-8 h-8 rounded-xl bg-white/[0.06] hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {loadingDetails ? (
              <div className="py-12 text-center text-white/40">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-[#5B4BFF]" />
                <span className="font-mono text-xs">Loading user record...</span>
              </div>
            ) : selectedUserDetails ? (
              <div className="space-y-6">
                {actionMessage && (
                  <div className="p-3 rounded-xl bg-white/[0.05] border border-white/10 text-xs font-mono text-[#5B4BFF]">
                    {actionMessage}
                  </div>
                )}

                {/* Account Information */}
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 space-y-2">
                  <h4 className="text-[10px] font-mono uppercase text-white/40 tracking-wider">Account Overview</h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-white/40 block text-[10px]">Email</span>
                      <span className="font-semibold text-white truncate block">{selectedUserDetails.user.email}</span>
                    </div>
                    <div>
                      <span className="text-white/40 block text-[10px]">Role</span>
                      <span className="font-mono font-bold text-[#5B4BFF] uppercase">{selectedUserDetails.user.role}</span>
                    </div>
                    <div>
                      <span className="text-white/40 block text-[10px]">Account Status</span>
                      <span className="text-emerald-400 font-mono">{selectedUserDetails.user.status}</span>
                    </div>
                    <div>
                      <span className="text-white/40 block text-[10px]">Registered On</span>
                      <span className="font-mono text-white/60">
                        {selectedUserDetails.user.createdAt ? new Date(selectedUserDetails.user.createdAt).toLocaleDateString() : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Usage / Credits */}
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 space-y-2">
                  <h4 className="text-[10px] font-mono uppercase text-white/40 tracking-wider">Usage & Credits</h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                      <span className="text-white/40 block text-[10px] font-mono">Bonus Downloads</span>
                      <span className="text-lg font-bold text-white font-mono">
                        {selectedUserDetails.credits?.bonusDownloadCredits ?? 0}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                      <span className="text-white/40 block text-[10px] font-mono">Bonus API Credits</span>
                      <span className="text-lg font-bold text-white font-mono">
                        {selectedUserDetails.credits?.bonusApiCredits ?? 0}
                      </span>
                    </div>
                  </div>
                </div>

                {/* User Download History */}
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 space-y-2">
                  <h4 className="text-[10px] font-mono uppercase text-white/40 tracking-wider">Download History</h4>
                  {selectedUserDetails.history && selectedUserDetails.history.length > 0 ? (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {selectedUserDetails.history.map((h: any, i: number) => (
                        <div key={i} className="p-2.5 rounded-xl bg-white/[0.02] text-xs flex items-center justify-between">
                          <span className="truncate max-w-[280px] text-white/80">{h.title || h.url}</span>
                          <span className="font-mono text-[10px] text-white/40">{h.format || 'MP4'}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-white/40 font-mono py-2">
                      No download history recorded in media_history for this account.
                    </p>
                  )}
                </div>

                {/* Available Account Controls */}
                <div className="pt-2 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => handleRoleToggle(selectedUserId, selectedUserDetails.user.role)}
                    disabled={actionLoading}
                    className="flex-1 h-11 rounded-xl bg-[#5B4BFF] hover:bg-[#4d3df7] text-white text-xs font-bold font-mono uppercase transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {actionLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : selectedUserDetails.user.role.toLowerCase() === 'admin' ? (
                      <>
                        <UserX className="w-4 h-4" />
                        <span>Demote to User</span>
                      </>
                    ) : (
                      <>
                        <UserCheck className="w-4 h-4" />
                        <span>Promote to Admin</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedUserId(null)}
                    className="px-5 h-11 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-semibold text-white/80 hover:text-white transition-all cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-white/40 text-center py-6">Could not load details for this account.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
