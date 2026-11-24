import { publicConfig } from '@/lib/server/env';
import { json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export function GET() {
  return json(publicConfig());
}
