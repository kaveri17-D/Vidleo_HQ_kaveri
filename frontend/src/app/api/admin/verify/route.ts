import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdminUser } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const result = await verifyAdminUser(supabase);

    if (!result.user) {
      return NextResponse.json(
        {
          authenticated: false,
          isAdmin: false,
          role: 'unauthenticated',
          user: null,
          message: 'No active session found.',
        },
        { status: 401 }
      );
    }

    if (!result.isAdmin) {
      return NextResponse.json(
        {
          authenticated: true,
          isAdmin: false,
          role: result.role,
          user: {
            id: result.user.id,
            email: result.user.email,
          },
          message: "You don't have administrator permissions.",
        },
        { status: 403 }
      );
    }

    return NextResponse.json({
      authenticated: true,
      isAdmin: true,
      role: 'admin',
      user: {
        id: result.user.id,
        email: result.user.email,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        authenticated: false,
        isAdmin: false,
        role: 'error',
        error: error.message || 'Internal server error verifying admin status',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
