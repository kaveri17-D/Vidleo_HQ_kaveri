import { redirect } from 'next/navigation';

export default function AdminDownloadsRedirectPage() {
  redirect('/admin/dashboard/downloads');
}
