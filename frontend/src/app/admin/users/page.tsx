'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { 
  Users, 
  Search, 
  Filter, 
  ShieldCheck, 
  Mail, 
  Calendar, 
  UserCheck, 
  UserX, 
  Trash2, 
  MoreVertical,
  X,
  AlertCircle
} from 'lucide-react';

interface UserRecord {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string;
  role: string;
  created_at?: string;
  provider?: string;
  status?: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);

  const supabase = createClient();

  useEffect(() => {
    async function fetchUsers() {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .order('created_at', { ascending: false });

        if (!error && data) {
          const mapped: UserRecord[] = data.map((item) => ({
            id: item.id,
            email: item.email || 'No email',
            full_name: item.full_name || 'Vidleo User',
            avatar_url: item.avatar_url,
            role: item.role || 'user',
            created_at: item.created_at || new Date().toISOString(),
            provider: item.avatar_url ? 'Google OAuth' : 'Email/Password',
            status: 'Active',
          }));
          setUsers(mapped);
        }
      } catch (err) {
        console.warn('Unable to load users list:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchUsers();
  }, [supabase]);

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === 'All' || u.role.toLowerCase() === roleFilter.toLowerCase();
    return matchesSearch && matchesRole;
  });

  return (
    <div className="space-y-6 text-white font-sans">
      
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight font-display text-white">
            User Directory Management
          </h1>
          <p className="text-xs text-white/60 pt-1">
            View registered Vidleo users, OAuth profiles, roles, and administrative statuses.
          </p>
        </div>
      </div>

      {/* Controls Bar: Search & Filter */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-[#12121A] border border-white/10">
        
        {/* Search Input */}
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, email, or user ID..."
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-white/[0.05] border border-white/10 text-white placeholder-white/40 text-xs focus:outline-none focus:border-[#5B4BFF] transition-all"
          />
        </div>

        {/* Role Filter Tabs */}
        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          {['All', 'Admin', 'User'].map((tab) => (
            <button
              key={tab}
              onClick={() => setRoleFilter(tab)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                roleFilter === tab
                  ? 'bg-[#5B4BFF] text-white shadow-md shadow-[#5B4BFF]/30'
                  : 'bg-white/[0.05] text-white/60 hover:text-white hover:bg-white/10'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Users Table Card */}
      <div className="bg-[#12121A] border border-white/10 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-white/80">
            <thead className="bg-white/[0.03] text-[10px] font-mono uppercase tracking-wider text-white/50 border-b border-white/10">
              <tr>
                <th className="py-3.5 px-5">User Profile</th>
                <th className="py-3.5 px-5">Authentication Provider</th>
                <th className="py-3.5 px-5">Role</th>
                <th className="py-3.5 px-5">Status</th>
                <th className="py-3.5 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-white/50">
                    Loading users database...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-white/50">
                    <Users className="w-8 h-8 text-white/20 mx-auto mb-2" />
                    No users found matching your search.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-4 px-5">
                      <div className="flex items-center gap-3">
                        {user.avatar_url ? (
                          <img
                            src={user.avatar_url}
                            alt={user.full_name}
                            className="w-9 h-9 rounded-full object-cover border border-white/20"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-[#5B4BFF] text-white font-bold flex items-center justify-center text-xs">
                            {user.full_name[0].toUpperCase()}
                          </div>
                        )}
                        <div>
                          <p className="font-semibold text-white text-xs">{user.full_name}</p>
                          <p className="text-[11px] text-white/50 font-mono">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-5 font-mono text-[11px] text-white/70">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/10">
                        {user.provider}
                      </span>
                    </td>
                    <td className="py-4 px-5">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                          user.role === 'admin'
                            ? 'bg-[#5B4BFF]/20 text-[#5B4BFF] border border-[#5B4BFF]/40'
                            : 'bg-white/10 text-white/80'
                        }`}
                      >
                        {user.role === 'admin' && <ShieldCheck className="w-3 h-3" />}
                        {user.role}
                      </span>
                    </td>
                    <td className="py-4 px-5">
                      <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium text-xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-2xs" />
                        Active
                      </span>
                    </td>
                    <td className="py-4 px-5 text-right">
                      <button
                        onClick={() => setSelectedUser(user)}
                        className="px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/10 text-white/80 hover:text-white transition-all text-xs font-medium cursor-pointer"
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Details Modal */}
      {selectedUser && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#12121A] border border-white/10 rounded-2xl p-6 max-w-md w-full space-y-5 text-white">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="font-bold text-base font-display">User Profile Details</h3>
              <button
                onClick={() => setSelectedUser(null)}
                className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-white/50 block font-mono text-[10px] uppercase">User ID</span>
                <span className="font-mono text-white/90 break-all">{selectedUser.id}</span>
              </div>
              <div>
                <span className="text-white/50 block font-mono text-[10px] uppercase">Full Name</span>
                <span className="font-semibold text-white">{selectedUser.full_name}</span>
              </div>
              <div>
                <span className="text-white/50 block font-mono text-[10px] uppercase">Email</span>
                <span className="font-semibold text-white">{selectedUser.email}</span>
              </div>
              <div>
                <span className="text-white/50 block font-mono text-[10px] uppercase">Assigned Role</span>
                <span className="font-semibold text-[#5B4BFF] uppercase">{selectedUser.role}</span>
              </div>
            </div>

            <div className="pt-3 border-t border-white/10 flex justify-end gap-2">
              <button
                onClick={() => setSelectedUser(null)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
