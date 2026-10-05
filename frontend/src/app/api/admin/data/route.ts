import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdminUser, normalizeRole } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// In-memory runtime audit log store for administrator actions
interface AuditLogEntry {
  id: string;
  admin_user: string;
  action: string;
  target: string;
  timestamp: string;
  result: 'SUCCESS' | 'FAILED';
  metadata?: Record<string, any>;
}

const RUNTIME_AUDIT_LOGS: AuditLogEntry[] = [];

// Verified platform definitions implemented in backend/extractor_service.py
const IMPLEMENTED_PLATFORMS = [
  { name: 'YouTube', domain: 'youtube.com / youtu.be', status: 'Operational', type: 'Video & Audio', maxQuality: '4K / 2160p', poTokenProtected: true },
  { name: 'Instagram', domain: 'instagram.com', status: 'Operational', type: 'Reels, Posts & Stories', maxQuality: '1080p', poTokenProtected: false },
  { name: 'X (Twitter)', domain: 'x.com / twitter.com', status: 'Operational', type: 'Video & Media Clips', maxQuality: '1080p', poTokenProtected: false },
  { name: 'TikTok', domain: 'tiktok.com', status: 'Operational', type: 'Shorts & Audio', maxQuality: '1080p', poTokenProtected: false },
  { name: 'Vimeo', domain: 'vimeo.com', status: 'Operational', type: 'Cinematic Video', maxQuality: '4K / 2160p', poTokenProtected: false },
  { name: 'Dailymotion', domain: 'dailymotion.com / dai.ly', status: 'Operational', type: 'High Bitrate Streams', maxQuality: '1080p', poTokenProtected: false },
  { name: 'Reddit', domain: 'reddit.com', status: 'Operational', type: 'Video & GIF Audio Merging', maxQuality: '1080p', poTokenProtected: false },
  { name: 'Facebook', domain: 'facebook.com / fb.watch', status: 'Operational', type: 'Public Reels & Videos', maxQuality: '1080p', poTokenProtected: false },
  { name: 'Twitch', domain: 'twitch.tv', status: 'Operational', type: 'VODs & Stream Clips', maxQuality: '1080p', poTokenProtected: false },
  { name: 'SoundCloud', domain: 'soundcloud.com', status: 'Operational', type: 'High Quality Audio', maxQuality: '320kbps MP3', poTokenProtected: false },
  { name: 'Bandcamp', domain: 'bandcamp.com', status: 'Operational', type: 'Lossless & MP3 Audio', maxQuality: 'Original Bitrate', poTokenProtected: false },
  { name: 'Bilibili', domain: 'bilibili.com', status: 'Operational', type: 'Video Streams', maxQuality: '1080p', poTokenProtected: false },
];

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const { isAdmin, user } = await verifyAdminUser(supabase);

    if (!user || !isAdmin) {
      return NextResponse.json(
        { error: 'Unauthorized: Administrator privileges required' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const section = searchParams.get('section') || 'overview';
    const backendUrl = process.env.NEXT_PUBLIC_VIDLEO_API_URL || 'http://localhost:8000';

    // 1. OVERVIEW STATS
    if (section === 'overview') {
      const { count: usersCount } = await supabase
        .from('user_roles')
        .select('*', { count: 'exact', head: true });

      let backendHealth: any = null;
      try {
        const res = await fetch(`${backendUrl}/api/health`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          backendHealth = await res.json();
        }
      } catch {
        // Backend offline or unreachable
      }

      const totalUsers = usersCount ?? 0;
      const totalJobs = backendHealth?.jobs_total ?? 0;
      const activeJobs = backendHealth?.jobs_active ?? 0;
      const successfulDownloads = backendHealth?.proxy_telemetry?.successes ?? 0;
      const failedDownloads = backendHealth?.proxy_telemetry?.failures ?? 0;
      const systemStatus = backendHealth?.status === 'ok' ? 'Operational' : 'Degraded';
      const providerCounts = backendHealth?.proxy_telemetry?.provider_counts || {};

      return NextResponse.json({
        totalUsers,
        activeUsers: totalUsers > 0 ? totalUsers : 0,
        totalDownloads: totalJobs,
        successfulDownloads,
        failedDownloads,
        activeJobs,
        providerCounts,
        systemStatus,
        lastUpdated: new Date().toISOString(),
      });
    }

    // 2. USERS
    if (section === 'users') {
      const { data: rolesData, error } = await supabase
        .from('user_roles')
        .select('user_id, role, created_at');

      if (error) {
        return NextResponse.json({ users: [], error: error.message });
      }

      const users = (rolesData || []).map((row) => ({
        id: row.user_id,
        email: row.user_id === user.id ? user.email : `User (${row.user_id.slice(0, 8)})`,
        role: normalizeRole(row.role) || 'user',
        status: 'Active',
        createdAt: row.created_at || new Date().toISOString(),
      }));

      return NextResponse.json({ users });
    }

    // 3. USER DETAILS
    if (section === 'user_details') {
      const targetUserId = searchParams.get('userId');
      if (!targetUserId) {
        return NextResponse.json({ error: 'userId is required' }, { status: 400 });
      }

      // Fetch user role
      const { data: roleRow } = await supabase
        .from('user_roles')
        .select('user_id, role, created_at')
        .eq('user_id', targetUserId)
        .maybeSingle();

      // Fetch user history if media_history table exists
      let history: any[] = [];
      try {
        const { data: histData } = await supabase
          .from('media_history')
          .select('*')
          .eq('user_id', targetUserId)
          .order('created_at', { ascending: false })
          .limit(20);
        if (histData) history = histData;
      } catch {
        history = [];
      }

      // Fetch user credits if table exists
      let credits = { bonusDownloadCredits: 0, bonusApiCredits: 0 };
      try {
        const { data: creditData } = await supabase
          .from('user_credit_grants')
          .select('bonus_download_credits, bonus_api_credits')
          .eq('user_id', targetUserId)
          .maybeSingle();
        if (creditData) {
          credits = {
            bonusDownloadCredits: creditData.bonus_download_credits || 0,
            bonusApiCredits: creditData.bonus_api_credits || 0,
          };
        }
      } catch {
        // Table not present
      }

      return NextResponse.json({
        user: {
          id: targetUserId,
          email: targetUserId === user.id ? user.email : `User (${targetUserId.slice(0, 8)})`,
          role: normalizeRole(roleRow?.role) || 'user',
          status: 'Active',
          createdAt: roleRow?.created_at || null,
        },
        credits,
        history,
      });
    }

    // 4. DOWNLOADS
    if (section === 'downloads') {
      let downloads: any[] = [];
      try {
        const { data: histData } = await supabase
          .from('media_history')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);
        if (histData && Array.isArray(histData)) {
          downloads = histData.map((d: any) => ({
            id: d.id || d.job_id,
            user: d.user_id ? `User (${d.user_id.slice(0, 8)})` : 'Anonymous',
            url: d.url || '',
            title: d.title || 'Untitled Stream',
            jobId: d.job_id || d.id,
            format: d.format || 'MP4',
            quality: d.quality || 'Standard',
            status: d.status || 'Completed',
            progress: 100,
            createdAt: d.created_at || new Date().toISOString(),
            error: d.error || null,
          }));
        }
      } catch {
        downloads = [];
      }

      return NextResponse.json({ downloads });
    }

    // 5. JOBS MONITORING
    if (section === 'jobs') {
      let backendHealth: any = null;
      try {
        const res = await fetch(`${backendUrl}/api/health`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          backendHealth = await res.json();
        }
      } catch {
        // Backend offline
      }

      const totalJobs = backendHealth?.jobs_total ?? 0;
      const processingJobs = backendHealth?.jobs_active ?? 0;
      const completedJobs = backendHealth?.proxy_telemetry?.successes ?? 0;
      const failedJobs = backendHealth?.proxy_telemetry?.failures ?? 0;
      const queuedJobs = Math.max(0, totalJobs - processingJobs - completedJobs - failedJobs);

      return NextResponse.json({
        counts: {
          total: totalJobs,
          queued: queuedJobs,
          processing: processingJobs,
          completed: completedJobs,
          failed: failedJobs,
        },
        systemStatus: backendHealth?.status === 'ok' ? 'Operational' : 'Degraded',
        recentJobs: [], // Zero synthetic data
        lastUpdated: new Date().toISOString(),
      });
    }

    // 6. SUPPORTED PLATFORMS
    if (section === 'platforms') {
      return NextResponse.json({
        platforms: IMPLEMENTED_PLATFORMS,
        totalSupported: IMPLEMENTED_PLATFORMS.length,
      });
    }

    // 7. SYSTEM HEALTH
    if (section === 'system') {
      const dbStart = performance.now();
      let dbStatus = 'Operational';
      let dbLatencyMs = 0;

      try {
        const { error } = await supabase.from('user_roles').select('user_id').limit(1);
        dbLatencyMs = Math.round(performance.now() - dbStart);
        if (error) dbStatus = 'Degraded';
      } catch {
        dbStatus = 'Unavailable';
      }

      const backendStart = performance.now();
      let backendStatus = 'Operational';
      let backendLatencyMs = 0;
      let backendDetails: any = null;

      try {
        const res = await fetch(`${backendUrl}/api/health`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(3000),
        });
        backendLatencyMs = Math.round(performance.now() - backendStart);
        if (res.ok) {
          backendDetails = await res.json();
        } else {
          backendStatus = 'Degraded';
        }
      } catch {
        backendStatus = 'Unavailable';
      }

      return NextResponse.json({
        database: {
          status: dbStatus,
          latencyMs: dbLatencyMs,
          engine: 'Supabase PostgreSQL',
        },
        extractionEngine: {
          status: backendStatus,
          latencyMs: backendLatencyMs,
          service: backendDetails?.service || 'media-extractor',
          jobsActive: backendDetails?.jobs_active ?? 0,
          jobsTotal: backendDetails?.jobs_total ?? 0,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // 8. AUDIT LOGS
    if (section === 'audit-logs') {
      return NextResponse.json({
        logs: RUNTIME_AUDIT_LOGS,
        total: RUNTIME_AUDIT_LOGS.length,
      });
    }

    return NextResponse.json({ message: 'Section data unavailable' }, { status: 404 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Error processing admin request' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const { isAdmin, user } = await verifyAdminUser(supabase);

    if (!user || !isAdmin) {
      return NextResponse.json(
        { error: 'Unauthorized: Administrator privileges required' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { action, targetUserId, newRole, metadata } = body;

    if (action === 'CHANGE_USER_ROLE') {
      if (!targetUserId || !newRole) {
        return NextResponse.json({ error: 'targetUserId and newRole are required' }, { status: 400 });
      }

      const normalizedNewRole = normalizeRole(newRole);
      if (normalizedNewRole !== 'admin' && normalizedNewRole !== 'user') {
        return NextResponse.json({ error: 'Permitted roles are admin or user' }, { status: 400 });
      }

      const { error: updateError } = await supabase
        .from('user_roles')
        .upsert(
          {
            user_id: targetUserId,
            role: normalizedNewRole,
          },
          { onConflict: 'user_id' }
        );

      if (updateError) {
        RUNTIME_AUDIT_LOGS.unshift({
          id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          admin_user: user.email || user.id,
          action: 'USER_ROLE_CHANGED',
          target: targetUserId,
          timestamp: new Date().toISOString(),
          result: 'FAILED',
          metadata: { attemptedRole: normalizedNewRole, error: updateError.message },
        });

        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      RUNTIME_AUDIT_LOGS.unshift({
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        admin_user: user.email || user.id,
        action: 'USER_ROLE_CHANGED',
        target: targetUserId,
        timestamp: new Date().toISOString(),
        result: 'SUCCESS',
        metadata: { newRole: normalizedNewRole },
      });

      return NextResponse.json({ success: true, targetUserId, role: normalizedNewRole });
    }

    if (action === 'RECORD_AUDIT_EVENT') {
      const eventName = body.event || 'ADMIN_ACTION';
      RUNTIME_AUDIT_LOGS.unshift({
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        admin_user: user.email || user.id,
        action: eventName,
        target: body.target || 'system',
        timestamp: new Date().toISOString(),
        result: 'SUCCESS',
        metadata: metadata || {},
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
