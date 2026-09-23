import { redirect } from 'next/navigation';
import { EXTERNAL_LINKS } from '@/config/links';

export default function ClipperXPage() {
  redirect(EXTERNAL_LINKS.CLIPPER_X);
}
