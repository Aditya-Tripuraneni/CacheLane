'use client';

import { motion } from 'framer-motion';

export const standardEase: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94];

type Props = {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'header' | 'article' | 'aside';
};

export function FadeIn({ children, delay = 0, className, as = 'div' }: Props) {
  const Comp = motion[as];

  return (
    <Comp
      className={className}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.45, ease: standardEase, delay }}
    >
      {children}
    </Comp>
  );
}
