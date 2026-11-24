import type { Metadata } from 'next';
import PlaygroundClient from '@/components/playground/PlaygroundClient';

export const metadata: Metadata = {
  title: 'Film Playground',
  description: 'Plan and shoot a short film shot by shot: script, cast, camera, lens, angle, dialogue and continuity.',
};

export default function PlaygroundPage() {
  return (
    <main>
      <PlaygroundClient />
    </main>
  );
}
