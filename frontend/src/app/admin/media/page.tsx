import { redirect } from 'next/navigation';

export default function AdminMediaRedirectPage() {
  redirect('/admin/extractions');
}
