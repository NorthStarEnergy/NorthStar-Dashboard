import { headers } from 'next/headers';
import Gate from './Gate';

export default async function Home() {
  const owner = (await headers()).get('oai-authenticated-user-email')?.toLowerCase() === 'forceofnaturegenetics@gmail.com';
  return <Gate owner={owner} />;
}
