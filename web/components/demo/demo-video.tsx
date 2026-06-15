'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { standardEase } from '@/components/motion/fade-in';

export function DemoVideo() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.play().catch(() => {
              /* autoplay blocked — user can click play */
            });
          } else {
            el.pause();
          }
        }
      },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 40, scale: 0.97 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: '-100px' }}
      transition={{ duration: 0.7, ease: standardEase }}
      className="relative mx-auto max-w-5xl rounded-xl overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg-elev)] shadow-2xl shadow-black/40 mt-16"
    >
      <video
        ref={ref}
        src="/cachelane.mp4?v=2"
        muted
        playsInline
        loop
        controls
        preload="metadata"
        className="w-full block"
      />
    </motion.div>
  );
}
